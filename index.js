"use strict";
const settings_1 = require("./settings");
const playstationPlatform_1 = require("./playstationPlatform");
module.exports = (api) => {
    api.registerPlatform(settings_1.PLATFORM_NAME, playstationPlatform_1.PlaystationPlatform);
};