const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;

const POLL_SECONDS = 10;
// pkexec may wait 60 s for a password and the gateway check takes up to 12 s,
// so this safety net must be longer than both.
const APPLY_TIMEOUT_SECONDS = 150;
const STATUS_TIMEOUT_SECONDS = 8;
const NOTE_SECONDS = 6;

const COLORS = {
    on: '#3fb489',
    warn: '#e0a526',
    off: '#6b7280',
    error: '#e5484d'
};

const GROUPS = [
    {
        title: 'Developer tools',
        items: [
            { key: 'git', label: 'Git' },
            { key: 'npm', label: 'npm' },
            { key: 'yarn', label: 'yarn' },
            { key: 'pip', label: 'pip' },
            { key: 'curl', label: 'curl' },
            { key: 'wget', label: 'wget' },
            { key: 'docker', label: 'Docker' }
        ]
    },
    {
        title: 'Editors & browsers',
        items: [
            { key: 'vscode', label: 'VS Code' },
            { key: 'browser', label: 'Chrome / Chromium' },
            { key: 'firefox', label: 'Firefox' }
        ]
    },
    {
        title: 'System',
        items: [
            { key: 'env', label: 'Shell environment' },
            { key: 'system', label: 'System settings' },
            { key: 'apt', label: 'APT packages' }
        ]
    }
];

function ProxyManagerApplet(metadata, orientation, panelHeight, instanceId) {
    this._init(metadata, orientation, panelHeight, instanceId);
}

ProxyManagerApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function (metadata, orientation, panelHeight, instanceId) {
        Applet.IconApplet.prototype._init.call(this, orientation, panelHeight, instanceId);

        this._script = GLib.build_filenamev([metadata.path, 'proxy-manager.sh']);
        this._iconPath = GLib.build_filenamev([metadata.path, 'icon-symbolic.svg']);
        this._configPath = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'proxy-manager', 'proxy.json']);

        this._status = null;
        this._statusError = '';
        this._actionError = '';
        this._note = null;
        this._noteId = 0;
        this._lastUpdate = '';
        this._pending = false;
        this._target = false;
        this._refreshing = false;
        this._populateNext = false;
        this._guardId = 0;
        this._pollId = 0;
        this._switches = {};
        this._groupSubs = [];
        this._silent = false;
        this._detected = null;
        this._detectLabel = null;
        this._pill = null;

        this.set_applet_icon_symbolic_path(this._iconPath);
        this.set_applet_tooltip('Proxy Manager');

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        try {
            if (this.menu.box) this.menu.box.add_style_class_name('proxy-menu');
        } catch (e) {
            // Styling only: the menu works without it.
        }
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                this._populateNext = true;
                this._refresh();
            }
        });

        this._buildMenu();
        this._safeRender();
        this._refresh();

        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    },

    on_applet_clicked: function () {
        this.menu.toggle();
    },

    on_applet_removed_from_panel: function () {
        if (this._pollId) GLib.source_remove(this._pollId);
        this._clearGuard();
        if (this._noteId) GLib.source_remove(this._noteId);
    },

    // ------------------------------------------------------------ menu

    _buildMenu: function () {
        let menu = this.menu;

        // Header
        this._switch = new PopupMenu.PopupSwitchMenuItem('Proxy Manager', false);
        this._switch.connect('toggled', (item, state) => this._setTarget(state));
        menu.addMenuItem(this._switch);

        // Status pill: a quick read of the state at the top of the menu
        let pillRow = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        this._pill = new St.Label({ text: 'PROXY OFF', style_class: 'proxy-pill proxy-pill-off' });
        pillRow.addActor(this._pill, { expand: true });
        menu.addMenuItem(pillRow);

        this._meta = this._addTextRow(menu, 'Reading\u2026', 'proxy-meta');
        this._flow = this._addTextRow(menu, '', 'proxy-flow');
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Actions: these buttons keep the menu open
        this._addButtons(menu, [
            { text: 'Test connection', style: 'proxy-btn-primary', onClick: () => this._runTest() },
            { text: 'Refresh', onClick: () => this._refresh() }
        ]);

        // Gateway settings
        this._gatewaySub = new PopupMenu.PopupSubMenuMenuItem('Gateway');
        menu.addMenuItem(this._gatewaySub);
        let g = this._gatewaySub.menu;

        this._autoSwitch = new PopupMenu.PopupSwitchMenuItem('Auto-detect gateway', true);
        this._autoSwitch.connect('toggled', (item, state) =>
            this._configure([['set-auto', state ? 'true' : 'false']], null));
        g.addMenuItem(this._autoSwitch);

        // Light card with black text: the detected gateway, the IP and the port
        let card = this._addCard(g);
        this._detectLabel = this._addCardText(card, 'Detecting gateway...', 'proxy-card-title');
        this._hostEntry = this._addCardEntry(card, 'IP address');
        this._portEntry = this._addCardEntry(card, 'Port');
        this._addButtons(g, [
            { text: 'Use detected', onClick: () => this._useDetected() },
            { text: 'Save gateway', style: 'proxy-btn-primary', onClick: () => this._saveGateway() }
        ]);

        // Integration groups, each with its own bulk buttons
        GROUPS.forEach((group) => {
            let sub = new PopupMenu.PopupSubMenuMenuItem(group.title);
            menu.addMenuItem(sub);
            let inner = sub.menu;
            let keys = group.items.map((i) => i.key);

            this._addButtons(inner, [
                { text: 'Turn all on', style: 'proxy-btn-primary', onClick: () => this._bulk(keys, 'on') },
                { text: 'Turn all off', style: 'proxy-btn-danger', onClick: () => this._bulk(keys, 'off') }
            ]);

            group.items.forEach((integ) => {
                let sw = new PopupMenu.PopupSwitchMenuItem(integ.label, false);
                sw.connect('toggled', (item, state) =>
                    this._configure([['set-integration', integ.key, state ? 'on' : 'off']],
                        (ok) => this._noteSavedWhileOff(ok, state ? 'on' : 'off')));
                inner.addMenuItem(sw);
                this._switches[integ.key] = sw;
            });
            this._groupSubs.push({ sub: sub, group: group });
        });

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        let openCfg = new PopupMenu.PopupMenuItem('Open config file');
        openCfg.connect('activate', () => Util.spawnCommandLine('xdg-open ' + this._configPath));
        menu.addMenuItem(openCfg);

        this._footer = this._addTextRow(menu, 'Waiting for proxy-manager\u2026', 'proxy-footer');
    },

    _setClass: function (actor, cls) {
        if (actor.set_style_class_name) actor.set_style_class_name(cls);
        else actor.style_class = cls;
    },

    // A light box that holds the gateway fields. Its labels are black (see stylesheet).
    _addCard: function (container) {
        let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        let box = new St.BoxLayout({ vertical: true, style_class: 'proxy-gw-card', x_expand: true });
        item.addActor(box, { expand: true });
        container.addMenuItem(item);
        return box;
    },

    _addCardText: function (card, text, styleClass) {
        let label = new St.Label({ text: text, style_class: styleClass });
        card.add_child(label);
        return label;
    },

    _addCardEntry: function (card, labelText) {
        let row = new St.BoxLayout({ style_class: 'proxy-gw-row', x_expand: true });
        let label = new St.Label({ text: labelText, style_class: 'proxy-field-label' });
        let entry = new St.Entry({ style_class: 'proxy-entry', x_expand: true });
        row.add_child(label);
        row.add_child(entry);
        card.add_child(row);
        return entry;
    },

    _useDetected: function () {
        let d = this._detected;
        if (!d || !d.gateway) return;
        this._hostEntry.clutter_text.text = d.gateway;
        this._portEntry.clutter_text.text = String(d.port || 8080);
    },

    // Asks the script what the gateway auto-detection sees right now.
    _detect: function () {
        this._run(['detect'], (out) => {
            let d = this._parse(out);
            if (d && d.gateway !== undefined) this._detected = d;
            this._safeRender();
        });
    },

    _addTextRow: function (container, text, styleClass) {
        let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        let label = new St.Label({ text: text, style_class: styleClass });
        item.addActor(label, { expand: true });
        container.addMenuItem(item);
        return label;
    },

    // A row of one or more buttons. The row itself is not clickable, so the menu stays open.
    _addButtons: function (container, specs) {
        let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        let box = new St.BoxLayout({ style_class: 'proxy-btn-row', x_expand: true });
        specs.forEach((spec) => {
            let btn = new St.Button({
                label: spec.text,
                style_class: 'proxy-btn ' + (spec.style || ''),
                reactive: true,
                can_focus: true,
                x_expand: true
            });
            btn.connect('clicked', () => spec.onClick());
            box.add_child(btn);
        });
        item.addActor(box, { expand: true });
        container.addMenuItem(item);
    },

    _addEntryRow: function (container, labelText) {
        let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        let label = new St.Label({ text: labelText, style_class: 'proxy-field-label' });
        let entry = new St.Entry({ style_class: 'proxy-entry' });
        item.addActor(label, { expand: true });
        item.addActor(entry);
        container.addMenuItem(item);
        return entry;
    },

    // Sets a label's markup. St.Label has no clutter_text property here, so ask for the text
    // actor with get_clutter_text(); if that is missing too, show the plain text.
    _setMarkup: function (label, markup, plain) {
        let actor = null;
        try {
            actor = label.get_clutter_text ? label.get_clutter_text() : label.clutter_text;
        } catch (e) {
            actor = null;
        }
        if (actor && actor.set_markup) actor.set_markup(markup);
        else label.text = plain;
    },

    _dot: function (state, text) {
        return '<span foreground="' + COLORS[state] + '">\u25CF</span>  ' +
            GLib.markup_escape_text(text, -1);
    },

    _populateEntries: function () {
        let url = (this._status && this._status.httpProxy) || '';
        let m = url.match(/^https?:\/\/([^:\/]+)(?::(\d+))?/);
        this._hostEntry.clutter_text.text = m ? m[1] : '';
        this._portEntry.clutter_text.text = (m && m[2]) ? m[2] : '8080';
    },

    _render: function () {
        let st = this._status;
        let enabled = this._pending ? this._target : !!(st && st.enabled);
        let drawKey = enabled + '/' + !!st + '/' + this._pending;
        if (drawKey !== this._lastDrawKey) {
            this._lastDrawKey = drawKey;
            this._log('render: enabled=' + enabled + ' status=' + (st ? 'yes' : 'none') +
                ' pending=' + this._pending);
        }

        this._drawErrors = [];
        this._section('switch', () => this._quietly(() => this._switch.setToggleState(enabled)));

        this._section('meta', () => {
            let meta, metaState;
            if (this._note) { meta = this._note.text; metaState = this._note.state; }
            else if (this._actionError) { meta = this._actionError; metaState = 'error'; }
            else if (this._pending) { meta = 'Applying\u2026'; metaState = 'warn'; }
            else if (this._statusError) { meta = this._statusError; metaState = 'error'; }
            else if (enabled) { meta = 'Connected through the proxy'; metaState = 'on'; }
            else { meta = 'Proxy is off'; metaState = 'off'; }
            this._setMarkup(this._meta, this._dot(metaState, meta), meta);
        });

        this._section('pill', () => {
            if (!this._pill) return;
            this._pill.text = enabled ? 'PROXY ON' : 'PROXY OFF';
            this._setClass(this._pill, 'proxy-pill ' + (enabled ? 'proxy-pill-on' : 'proxy-pill-off'));
        });
        this._section('detected', () => {
            if (!this._detectLabel) return;
            let d = this._detected;
            if (!d) this._detectLabel.text = 'Detecting gateway...';
            else if (!d.gateway) this._detectLabel.text = 'No default gateway found';
            else this._detectLabel.text = 'Detected  ' + d.gateway + ':' + d.port + '  via ' + (d.iface || '?');
        });

        this._section('flow', () => {
            let gateway = (st && st.httpProxy) ? st.httpProxy.replace(/^https?:\/\//, '') : '';
            if (!st) this._flow.text = '';
            else if (enabled && gateway) this._flow.text = 'This PC  \u2192  ' + gateway + '  \u2192  Internet';
            else this._flow.text = 'This PC  \u2192  Internet  (direct)';
        });

        this._section('tooltip', () => this.set_applet_tooltip(enabled ? 'Proxy on' : 'Proxy off'));
        this._section('opacity', () => this.actor.set_opacity(enabled ? 255 : 150));

        this._section('auto-detect switch', () => {
            if (st) this._quietly(() => this._autoSwitch.setToggleState(st.gatewayAuto !== false));
        });

        GROUPS.forEach((group) => this._section('group ' + group.title, () => {
            let activeInGroup = 0;
            group.items.forEach((integ) => this._section('item ' + integ.key, () => {
                let sw = this._switches[integ.key];
                let configured = !!(st && st.integrations && st.integrations.indexOf(integ.key) !== -1);
                let active = !!(st && st.active && st.active[integ.key] === true);
                if (active) activeInGroup++;
                let state = active ? 'on' : (configured ? 'warn' : 'off');
                this._quietly(() => sw.setToggleState(configured));
                this._setMarkup(sw.label, this._dot(state, integ.label), integ.label);
            }));
            let entry = this._groupSubs.filter((x) => x.group === group)[0];
            if (entry) entry.sub.label.text = group.title + '  (' + activeInGroup + '/' + group.items.length + ' active)';
        }));

        this._section('footer', () => {
            if (this._drawErrors.length)
                this._footer.text = 'draw error: ' + this._drawErrors.join('; ');
            else if (st && this._lastUpdate)
                this._footer.text = 'updated ' + this._lastUpdate + '  \u00b7  ' +
                    (st.enabled ? 'proxy on' : 'proxy off');
        });
    },

    // Draws one part of the menu. A failure is logged with its name and message and
    // remembered for the footer; it never stops the other parts from being drawn.
    _section: function (name, fn) {
        try {
            fn();
        } catch (e) {
            let msg = String((e && e.message) || e).slice(0, 120);
            try {
                if (this._drawErrors) this._drawErrors.push(name + ': ' + msg);
                this._log('render section "' + name + '" failed: ' + msg + ' | ' +
                    String((e && e.stack) || '').split('\n').join(' | '));
            } catch (ignored) {
                // Logging must never break drawing.
            }
        }
    },

    _safeRender: function () {
        try {
            this._render();
        } catch (e) {
            this._log('render failed: ' + String((e && e.message) || e) + ' | ' +
                String((e && e.stack) || '').split('\n').join(' | '));
            this._meta.text = 'UI error: ' + String(e.message || e);
        }
    },

    // ------------------------------------------------------- actions

    // Runs fn while ignoring the "toggled" signals it causes. Stops the menu from
    // reacting to its own updates, which would turn the proxy on or off by itself.
    _quietly: function (fn) {
        this._silent = true;
        try {
            fn();
        } finally {
            this._silent = false;
        }
    },

    _saveGateway: function () {
        let host = this._hostEntry.clutter_text.text.trim();
        let port = this._portEntry.clutter_text.text.trim();
        this._configure([['set-gateway', host, port]], (ok) => {
            if (ok) this.menu.close();
        });
    },

    _bulk: function (keys, state) {
        this._configure(keys.map((k) => ['set-integration', k, state]),
            (ok) => this._noteSavedWhileOff(ok, state));
    },

    // With the proxy off, switching integrations on only saves the choice. Say so.
    _noteSavedWhileOff: function (ok, state) {
        if (this._silent || !ok || state !== 'on') return;
        if (this._status && !this._status.enabled)
            this._showNote('Saved. They apply when the proxy is turned on', 'warn');
    },

    _finishPending: function () {
        this._pending = false;
        this._actionError = '';
        this._clearGuard();
    },

    _armGuard: function () {
        this._clearGuard();
        this._guardId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, APPLY_TIMEOUT_SECONDS, () => {
            this._guardId = 0;
            this._pending = false;
            this._actionError = this._target ? 'Failed to enable proxy' : 'Failed to disable proxy';
            this._safeRender();
            return GLib.SOURCE_REMOVE;
        });
    },

    _clearGuard: function () {
        if (this._guardId) {
            GLib.source_remove(this._guardId);
            this._guardId = 0;
        }
    },

    _showNote: function (text, state) {
        if (this._noteId) GLib.source_remove(this._noteId);
        this._note = { text: text, state: state };
        this._noteId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, NOTE_SECONDS, () => {
            this._noteId = 0;
            this._note = null;
            this._safeRender();
            return GLib.SOURCE_REMOVE;
        });
        this._safeRender();
    },

    _runTest: function () {
        this._showNote('Testing connection\u2026', 'warn');
        this._run(['test'], (out, err, code) => {
            let st = this._parse(out);
            if (st && st.test === 'ok') {
                this._showNote('Proxy reachable \u00b7 ' + st.ms + ' ms', 'on');
            } else {
                this._showNote(this._reason(st, out, err, code, 'Proxy not reachable'), 'error');
            }
        });
    },

    _setTarget: function (next) {
        if (this._silent) return;
        if (this._pending) {
            this._safeRender();
            return;
        }
        this._actionError = '';
        this._pending = true;
        this._target = next;
        this._armGuard();
        this._safeRender();

        this._run([next ? 'enable' : 'disable'], (out, err, code) => {
            let st = this._parse(out);
            if (code !== 0 || !st || st.error) {
                this._pending = false;
                this._clearGuard();
                this._actionError = this._reason(st, out, err, code,
                    next ? 'Failed to enable proxy' : 'Failed to disable proxy');
                this._refresh();    // show what the machine really looks like
            } else {
                this._applyStatus(st);
                if (!!st.enabled === next) this._finishPending();
            }
            this._safeRender();
        });
    },

    // Runs settings commands in order, then refreshes. onDone(true) when all succeeded.
    _configure: function (commands, onDone) {
        if (this._silent) {
            if (onDone) onDone(true);
            return;
        }
        if (this._configuring) {
            // One queue at a time: stacked clicks used to run the same commands many times over.
            this._showNote('Still applying the last change\u2026', 'warn');
            this._safeRender();
            return;
        }
        this._configuring = true;
        let queue = commands.slice();
        let total = commands.length;
        this._actionError = '';
        let step = () => {
            if (!queue.length) {
                this._configuring = false;
                if (this._note && this._note.progress) this._note = null;
                this._populateNext = true;
                this._safeRender();
                this._refresh();
                if (onDone) onDone(!this._actionError);
                return;
            }
            this._run(queue.shift(), (out, err, code) => {
                let st = this._parse(out);
                if (code !== 0 || !st || st.error) {
                    // Keep going so one failing item does not skip the rest; show the first error.
                    if (!this._actionError)
                        this._actionError = this._reason(st, out, err, code, 'Settings could not be saved');
                } else {
                    this._applyStatus(st);
                }
                if (total > 1 && queue.length) {
                    this._showNote('Applying ' + (total - queue.length) + '/' + total + '\u2026', 'warn');
                    this._note.progress = true;
                } else {
                    this._safeRender();
                }
                step();
            });
        };
        step();
    },

    _applyStatus: function (st) {
        if (!this._status || this._status.enabled !== st.enabled)
            this._log('status applied: enabled=' + st.enabled + ' integrations=' +
                ((st.integrations || []).length));
        this._status = st;
        this._statusError = '';
        this._lastUpdate = GLib.DateTime.new_now_local().format('%H:%M:%S');
    },

    _refresh: function () {
        if (this._refreshing) return;
        this._refreshing = true;

        this._detect();
        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, STATUS_TIMEOUT_SECONDS, () => {
            this._log('status timed out');
            this._refreshing = false;
            this._statusError = 'No answer from proxy-manager.sh';
            this._safeRender();
            return GLib.SOURCE_REMOVE;
        });

        this._run(['status'], (out, err, code) => {
            GLib.source_remove(timeoutId);
            this._refreshing = false;
            let st = this._parse(out);
            if (!st || st.error) {
                this._statusError = this._reason(st, out, err, code, 'Cannot read proxy status');
                this._safeRender();
                return;
            }
            this._applyStatus(st);
            if (this._pending && !!st.enabled === this._target) this._finishPending();
            if (this._populateNext) {
                this._populateNext = false;
                this._populateEntries();
            }
            this._safeRender();
        });
    },

    _reason: function (st, out, err, code, fallback) {
        if (st && st.error) return st.error;
        let lastErr = (err || '').trim().split('\n').pop();
        if (lastErr) return lastErr;
        if (out && out.trim()) return 'Unexpected output: ' + out.trim().slice(0, 60);
        return fallback + (code !== undefined ? ' (exit ' + code + ')' : '');
    },

    // ---------------------------------------------------------- helpers

    _log: function (msg) {
        global.log('[proxy-manager] ' + msg);
    },

    _parse: function (out) {
        try {
            return JSON.parse((out || '').trim());
        } catch (e) {
            return null;
        }
    },

    // Runs proxy-manager.sh with the given arguments. Callback: (stdout, stderr, exitCode).
    // Gio.Subprocess is used because Util.spawnCommandLineAsync does not pass the command's
    // output to its callback (the log showed "ok: status (0 bytes)" for every call), so the
    // menu never saw any status and showed the proxy as off.
    _run: function (args, callback) {
        this._log('run: ' + args.join(' '));
        let proc;
        try {
            proc = Gio.Subprocess.new(['/bin/bash', this._script].concat(args),
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            this._log('could not start ' + args[0] + ': ' + e);
            callback('', String(e), 1);
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            let stdout = '', stderr = '', code = 1;
            try {
                let [, out, err] = p.communicate_utf8_finish(res);
                stdout = out || '';
                stderr = err || '';
                code = p.get_if_exited() ? p.get_exit_status() : 1;
            } catch (e) {
                stderr = String(e);
            }
            this._log((code === 0 ? 'ok: ' : 'failed: ') + args[0] + ' (exit ' + code + ', ' +
                stdout.length + ' bytes)' + (code !== 0 ? ' ' + stderr.trim().slice(0, 160) : ''));
            callback(stdout, stderr, code);
        });
    }
};

function main(metadata, orientation, panelHeight, instanceId) {
    return new ProxyManagerApplet(metadata, orientation, panelHeight, instanceId);
}
