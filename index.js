"use strict";

const { PLATFORM_NAME, PLUGIN_NAME } = require("./settings");
const { PlaystationPlatform } = require("./playstationPlatform");

module.exports = (api) => {
    api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, PlaystationPlatform);
};
