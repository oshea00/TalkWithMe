/**
 * test_utils.js — Tests for the shared helpers in static/utils.js.
 *
 * Run with plain Node (Node 20+, no npm packages, no network):
 *
 *     node tests/test_utils.js
 *
 * Covers generateUUID(). crypto.randomUUID() only exists in secure
 * contexts (HTTPS or localhost); when the app is opened over plain http://
 * from another machine on the LAN it is undefined, and calling it directly
 * made sendMessage() throw before anything was sent. Each test evaluates
 * utils.js in a fresh vm.Context whose `crypto` global is controlled by the
 * test, so both the secure and the insecure browser shapes are exercised.
 *
 * NOTE: this file is intentionally NOT part of the pytest suite (which
 * must run with nothing but Python installed).
 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const UTILS_PATH = path.join(__dirname, "..", "static", "utils.js");
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Load utils.js into a fresh context with the given `crypto` global. */
function loadUtils(cryptoStub) {
    const sandbox = { crypto: cryptoStub };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(UTILS_PATH, "utf8"), sandbox, { filename: "utils.js" });
    return sandbox;
}

/** The crypto shape of an insecure context: getRandomValues but no randomUUID. */
function insecureCrypto(fill) {
    return {
        getRandomValues(array) {
            if (fill === undefined) return globalThis.crypto.getRandomValues(array);
            array.fill(fill);
            return array;
        },
    };
}

test("generateUUID_secureContext_delegatesToRandomUUID", () => {
    // GIVEN a secure context (crypto.randomUUID available):
    const sandbox = loadUtils({
        randomUUID: () => "11111111-2222-4333-8444-555555555555",
        getRandomValues() {
            throw new Error("fallback must not run when randomUUID exists");
        },
    });

    // THEN the native implementation is used as-is:
    assert.equal(sandbox.generateUUID(), "11111111-2222-4333-8444-555555555555");
});

test("generateUUID_insecureContext_returnsVersion4Uuid", () => {
    // GIVEN an insecure context (plain http:// to a LAN address):
    const sandbox = loadUtils(insecureCrypto());

    // THEN every generated id is a well-formed, distinct v4 UUID:
    const ids = new Set();
    for (let i = 0; i < 200; i++) {
        const id = sandbox.generateUUID();
        assert.match(id, UUID_V4);
        ids.add(id);
    }
    assert.equal(ids.size, 200);
});

test("generateUUID_insecureContext_setsVersionAndVariantBits", () => {
    // GIVEN random bytes that are all ones, then all zeros:
    // THEN only the version nibble and the variant bits are forced.
    assert.equal(
        loadUtils(insecureCrypto(0xff)).generateUUID(),
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
    );
    assert.equal(
        loadUtils(insecureCrypto(0x00)).generateUUID(),
        "00000000-0000-4000-8000-000000000000",
    );
});
