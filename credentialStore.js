"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { CredentialManager } = require("playactor/dist/credentials");
const { DiskCredentialsStorage, determineDefaultFile } = require("playactor/dist/credentials/disk-storage");
const { RejectingCredentialRequester } = require("playactor/dist/credentials/rejecting-requester");
const { PendingDevice } = require("playactor/dist/device/pending");
const { PLUGIN_NAME } = require("./settings");

// ------------------------------------------------------------
// Where the Remote Play credentials live
//
// playactor defaults to ~/.config/playactor/credentials.json. In the official
// Homebridge Docker image HOME is /home/homebridge, which is *not* on the
// /homebridge volume, so the console pairing was silently lost every time the
// container was recreated (new image, Synology "Build", `compose up`...).
// Keeping the file in the Homebridge storage directory puts it next to
// config.json and persist/, wherever the user already keeps Homebridge state.
// ------------------------------------------------------------

/**
 * @param {string} storagePath Homebridge storage directory (api.user.storagePath())
 * @returns {string}
 */
function credentialsPathFor(storagePath) {
    return path.join(storagePath, PLUGIN_NAME, "credentials.json");
}

/**
 * playactor's own default location, used by this plugin before 2.2.0.
 * Delegates to playactor so the two can never drift apart.
 *
 * @returns {string}
 */
function legacyCredentialsPath() {
    return determineDefaultFile();
}

/**
 * @param {string} file
 * @returns {boolean} true when the file holds at least one paired console
 */
function hasCredentials(file) {
    if (!fs.existsSync(file)) {
        return false;
    }

    const credentials = JSON.parse(fs.readFileSync(file, "utf8"));
    return !!credentials && Object.keys(credentials).length > 0;
}

/**
 * Copy credentials paired by an older version (or by playactor's own CLI)
 * into the storage directory. The legacy file is left in place so a downgrade
 * keeps working.
 *
 * Runs only while the plugin's storage directory does not exist yet. Checking
 * the directory rather than the file matters: someone who deletes
 * credentials.json to pair again must not get the old pairing re-imported on
 * the next start.
 *
 * @param {string} target
 * @param {string} [legacy]
 * @returns {boolean} true when a file was copied
 */
function migrateLegacyCredentials(target, legacy = legacyCredentialsPath()) {
    if (fs.existsSync(path.dirname(target)) || !fs.existsSync(legacy)) {
        return false;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(legacy, target, fs.constants.COPYFILE_EXCL);
    return true;
}

/**
 * Equivalent of playactor's `Device.withId(id)`, which is hard-wired to the
 * default credentials file, but reading and writing `credentialsFile` instead.
 * Pairing needs a human to type the console's PIN, so missing credentials are
 * rejected rather than requested.
 *
 * @param {string} id
 * @param {string} credentialsFile
 * @returns {PendingDevice}
 */
function deviceWithId(id, credentialsFile) {
    const credentials = new CredentialManager(
        new RejectingCredentialRequester("Console not paired: run homebridge-playstation-login"),
        new DiskCredentialsStorage(credentialsFile),
    );

    // `undefined` keeps playactor's standard discovery network factory.
    return new PendingDevice(`with id ${id}`, (device) => device.id === id, {}, {}, undefined, credentials);
}

// ------------------------------------------------------------
// Storage directory, as seen by the login CLI
//
// The CLI runs outside Homebridge, so it cannot ask api.user.storagePath().
// ------------------------------------------------------------

function parseStorageFlag(argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "-U" || arg === "--user-storage-path") {
            return argv[i + 1];
        }

        if (arg.startsWith("--user-storage-path=")) {
            return arg.slice("--user-storage-path=".length);
        }
    }

    return undefined;
}

/**
 * Resolution order:
 *  1. `-U` / `--user-storage-path`, the same flag homebridge itself takes
 *  2. UIX_STORAGE_PATH, set by hb-service and inherited by the terminal of the
 *     Homebridge UI
 *  3. the first usual location holding a config.json: the current directory
 *     (the UI terminal starts there), /var/lib/homebridge (hb-service and the
 *     Docker image, e.g. through `docker exec`), then ~/.homebridge
 *
 * @returns {{ storagePath: string, source: string }}
 */
function resolveCliStoragePath({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
    const flag = parseStorageFlag(argv);
    if (flag) {
        return { storagePath: path.resolve(cwd, flag), source: "--user-storage-path" };
    }

    if (env.UIX_STORAGE_PATH) {
        return { storagePath: env.UIX_STORAGE_PATH, source: "UIX_STORAGE_PATH" };
    }

    const candidates = [cwd, "/var/lib/homebridge", path.join(os.homedir(), ".homebridge")];
    const found = candidates.find((dir) => fs.existsSync(path.join(dir, "config.json")));
    if (found) {
        return { storagePath: found, source: "config.json" };
    }

    return { storagePath: path.join(os.homedir(), ".homebridge"), source: "default" };
}

module.exports = {
    credentialsPathFor,
    legacyCredentialsPath,
    hasCredentials,
    migrateLegacyCredentials,
    deviceWithId,
    resolveCliStoragePath,
};
