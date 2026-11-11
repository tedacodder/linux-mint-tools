'use strict';
// Flow tests: drive the applet through the same signals a user triggers
// (button clicks, key presses, timer ticks) and check the state and the file.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCinnamon } = require('./mock-cinnamon');
const crypto = require('crypto');
const H = require('./harness');
const {
    check, summary, freshHome, startApplet, fireTimers, findAll, findButton,
    findEntry, press, type, pressKey, pressAt, settingsFile, newStorePath, oldStorePath, readStore, K, DAY_MS,
} = H;

const ADD_HINT = 'Add a task';
const DESC_HINT = 'Short description';

function addTask(app, title, opts = {}) {
    if (opts.tab) app.applet.setTab(opts.tab);
    if (opts.priority) app.applet.ui.draftPriority = opts.priority;
    type(findEntry(app.menu, ADD_HINT), title);
    if (opts.description) type(findEntry(app.menu, DESC_HINT), opts.description);
    press(findButton(app.menu, 'Add'));
}

// Arrays made inside the applet's sandbox come from another realm, so copy
// them into this one before comparing.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function hashOf(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Writes the old file in a deliberately different format (one line, no
// trailing newline, fields in another order), so any rewrite changes its bytes.
function writeOld(tasks) {
    const file = oldStorePath();
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ tasks, version: 2, dailyTasks: [], activeTab: 'ongoing', dailyResetDate: '' }));
    return file;
}

check('clicking the panel icon opens and closes the dialog', () => {
    freshHome('click');
    const app = startApplet();
    app.applet.on_applet_clicked();
    assert.strictEqual(app.menu.isOpen, true);
    app.applet.on_applet_clicked();
    assert.strictEqual(app.menu.isOpen, false);
});

check('adding on Ongoing writes the Omarchy field names and the chosen priority', () => {
    freshHome('add');
    const app = startApplet();
    addTask(app, 'Ship it', { priority: 'high' });
    const store = readStore();
    assert.deepStrictEqual(Object.keys(store), ['version', 'activeTab', 'tasks', 'dailyTasks', 'dailyResetDate']);
    assert.strictEqual(store.version, 2);
    assert.deepStrictEqual(Object.keys(store.tasks[0]),
        ['id', 'title', 'description', 'priority', 'status', 'completed', 'createdAt', 'completedAt']);
    assert.strictEqual(store.tasks[0].title, 'Ship it');
    assert.strictEqual(store.tasks[0].priority, 'high');
    assert.strictEqual(store.tasks[0].status, 'ongoing');
    assert.strictEqual(store.tasks[0].completed, false);
});

check('a new task on Completed lands on Ongoing and the view moves there', () => {
    freshHome('completed-add');
    const app = startApplet();
    app.applet.setTab('complete');
    addTask(app, 'Later');
    const store = readStore();
    assert.strictEqual(store.tasks[0].status, 'ongoing');
    assert.strictEqual(app.applet.state.activeTab, 'ongoing');
    assert.strictEqual(store.activeTab, 'ongoing');
});

check('a new task on Backlog stays on Backlog', () => {
    freshHome('backlog-add');
    const app = startApplet();
    addTask(app, 'Someday', { tab: 'backlog' });
    assert.strictEqual(readStore().tasks[0].status, 'backlog');
    assert.strictEqual(app.applet.state.activeTab, 'backlog');
});

check('a Daily task goes to the daily list and not the normal list', () => {
    freshHome('daily-add');
    const app = startApplet();
    addTask(app, 'Stretch', { tab: 'daily', description: 'Ten minutes' });
    const store = readStore();
    assert.strictEqual(store.tasks.length, 0);
    assert.strictEqual(store.dailyTasks.length, 1);
    assert.strictEqual(store.dailyTasks[0].title, 'Stretch');
    assert.strictEqual(store.dailyTasks[0].description, 'Ten minutes');
    assert.strictEqual(app.applet.state.activeTab, 'daily');
});

check('Left and Right cycle tabs; n and slash move focus; Escape closes the dialog', () => {
    freshHome('keys');
    const app = startApplet();
    app.applet.on_applet_clicked();
    assert.strictEqual(app.menu.isOpen, true, 'a click opens the dialog');
    app.menu.grab_key_focus();
    pressKey(app, K.KEY_Right);
    assert.strictEqual(app.applet.state.activeTab, 'complete');
    pressKey(app, K.KEY_Left);
    pressKey(app, K.KEY_Left);
    assert.strictEqual(app.applet.state.activeTab, 'backlog');

    pressKey(app, K.KEY_n);
    assert.strictEqual(app.world.focused, findEntry(app.menu, ADD_HINT));
    pressKey(app, K.KEY_Right);
    assert.strictEqual(app.applet.state.activeTab, 'backlog', 'Right must not change the tab while typing');

    pressKey(app, K.KEY_Escape);
    assert.strictEqual(app.world.focused.label, 'Close', 'Escape in a field moves focus to the Close button');
    assert.strictEqual(app.menu.isOpen, true, 'the first Escape does not close the dialog');

    pressKey(app, K.KEY_slash);
    assert.strictEqual(app.world.focused, findEntry(app.menu, 'Search tasks'));

    app.menu.grab_key_focus();
    pressKey(app, K.KEY_Escape);
    assert.strictEqual(app.menu.isOpen, false, 'Escape outside a field closes the dialog');
});

check('the last tab used is remembered after a restart', () => {
    freshHome('remember');
    const first = startApplet();
    press(findButton(first.menu, 'Completed'));
    const second = startApplet();
    assert.strictEqual(second.applet.state.activeTab, 'complete');
    assert.strictEqual(readStore().activeTab, 'complete');
});

check('a refresh changes nothing the user set: tab, search, open row, typed draft and focus', () => {
    freshHome('refresh');
    const app = startApplet();
    addTask(app, 'Alpha', { tab: 'backlog' });
    type(findEntry(app.menu, 'Search tasks'), 'lph');
    const row = findAll(app.menu, a => a.classes.has('todo-row-title'))[0];
    press(row);
    const id = Object.keys(app.applet.ui.expanded)[0];
    const draft = findEntry(app.menu, ADD_HINT);
    app.world.focused = draft;
    type(draft, 'half-typed thought');

    // One ordinary tick, then one that crosses midnight and runs the daily reset.
    fireTimers(app.world, 60 * 1000);
    fireTimers(app.world, DAY_MS);

    assert.strictEqual(app.applet.state.activeTab, 'backlog');
    assert.strictEqual(app.applet.ui.query, 'lph');
    assert.strictEqual(app.applet.ui.expanded[id], true);
    assert.strictEqual(findEntry(app.menu, ADD_HINT).get_text(), 'half-typed thought');
    assert.strictEqual(app.world.focused, draft, 'focus stays in the field being typed in');
});

check('a refresh while a row is being edited keeps the editor and its text', () => {
    freshHome('refresh-edit');
    const app = startApplet();
    addTask(app, 'Beta');
    const editButton = findAll(app.menu, a => a.kind === 'Button' && a.label === '\u270e')[0];
    press(editButton);
    const editor = findEntry(app.menu, 'Title');
    type(editor, 'Beta edited');

    fireTimers(app.world, DAY_MS);

    assert.strictEqual(findEntry(app.menu, 'Title'), editor, 'the editor must not be rebuilt');
    assert.strictEqual(editor.get_text(), 'Beta edited');
    assert.strictEqual(Object.keys(app.applet.ui.editing).length, 1);
});

check('daily tasks reset on the next local day, keep their text, and stay visible until deleted', () => {
    freshHome('daily');
    const app = startApplet();
    addTask(app, 'Stretch', { tab: 'daily', description: 'Ten minutes' });
    const check1 = findAll(app.menu, a => a.classes.has('todo-check'))[0];
    press(check1);
    assert.strictEqual(readStore().dailyTasks[0].completed, true);

    fireTimers(app.world, 60 * 1000);
    assert.strictEqual(app.applet.state.dailyTasks.length, 1, 'completed daily task stays on the list');
    assert.strictEqual(app.applet.state.dailyTasks[0].completed, true, 'same day: still completed');

    fireTimers(app.world, DAY_MS);
    const store = readStore();
    assert.strictEqual(store.dailyTasks.length, 1);
    assert.strictEqual(store.dailyTasks[0].completed, false);
    assert.strictEqual(store.dailyTasks[0].title, 'Stretch');
    assert.strictEqual(store.dailyTasks[0].description, 'Ten minutes');
    assert.strictEqual(store.dailyResetDate, '2026-11-11');
    assert.strictEqual(app.applet.state.activeTab, 'daily', 'the reset does not change the tab');
});

check('Critical sorts first and the badge shows the highest ongoing priority', () => {
    freshHome('badge');
    const app = startApplet();
    addTask(app, 'Low one', { priority: 'low' });
    addTask(app, 'Parked crit', { tab: 'backlog', priority: 'critical' });
    addTask(app, 'High one', { tab: 'ongoing', priority: 'high' });
    app.applet.setTab('ongoing');

    // Copy out of the applet's sandbox first: its arrays are from another realm.
    const titles = plain(app.api.listed(app.applet.state.tasks, '', 'ongoing').map(t => t.title));
    assert.deepStrictEqual(titles, ['High one', 'Low one']);
    const badge = findAll(app.applet.actor, a => a.classes.has('todo-badge'))[0];
    assert.strictEqual(badge.text, '2');
    assert.strictEqual(badge.visible, true);
    assert.ok(badge.style.includes(app.api.PRIORITY_COLORS.high), 'badge colour is the highest ongoing (high)');
});

check('backlog items do not count toward the badge', () => {
    freshHome('badge-backlog');
    const app = startApplet();
    addTask(app, 'Parked crit', { tab: 'backlog', priority: 'critical' });
    const badge = findAll(app.applet.actor, a => a.classes.has('todo-badge'))[0];
    assert.strictEqual(badge.visible, false);
});

check('Clear removes finished normal tasks and leaves daily tasks alone', () => {
    freshHome('clear');
    const app = startApplet();
    addTask(app, 'Finished normal');
    app.applet.toggleCompleted(String(app.applet.state.tasks[0].id), true);
    addTask(app, 'Daily one', { tab: 'daily' });
    app.applet.toggleCompleted(String(app.applet.state.dailyTasks[0].id), true);

    app.applet.setTab('complete');
    press(findButton(app.menu, 'Clear'));

    assert.strictEqual(app.applet.state.tasks.filter(t => t.status === 'complete').length, 0);
    assert.strictEqual(app.applet.state.dailyTasks.length, 1);
    assert.strictEqual(readStore().dailyTasks.length, 1);
});

check('one-way import: the Omarchy file is read once and never changed', () => {
    freshHome('import');
    const oldFile = writeOld([{ id: 'old-1', title: 'Old task', description: '', priority: 'high', status: 'ongoing', completed: false, createdAt: 5, completedAt: 0 }]);
    const before = hashOf(oldFile);

    const app = startApplet();
    assert.strictEqual(app.applet.state.tasks[0].title, 'Old task');
    assert.strictEqual(readStore().tasks[0].title, 'Old task');
    assert.strictEqual(hashOf(oldFile), before, 'the old file must not change on import');

    addTask(app, 'New task');
    assert.strictEqual(hashOf(oldFile), before, 'the old file must not change on later saves');
    assert.strictEqual(readStore().tasks.length, 2);
});

check('the import runs only while the new file is missing', () => {
    freshHome('import-once');
    writeOld([{ id: 'old-1', title: 'First import', status: 'ongoing', priority: 'low', createdAt: 1 }]);
    startApplet();
    assert.strictEqual(readStore().tasks[0].title, 'First import');

    writeOld([{ id: 'old-2', title: 'Changed later', status: 'ongoing', priority: 'low', createdAt: 2 }]);
    startApplet();
    const titles = readStore().tasks.map(t => t.title);
    assert.deepStrictEqual(titles, ['First import'], 'a second start must not import again');
});

check('an unreadable store is never overwritten', () => {
    freshHome('invalid');
    fs.mkdirSync(require('path').dirname(newStorePath()), { recursive: true });
    fs.writeFileSync(newStorePath(), '{not json');
    const app = startApplet();
    addTask(app, 'Would be lost');
    assert.strictEqual(fs.readFileSync(newStorePath(), 'utf8'), '{not json');
    assert.ok(app.world.logs.some(l => l.includes('not valid JSON')), 'the refusal is logged');
});

check('saves go through a temp file and leave none behind', () => {
    freshHome('atomic');
    const app = startApplet();
    addTask(app, 'Saved');
    assert.strictEqual(fs.existsSync(newStorePath() + '.tmp'), false);
    assert.strictEqual(readStore().tasks[0].title, 'Saved');
});

check('every action is logged with the [todo-list] prefix', () => {
    freshHome('logs');
    const app = startApplet();
    addTask(app, 'Logged');
    assert.ok(app.world.logs.length > 0);
    app.world.logs.forEach(l => assert.ok(l.startsWith('[todo-list] '), 'bad log line: ' + l));
});

check('removing the applet clears its timer and destroys the dialog', () => {
    freshHome('remove');
    const app = startApplet();
    assert.strictEqual(app.world.timers.length, 1);
    app.applet.on_applet_removed_from_panel();
    assert.strictEqual(app.world.timers.length, 0);
    assert.strictEqual(app.menu.destroyed, true);
});

// ---- keyboard only: no mouse anywhere in these checks ----

function openWithRows(name, titles) {
    freshHome(name);
    const app = startApplet();
    app.applet.on_applet_clicked();
    titles.forEach(t => addTask(app, t));
    return app;
}

check('keyboard only: Tab and Shift+Tab move focus through every control and wrap', () => {
    const app = openWithRows('kb-tab', ['One', 'Two']);
    const order = app.applet._focusOrder();
    app.world.focused = order[0];
    for (let i = 1; i < order.length; i++) {
        pressKey(app, K.KEY_Tab);
        assert.strictEqual(app.world.focused, order[i], 'Tab step ' + i);
    }
    pressKey(app, K.KEY_Tab);
    assert.strictEqual(app.world.focused, order[0], 'Tab wraps to the first control');
    pressKey(app, K.KEY_Tab, K.SHIFT_MASK);
    assert.strictEqual(app.world.focused, order[order.length - 1], 'Shift+Tab goes backwards');
});

check('keyboard only: Down from search reaches the first row, and Up returns to search', () => {
    const app = openWithRows('kb-rows', ['One', 'Two']);
    app.world.focused = app.applet._search;
    pressKey(app, K.KEY_Down);
    assert.ok(app.world.focused.classes.has('todo-row-title'), 'focus on a row title');
    assert.strictEqual(app.world.focused.label, app.applet._rowTitles[0].button.label);
    pressKey(app, K.KEY_Down);
    assert.strictEqual(app.world.focused, app.applet._rowTitles[1].button, 'Down moves to the next row');
    pressKey(app, K.KEY_Up);
    assert.strictEqual(app.world.focused, app.applet._rowTitles[0].button, 'Up moves back');
    pressKey(app, K.KEY_Up);
    assert.strictEqual(app.world.focused, app.applet._search, 'Up from the first row returns to search');
});

check('keyboard only: c completes the focused row and focus stays in the list', () => {
    // New tasks go to the top, so the list reads Second, then First.
    const app = openWithRows('kb-complete', ['First', 'Second']);
    app.world.focused = app.applet._rowTitles[0].button;
    assert.strictEqual(app.world.focused.label, 'Second');
    pressKey(app, K.KEY_c);
    const store = readStore();
    assert.strictEqual(store.tasks.filter(t => t.status === 'complete').length, 1);
    assert.strictEqual(store.tasks.find(t => t.status === 'complete').title, 'Second');
    assert.ok(app.world.focused.classes.has('todo-row-title'), 'focus stays on a row');
    assert.strictEqual(app.world.focused.label, 'First', 'focus moves to the row that took its place');
});

check('keyboard only: x removes the focused row and focus moves to the next row', () => {
    // The list reads: Also keep, Drop, Keep. Removing position 1 leaves: Also keep, Keep.
    const app = openWithRows('kb-remove', ['Keep', 'Drop', 'Also keep']);
    app.world.focused = app.applet._rowTitles[1].button;
    assert.strictEqual(app.world.focused.label, 'Drop');
    pressKey(app, K.KEY_x);
    assert.deepStrictEqual(readStore().tasks.map(t => t.title).sort(), ['Also keep', 'Keep']);
    assert.strictEqual(app.world.focused.label, 'Keep', 'focus lands on the row now in that position');
});

check('keyboard only: p parks the focused task to Backlog', () => {
    const app = openWithRows('kb-park', ['Park me']);
    app.world.focused = app.applet._rowTitles[0].button;
    pressKey(app, K.KEY_p);
    assert.strictEqual(readStore().tasks[0].status, 'backlog');
});

check('keyboard only: e opens the editor and Enter saves it', () => {
    const app = openWithRows('kb-edit', ['Old name']);
    app.world.focused = app.applet._rowTitles[0].button;
    pressKey(app, K.KEY_e);
    const editor = findEntry(app.menu, 'Title');
    assert.strictEqual(app.world.focused, editor, 'the editor gets focus');
    editor.set_text('New name');
    pressKey(app, K.KEY_Return);
    assert.strictEqual(readStore().tasks[0].title, 'New name');
});

check('keyboard only: Left and Right change the tab and move focus onto it', () => {
    const app = openWithRows('kb-tabs', ['One']);
    app.world.focused = app.applet._rowTitles[0].button;
    pressKey(app, K.KEY_Right);
    assert.strictEqual(app.applet.state.activeTab, 'complete');
    assert.strictEqual(app.world.focused.label, app.applet._tabButtons[3].btn.label);
    assert.ok(app.world.focused.label.startsWith('Completed'), 'focus is on the Completed tab');
});

check('keyboard only: n, type, Enter adds a task and keeps focus in the add field', () => {
    freshHome('kb-add');
    const app = startApplet();
    app.applet.on_applet_clicked();
    pressKey(app, K.KEY_n);
    const title = findEntry(app.menu, ADD_HINT);
    assert.strictEqual(app.world.focused, title);
    title.set_text('Keyboard task');
    pressKey(app, K.KEY_Return);
    assert.strictEqual(readStore().tasks[0].title, 'Keyboard task');
    assert.strictEqual(app.world.focused, title, 'focus stays in the add field');
});

check('keyboard only: Enter on the focused Add button adds a task', () => {
    freshHome('kb-button');
    const app = startApplet();
    app.applet.on_applet_clicked();
    findEntry(app.menu, ADD_HINT).set_text('Via button');
    app.world.focused = findButton(app.menu, 'Add');
    pressKey(app, K.KEY_Return);
    assert.strictEqual(readStore().tasks[0].title, 'Via button');
});

check('keyboard only: row keys do not fire while typing in the search field', () => {
    const app = openWithRows('kb-typing', ['Stay open']);
    app.world.focused = app.applet._search;
    pressKey(app, K.KEY_c);
    pressKey(app, K.KEY_x);
    assert.strictEqual(readStore().tasks.length, 1);
    assert.strictEqual(readStore().tasks[0].status, 'ongoing');
});

check('keyboard only: Escape from a row closes the dialog', () => {
    const app = openWithRows('kb-escape', ['One']);
    app.world.focused = app.applet._rowTitles[0].button;
    pressKey(app, K.KEY_Escape);
    assert.strictEqual(app.menu.isOpen, false);
});

// ---- keyboard shortcut trigger ----

const TOGGLE_EVENT = { CHANGED: 0, CHANGES_DONE_HINT: 1, DELETED: 2, CREATED: 3, ATTRIBUTE_CHANGED: 4 };

function triggerMonitor(app) {
    const m = app.world.monitors.find(x => x.path.endsWith('/todo-list/toggle'));
    assert.ok(m, 'the applet watches the toggle file');
    return m;
}

check('the keyboard shortcut trigger opens the window, and a second press closes it', () => {
    freshHome('shortcut');
    const app = startApplet();
    const monitor = triggerMonitor(app);
    assert.strictEqual(app.menu.isOpen, false);
    monitor.emit('changed', null, null, TOGGLE_EVENT.CHANGES_DONE_HINT);
    assert.strictEqual(app.menu.isOpen, true, 'first press opens');
    fireTimers(app.world, 1000);
    monitor.emit('changed', null, null, TOGGLE_EVENT.CHANGES_DONE_HINT);
    assert.strictEqual(app.menu.isOpen, false, 'second press closes');
});

check('one press that sends two events toggles only once', () => {
    freshHome('shortcut-double');
    const app = startApplet();
    const monitor = triggerMonitor(app);
    monitor.emit('changed', null, null, TOGGLE_EVENT.CHANGES_DONE_HINT);
    monitor.emit('changed', null, null, TOGGLE_EVENT.CREATED);
    assert.strictEqual(app.menu.isOpen, true, 'the second event is ignored');
});

check('a touch (attribute change) opens the window, as the shortcut command does', () => {
    freshHome('shortcut-touch');
    const app = startApplet();
    triggerMonitor(app).emit('changed', null, null, TOGGLE_EVENT.ATTRIBUTE_CHANGED);
    assert.strictEqual(app.menu.isOpen, true);
});

check('a deleted file does nothing, and every event is logged', () => {
    freshHome('shortcut-other');
    const app = startApplet();
    triggerMonitor(app).emit('changed', null, null, TOGGLE_EVENT.DELETED);
    assert.strictEqual(app.menu.isOpen, false);
    assert.ok(app.world.logs.some(l => l.includes('shortcut trigger event 2')));
});

check('removing the applet stops watching the toggle file', () => {
    freshHome('shortcut-remove');
    const app = startApplet();
    const monitor = triggerMonitor(app);
    app.applet.on_applet_removed_from_panel();
    assert.strictEqual(monitor.cancelled, true);
});

check('a broken shortcut watcher does not stop the applet from loading', () => {
    freshHome('shortcut-broken');
    const app = startApplet('2026-11-10T10:00:00', { failMonitor: true });
    assert.strictEqual(app.applet.state.activeTab, 'ongoing', 'the applet loaded');
    app.applet.on_applet_clicked();
    assert.strictEqual(app.menu.isOpen, true, 'the window still opens from the panel');
    assert.ok(app.world.logs.some(l => l.includes('keyboard shortcut is off')), 'the failure is logged');
});

check('the tasks file is replaced by a move, and no temp file is left behind', () => {
    freshHome('move-save');
    const app = startApplet();
    addTask(app, 'First');
    addTask(app, 'Second');
    assert.strictEqual(readStore().tasks.length, 2);
    assert.strictEqual(fs.existsSync(newStorePath() + '.tmp'), false);
});


// ---- themes, critical icon, outside clicks, hover ----

function dialogClasses(app) {
    return app.menu.dialogLayout.classes;
}

check('the window starts in the Neon theme', () => {
    freshHome('theme-default');
    const app = startApplet();
    assert.ok(dialogClasses(app).has('todo-theme-neon'));
    assert.ok(!dialogClasses(app).has('todo-theme-omarchy'));
});

check('the t key switches to Omarchy and the choice is saved', () => {
    freshHome('theme-key');
    const app = startApplet();
    app.applet.on_applet_clicked();
    app.menu.grab_key_focus();
    pressKey(app, K.KEY_t);
    assert.ok(dialogClasses(app).has('todo-theme-omarchy'));
    assert.ok(!dialogClasses(app).has('todo-theme-neon'));
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).theme, 'omarchy');
});

check('the Theme button cycles through all six themes', () => {
    freshHome('theme-button');
    const app = startApplet();
    app.applet.on_applet_clicked();
    const themeButton = findAll(app.menu, a => a.kind === 'Button' && a.label.startsWith('Theme:'))[0];
    assert.strictEqual(themeButton.label, 'Theme: Neon');
    press(themeButton);
    assert.strictEqual(themeButton.label, 'Theme: Omarchy');
    press(themeButton);
    assert.strictEqual(themeButton.label, 'Theme: Ember');
    press(themeButton);
    assert.strictEqual(themeButton.label, 'Theme: Paper');
    press(themeButton);
    assert.strictEqual(themeButton.label, 'Theme: Sakura');
    press(themeButton);
    assert.strictEqual(themeButton.label, 'Theme: Lagoon');
    press(themeButton);
    assert.ok(dialogClasses(app).has('todo-theme-neon'), 'the cycle returns to Neon after six themes');
});

check('a saved theme is used the next time the applet loads', () => {
    freshHome('theme-remember');
    const first = startApplet();
    first.applet.cycleTheme();
    const second = startApplet();
    assert.ok(dialogClasses(second).has('todo-theme-omarchy'));
});

check('an unknown saved theme falls back to Neon', () => {
    freshHome('theme-unknown');
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), '{"theme":"purple"}');
    const app = startApplet();
    assert.ok(dialogClasses(app).has('todo-theme-neon'));
});

check('the panel icon turns the critical colour while a critical task is ongoing', () => {
    freshHome('icon-critical');
    const app = startApplet();
    app.applet.ui.draftPriority = 'critical';
    app.applet.addTask && void 0;
    app.applet.on_applet_clicked();
    addTask(app, 'Urgent one', { priority: 'critical' });
    assert.ok(app.applet._applet_icon.style.includes(app.api.PRIORITY_COLORS.critical), 'icon is red');
});

check('the panel icon returns to its normal colour when no critical task is ongoing', () => {
    freshHome('icon-normal');
    const app = startApplet();
    app.applet.on_applet_clicked();
    addTask(app, 'Urgent one', { priority: 'critical' });
    app.applet.moveTask(String(app.applet.state.tasks[0].id), 'backlog');
    assert.strictEqual(app.applet._applet_icon.style, '', 'a backlog critical does not colour the icon');
});

check('a press outside the window closes it', () => {
    freshHome('outside');
    const app = startApplet();
    app.applet.on_applet_clicked();
    assert.strictEqual(app.menu.isOpen, true);
    // A button that is not part of the window, such as something on the desktop.
    const elsewhere = new (makeCinnamon(app.world).St.Button)({ label: 'Desktop' });
    pressAt(app.world, elsewhere);
    assert.strictEqual(app.menu.isOpen, false);
});

check('a press inside the window does not close it', () => {
    freshHome('inside');
    const app = startApplet();
    app.applet.on_applet_clicked();
    addTask(app, 'Click me');
    const title = findAll(app.menu, a => a.classes.has('todo-row-title'))[0];
    pressAt(app.world, title);
    assert.strictEqual(app.menu.isOpen, true);
});

check('a press on the panel icon is left to the icon, so it toggles once', () => {
    freshHome('icon-press');
    const app = startApplet();
    app.applet.on_applet_clicked();
    pressAt(app.world, app.applet.actor);
    assert.strictEqual(app.menu.isOpen, true, 'the outside-click handler does not close it');
});

check('the outside-click listener is removed when the window closes', () => {
    freshHome('outside-cleanup');
    const app = startApplet();
    app.applet.on_applet_clicked();
    app.applet.on_applet_clicked();
    assert.strictEqual((app.world.stageHandlers || []).length, 0);
});

check('rows track the mouse, so their hover state works', () => {
    freshHome('hover');
    const app = openWithRows('hover-rows', ['Hover me']);
    const row = findAll(app.menu, a => a.classes.has('todo-row'))[0];
    assert.strictEqual(row.track_hover, true);
});

check('Ember is a third theme, saved and remembered like the others', () => {
    freshHome('theme-ember');
    const app = startApplet();
    app.applet.cycleTheme();
    app.applet.cycleTheme();
    assert.ok(dialogClasses(app).has('todo-theme-ember'));
    assert.ok(!dialogClasses(app).has('todo-theme-neon'));
    assert.ok(!dialogClasses(app).has('todo-theme-omarchy'));
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).theme, 'ember');
    const again = startApplet();
    assert.ok(dialogClasses(again).has('todo-theme-ember'));
});

check('the badge uses the Ember accent when no task is ongoing', () => {
    freshHome('ember-badge');
    const app = startApplet();
    app.applet.cycleTheme();
    app.applet.cycleTheme();
    assert.ok(app.applet._badge.style.includes('#FFB547'));
});

check('Paper is a light theme, saved and remembered', () => {
    freshHome('theme-paper');
    const app = startApplet();
    for (let i = 0; i < 3; i++) app.applet.cycleTheme();
    assert.ok(dialogClasses(app).has('todo-theme-paper'));
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).theme, 'paper');
    assert.ok(startApplet().applet.ui.theme === 'paper');
});

check('priority chips use text that reads on their colour', () => {
    freshHome('chip-text');
    const app = startApplet();
    // Each priority colour must be readable with the chosen text colour (at least 4:1).
    Object.keys(app.api.PRIORITY_COLORS).forEach(p => {
        const colour = app.api.PRIORITY_COLORS[p];
        const text = app.api.readableTextOn(colour);
        assert.ok(app.api.contrastRatio(colour, text) >= 4, p + ' chip text is too faint');
    });
});

check('a selected chip uses dark text on the light Medium colour', () => {
    freshHome('chip-medium');
    const app = startApplet();
    app.applet.on_applet_clicked();
    const medium = app.applet._chips.find(c => c.p === 'medium').btn;
    app.applet.ui.draftPriority = 'medium';
    app.applet._renderComposer();
    assert.ok(medium.style.includes('#111318'), 'Medium has dark text when selected');
});

// ---- the built-in keyboard shortcut ----

check('the applet registers Ctrl+Alt+D itself when it loads', () => {
    freshHome('hotkey-register');
    const app = startApplet();
    assert.ok(app.world.hotkeys['todo-list-toggle'], 'a hotkey is registered');
    assert.strictEqual(app.world.hotkeys['todo-list-toggle'].combo, '<Primary><Alt>d');
});

check('the registered hotkey opens the window, and a second press closes it', () => {
    freshHome('hotkey-toggle');
    const app = startApplet();
    const hotkey = app.world.hotkeys['todo-list-toggle'];
    hotkey.callback();
    assert.strictEqual(app.menu.isOpen, true, 'first press opens');
    fireTimers(app.world, 1000);
    hotkey.callback();
    assert.strictEqual(app.menu.isOpen, false, 'second press closes');
});

check('removing the applet unregisters the hotkey', () => {
    freshHome('hotkey-remove');
    const app = startApplet();
    app.applet.on_applet_removed_from_panel();
    assert.strictEqual(app.world.hotkeys['todo-list-toggle'], undefined);
});

check('a failed hotkey registration does not stop the applet, and is logged', () => {
    freshHome('hotkey-broken');
    const app = startApplet('2026-11-10T10:00:00', { failHotkey: true });
    assert.strictEqual(app.applet.state.activeTab, 'ongoing', 'the applet loaded');
    assert.ok(app.world.logs.some(l => l.includes('built-in shortcut')), 'the failure is logged');
});

check('the bottom bar shows the shortcut as text', () => {
    freshHome('footer-hotkey');
    const app = startApplet();
    assert.strictEqual(app.applet._footerHotkey.text, 'Ctrl+Alt+D open / close');
    assert.ok(app.applet._footerKeys.text.includes('Esc close'), 'the key list is still shown');
});

check('Sakura is saved and remembered, and its badge uses the pink accent', () => {
    freshHome('theme-sakura');
    const app = startApplet();
    for (let i = 0; i < 4; i++) app.applet.cycleTheme();
    assert.ok(dialogClasses(app).has('todo-theme-sakura'));
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).theme, 'sakura');
    assert.ok(startApplet().applet.ui.theme === 'sakura');
    assert.ok(app.applet._badge.style.includes('#FF8FB1'));
});

check('Lagoon is saved and remembered, and its badge uses the teal accent', () => {
    freshHome('theme-lagoon');
    const app = startApplet();
    for (let i = 0; i < 5; i++) app.applet.cycleTheme();
    assert.ok(dialogClasses(app).has('todo-theme-lagoon'));
    assert.strictEqual(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).theme, 'lagoon');
    assert.ok(startApplet().applet.ui.theme === 'lagoon');
    assert.ok(app.applet._badge.style.includes('#4FD1C5'));
});

summary();
