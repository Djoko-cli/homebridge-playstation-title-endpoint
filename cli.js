#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const options_1 = require("playactor/dist/cli/options");
const discovery_1 = require("playactor/dist/discovery");
const readline_1 = __importDefault(require("readline"));
const { credentialsPathFor, legacyCredentialsPath, migrateLegacyCredentials, resolveCliStoragePath } = require("./credentialStore");
// Must match what the plugin reads: <Homebridge storage>/<plugin>/credentials.json
const { storagePath, source } = resolveCliStoragePath();
const credentialsPath = credentialsPathFor(storagePath);
const connect = async (deviceId) => {
    try {
        const opt = new options_1.DeviceOptions();
        opt.dontAutoOpenUrls = true;
        opt.deviceHostId = deviceId;
        opt.credentialsPath = credentialsPath;
        console.log(`Connecting to <${deviceId}>...`);
        const device = await opt.findDevice();
        const conn = await device.openConnection();
        console.log("Connection successful, wait a bit so we can safely close the connection...");
        await conn.close();
        return true;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : err;
        console.error(message);
        return false;
    }
};
const confirm = (deviceName) => {
    const input = readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        input.question(`Authenticate to ${deviceName}? (y/n) `, (response) => {
            input.close();
            resolve(response.toLowerCase() === "y");
        });
    });
};
const discover = async () => {
    const discovery = new discovery_1.Discovery();
    const devices = discovery.discover();
    let success = false;
    for await (const device of devices) {
        console.log("Discovered device:", device);
        const confirmed = await confirm(device.name);
        if (confirmed) {
            // track if there were any successful connections
            success = (await connect(device.id)) || success;
        }
        console.log("\nDiscovering next device...");
    }
    return success;
};
console.log(`Homebridge storage: ${storagePath} (${source})`);
console.log(`Credentials file:   ${credentialsPath}`);
if (source === "default") {
    console.warn("No Homebridge config.json found; pass -U <path> if your Homebridge storage lives elsewhere.");
}
try {
    // an existing pairing from before 2.2.0 saves typing the PIN again
    if (migrateLegacyCredentials(credentialsPath)) {
        console.log(`Moved existing credentials from ${legacyCredentialsPath()}`);
    }
}
catch (err) {
    console.error(`Could not move existing credentials: ${err instanceof Error ? err.message : err}`);
}
console.log();
discover()
    .then((success) => {
    if (success) {
        console.log("\nPlease restart Homebridge now!");
    }
    else {
        console.error("\nDid not authenticate to any consoles.");
    }
})
    .catch((err) => console.error(err));
//# sourceMappingURL=cli.js.map