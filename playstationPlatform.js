"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { PlaystationAccessory } = require("./playstationAccessory");
const { Discovery } = require("playactor/dist/discovery");
const { DEFAULT_POLL_INTERVAL, MIN_POLL_INTERVAL } = require("./settings");
const { describeError } = require("./utils");

class PlaystationPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config || {};
        this.api = api;

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        // NOTE: do not name this `accessories`. Homebridge decides what kind of
        // platform this is with `'accessories' in platformInstance`, so an
        // `accessories` property — even an array — makes it a *static* platform
        // and it gets invoked as `platformInstance.accessories(callback)`.
        this.publishedAccessories = [];

        // playactor stores its Remote Play credentials here (see
        // playactor/dist/credentials/disk-storage). os.homedir() is what
        // playactor itself uses, so never diverge from it.
        this.credentialsPath = path.join(os.homedir(), ".config", "playactor", "credentials.json");

        this.endpoint = this.config.endpoint;
        this.pollInterval = this.resolvePollInterval();

        // Homebridge 2 counts anything done in the constructor against plugin
        // startup time. Discovery talks to the network, so defer it until the
        // bridge is up and only then publish the external accessories.
        this.api.on("didFinishLaunching", () => {
            this.start().catch((err) => this.log.error(describeError(err)));
        });

        this.api.on("shutdown", () => this.shutdown());
    }

    resolvePollInterval() {
        const configured = Number(this.config.pollInterval);

        if (!Number.isFinite(configured) || configured <= 0) {
            return DEFAULT_POLL_INTERVAL;
        }

        if (configured < MIN_POLL_INTERVAL) {
            this.log.warn(
                `pollInterval ${configured}ms is below the ${MIN_POLL_INTERVAL}ms minimum, using ${MIN_POLL_INTERVAL}ms.`,
            );
            return MIN_POLL_INTERVAL;
        }

        return configured;
    }

    //
    // ────────────────────────────────────────────────
    //   ONBOARDING / DISCOVERY STATE MACHINE
    // ────────────────────────────────────────────────
    //
    async start() {
        if (!this.hasCredentials()) {
            this.log.warn("No PlayActor credentials found → ONBOARDING required");
            this.startOnboarding();
            return; // do not publish accessories until onboarding is complete
        }

        if (!this.endpoint) {
            this.log.warn("Credentials OK but no endpoint configured → DISCOVERY required");
            await this.suggestEndpoint();
            return; // do not publish accessories until the endpoint is known
        }

        this.log.info("Discovering PlayStation devices…");
        await this.discoverDevices();
    }

    shutdown() {
        for (const accessory of this.publishedAccessories) {
            accessory.dispose();
        }
        this.publishedAccessories = [];
    }

    //
    // ────────────────────────────────────────────────
    //   LOAD CREDENTIALS
    // ────────────────────────────────────────────────
    //
    hasCredentials() {
        try {
            if (!fs.existsSync(this.credentialsPath)) {
                return false;
            }

            const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, "utf8"));
            return !!credentials && Object.keys(credentials).length > 0;
        } catch (err) {
            this.log.error(`Error loading PlayActor credentials: ${describeError(err)}`);
            return false;
        }
    }

    //
    // ────────────────────────────────────────────────
    //   ONBOARDING
    // ────────────────────────────────────────────────
    //
    startOnboarding() {
        this.log.warn("Starting PlayActor onboarding…");
        this.log.warn("Run the following command on your machine:");
        this.log.warn("   homebridge-playstation-login");
        this.log.warn("Restart Homebridge once onboarding is complete.");
    }

    //
    // ────────────────────────────────────────────────
    //   DISCOVERY
    // ────────────────────────────────────────────────
    //
    async suggestEndpoint() {
        this.log.warn("Attempting automatic endpoint discovery…");

        try {
            for await (const deviceInformation of new Discovery().discover()) {
                const autoEndpoint = `http://${deviceInformation.address}:18000/status`;
                this.log.warn(`Automatically discovered endpoint: ${autoEndpoint}`);
                this.log.warn("Add this endpoint in Homebridge UI and restart.");
                return;
            }
        } catch (err) {
            this.log.error(`Endpoint discovery failed: ${describeError(err)}`);
            return;
        }

        this.log.error("No endpoint discovered automatically. Configure it manually in Homebridge UI.");
    }

    async discoverDevices() {
        const seen = new Set();

        for await (const deviceInformation of new Discovery().discover()) {
            // discover() keeps yielding for as long as consoles keep answering
            // the broadcast, so the same device shows up repeatedly. Publishing
            // it twice would collide on the HAP UUID.
            if (seen.has(deviceInformation.id)) {
                continue;
            }
            seen.add(deviceInformation.id);

            this.log.info(`Found PlayStation: ${deviceInformation.name}`);
            this.publishedAccessories.push(new PlaystationAccessory(this, deviceInformation));
        }

        if (seen.size === 0) {
            this.log.error("No PlayStation found on the network. Check that the console is reachable from Homebridge.");
        }
    }
}

exports.PlaystationPlatform = PlaystationPlatform;
