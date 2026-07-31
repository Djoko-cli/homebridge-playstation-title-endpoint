"use strict";

// ------------------------------------------------------------
// HomeKit name sanitising
//
// HAP-NodeJS v2 (bundled with Homebridge 2.x) validates every accessory,
// service and `Name` characteristic against Apple's naming rules and logs a
// warning when they don't match:
//
//   ^[\p{L}\p{N}][\p{L}\p{N}\p{Zs}’'&!._:;()/,-]*[\p{L}\p{N}]$
//
// Game titles routinely contain characters outside that set (™, ®, en dashes,
// emoji), so everything we push into HomeKit goes through here first.
// ------------------------------------------------------------

// Characters HomeKit tolerates anywhere but the first/last position.
const DISALLOWED = /[^\p{L}\p{N}\p{Zs}’'&!._:;()/,-]/gu;

// The name must begin and end with a letter or a number.
const BAD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

// `Name` declares maxLen 64; HAP truncates (and warns) beyond that.
const MAX_NAME_LENGTH = 64;

/**
 * Coerce an arbitrary string into something HomeKit accepts.
 *
 * @param {unknown} value    raw name, e.g. a game title from the endpoint
 * @param {string}  fallback returned when nothing usable survives sanitising
 * @returns {string}
 */
function sanitizeHomeKitName(value, fallback = "Unknown") {
    const cleaned = String(value ?? "")
        .normalize("NFC")
        .replace(DISALLOWED, " ")
        .replace(/\p{Zs}+/gu, " ")
        .slice(0, MAX_NAME_LENGTH)
        .replace(BAD_EDGES, "");

    return cleaned.length > 0 ? cleaned : fallback;
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------

/**
 * GET a JSON document, aborting if the server takes too long to answer.
 * Uses the global fetch available on every Node version Homebridge 2 supports.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
async function fetchJson(url, timeoutMs) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return response.json();
}

/**
 * Human-readable one-liner for anything that can be thrown.
 * `fetch` surfaces the interesting part in `cause`, so unwrap it.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
    if (!(error instanceof Error)) {
        return String(error);
    }

    if (error.name === "TimeoutError") {
        return "request timed out";
    }

    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
    return `${error.message}${cause}`;
}

module.exports = { sanitizeHomeKitName, fetchJson, describeError };
