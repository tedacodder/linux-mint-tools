#!/usr/bin/env node
// Runs the Cinnamon applet's menu logic with mocked Cinnamon APIs, so UI bugs
// (switches flipping, menus closing, buttons not working) show up without a desktop.
// The mock is strict: it fires "toggled" even when code sets a switch programmatically,
// which is the worst case, so a passing run means the applet is safe either way.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPLET_DIR = path.join(__dirname, '..', 'applet');
let failures = 0;
function check(name, cond) {
    if (cond) console.log('  PASS  ' + name);
    else { failures++; console.log('  FAIL  ' + name); }
}

// ---------- mock Cinnamon APIs ----------

class Emitter {
    constructor() { this._handlers = {}; }
    connect(name, fn) { (this._handlers[name] = this._handlers[name] || []).push(fn); }
    emit(name, ...args) { (this._handlers[name] || []).forEach((fn) => fn(this, ...args)); }
}

class Actor extends Emitter {
    constructor(props = {}) {
        super();
        this.text = props.text || '';
        this.children = [];
        this.clutter_text = {
            text: '', markup: '', line_wrap: false,
            set_markup(m) { this.markup = m; }
        };
    }
    addActor(a) { this.children.push(a); }
    add_child(a) { this.children.push(a); }
    add_style_class_name() {}
    remove_style_class_name() {}
    set_opacity() {}
}

class Button extends Emitter {
    constructor(props = {}) { super(); this.buttonText = props.label; this.children = []; }
}

class BaseItem extends Emitter {
    constructor() { super(); this.children = []; }
    addActor(a) { this.children.push(a); }
}

class SwitchItem extends BaseItem {
    constructor(text, active) {
        super();
        this.label = new Actor({ text: text });
        this._state = !!active;
    }
    // Worst case: a programmatic change also emits "toggled".
    setToggleState(s) { this._state = s; this.emit('toggled', s); }
    userClick(s) { this._state = s; this.emit('toggled', s); }
}

class SubMenuItem extends BaseItem {
    constructor(text) { super(); this.label = new Actor({ text: text }); this.menu = new MenuBase(); }
}

class PlainItem extends BaseItem {
    constructor(text) { super(); this.label = new Actor({ text: text }); }
}

class SeparatorItem extends BaseItem {}

class MenuBase extends Emitter {
    constructor() { super(); this.items = []; this.isOpen = false; this.closeCount = 0; }
    addMenuItem(item) { this.items.push(item); return item; }
}

class AppletPopupMenu extends MenuBase {
    toggle() { this.isOpen = !this.isOpen; }
    close() { this.isOpen = false; this.closeCount++; this.emit('open-state-changed', this, false); }
}

class IconApplet {
    constructor() { this.actor = new Actor(); }
    _init() { this.actor = new Actor(); }   // the real _init creates the actor; without it render() threw halfway
    set_applet_icon_symbolic_path(p) { this.icon = p; }
    set_applet_tooltip(t) { this.tooltip = t; }
}

// Machine state the fake proxy-manager.sh reads and writes.
const machine = {
    enabled: false,
    gateway: 'http://192.168.137.1:8080',
    integrations: ['git', 'npm'],
};
const runs = [];

function statusJson() {
    return {
        enabled: machine.enabled,
        httpProxy: machine.gateway,
        httpsProxy: machine.gateway,
        gatewayAuto: false,
        integrations: machine.integrations.slice(),
        active: {},
    };
}

// Timers are stored so the test can fire the 10-second poll on demand.
const timers = {};
let nextId = 1;
const GLib = {
    PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true, SOURCE_REMOVE: false,
    build_filenamev: (parts) => parts.join('/'),
    get_home_dir: () => '/home/test',
    timeout_add_seconds(prio, secs, fn) { const id = nextId++; timers[id] = { secs, fn }; return id; },
    source_remove(id) { delete timers[id]; },
    markup_escape_text: (s) => s,
    shell_quote: (s) => "'" + s + "'",
    DateTime: { new_now_local: () => ({ format: () => '12:00:00' }) },
};

// Command results arrive later, from a queue, the way they do on a real desktop.
const queue = [];
function flush() {
    let steps = 0;
    while (queue.length) {
        if (++steps > 500) {
            failures++;
            console.log('  FAIL  the menu never settled: a switch keeps re-triggering itself (feedback loop)');
            queue.length = 0;
            return;
        }
        queue.shift()();
    }
}

// Switches the scenarios use to make the fake script misbehave.
machine.refuse = false;     // enable is refused: no proxy answered at the gateway
machine.failKeys = [];      // set-integration fails for these keys

// What proxy-manager.sh does. Returns a finished process: { out, err, code }.
function answer(sub, rest) {
    const good = (o) => ({ out: JSON.stringify(o), err: '', code: 0 });
    const bad = (msg) => ({ out: JSON.stringify({ error: msg }), err: '', code: 1 });
    if (sub === 'status') return good(statusJson());
    if (sub === 'enable') {
        if (machine.refuse) return bad('No proxy answered at ' + machine.gateway + '. Nothing was changed.');
        machine.enabled = true;
        return good(statusJson());
    }
    if (sub === 'disable') { machine.enabled = false; return good(statusJson()); }
    if (sub === 'set-integration') {
        const [key, state] = rest;
        if (machine.failKeys.indexOf(key) !== -1) return bad('could not save ' + key);
        machine.integrations = machine.integrations.filter((k) => k !== key);
        if (state === 'on') machine.integrations.push(key);
        return good(statusJson());
    }
    if (sub === 'set-gateway') { machine.gateway = 'http://' + rest[0] + ':' + rest[1]; return good(statusJson()); }
    if (sub === 'set-auto') return good(statusJson());
    if (sub === 'test') return good({ test: 'ok', ms: 12 });
    if (sub === 'detect') return good({ gateway: '192.168.137.1', iface: 'wlp2s0', port: 8080, url: 'http://192.168.137.1:8080' });
    return { out: '', err: 'unknown command', code: 2 };
}

// Util.spawnCommandLineAsync, as it behaves in Cinnamon 6: it runs the command but does NOT
// pass the output to the callback. The desktop log showed "ok: status (0 bytes)" for every
// call. Code that reads command output from this function sees an empty string, here and there.
const Util = {
    spawnCommandLineAsync(cmd, ok, fail) {
        const words = cmd.replace(/'/g, '').split(' ');   // ['/bin/bash', script, sub, ...args]
        const sub = words[2];
        const rest = words.slice(3);
        runs.push([sub].concat(rest).join(' '));
        queue.push(() => { answer(sub, rest); ok(); });
    },
    spawnCommandLine() {},
};

// Gio.Subprocess: the supported way to get stdout, stderr and the exit code.
const Gio = {
    SubprocessFlags: { STDOUT_PIPE: 1, STDERR_PIPE: 2 },
    Subprocess: {
        new(argv, flags) {
            const sub = argv[2];                            // ['/bin/bash', script, sub, ...args]
            const rest = argv.slice(3);
            runs.push([sub].concat(rest).join(' '));
            let result = null;
            return {
                communicate_utf8_async(stdin, cancellable, cb) {
                    queue.push(() => { result = answer(sub, rest); cb(this, 'res'); });
                },
                communicate_utf8_finish() { return [true, result.out, result.err]; },
                get_if_exited() { return true; },
                get_exit_status() { return result.code; },
            };
        },
    },
};

const sandbox = {
    console,
    global: { log: (m) => { (globalThis.__logs = globalThis.__logs || []).push(String(m)); } },
    imports: {
        ui: {
            applet: { IconApplet, AppletPopupMenu },
            popupMenu: {
                PopupMenuManager: class { addMenu() {} },
                PopupSwitchMenuItem: SwitchItem,
                PopupSubMenuMenuItem: SubMenuItem,
                PopupMenuItem: PlainItem,
                PopupSeparatorMenuItem: SeparatorItem,
                PopupBaseMenuItem: BaseItem,
            },
        },
        gi: {
            St: {
                Label: Actor,
                Entry: Actor,
                Button,
                BoxLayout: Actor,
            },
            GLib,
            Gio,
        },
        misc: { util: Util },
    },
};

vm.createContext(sandbox);
const source = fs.readFileSync(path.join(APPLET_DIR, 'applet.js'), 'utf8');
vm.runInContext(source + '\nthis.main = main;', sandbox);

// ---------- helpers ----------

function fireTimers(secs) {
    Object.keys(timers).forEach((id) => {
        const t = timers[id];
        if (t && t.secs === secs) t.fn();
    });
}

function findButton(node, text) {
    if (!node) return null;
    if (node instanceof Button && node.buttonText === text) return node;
    const kids = [].concat(node.children || [], node.items || []);
    if (node.menu) kids.push(node.menu);
    for (const k of kids) {
        const found = findButton(k, text);
        if (found) return found;
    }
    return null;
}

// ---------- scenarios ----------

console.log('== applet logic ==');
const applet = sandbox.main({ path: APPLET_DIR }, 'bottom', 24, 1);
flush();

console.log('startup');
check('startup does not turn the proxy off', !runs.some((r) => r.startsWith('disable')));
check('header shows off when the proxy is off', applet._switch._state === false);

console.log('turning on');
applet._switch.userClick(true);
flush();
check('turning on runs enable once', runs.filter((r) => r === 'enable').length === 1);
check('the proxy really is on', machine.enabled === true);
check('header switch stays on', applet._switch._state === true);

console.log('background refreshes');
fireTimers(10);
flush();
fireTimers(10);
flush();
applet.menu.emit('open-state-changed', applet.menu, true);
flush();
check('refreshes never run disable', !runs.some((r) => r.startsWith('disable')));
check('header switch still on after refreshes', applet._switch._state === true);
check('the proxy is still on after refreshes', machine.enabled === true);

console.log('turn all off buttons');
const turnOff = findButton(applet.menu, 'Turn all off');
check('a "Turn all off" button exists', turnOff !== null);
if (turnOff) {
    turnOff.emit('clicked');
    flush();
    const offRuns = runs.filter((r) => r.startsWith('set-integration') && r.endsWith(' off'));
    check('turn all off sends set-integration off for each key', offRuns.length === 7);
    check('turn all off leaves the menu open', applet.menu.closeCount === 0);
}

console.log('save gateway');
applet._hostEntry.clutter_text.text = '192.168.137.5';
applet._portEntry.clutter_text.text = '8081';
const save = findButton(applet.menu, 'Save gateway');
check('a "Save gateway" button exists', save !== null);
if (save) {
    save.emit('clicked');
    flush();
    check('save sends set-gateway with the typed values',
        runs.some((r) => r === 'set-gateway 192.168.137.5 8081'));
    check('a successful save closes the menu', applet.menu.closeCount >= 1);
}

console.log('test connection');
const testBtn = findButton(applet.menu, 'Test connection');
check('a "Test connection" button exists', testBtn !== null);
if (testBtn) {
    const before = applet.menu.closeCount;
    testBtn.emit('clicked');
    flush();
    check('test connection runs the test command', runs.includes('test'));
    check('test connection keeps the menu open', applet.menu.closeCount === before);
}

console.log('detected gateway');
check('the detected gateway is shown', String(applet._detectLabel.text).indexOf('192.168.137.1') !== -1);
const useDetected = findButton(applet.menu, 'Use detected');
check('a "Use detected" button exists', useDetected !== null);
if (useDetected) {
    applet._hostEntry.clutter_text.text = '';
    applet._portEntry.clutter_text.text = '';
    useDetected.emit('clicked');
    flush();
    check('Use detected fills the IP address', applet._hostEntry.clutter_text.text === '192.168.137.1');
    check('Use detected fills the port', applet._portEntry.clutter_text.text === '8080');
    check('Use detected does not save anything yet', !runs.some((r) => r.startsWith('set-gateway')) ||
        runs.lastIndexOf('set-gateway 192.168.137.1 8080') === -1);
}

console.log('status pill');
check('the status pill follows the proxy state', applet._pill !== null && applet._pill.text === 'PROXY ON');

// ---------- regression: the menu must see what the script prints ----------

console.log('menu reads the script output (proxy turned itself off)');
fireTimers(6); flush();                       // let any old note expire
machine.enabled = false; machine.refuse = false; machine.failKeys = [];
applet._refresh(); flush();
check('status from the script reaches the menu', applet._status !== null && applet._status.enabled === false);
check('no "cannot read status" error while the script works', applet._statusError === '');
check('rendering alone never shows a "saved" note', applet._note === null);

applet._switch.userClick(true);
const guards = Object.keys(timers).map((id) => timers[id].secs).filter((s) => s > 10);
check('the enable guard outlasts a 60 s password prompt', guards.length > 0 && Math.min.apply(null, guards) > 70);
flush();
check('the proxy is really on', machine.enabled === true);
check('the switch stays on after enable', applet._switch._state === true);
check('the pill says PROXY ON after enable', applet._pill.text === 'PROXY ON');
check('no error is shown after a good enable', applet._actionError === '');
fireTimers(10); flush();
check('the switch stays on after the next poll', applet._switch._state === true);

console.log('enable refused by the script');
applet._switch.userClick(false); flush();
machine.refuse = true;
const mark = runs.length;
applet._switch.userClick(true); flush();
check('a refused enable leaves the proxy off', machine.enabled === false);
check('a refused enable puts the switch back off', applet._switch._state === false);
check('a refused enable shows the reason', /No proxy answered/.test(applet._meta.clutter_text.markup));
check('a refused enable re-reads the real status', runs.slice(mark).indexOf('status') !== -1);
machine.refuse = false;

console.log('turn all on');
fireTimers(6); flush();
machine.enabled = false; machine.integrations = []; machine.failKeys = ['npm'];
applet._refresh(); flush();
const turnOn = findButton(applet.menu, 'Turn all on');
check('a "Turn all on" button exists', turnOn !== null);
if (turnOn) {
    const start = runs.length;
    turnOn.emit('clicked'); flush();
    const onRuns = runs.slice(start).filter((r) => r.startsWith('set-integration') && r.endsWith(' on'));
    check('turn all on sends set-integration on for all seven', onRuns.length === 7);
    check('one failing item does not stop the others',
        ['git', 'yarn', 'pip', 'curl', 'wget', 'docker'].every((k) => machine.integrations.indexOf(k) !== -1));
    check('the failing item is reported', /could not save npm/.test(applet._meta.clutter_text.markup));

    machine.failKeys = []; machine.integrations = [];
    turnOn.emit('clicked'); flush();
    check('with the proxy off, turn all on says it applies later', /turned on/.test(applet._meta.clutter_text.markup));
    check('and the proxy stays off', machine.enabled === false);

    fireTimers(6); flush();
    machine.enabled = true; machine.integrations = [];
    applet._refresh(); flush();
    turnOn.emit('clicked'); flush();
    check('with the proxy on, turn all on does not say "applies later"', !/turned on/.test(applet._meta.clutter_text.markup));
}

console.log('one queue at a time, with progress');
fireTimers(6); flush();
machine.enabled = false; machine.integrations = []; machine.failKeys = [];
applet._refresh(); flush();
const bulkOn = findButton(applet.menu, 'Turn all on');
const before2 = runs.length;
bulkOn.emit('clicked');
bulkOn.emit('clicked');                       // impatient second and third clicks
bulkOn.emit('clicked');
queue.shift()();                              // only the first command (git) has finished
check('after one step the first switch is already on', applet._switches.git._state === true);
check('and the next one is not yet', applet._switches.npm._state === false);
check('progress is shown while the queue runs', /Applying 1\/7/.test(applet._meta.clutter_text.markup));
flush();
const onRuns2 = runs.slice(before2).filter((r) => r.startsWith('set-integration') && r.endsWith(' on'));
check('extra clicks do not start extra queues (7 commands, not 21)', onRuns2.length === 7);
check('all seven end up on', ['git', 'npm', 'yarn', 'pip', 'curl', 'wget', 'docker']
    .every((k) => machine.integrations.indexOf(k) !== -1 && applet._switches[k]._state === true));
check('the progress note is gone when the queue ends', !/Applying/.test(applet._meta.clutter_text.markup));
machine.integrations = [];
const before3 = runs.length;
bulkOn.emit('clicked'); flush();
check('a new click works after the queue finished',
    runs.slice(before3).filter((r) => r.startsWith('set-integration')).length === 7);

console.log('the menu reports what it draws');
fireTimers(6); flush();
machine.enabled = true; applet._refresh(); flush();
const logs = globalThis.__logs || [];
check('the log says a status with the proxy on was applied', logs.some((l) => /status applied: enabled=true/.test(l)));
check('the log says the menu was drawn with the proxy on', logs.some((l) => /render: enabled=true status=yes/.test(l)));
check('the footer shows the update time', /^updated 12:00:00/.test(applet._footer.text));
check('the flow line shows the gateway', applet._flow.text.indexOf(machine.gateway.replace('http://', '')) !== -1);
const savedFooter = applet._footer;
applet._footer = null;                         // force a drawing error
applet._safeRender();
check('a drawing error is logged with its cause', (globalThis.__logs || []).some((l) => /render section "footer" failed:.*null/.test(l)));
applet._footer = savedFooter;

console.log('one failing part of the menu does not stop the rest');
fireTimers(6); flush();
machine.enabled = true; machine.integrations = ['git'];
const savedFlow = applet._flow;
applet._flow = null;                           // make the flow line fail
applet._refresh(); flush();
check('the failing part is logged by name and message', (globalThis.__logs || []).some((l) => /render section "flow" failed: .*null/.test(l)));
check('the pill after it is still drawn', applet._pill.text === 'PROXY ON');
check('the switches after it are still drawn', applet._switches.git._state === true);
check('the footer shows the draw error', /draw error: flow:/.test(applet._footer.text));
applet._flow = savedFlow;
applet._refresh(); flush();
check('the footer recovers when the error is gone', /^updated/.test(applet._footer.text));

console.log('labels without a clutter_text property (as in real Cinnamon)');
fireTimers(6); flush();
machine.enabled = false; machine.integrations = [];
const realMeta = applet._meta;
const viaGetter = { text: '', ct: { markup: '', set_markup(m) { this.markup = m; } },
    get_clutter_text() { return this.ct; } };
applet._meta = viaGetter;
applet._refresh(); flush();
check('the status line is drawn through get_clutter_text()', /Proxy is off/.test(viaGetter.ct.markup));
check('no draw error is shown for it', !/draw error/.test(applet._footer.text));
check('the pill and footer are still updated', applet._pill.text === 'PROXY OFF' && /^updated/.test(applet._footer.text));
const plainMeta = { text: '' };
applet._meta = plainMeta;
applet._safeRender();
check('with no text actor at all the status line falls back to plain text', plainMeta.text === 'Proxy is off');
check('and that is not a draw error either', !/draw error/.test(applet._footer.text));
applet._meta = realMeta;
const realSwitch = applet._switches.git.label;
const bareLabel = { text: '' };
applet._switches.git.label = bareLabel;
applet._safeRender();
check('a switch label without a text actor falls back to plain text', bareLabel.text === 'Git');
applet._switches.git.label = realSwitch;

console.log('');
console.log(failures === 0 ? 'ALL APPLET LOGIC CHECKS PASSED' : failures + ' applet logic check(s) failed');
process.exit(failures === 0 ? 0 : 1);
