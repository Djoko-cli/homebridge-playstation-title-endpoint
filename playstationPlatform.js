"use strict";

const { PlaystationAccessory } = require("./playstationAccessory");
const { Discovery } = require("playactor/dist/discovery");
const { DEFAULT_POLL_INTERVAL, MIN_POLL_INTERVAL, DISCOVERY_RETRY_INTERVAL } = require("./settings");
const { describeError } = require("./utils");
const {
    credentialsPathFor,
    legacyCredentialsPath,
    hasCredentials,
    migrateLegacyCredentials,
} = require("./credentialStore");

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

        // Remote Play credentials live in the Homebridge storage directory, not
        // in playactor's ~/.config default (see credentialStore.js for why).
        this.credentialsPath = credentialsPathFor(this.api.user.storagePath());

        this.endpoint = this.config.endpoint;
        this.pollInterval = this.resolvePollInterval();

        // Discovery is retried until the console answers (see discoverDevices).
        this.discoveredIds = new Set();
        this.discoveryAttempts = 0;
        this.discoveryRetryInterval = DISCOVERY_RETRY_INTERVAL;
        this.discoveryRetryTimer = null;
        this.shuttingDown = false;

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
        this.migrateCredentials();

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
        this.shuttingDown = true;
        clearTimeout(this.discoveryRetryTimer);

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
            return hasCredentials(this.credentialsPath);
        } catch (err) {
            this.log.error(`Error loading PlayActor credentials: ${describeError(err)}`);
            return false;
        }
    }

    // Before 2.2.0 the credentials sat in playactor's ~/.config default.
    // Bring them over once, so upgrading does not mean pairing again.
    migrateCredentials() {
        const legacy = legacyCredentialsPath();

        try {
            if (migrateLegacyCredentials(this.credentialsPath, legacy)) {
                this.log.info(`Moved PlayActor credentials from ${legacy} to ${this.credentialsPath}`);
            }
        } catch (err) {
            this.log.error(`Could not move PlayActor credentials from ${legacy}: ${describeError(err)}`);
        }
    }

    //
    // ────────────────────────────────────────────────
    //   ONBOARDING
    // ────────────────────────────────────────────────
    //
    startOnboarding() {
        this.log.warn("Starting PlayActor onboarding…");
        this.log.warn("Run the following command in the Homebridge UI terminal:");
        this.log.warn("   homebridge-playstation-login");
        this.log.warn(`Credentials will be stored in ${this.credentialsPath}`);
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

    // One attempt listens for playactor's 30 s discovery window. A console that
    // is switched off, or in rest mode without network access, stays silent;
    // until 2.2.0 it then remained unpublished ("No Response" in Home) until
    // the next Homebridge restart, such as the one every plugin update
    // triggers. Keep looking until it answers.
    async discoverDevices() {
        this.discoveryAttempts++;

        try {
            for await (const deviceInformation of new Discovery().discover()) {
                if (this.shuttingDown) {
                    return;
                }

                // playactor already de-duplicates within one attempt; this set
                // spans attempts, so a console is never published twice (it
                // would collide on the HAP UUID).
                if (this.discoveredIds.has(deviceInformation.id)) {
                    continue;
                }
                this.discoveredIds.add(deviceInformation.id);

                const attempt = this.discoveryAttempts > 1 ? ` (attempt ${this.discoveryAttempts})` : "";
                this.log.info(`Found PlayStation: ${deviceInformation.name}${attempt}`);
                this.publishedAccessories.push(new PlaystationAccessory(this, deviceInformation));
            }
        } catch (err) {
            this.log.error(`PlayStation discovery failed: ${describeError(err)}`);
        }

        if (this.discoveredIds.size > 0 || this.shuttingDown) {
            return;
        }

        if (this.discoveryAttempts === 1) {
            this.log.warn(
                `No PlayStation found on the network yet; looking again in ${this.discoveryRetryInterval / 1000}s ` +
                "and until the console answers (it must be on, or in rest mode with network access).",
            );
        } else {
            this.log.debug(`Still no PlayStation on the network (attempt ${this.discoveryAttempts}).`);
        }

        this.discoveryRetryTimer = setTimeout(() => {
            this.discoverDevices().catch((err) => this.log.error(describeError(err)));
        }, this.discoveryRetryInterval);
    }
}

exports.PlaystationPlatform = PlaystationPlatform;
