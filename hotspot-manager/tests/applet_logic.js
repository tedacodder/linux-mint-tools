#!/usr/bin/env node
// Runs the Hotspot Manager menu with mocked Cinnamon APIs. Checks the two bugs that
// bit the proxy manager: a refresh must never start or stop the hotspot, and a
// toggle must run exactly one command.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APPLET_DIR = path.join(__dirname, '..', 'applet');
let failures = 0;
function check(name, cond) {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
    if (!cond) failures++;
}

class Emitter {
    constructor() { this._h = {}; }
    connect(n, fn) { (this._h[n] = this._h[n] || []).push(fn); }
    emit(n, ...a) { (this._h[n] || []).forEach((fn) => fn(this, ...a)); }
}
class Actor extends Emitter {
    constructor(p = {}) {
        super();
        this.text = p.text || '';
        this.children = [];
        this.clutter_text = { text: '', set_password_char() {} };
        this.menu = null;
    }
    addActor(a) { this.children.push(a); }
    add_child(a) { this.children.push(a); }
    add_style_class_name() {}
    set_opacity() {}
}
class Button extends Emitter {
    constructor(p = {}) { super(); this.buttonText = p.label; this.children = []; }
    add_child(a) { this.children.push(a); }
}
class BaseItem extends Emitter {
    constructor() { super(); this.children = []; this.label = new Actor(); this.actor = new Actor(); }
    addActor(a) { this.children.push(a); }
}
class SwitchItem extends BaseItem {
    constructor(text, active) { super(); this.label = new Actor({ text }); this._state = !!active; }
    setToggleState(s) { this._state = s; this.emit('toggled', s); }   // worst case, like the proxy mock
    userClick(s) { this._state = s; this.emit('toggled', s); }
}
class MenuBase extends Emitter {
    constructor() { super(); this.items = []; }
    addMenuItem(i) { this.items.push(i); return i; }
    removeAll() { this.items = []; }
}
class SubMenu extends BaseItem {
    constructor() { super(); this.menu = new MenuBase(); }
}
class AppletPopupMenu extends MenuBase {
    toggle() {}
}
class IconApplet {
    _init() {}
    set_applet_icon_symbolic_path() {}
    set_applet_tooltip() {}
}

// The fake machine that proxy-manager's stand-in (hotspot-manager.sh) reads and writes
const machine = { active: false, ssid: 'cody', password: 'testpass1', clients: [] };
const runs = [];
const queue = [];
const timers = {};
let nextId = 1;
const GLib = {
    PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true, SOURCE_REMOVE: false,
    build_filenamev: (p) => p.join('/'),
    get_home_dir: () => '/home/test',
    get_real_time: () => 1000000 * 1000,
    shell_quote: (s) => "'" + s + "'",
    timeout_add_seconds(prio, secs, fn) { const id = nextId++; timers[id] = { secs, fn }; return id; },
    source_remove(id) { delete timers[id]; },
    DateTime: { new_now_local: () => ({ format: () => '12:00:00' }) },
};

function answer(sub, args) {
    if (sub === 'status') {
        return { active: machine.active, ssid: machine.ssid, iface: 'wlp2s0', ip: '10.42.0.1', host: 'tedacodder-Satellite',
            startedAt: 999000, clientCount: machine.clients.length, clients: machine.clients.slice() };
    }
    if (sub === 'start') { machine.active = true; return answer('status'); }
    if (sub === 'stop') { machine.active = false; return answer('status'); }
    if (sub === 'show-password') return { password: machine.password };
    if (sub === 'qr') { runs.push('qr'); return { path: '/tmp/join.png' }; }
    if (sub === 'set-ssid') { machine.ssid = args[0]; return answer('status'); }
    if (sub === 'set-password') { machine.password = args[0]; return answer('status'); }
    if (sub === 'generate-password') { machine.password = 'NEWPASS12345'; return answer('status'); }
    return { error: 'unknown' };
}

function answerFor(argv) {
    if (argv[0] === 'notify-send') { notes.push(argv.join(' ')); return ''; }
    if (argv[0] === 'xdg-open') { notes.push(argv.join(' ')); return ''; }
    const sub = argv[2];
    const args = argv.slice(3);
    runs.push([sub].concat(args).join(' '));
    return JSON.stringify(answer(sub, args));
}
const Gio = {
    SubprocessFlags: { STDOUT_PIPE: 1, STDERR_SILENCE: 2 },
    Subprocess: class {
        constructor(o) { this.argv = o.argv; this._out = ''; }
        init() {}
        communicate_utf8_async(stdin, cancellable, cb) {
            this._out = answerFor(this.argv);
            queue.push(() => cb(this, null));
        }
        communicate_utf8_finish() { return [true, this._out, '']; }
    },
};
const Util = {};

function flush() {
    let steps = 0;
    while (queue.length) {
        if (++steps > 500) { failures++; console.log('  FAIL  menu never settled (feedback loop)'); queue.length = 0; return; }
        queue.shift()();
    }
}
function fireTimers(secs) {
    Object.keys(timers).forEach((id) => { const t = timers[id]; if (t && t.secs === secs) t.fn(); });
}
function findButton(node, text) {
    if (!node) return null;
    if (node instanceof Button && node.buttonText === text) return node;
    const kids = [].concat(node.children || [], node.items || []);
    if (node.menu) kids.push(node.menu);
    for (const k of kids) { const f = findButton(k, text); if (f) return f; }
    return null;
}

const logs = [];
const notes = [];
const sandbox = {
    console, global: { log: (m) => logs.push(m) },
    imports: {
        ui: {
            applet: { IconApplet, AppletPopupMenu },
            popupMenu: {
                PopupMenuManager: class { addMenu() {} },
                PopupSwitchMenuItem: SwitchItem,
                PopupSubMenuMenuItem: SubMenu,
                PopupMenuItem: BaseItem,
                PopupSeparatorMenuItem: BaseItem,
                PopupBaseMenuItem: BaseItem,
            },
        },
        gi: {
            St: { Label: Actor, Entry: Actor, Button, BoxLayout: Actor,
                  Clipboard: { get_default: () => ({ set_text() {} }) }, ClipboardType: { CLIPBOARD: 1 } },
            GLib,
            Gio,
        },
        misc: { util: Util },
    },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APPLET_DIR, 'applet.js'), 'utf8') + '\nthis.main = main;', sandbox);

console.log('== hotspot applet logic ==');
const applet = sandbox.main({ path: APPLET_DIR }, 'bottom', 24, 1);
flush();

console.log('startup');
check('startup does not start or stop the hotspot', !runs.some((r) => r.startsWith('start') || r.startsWith('stop')));
check('the switch is off when the hotspot is off', applet._switch._state === false);
check('the pill says OFFLINE', applet._pill.text === 'OFFLINE');

console.log('turning on');
applet._switch.userClick(true);
flush();
check('turning on runs start exactly once', runs.filter((r) => r === 'start').length === 1);
check('the hotspot really is on', machine.active === true);
check('the switch stays on', applet._switch._state === true);
check('the pill says ON AIR', applet._pill.text === 'ON AIR');
check('the switch click is logged', logs.some((l) => l.indexOf('switch on requested') !== -1));
check('the result is shown as a notification', notes.some((n) => n.indexOf('hotspot is on') !== -1));

console.log('background refreshes');
fireTimers(5); flush(); fireTimers(5); flush();
check('refreshes never run stop', !runs.some((r) => r.startsWith('stop')));
check('the switch stays on after refreshes', applet._switch._state === true);
check('the hotspot stays on after refreshes', machine.active === true);

console.log('clients');
machine.clients = [{ ip: '10.42.0.23', mac: 'aa:bb:cc:dd:ee:01', state: 'REACHABLE', name: 'Galaxy-S24' }];
fireTimers(5); flush();
check('the client count shows 1', applet._countRow.text === 'CLIENTS  1');
check('the device row shows the connected device', applet._slots[0].label.text.indexOf('10.42.0.23') !== -1);
check('the device row shows its name', applet._slots[0].label.text.indexOf('Galaxy-S24') !== -1);
check('the second device row is hidden', applet._slots[1].item.actor.visible === false);
check('the devices header shows 1', applet._devicesHeader.text === 'DEVICES  (1)');
check('the laptop name is shown', applet._hostRow.text.indexOf('tedacodder-Satellite') !== -1);
machine.clients = [{ ip: '10.42.0.23', mac: 'aa:bb:cc:dd:ee:01', state: 'REACHABLE', name: 'Galaxy-S24' }, { ip: '10.42.0.40', mac: 'aa:bb:cc:dd:ee:03', state: 'REACHABLE', name: '' }];
fireTimers(5); flush();
check('a new device raises a join alert', notes.some((n) => n.indexOf('Device joined') !== -1));
check('an unnamed device shows as unknown', applet._slots[1].label.text.indexOf('unknown device') !== -1);
machine.clients = [];
fireTimers(5); flush();
check('a device that leaves raises a leave alert', notes.some((n) => n.indexOf('Device left') !== -1));

console.log('reveal and copy');
const reveal = findButton(applet.menu, 'Reveal password');
check('a Reveal password button exists', reveal !== null);
if (reveal) { reveal.emit('clicked'); flush(); check('reveal shows the password', applet._passRow.text.indexOf('testpass1') !== -1); }

console.log('show QR');
const qrBtn = findButton(applet.menu, 'Show QR to join');
check('a Show QR button exists', qrBtn !== null);
if (qrBtn) {
    qrBtn.emit('clicked'); flush();
    check('QR asks the script for a code', runs.indexOf('qr') !== -1);
    check('the QR image opens', notes.some((n) => n.indexOf('xdg-open') !== -1));
}

console.log('settings');
applet._ssidEntry.clutter_text.text = 'newname';
applet._passEntry.clutter_text.text = '';
const save = findButton(applet.menu, 'Save & apply');
check('a Save & apply button exists', save !== null);
if (save) {
    save.emit('clicked'); flush();
    check('save sends set-ssid with the typed name', runs.some((r) => r === 'set-ssid newname'));
    check('the new SSID shows in the menu', applet._ssidRow.text === 'SSID   newname');
    check('saving does not stop the hotspot', machine.active === true);
}

console.log('turning off');
applet._switch.userClick(false);
flush();
check('turning off runs stop once', runs.filter((r) => r === 'stop').length === 1);
check('the pill says OFFLINE again', applet._pill.text === 'OFFLINE');

console.log('');
console.log(failures === 0 ? 'ALL HOTSPOT APPLET CHECKS PASSED' : failures + ' applet check(s) failed');
process.exit(failures === 0 ? 0 : 1);
