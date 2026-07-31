"use strict";

const { Device } = require("playactor/dist/device");
const { DeviceStatus } = require("playactor/dist/discovery/model");
const { PLUGIN_NAME, ENDPOINT_TIMEOUT } = require("./settings");
const { sanitizeHomeKitName, fetchJson, describeError } = require("./utils");
const locales = require("./src");

const PLACEHOLDER_SUBTYPE = "PSAXXXX";

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
        this.Categories = this.api.hap.Categories;
        this.HAPStatus = this.api.hap.HAPStatus;

        // Load language. Everything that reaches HomeKit is pre-sanitised so
        // comparisons against the current title stay consistent.
        const lang = locales[this.platform.config.language] || locales.en;
        this.lang = lang;
        this.strings = {
            loading: sanitizeHomeKitName(lang.loading, "Loading"),
            notPlaying: sanitizeHomeKitName(lang.notPlaying, "Not playing"),
            npssoExpired: sanitizeHomeKitName(lang.npssoExpired, "NPSSO expired"),
        };

        this.lockUpdate = false;
        this.lockSetOn = false;
        this.kLockTimeout = 20000;

        this.disposed = false;
        this.dynamicTitleSource = null;
        this.titleIDs = [];
        this.lastTitle = null;
        this._lastAwakeState = null;

        const displayName = sanitizeHomeKitName(deviceInfo.name, "PlayStation");
        const uuid = this.api.hap.uuid.generate(deviceInfo.id);
        const accessory = new this.api.platformAccessory(displayName, uuid);
        this.accessory = accessory;

        accessory.category = this.Categories.TV_SET_TOP_BOX;

        // Accessory information. HAP-NodeJS v2 warns when a characteristic is
        // handed a non-string, and playactor may not report every field.
        accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, "Sony")
            .setCharacteristic(this.Characteristic.Model, String(deviceInfo.type || "PlayStation"))
            .setCharacteristic(this.Characteristic.SerialNumber, String(deviceInfo.id || "unknown"))
            .setCharacteristic(this.Characteristic.FirmwareRevision, String(deviceInfo.systemVersion || "0.0.0"));

        // Television service
        this.tvService =
            accessory.getService(this.Service.Television) ||
            accessory.addService(this.Service.Television);

        this.tvService
            .setCharacteristic(this.Characteristic.ConfiguredName, displayName)
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

        this.tvService
            .getCharacteristic(this.Characteristic.ActiveIdentifier)
            .onSet(async () => { return; });

        // Initial placeholder title
        this.addTitle(PLACEHOLDER_SUBTYPE, this.strings.loading, 0);

        // Start update loops
        const interval = this.platform.pollInterval;

        this.titleUpdateInterval = setInterval(() => this.safeRefreshTitle(), interval);
        this.deviceUpdateInterval = setInterval(() => {
            this.updateDeviceInformations().catch((err) => {
                this.platform.log.debug(`[${deviceInfo.id}] State refresh failed: ${describeError(err)}`);
            });
        }, interval);

        this.safeRefreshTitle();

        this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    }

    // ------------------------------------------------------------
    // Teardown (Homebridge `shutdown` event)
    // ------------------------------------------------------------
    dispose() {
        this.disposed = true;
        clearInterval(this.titleUpdateInterval);
        clearInterval(this.deviceUpdateInterval);
        clearTimeout(this.lockTimeout);
    }

    // ------------------------------------------------------------
    // Dynamic InputSource
    // ------------------------------------------------------------
    addTitle(id, name, index) {
        const safe = sanitizeHomeKitName(name, "Unknown");
        const src = new this.Service.InputSource(safe, id);

        src.setCharacteristic(this.Characteristic.Identifier, index)
            .setCharacteristic(this.Characteristic.Name, safe)
            .setCharacteristic(this.Characteristic.ConfiguredName, safe)
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

    // Push a title onto the dynamic InputSource. `updateCharacteristic` (rather
    // than `setCharacteristic`) is what notifies subscribed HomeKit controllers
    // without firing our own write handlers.
    applyTitle(title) {
        if (!this.dynamicTitleSource) {
            return;
        }

        this.dynamicTitleSource
            .updateCharacteristic(this.Characteristic.Name, title)
            .updateCharacteristic(this.Characteristic.ConfiguredName, title);
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
        if (this.lastTitle === this.strings.npssoExpired) {
            return 1;
        }

        return this.deviceInformation.status === DeviceStatus.AWAKE ? 1 : 0;
    }

    // ------------------------------------------------------------
    // ON/OFF control
    // ------------------------------------------------------------
    setOn(value) {
        if (this.lockSetOn) {
            throw new this.api.hap.HapStatusError(this.HAPStatus.RESOURCE_BUSY);
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
                this.platform.log.error(`[${this.deviceInformation.id}] Background error: ${describeError(err)}`);
            } finally {
                this.releaseLocks();
                await this.updateDeviceInformations(true);
            }
        })();
    }

    // ------------------------------------------------------------
    // Title refresh (external endpoint)
    // ------------------------------------------------------------

    // An unhandled rejection inside a timer would take the whole bridge down,
    // so the loops always go through here.
    safeRefreshTitle() {
        this.refreshTitle().catch((err) => {
            this.platform.log.error(`⚠️ Error updating title: ${describeError(err)}`);
        });
    }

    async refreshTitle() {
        const endpoint = this.platform.endpoint;

        if (!endpoint) {
            return;
        }

        let data;
        try {
            data = await fetchJson(endpoint, ENDPOINT_TIMEOUT);
        } catch (err) {
            this.platform.log.error(`⚠️ Error fetching title: ${describeError(err)}`);
            return;
        }

        if (this.disposed) {
            return;
        }

        const raw = (data && typeof data.title === "string") ? data.title.trim() : "";

        // NPSSO detection
        const newTitle = raw.toLowerCase().includes("npsso")
            ? this.strings.npssoExpired
            : sanitizeHomeKitName(raw, this.strings.notPlaying);

        if (newTitle === this.lastTitle) {
            return;
        }

        const previous = this.lastTitle;
        this.lastTitle = newTitle;

        this.platform.log.info(`[PSNAWP] ${newTitle}`);
        this.applyTitle(newTitle);

        // NPSSO recovery
        if (previous === this.strings.npssoExpired && newTitle !== this.strings.npssoExpired) {
            this.platform.log.info(`[PSNAWP] ${this.lang.npssoRecovered}`);
            await this.updateDeviceInformations(true);
        }
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
            if (this.lastTitle === this.strings.npssoExpired) {
                this.tvService.updateCharacteristic(this.Characteristic.Active, 1);
                this.tvService.updateCharacteristic(this.Characteristic.ActiveIdentifier, 0);
                this.applyTitle(this.lastTitle);

                return;
            }

            // Normal mode
            if (this._lastAwakeState !== isAwake) {
                this._lastAwakeState = isAwake;
                this.platform.log.info(`[PSNAWP] ${isAwake ? this.lang.deviceOn : this.lang.deviceOff}`);
            }

            this.tvService
                .getCharacteristic(this.Characteristic.Active)
                .updateValue(isAwake ? 1 : 0);
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
}

module.exports = { PlaystationAccessory };
