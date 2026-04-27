"use strict";

const http = require("http");
const https = require("https");
const { Device } = require("playactor/dist/device");
const { DeviceStatus } = require("playactor/dist/discovery/model");
const { PLUGIN_NAME } = require("./settings");
const locales = require("./locales");

// ------------------------------------------------------------
// HTTP utilities
// ------------------------------------------------------------
function httpGet(url) {
    return new Promise((resolve, reject) => {
        if (!url) return resolve({ title: null });

        const client = url.startsWith("https") ? https : http;
        const req = client.get(url, (res) => {
            let buffer = "";
            res.on("data", (chunk) => buffer += chunk);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(buffer));
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on("error", reject);
        req.end();
    });
}

function timeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout")), ms);
        promise
            .then((v) => { clearTimeout(timer); resolve(v); })
            .catch((e) => { clearTimeout(timer); reject(e); });
    });
}

// ------------------------------------------------------------
// PlayStation Accessory
// ------------------------------------------------------------
class PlaystationAccessory {
    constructor(platform, deviceInfo) {
        this.platform = platform;
        this.deviceInformation = deviceInfo;

        this.api = platform.api;
        this.Service = platform.Service;
        this.Characteristic = platform.Characteristic;

        // Load language
        this.lang = locales[this.platform.config.language] || locales.en;

        this.lockUpdate = false;
        this.lockSetOn = false;
        this.kLockTimeout = 20000;

        this.dynamicTitleSource = null;
        this.titleIDs = [];
        this.lastTitle = null;
        this._lastAwakeState = null;

        const uuid = this.api.hap.uuid.generate(deviceInfo.id);
        const accessory = new this.api.platformAccessory(deviceInfo.name, uuid);
        this.accessory = accessory;

        accessory.category = 35;

        // Accessory information
        accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, "Sony")
            .setCharacteristic(this.Characteristic.Model, deviceInfo.type)
            .setCharacteristic(this.Characteristic.SerialNumber, deviceInfo.id)
            .setCharacteristic(this.Characteristic.FirmwareRevision, deviceInfo.systemVersion);

        // Television service
        this.tvService =
            accessory.getService(this.Service.Television) ||
            accessory.addService(this.Service.Television);

        this.tvService
            .setCharacteristic(this.Characteristic.ConfiguredName, deviceInfo.name)
            .setCharacteristic(
                this.Characteristic.SleepDiscoveryMode,
                this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
            );

        this.tvService
            .getCharacteristic(this.Characteristic.Active)
            .onSet(this.setOn.bind(this))
            .onGet(this.getOn.bind(this));

        this.tvService
            .getCharacteristic(this.Characteristic.RemoteKey)
            .onSet((value) => {
                this.platform.log.debug(`[${deviceInfo.id}] RemoteKey not implemented`, value);
            });

        this.tvService.setCharacteristic(this.Characteristic.ActiveIdentifier, 0);

        // Initial placeholder title
        this.addTitle("PSAXXXX", this.lang.loading, 0);

        // Start update loops
        this.startTitleUpdateLoop();
        this.updateGameTitleNow();

        this.tvService
            .getCharacteristic(this.Characteristic.ActiveIdentifier)
            .onSet(async () => { return; });

        this.tick = setInterval(
            this.updateDeviceInformations.bind(this),
            this.platform.config.pollInterval || 120000
        );

        this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    }

    // ------------------------------------------------------------
    // Dynamic InputSource
    // ------------------------------------------------------------
    addTitle(id, name, index) {
        const src = new this.Service.InputSource(name, id);

        src.setCharacteristic(this.Characteristic.Identifier, index)
            .setCharacteristic(this.Characteristic.Name, name)
            .setCharacteristic(this.Characteristic.ConfiguredName, name)
            .setCharacteristic(
                this.Characteristic.IsConfigured,
                this.Characteristic.IsConfigured.CONFIGURED
            )
            .setCharacteristic(
                this.Characteristic.InputSourceType,
                this.Characteristic.InputSourceType.APPLICATION
            )
            .setCharacteristic(
                this.Characteristic.CurrentVisibilityState,
                this.Characteristic.CurrentVisibilityState.SHOWN
            );

        this.accessory.addService(src);
        this.tvService.addLinkedService(src);

        this.dynamicTitleSource = src;
        this.titleIDs.push(id);
    }

    // ------------------------------------------------------------
    // PlayActor discovery
    // ------------------------------------------------------------
    async discoverDevice() {
        const dev = Device.withId(this.deviceInformation.id);
        this.deviceInformation = await dev.discover();
        return dev;
    }

    async getOn() {
        // NPSSO UX mode: console stays ON
        if (this.lastTitle === this.lang.npssoExpired) {
            return true;
        }

        return this.deviceInformation.status === DeviceStatus.AWAKE;
    }

    // ------------------------------------------------------------
    // ON/OFF control
    // ------------------------------------------------------------
    setOn(value) {
        if (this.lockSetOn) {
            throw new this.api.hap.HapStatusError(-70403);
        }

        this.addLocks();

        this.tvService
            .getCharacteristic(this.Characteristic.Active)
            .updateValue(value);

        (async () => {
            try {
                const dev = await this.discoverDevice();
                const current = this.deviceInformation.status;
                const target = value ? DeviceStatus.AWAKE : DeviceStatus.STANDBY;

                if (current === target) {
                    this.platform.log.debug(`[${this.deviceInformation.id}] Already in desired state`);
                    return;
                }

                try {
                    const conn = await dev.openConnection();

                    if (value) {
                        this.platform.log.debug(`[${this.deviceInformation.id}] Waking device…`);
                        await timeout(dev.wake(), 15000);
                    } else {
                        this.platform.log.debug(`[${this.deviceInformation.id}] Sending standby…`);
                        await timeout(conn.standby(), 15000);
                    }

                    await conn.close();
                } catch (err) {
                    const msg = err.message || "";
                    if (!value && msg.includes("403") && msg.includes("Remote is already in use")) {
                        this.platform.log.warn(
                            `[${this.deviceInformation.id}] Remote already in use — assuming console already in standby.`
                        );
                        await this.updateDeviceInformations(true);
                        return;
                    }
                    throw err;
                }
            } catch (err) {
                this.platform.log.error(`[${this.deviceInformation.id}] Background error: ${err.message}`);
            } finally {
                this.releaseLocks();
                await this.updateDeviceInformations(true);
            }
        })();
    }

    // ------------------------------------------------------------
    // Title update loop (external endpoint)
    // ------------------------------------------------------------
    startTitleUpdateLoop() {
        const endpoint = this.platform.config.endpoint || "";
        const interval = this.platform.config.pollInterval || 120000;

        if (this.titleUpdateInterval) clearInterval(this.titleUpdateInterval);

        this.titleUpdateInterval = setInterval(async () => {
            try {
                const data = await httpGet(endpoint);
                const raw = (data && typeof data.title === "string") ? data.title.trim() : "";
                let newTitle = raw.length > 0 ? raw : this.lang.notPlaying;

                // NPSSO detection
                if (raw.toLowerCase().includes("npsso")) {
                    newTitle = this.lang.npssoExpired;
                }

                if (newTitle !== this.lastTitle && this.dynamicTitleSource) {
                    const previous = this.lastTitle;
                    this.lastTitle = newTitle;
                    const safe = newTitle.substring(0, 63);

                    this.platform.log.info(`[PSNAWP] ${safe}`);

                    this.dynamicTitleSource
                        .setCharacteristic(this.Characteristic.Name, safe)
                        .setCharacteristic(this.Characteristic.ConfiguredName, safe);

                    // NPSSO recovery
                    if (previous === this.lang.npssoExpired && newTitle !== this.lang.npssoExpired) {
                        this.platform.log.info(`[PSNAWP] ${this.lang.npssoRecovered}`);
                        await this.updateDeviceInformations(true);
                    }
                }
            } catch (err) {
                this.platform.log.error(`⚠️ Error fetching title: ${err}`);
            }
        }, interval);
    }

    // ------------------------------------------------------------
    // Device state update
    // ------------------------------------------------------------
    async updateDeviceInformations(force = false) {
        if (this.lockUpdate && !force) return;

        this.lockUpdate = true;

        try {
            await this.discoverDevice();
        } catch {
            this.deviceInformation.status = DeviceStatus.STANDBY;
        } finally {
            this.lockUpdate = false;

            const isAwake = this.deviceInformation.status === DeviceStatus.AWAKE;

            // NPSSO UX mode
            if (this.lastTitle === this.lang.npssoExpired) {
                this.tvService.updateCharacteristic(this.Characteristic.Active, 1);
                this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);

                if (this.dynamicTitleSource) {
                    const safe = this.lastTitle.substring(0, 63);
                    this.dynamicTitleSource
                        .updateCharacteristic(this.Characteristic.Name, safe)
                        .updateCharacteristic(this.Characteristic.ConfiguredName, safe);
                }

                return;
            }

            // Normal mode
            if (this._lastAwakeState !== isAwake) {
                this._lastAwakeState = isAwake;
                this.platform.log.info(`[PSNAWP] ${isAwake ? this.lang.deviceOn : this.lang.deviceOff}`);
            }

            this.tvService
                .getCharacteristic(this.Characteristic.Active)
                .updateValue(isAwake);
        }
    }

    // ------------------------------------------------------------
    // Lock management
    // ------------------------------------------------------------
    addLocks() {
        this.lockSetOn = true;
        this.lockUpdate = true;
        this.lockTimeout = setTimeout(() => this.releaseLocks(), this.kLockTimeout);
    }

    releaseLocks() {
        this.lockSetOn = false;
        this.lockUpdate = false;
        if (this.lockTimeout) clearTimeout(this.lockTimeout);
    }

    // ------------------------------------------------------------
    // Immediate title refresh
    // ------------------------------------------------------------
    updateGameTitleNow() {
        const endpoint = this.platform.config.endpoint || "";

        (async () => {
            try {
                const data = await httpGet(endpoint);
                const raw = (data && typeof data.title === "string") ? data.title.trim() : "";
                let newTitle = raw.length > 0 ? raw : this.lang.notPlaying;

                if (raw.toLowerCase().includes("npsso")) {
                    newTitle = this.lang.npssoExpired;
                }

                if (newTitle !== this.lastTitle && this.dynamicTitleSource) {
                    const previous = this.lastTitle;
                    this.lastTitle = newTitle;
                    const safe = newTitle.substring(0, 63);

                    this.platform.log.info(`[PSNAWP] ${safe}`);

                    this.dynamicTitleSource
                        .setCharacteristic(this.Characteristic.Name, safe)
                        .setCharacteristic(this.Characteristic.ConfiguredName, safe);

                    if (previous === this.lang.npssoExpired && newTitle !== this.lang.npssoExpired) {
                        this.platform.log.info(`[PSNAWP] ${this.lang.npssoRecovered}`);
                        await this.updateDeviceInformations(true);
                    }
                }
            } catch (err) {
                this.platform.log.error(`⚠️ Error fetching title: ${err}`);
            }
        })();
    }
}

module.exports = { PlaystationAccessory };
