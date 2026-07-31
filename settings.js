"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

// Platform identifier (stable, used internally by Homebridge)
exports.PLATFORM_NAME = "PlayStation";

// Plugin identifier (must match EXACT npm package name)
exports.PLUGIN_NAME = "homebridge-playstation-title-endpoint";

// Polling interval applied when the user leaves `pollInterval` unset.
// Must stay in sync with the default declared in config.schema.json.
exports.DEFAULT_POLL_INTERVAL = 15000;
exports.MIN_POLL_INTERVAL = 5000;

// How long a single request to the external title endpoint may take.
exports.ENDPOINT_TIMEOUT = 10000;
