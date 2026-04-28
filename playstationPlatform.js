"use strict";

const { PlaystationAccessory } = require("./playstationAccessory");
const { Discovery } = require("playactor/dist/discovery");
const fs = require("fs");
const path = require("path");

class PlaystationPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        this.kDefaultPollInterval = 15000;

        //
        // ────────────────────────────────────────────────
        //   ONBOARDING / DISCOVERY STATE MACHINE
        // ────────────────────────────────────────────────
        //

        this.credentialsPath = path.join(
            process.env.HOME || process.env.USERPROFILE,
            ".config/playactor/credentials.json"
        );

        this.credentials = this.loadCredentials();
        this.endpoint = config.endpoint;

        this.needsOnboarding = !this.credentials;
        this.needsDiscovery = !!this.credentials && !this.endpoint;

        if (this.needsOnboarding) {
            this.log.warn("[PlayStation] No PlayActor credentials found → ONBOARDING required");
            this.startOnboarding();
            return; // do not publish accessories until onboarding is complete
        }

        if (this.needsDiscovery) {
            this.log.warn("[PlayStation] Credentials OK but no endpoint configured → DISCOVERY required");
            this.startDiscovery();
            return; // do not publish accessories until endpoint is known
        }

        this.log.info("Discovering PlayStation devices…");

        this.discoverDevices().catch((err) => {
            this.log.error(err.message);
        });
    }

    //
    // ────────────────────────────────────────────────
    //   LOAD CREDENTIALS
    // ────────────────────────────────────────────────
    //
    loadCredentials() {
        try {
            if (fs.existsSync(this.credentialsPath)) {
                const raw = fs.readFileSync(this.credentialsPath, "utf8");
                return JSON.parse(raw);
            }
        } catch (err) {
            this.log.error("Error loading PlayActor credentials:", err.message);
        }
        return null;
    }

    //
    // ────────────────────────────────────────────────
    //   ONBOARDING
    // ────────────────────────────────────────────────
    //
    startOnboarding() {
        this.log.warn("[PlayStation] Starting PlayActor onboarding…");
        this.log.warn("[PlayStation] Run the following command on your machine:");
        this.log.warn("   homebridge-playstation-login");
        this.log.warn("[PlayStation] Restart Homebridge once onboarding is complete.");
    }

    //
    // ────────────────────────────────────────────────
    //   DISCOVERY
    // ────────────────────────────────────────────────
    //
    startDiscovery() {
        this.log.warn("[PlayStation] Attempting automatic endpoint discovery…");

        const discovery = new Discovery();
        const devices = discovery.discover();

        (async () => {
            for await (const deviceInformation of devices) {
                const autoEndpoint = `http://${deviceInformation.address}:18000/status`;
                this.log.warn(`[PlayStation] Automatically discovered endpoint: ${autoEndpoint}`);
                this.log.warn("[PlayStation] Add this endpoint in Homebridge UI and restart.");
                return;
            }

            this.log.error("[PlayStation] No endpoint discovered automatically. Configure it manually in Homebridge UI.");
        })();
    }


    async discoverDevices() {
        const discovery = new Discovery();
        const devices = discovery.discover();

        for await (const deviceInformation of devices) {
            this.log.info(`Found PlayStation: ${deviceInformation.name}`);
            new PlaystationAccessory(this, deviceInformation);
        }
    }
}

exports.PlaystationPlatform = PlaystationPlatform;
