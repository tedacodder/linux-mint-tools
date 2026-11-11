'use strict';
// Unit tests for the pure task logic in applet.js.
const assert = require('assert');
const H = require('./harness');
const { check, summary, startApplet } = H;

const { api } = startApplet();

// Arrays from the applet's sandbox are from another realm; copy before comparing.
const plain = value => JSON.parse(JSON.stringify(value));

function task(id, priority, status, createdAt, extra = {}) {
    return Object.assign({
        id, title: id, description: '', priority, status,
        completed: status === 'complete', createdAt, completedAt: 0,
    }, extra);
}

check('normalizePriority rejects prototype names like "constructor"', () => {
    assert.strictEqual(api.normalizePriority('constructor'), 'medium');
    assert.strictEqual(api.normalizePriority('HIGH'), 'high');
});

check('cycleTab wraps in both directions', () => {
    assert.strictEqual(api.cycleTab('daily', -1), 'complete');
    assert.strictEqual(api.cycleTab('complete', 1), 'daily');
    assert.strictEqual(api.cycleTab('ongoing', 1), 'complete');
});

check('listed puts Critical first, then newest first within a priority', () => {
    const list = [
        task('low', 'low', 'ongoing', 3),
        task('crit-old', 'critical', 'ongoing', 1),
        task('crit-new', 'critical', 'ongoing', 2),
    ];
    assert.deepStrictEqual(plain(api.listed(list, '', 'ongoing').map(t => t.id)), ['crit-new', 'crit-old', 'low']);
});

check('listed on Completed sorts by completedAt, newest first', () => {
    const list = [
        task('a', 'high', 'complete', 1, { completedAt: 100 }),
        task('b', 'high', 'complete', 1, { completedAt: 300 }),
    ];
    assert.deepStrictEqual(plain(api.listed(list, '', 'complete').map(t => t.id)), ['b', 'a']);
});

check('listed keeps backlog apart from ongoing', () => {
    const list = [task('b', 'critical', 'backlog', 1), task('o', 'low', 'ongoing', 1)];
    assert.deepStrictEqual(plain(api.listed(list, '', 'backlog').map(t => t.id)), ['b']);
    assert.deepStrictEqual(plain(api.listed(list, '', 'ongoing').map(t => t.id)), ['o']);
});

check('search matches title, description, priority and status words', () => {
    const t = task('x', 'critical', 'backlog', 1, { title: 'Write notes', description: 'for Friday' });
    assert.ok(api.matches(t, 'notes'));
    assert.ok(api.matches(t, 'friday'));
    assert.ok(api.matches(t, 'critical'));
    assert.ok(api.matches(t, 'BACKLOG'));
    assert.ok(!api.matches(t, 'nothing-like-this'));
});

check('highestOngoing ignores backlog and completed tasks', () => {
    const list = [
        task('a', 'critical', 'backlog', 1),
        task('b', 'high', 'complete', 1),
        task('c', 'low', 'ongoing', 1),
    ];
    assert.strictEqual(api.highestOngoing(list), 'low');
    assert.strictEqual(api.ongoingCount(list), 1);
});

check('highestOngoing is empty when nothing is ongoing', () => {
    assert.strictEqual(api.highestOngoing([task('a', 'critical', 'backlog', 1)]), '');
});

check('rollDailyTasks does nothing on the same day', () => {
    const tasks = [{ id: 'daily-1', title: 'Stretch', completed: true, completedAt: 5 }];
    const result = api.rollDailyTasks(tasks, '2026-11-10', '2026-11-10');
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.tasks[0].completed, true);
});

check('rollDailyTasks clears completed on a new day and keeps the text', () => {
    const tasks = [{ id: 'daily-1', title: 'Stretch', description: 'ten minutes', completed: true, completedAt: 5 }];
    const result = api.rollDailyTasks(tasks, '2026-11-10', '2026-11-11');
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.dailyResetDate, '2026-11-11');
    assert.strictEqual(result.tasks[0].completed, false);
    assert.strictEqual(result.tasks[0].completedAt, 0);
    assert.strictEqual(result.tasks[0].title, 'Stretch');
    assert.strictEqual(result.tasks[0].description, 'ten minutes');
    assert.strictEqual(tasks[0].completed, true, 'input must not be mutated');
});

check('parseStore accepts the v2 object and a bare array', () => {
    const v2 = api.parseStore('{"version":2,"activeTab":"backlog","tasks":[{"id":"a","title":"x","status":"backlog"}]}');
    assert.strictEqual(v2.activeTab, 'backlog');
    assert.strictEqual(v2.tasks[0].status, 'backlog');
    const bare = api.parseStore('[{"id":"b","title":"y","completed":true}]');
    assert.strictEqual(bare.tasks[0].status, 'complete');
});

check('parseStore reports invalid JSON as not valid', () => {
    assert.strictEqual(api.parseStore('{not json').valid, false);
    assert.strictEqual(api.parseStore('').valid, true);
});

check('parseStore drops untitled rows and ignores a malformed reset date', () => {
    const store = api.parseStore('{"tasks":[{"id":"a","title":"  "},{"id":"b","title":"ok"}],"dailyResetDate":"11/10/2026"}');
    assert.strictEqual(store.tasks.length, 1);
    assert.strictEqual(store.tasks[0].title, 'ok');
    assert.strictEqual(store.dailyResetDate, '');
});

check('parseStore normalizes an unknown activeTab to ongoing', () => {
    assert.strictEqual(api.parseStore('{"activeTab":"settings"}').activeTab, 'ongoing');
});

check('serialize writes the Omarchy field names and round-trips', () => {
    const tasks = [task('a', 'high', 'ongoing', 9)];
    const text = api.serialize(tasks, 'backlog', [], '2026-11-10');
    const data = JSON.parse(text);
    assert.deepStrictEqual(Object.keys(data), ['version', 'activeTab', 'tasks', 'dailyTasks', 'dailyResetDate']);
    assert.strictEqual(data.version, 2);
    assert.ok(text.endsWith('\n'));
    const back = api.parseStore(text);
    assert.strictEqual(back.activeTab, 'backlog');
    assert.strictEqual(back.tasks[0].id, 'a');
    assert.strictEqual(back.dailyResetDate, '2026-11-10');
});

check('emptyMessage covers search and each tab', () => {
    assert.strictEqual(api.emptyMessage('zzz', 'ongoing', 3), 'No tasks match \u201czzz\u201d');
    assert.strictEqual(api.emptyMessage('', 'daily', 0), 'No daily tasks yet');
    assert.strictEqual(api.emptyMessage('', 'complete', 0), 'Nothing completed yet');
    assert.strictEqual(api.emptyMessage('', 'backlog', 0), 'Nothing in the backlog');
    assert.strictEqual(api.emptyMessage('', 'ongoing', 0), 'Nothing on the list yet');
});

check('badgeTooltip names the top priority only for critical and high', () => {
    assert.strictEqual(api.badgeTooltip(0, ''), 'Todo List');
    assert.strictEqual(api.badgeTooltip(1, 'critical'), '1 ongoing \u00b7 Critical');
    assert.strictEqual(api.badgeTooltip(3, 'low'), '3 ongoing');
});

check('localDateKey pads month and day', () => {
    assert.strictEqual(api.localDateKey(new Date(2026, 0, 5, 12)), '2026-01-05');
});

check('trim removes surrounding whitespace only', () => {
    assert.strictEqual(api.trim('  a b  '), 'a b');
    assert.strictEqual(api.trim(null), '');
});

check('hotkeyLabel turns Cinnamon key strings into readable text', () => {
    assert.strictEqual(api.hotkeyLabel('<Primary><Alt>d'), 'Ctrl+Alt+D');
    assert.strictEqual(api.hotkeyLabel('<Super>t'), 'Super+T');
    assert.strictEqual(api.hotkeyLabel('<Primary><Shift>F5'), 'Ctrl+Shift+F5');
});

summary();
