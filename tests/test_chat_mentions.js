/**
 * test_chat_mentions.js — Regression tests for persona-name mention routing
 * (resolveWhoAnswers() in static/chat.js).
 *
 * Run with plain Node (Node 20+, no npm packages, no network):
 *
 *     node tests/test_chat_mentions.js
 *
 * The invariants under test:
 *  - "Selected persona" always wins. With Doctor McCoy selected, asking
 *    "what does Spock think?" must still be answered by McCoy (the original
 *    bug: the mention silently re-selected Spock).
 *  - In "LLM decides" / "Surprise me" mode a mention routes THAT message to
 *    the mentioned persona, but never flips the chooser to "Selected
 *    persona" (which made the re-route sticky for every later message).
 *  - general.persona_name_mentions = false disables mention routing.
 *
 * The real utils.js + state.js + persona.js + chat.js are evaluated in a
 * fresh vm.Context per test against a minimal DOM stub. Like the other Node
 * suites, this file is intentionally NOT part of pytest.
 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const STATIC_DIR = path.join(__dirname, "..", "static");
// Load order mirrors templates/index.html.
const APP_SCRIPTS = ["state.js", "utils.js", "persona.js", "chat.js"];

function makeFakeElement(id) {
    const classSet = new Set();
    const el = {
        id,
        value: "",
        innerHTML: "",
        style: {},
        dataset: {},
        children: [],
        addEventListener() {},
        appendChild(child) {
            el.children.push(child);
            return child;
        },
        querySelector: () => null,
    };
    el.classList = {
        add: (c) => classSet.add(c),
        remove: (c) => classSet.delete(c),
        contains: (c) => classSet.has(c),
        toggle(c, force) {
            const want = force === undefined ? !classSet.has(c) : !!force;
            if (want) classSet.add(c);
            else classSet.delete(c);
            return want;
        },
    };
    return el;
}

/**
 * Build a sandbox with the "who_answers" radio group set to `mode`
 * ("router" | "random" | "selected").
 */
function createHarness(mode) {
    const elements = new Map();
    const elementById = (id) => {
        if (!elements.has(id)) elements.set(id, makeFakeElement(id));
        return elements.get(id);
    };
    const radios = ["router", "random", "selected"].map((value) => ({
        value,
        checked: value === mode,
        dispatchEvent() {},
    }));

    const documentStub = {
        getElementById: elementById,
        createElement: (tag) => makeFakeElement(`created-${tag}`),
        querySelector(selector) {
            if (selector === 'input[name="who_answers"]:checked') {
                return radios.find((r) => r.checked) || null;
            }
            const m = selector.match(/^input\[name="who_answers"\]\[value="(\w+)"\]$/);
            if (m) return radios.find((r) => r.value === m[1]) || null;
            return null;
        },
        querySelectorAll: () => [],
    };

    const sandbox = { console, document: documentStub, window: {}, Event: class {} };
    vm.createContext(sandbox);
    for (const file of APP_SCRIPTS) {
        const code = fs.readFileSync(path.join(STATIC_DIR, file), "utf8");
        vm.runInContext(code, sandbox, { filename: file });
    }
    vm.runInContext('selectedPersona = "Doctor McCoy";', sandbox);

    return {
        radios,
        checkedMode: () => radios.find((r) => r.checked).value,
        get: (expr) => vm.runInContext(`(() => (${expr}))()`, sandbox),
        run: (stmt) => vm.runInContext(stmt, sandbox),
    };
}

const ROOM = ["Doctor McCoy", "James Kirk", "Spock"];
const resolve = (h, text) =>
    h.get(`resolveWhoAnswers(${JSON.stringify(text)}, ${JSON.stringify(ROOM)})`);

test("selected mode: a mention never overrides the selected persona", () => {
    const h = createHarness("selected");
    assert.equal(resolve(h, "Doctor, what do you think of Spock?"), "Doctor McCoy");
    assert.equal(h.get("selectedPersona"), "Doctor McCoy");
    assert.equal(h.checkedMode(), "selected");
});

test("selected mode: no mention sends the selected persona", () => {
    const h = createHarness("selected");
    assert.equal(resolve(h, "How is the crew?"), "Doctor McCoy");
});

for (const mode of ["router", "random"]) {
    test(`${mode} mode: a mention routes this message to the mentioned persona`, () => {
        const h = createHarness(mode);
        assert.equal(resolve(h, "What does Spock think?"), "Spock");
    });

    test(`${mode} mode: a mention does not flip the chooser to "selected"`, () => {
        const h = createHarness(mode);
        resolve(h, "What does Spock think?");
        assert.equal(h.checkedMode(), mode);
        // The next, mention-free message goes back to the chosen mode.
        assert.equal(resolve(h, "And the rest of the crew?"), mode);
    });

    test(`${mode} mode: no mention sends the mode itself`, () => {
        const h = createHarness(mode);
        assert.equal(resolve(h, "How is the crew?"), mode);
    });

    test(`${mode} mode: mentions disabled by setting are ignored`, () => {
        const h = createHarness(mode);
        h.run("personaNameMentionsEnabled = false;");
        assert.equal(resolve(h, "What does Spock think?"), mode);
        assert.equal(h.get("selectedPersona"), "Doctor McCoy");
    });
}

test("selected mode with nothing selected falls back to the router", () => {
    const h = createHarness("selected");
    h.run("selectedPersona = null;");
    assert.equal(resolve(h, "What does Spock think?"), "router");
});
