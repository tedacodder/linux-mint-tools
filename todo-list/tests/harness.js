'use strict';
// Loads applet/applet.js the way Cinnamon runs it: as a script with `imports`
// and `global` in scope. Each startApplet() call is a fresh applet with its
// own clock, timers and log, sharing the disk under the temp HOME.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeCinnamon, sendKey, KeyEvent, K, pressAt } = require('./mock-cinnamon');

if (!String(process.env.HOME || '').includes('todo-list-test')) {
    throw new Error('refusing to run: HOME is not a temp test home (use tests/run-all.sh)');
}

const BASE_HOME = process.env.HOME;
const APPLET_SRC = fs.readFileSync(path.join(__dirname, '..', 'applet', 'applet.js'), 'utf8');
const DAY_MS = 24 * 60 * 60 * 1000;

const results = [];
function check(name, fn) {
    try {
        fn();
        results.push(true);
        console.log('  ok    ' + name);
    } catch (e) {
        results.push(false);
        const detail = String(e && e.message ? e.message : e).split('\n').join('\n        ');
        console.log('  FAIL  ' + name + '\n        ' + detail);
    }
}
function summary() {
    const failed = results.filter(r => !r).length;
    console.log('  ' + (results.length - failed) + '/' + results.length + ' passed');
    process.exitCode = failed ? 1 : 0;
}

// Gives a case its own HOME under the temp root, so cases never share files.
// Runs the asynchronous work that has been queued: finished reads and writes.
// Cinnamon does this on its main loop, between events.
let lastWorld = null;
function flushPending(world) {
    while (world && world.pending && world.pending.length) {
        world.pending.shift()();
    }
}

function freshHome(name) {
    const dir = path.join(BASE_HOME, name);
    fs.mkdirSync(dir, { recursive: true });
    process.env.HOME = dir;
    delete process.env.XDG_STATE_HOME;
    delete process.env.XDG_DATA_HOME;
    return dir;
}

function settingsFile() {
    return path.join(process.env.HOME, '.local', 'state', 'todo-list', 'settings.json');
}

function newStorePath() {
    return path.join(process.env.HOME, '.local', 'state', 'todo-list', 'todos.json');
}
function oldStorePath() {
    return path.join(process.env.HOME, '.local', 'state', 'omarchy', 'todos.json');
}
function readStore() {
    flushPending(lastWorld);
    return JSON.parse(fs.readFileSync(newStorePath(), 'utf8'));
}

function startApplet(startIso = '2026-11-10T10:00:00', options = {}) {
    const world = { focused: null, root: null, logs: [], timers: [], nextId: 0, now: Date.parse(startIso),
        failMonitor: !!options.failMonitor, failHotkey: !!options.failHotkey };
    const cinnamon = makeCinnamon(world);
    class FakeDate extends Date {
        constructor(...args) {
            if (args.length) super(...args);
            else super(world.now);
        }
        static now() { return world.now; }
    }
    const sandbox = { imports: cinnamon.imports, global: cinnamon.global, Date: FakeDate, console };
    vm.createContext(sandbox);
    // Cinnamon's JavaScript environment provides String.prototype.format, with %s and %d.
    vm.runInContext(`
        String.prototype.format = function () {
            let i = 0;
            const args = arguments;
            return this.replace(/%[sd]/g, () => String(args[i++]));
        };`, sandbox);
    vm.runInContext(APPLET_SRC + `
;globalThis.__api = {
    TodoListApplet, main, parseStore, serialize, localDateKey, rollDailyTasks,
    listed, listedDaily, normalizePriority, cycleTab, highestOngoing, ongoingCount,
    emptyMessage, badgeTooltip, matches, trim, PRIORITY_COLORS,
    readableTextOn, contrastRatio, hotkeyLabel
};`, sandbox, { filename: 'applet.js' });
    const api = sandbox.__api;
    const applet = api.main({}, 0, 24, 1);
    flushPending(world);
    lastWorld = world;
    world.root = applet._dialog;
    return { applet, api, world, menu: applet._dialog };
}

// Advances the clock and runs every timer once, as the GLib main loop would.
function fireTimers(world, advanceMs = 0) {
    world.now += advanceMs;
    world.timers.slice().forEach(t => {
        const keepGoing = t.fn();
        if (!keepGoing) world.timers = world.timers.filter(x => x.id !== t.id);
    });
}

function findAll(root, pred) {
    const out = [];
    (function visit(a) {
        if (pred(a)) out.push(a);
        a.children.forEach(visit);
    })(root);
    return out;
}

function findButton(root, label) {
    const hit = findAll(root, a => a.kind === 'Button'
        && (a.label === label || a.label.startsWith(label + ' (')));
    assert.ok(hit.length > 0, 'no button labelled "' + label + '"');
    return hit[0];
}

function findEntry(root, hintPrefix) {
    const hit = findAll(root, a => a.kind === 'Entry' && a.hint_text.startsWith(hintPrefix));
    assert.ok(hit.length > 0, 'no entry with hint "' + hintPrefix + '"');
    return hit[0];
}

function press(button) { button.emit('clicked'); }
function type(entry, text) { entry.set_text(text); }
function pressKey(app, sym, state = 0) { return sendKey(app.world, new KeyEvent(sym, state)); }

module.exports = {
    check, summary, freshHome, startApplet, fireTimers, findAll, findButton, findEntry,
    press, type, pressKey, pressAt, settingsFile, newStorePath, oldStorePath, readStore, flushPending, K, DAY_MS,
};
