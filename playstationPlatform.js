"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaystationPlatform = void 0;

const { PlaystationAccessory } = require("./playstationAccessory");
const { Discovery } = require("playactor/dist/discovery");

class PlaystationPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        this.kDefaultPollInterval = 15000;

        this.log.info("Discovering PlayStation devices…");

        this.discoverDevices().catch((err) => {
            this.log.error(err.message);
        });
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
