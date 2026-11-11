'use strict';
// Mocks for the Cinnamon and GJS APIs that applet.js uses.
//
// Each mock keeps the real name, argument order, return shape and signal
// behaviour that the applet relies on. Constants use the real values where
// known (GTK PolicyType.NEVER is 2, Clutter.EVENT_STOP is 1). Gio file calls
// use the real disk inside the temporary HOME. Keyboard focus and propagation
// follow Clutter: a key goes to the focused actor, then to its parents until a
// handler stops it. Clutter.Text then does its default work (Return fires
// 'activate' in single-line mode and inserts a newline otherwise).
//
// Nothing here has been checked against a running Cinnamon.

const fs = require('fs');
const path = require('path');

const K = {
    KEY_Escape: 0xff1b,
    KEY_Return: 0xff0d,
    KEY_KP_Enter: 0xff8d,
    KEY_Left: 0xff51,
    KEY_Right: 0xff53,
    KEY_slash: 0x2f,
    KEY_n: 0x6e,
    KEY_N: 0x4e,
    KEY_Tab: 0xff09,
    KEY_ISO_Left_Tab: 0xfe20,
    KEY_Up: 0xff52,
    KEY_Down: 0xff54,
    KEY_c: 0x63,
    KEY_e: 0x65,
    KEY_p: 0x70,
    KEY_x: 0x78,
    KEY_Delete: 0xffff,
    KEY_space: 0x20,
    KEY_t: 0x74,
    BUTTON_PRESS: 4,
    BUTTON_RELEASE: 5,
    EVENT_PROPAGATE: 0,
    EVENT_STOP: 1,
    SHIFT_MASK: 1,
};

class KeyEvent {
    constructor(sym, state = 0) {
        this.sym = sym;
        this.state = state;
    }
    get_key_symbol() { return this.sym; }
    get_state() { return this.state; }
}

// Calls every handler for a signal. Returns true if any returned a truthy
// value, which for key events means "stop propagation".
function runHandlers(table, sig, actor, ...args) {
    let stopped = false;
    (table[sig] || []).forEach(fn => {
        if (fn(actor, ...args)) stopped = true;
    });
    return stopped;
}

function isWithin(root, actor) {
    for (let a = actor; a; a = a.parent) {
        if (a === root) return true;
    }
    return false;
}

function makeCinnamon(world) {
    class ClutterText {
        constructor(owner) {
            this.owner = owner;
            this.singleLine = true;
            this.lineWrap = false;
            this.handlers = {};
        }
        connect(sig, fn) {
            (this.handlers[sig] = this.handlers[sig] || []).push(fn);
            return 1;
        }
        emit(sig, ...args) { return runHandlers(this.handlers, sig, this, ...args); }
        set_single_line_mode(v) { this.singleLine = !!v; }
        set_line_wrap(v) { this.lineWrap = !!v; }
    }

    class Actor {
        constructor(kind, props = {}) {
            this.kind = kind;
            this.style_class = props.style_class || '';
            this.classes = new Set(this.style_class.split(' ').filter(Boolean));
            this.label = props.label || '';
            this.hint_text = props.hint_text || '';
            this.text = props.text || '';
            this.reactive = !!props.reactive;
            this.visible = true;
            this.parent = null;
            this.children = [];
            this.handlers = {};
            this.style = '';
            this.destroyed = false;
            this.clutter_text = new ClutterText(this);
        }
        connect(sig, fn) {
            (this.handlers[sig] = this.handlers[sig] || []).push(fn);
            return 1;
        }
        emit(sig, ...args) { return runHandlers(this.handlers, sig, this, ...args); }
        add_child(child) {
            child.parent = this;
            this.children.push(child);
            return child;
        }
        add(child) { return this.add_child(child); }
        add_actor(child) { return this.add_child(child); }
        destroy_all_children() {
            this.children.forEach(c => {
                if (world.focused && isWithin(c, world.focused)) world.focused = null;
                c.parent = null;
            });
            this.children = [];
        }
        destroy() { this.destroyed = true; }
        set_style(s) { this.style = s; }
        add_style_class_name(c) { this.classes.add(c); }
        remove_style_class_name(c) { this.classes.delete(c); }
        set_policy(horizontal, vertical) { this.policy = [horizontal, vertical]; }
        contains(actor) { return isWithin(this, actor); }
        set_label(t) { this.label = String(t); }
        set_text(t) {
            this.text = String(t);
            this.clutter_text.emit('text-changed');
        }
        get_text() { return this.text; }
        grab_key_focus() { world.focused = this; }
        has_key_focus() { return world.focused === this; }
    }

    class Label extends Actor { constructor(p) { super('Label', p); } }
    class BoxLayout extends Actor { constructor(p) { super('BoxLayout', p); } }
    class Entry extends Actor { constructor(p) { super('Entry', p); } }
    class Button extends Actor { constructor(p) { super('Button', p); } }
    class ScrollView extends Actor { constructor(p) { super('ScrollView', p); } }

    class TextIconApplet {
        constructor(orientation, panelHeight, instanceId) {
            this.orientation = orientation;
            this.panelHeight = panelHeight;
            this.instanceId = instanceId;
            this.actor = new BoxLayout({ style_class: 'applet-box' });
            this._applet_icon = new BoxLayout({ style_class: 'applet-icon' });
            this.iconPath = null;
            this.tooltip = '';
        }
        set_applet_icon_symbolic_path(p) { this.iconPath = p; }
        set_applet_tooltip(t) { this.tooltip = t; }
    }

    class AppletPopupMenu {
        constructor(applet, orientation) {
            this.applet = applet;
            this.orientation = orientation;
            this.isOpen = false;
            this.actor = new BoxLayout({ style_class: 'popup-menu' });
            this.handlers = {};
            this.destroyed = false;
        }
        connect(sig, fn) {
            (this.handlers[sig] = this.handlers[sig] || []).push(fn);
            return 1;
        }
        emit(sig, ...args) { return runHandlers(this.handlers, sig, this, ...args); }
        open() {
            if (this.isOpen) return;
            this.isOpen = true;
            this.emit('open-state-changed', true);
        }
        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            this.emit('open-state-changed', false);
        }
        toggle() { if (this.isOpen) this.close(); else this.open(); }
        addActor(actor) { return this.actor.add_child(actor); }
        destroy() { this.destroyed = true; }
    }

    // Mirrors Cinnamon's ModalDialog (ui/modalDialog.js): content goes in
    // contentLayout; open() moves key focus to the initial focus actor; close()
    // destroys the dialog only when destroyOnClose is true.
    class ModalDialog extends Actor {
        constructor(params = {}) {
            super('ModalDialog', {});
            this.destroyOnClose = params.destroyOnClose !== false;
            this.styleClass = params.styleClass || null;
            this.dialogLayout = new BoxLayout({ style_class: 'modal-dialog' });
            this.contentLayout = new BoxLayout({ style_class: 'modal-content' });
            this.add_child(this.dialogLayout);
            this.dialogLayout.add_child(this.contentLayout);
            this.initialFocus = null;
            this.isOpen = false;
            this.destroyed = false;
        }
        setInitialKeyFocus(actor) { this.initialFocus = actor; }
        open() {
            if (this.isOpen) return true;
            this.isOpen = true;
            if (this.initialFocus) this.initialFocus.grab_key_focus();
            return true;
        }
        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            if (this.destroyOnClose) this.destroy();
        }
        destroy() { this.destroyed = true; }
    }

    class PopupMenuManager {
        constructor(owner) {
            this.owner = owner;
            this.menus = [];
        }
        addMenu(menu) { this.menus.push(menu); }
    }

    // Mirrors Gio.FileMonitor: connect('changed') handlers receive
    // (monitor, file, otherFile, eventType). cancel() stops it.
    class FileMonitor {
        constructor(path) {
            this.path = path;
            this.handlers = {};
            this.cancelled = false;
        }
        connect(sig, fn) {
            (this.handlers[sig] = this.handlers[sig] || []).push(fn);
            return 1;
        }
        emit(sig, ...args) { return runHandlers(this.handlers, sig, this, ...args); }
        cancel() { this.cancelled = true; }
    }

    class GFile {
        constructor(p) { this.p = p; }
        move(dest) {
            // Like Gio.File.move with OVERWRITE: replaces the destination.
            fs.renameSync(this.p, dest.p);
            return true;
        }
        monitor_file() {
            if (world.failMonitor) throw new Error('monitor unavailable (test)');
            const monitor = new FileMonitor(this.p);
            world.monitors = world.monitors || [];
            world.monitors.push(monitor);
            return monitor;
        }
        query_exists() { return fs.existsSync(this.p); }
        load_contents() {
            // The real call throws a GLib error when the file is missing.
            const buf = fs.readFileSync(this.p);
            return [true, new Uint8Array(buf), ''];
        }
        replace_contents(bytes) {
            fs.writeFileSync(this.p, Buffer.from(bytes));
            return [true, ''];
        }
    }

    const St = {
        Label, BoxLayout, Entry, Button, ScrollView,
        PolicyType: { ALWAYS: 0, AUTOMATIC: 1, NEVER: 2 },
    };

    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_CONTINUE: true,
        SOURCE_REMOVE: false,
        get_home_dir: () => process.env.HOME,
        get_user_state_dir: () => process.env.XDG_STATE_HOME
            || path.join(process.env.HOME, '.local', 'state'),
        build_filenamev: (parts) => path.join(...parts),
        mkdir_with_parents: (dir) => {
            fs.mkdirSync(dir, { recursive: true });
            return 0;
        },
        rename: (from, to) => {
            try {
                fs.renameSync(from, to);
                return 0;
            } catch (e) {
                return -1;
            }
        },
        timeout_add_seconds: (priority, seconds, fn) => {
            world.nextId += 1;
            world.timers.push({ id: world.nextId, seconds, fn });
            return world.nextId;
        },
        source_remove: (id) => {
            world.timers = world.timers.filter(t => t.id !== id);
        },
    };

    const Gio = {
        File: { new_for_path: (p) => new GFile(p) },
        FileCreateFlags: { NONE: 0 },
        FileCopyFlags: { NONE: 0, OVERWRITE: 1 },
        FileMonitorFlags: { NONE: 0 },
        FileMonitorEvent: { CHANGED: 0, CHANGES_DONE_HINT: 1, DELETED: 2, CREATED: 3, ATTRIBUTE_CHANGED: 4 },
        SubprocessFlags: { STDOUT_PIPE: 1, STDERR_SILENCE: 4 },
    };

    const Clutter = {
        KEY_Escape: K.KEY_Escape,
        KEY_Return: K.KEY_Return,
        KEY_KP_Enter: K.KEY_KP_Enter,
        KEY_Left: K.KEY_Left,
        KEY_Right: K.KEY_Right,
        KEY_slash: K.KEY_slash,
        KEY_n: K.KEY_n,
        KEY_N: K.KEY_N,
        KEY_Tab: K.KEY_Tab,
        KEY_ISO_Left_Tab: K.KEY_ISO_Left_Tab,
        KEY_Up: K.KEY_Up,
        KEY_Down: K.KEY_Down,
        KEY_c: K.KEY_c,
        KEY_e: K.KEY_e,
        KEY_p: K.KEY_p,
        KEY_x: K.KEY_x,
        KEY_Delete: K.KEY_Delete,
        KEY_t: K.KEY_t,
        EventType: { BUTTON_PRESS: K.BUTTON_PRESS, BUTTON_RELEASE: K.BUTTON_RELEASE },
        EVENT_PROPAGATE: K.EVENT_PROPAGATE,
        EVENT_STOP: K.EVENT_STOP,
        ModifierType: { SHIFT_MASK: K.SHIFT_MASK },
    };

    // Mirrors Main.keybindingManager: addHotKey(name, combo, callback) and removeHotKey(name).
    const keybindingManager = {
        addHotKey(name, combo, callback) {
            if (world.failHotkey) throw new Error('keybinding unavailable (test)');
            world.hotkeys = world.hotkeys || {};
            world.hotkeys[name] = { combo: combo, callback: callback };
            return true;
        },
        removeHotKey(name) {
            if (world.hotkeys) delete world.hotkeys[name];
        },
    };

    const imports = {
        ui: {
            main: { keybindingManager },
            applet: { TextIconApplet, AppletPopupMenu },
            popupMenu: { PopupMenuManager },
            modalDialog: { ModalDialog },
        },
        gi: { St, GLib, Gio, Clutter },
        byteArray: {
            toString: (bytes) => Buffer.from(bytes).toString('utf8'),
            fromString: (s) => new Uint8Array(Buffer.from(String(s), 'utf8')),
        },
    };

    const stage = {
        connect(sig, fn) {
            world.stageSeq = (world.stageSeq || 0) + 1;
            world.stageHandlers = world.stageHandlers || [];
            world.stageHandlers.push({ id: world.stageSeq, sig: sig, fn: fn });
            return world.stageSeq;
        },
        disconnect(id) {
            world.stageHandlers = (world.stageHandlers || []).filter(h => h.id !== id);
        },
    };

    const global = {
        log: (message) => { world.logs.push(String(message)); },
        stage: stage,
    };

    return { imports, global, GLib, Gio, Clutter, St };
}

// Sends a key the way Clutter does: focused actor first, then up the parents.
// If nothing stops it, the default text behaviour of a focused entry runs.
function sendKey(world, event) {
    const start = world.focused || world.root;
    for (let a = start; a; a = a.parent) {
        if (runHandlers(a.handlers, 'key-press-event', a, event)) return 'stopped';
    }
    const f = world.focused;
    // A focused St.Button activates on Return or Space, as a real button does.
    if (f && f.kind === 'Button') {
        const sym = event.get_key_symbol();
        if (sym === K.KEY_Return || sym === K.KEY_KP_Enter || sym === K.KEY_space) {
            f.emit('clicked');
        }
    }
    if (f && f.kind === 'Entry') {
        const sym = event.get_key_symbol();
        if (sym === K.KEY_Return || sym === K.KEY_KP_Enter) {
            if (f.clutter_text.singleLine) f.clutter_text.emit('activate');
            else f.set_text(f.text + '\n');
        }
    }
    return 'propagated';
}

// Delivers a mouse press on `actor` to the stage handlers, as the capture phase would.
function pressAt(world, actor) {
    const event = { type: () => K.BUTTON_PRESS, get_source: () => actor };
    (world.stageHandlers || []).slice().forEach(h => {
        if (h.sig === 'captured-event') h.fn(null, event);
    });
}

module.exports = { makeCinnamon, sendKey, KeyEvent, K, pressAt };
