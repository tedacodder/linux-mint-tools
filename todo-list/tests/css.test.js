'use strict';
// Checks applet/stylesheet.css: its braces balance, every theme is present, and
// the muted and body text in each theme meets the 4.5:1 contrast minimum.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'applet', 'stylesheet.css'), 'utf8');
const THEMES = ['neon', 'omarchy', 'ember', 'paper', 'sakura', 'lagoon'];
let failures = 0;

function check(name, fn) {
    try {
        fn();
        console.log('  ok    ' + name);
    } catch (e) {
        failures += 1;
        console.log('  FAIL  ' + name + '\n        ' + e.message);
    }
}

function luminance(hex) {
    const h = hex.replace('#', '');
    const c = [0, 2, 4]
        .map(i => parseInt(h.substr(i, 2), 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The value of a property in the rule whose selector is exactly `selector`.
function colourOf(selector, property) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(rule, 'no rule for ' + selector);
    const decl = new RegExp('(?:^|[;\\s{])' + property + '\\s*:\\s*(#[0-9A-Fa-f]{6})').exec(rule[1]);
    assert.ok(decl, selector + ' has no ' + property);
    return decl[1];
}

check('braces are balanced', () => {
    assert.strictEqual(css.split('{').length, css.split('}').length);
});

THEMES.forEach(theme => {
    const cls = '.todo-theme-' + theme;
    check(theme + ' has its window background', () => {
        colourOf('.todo-dialog' + cls, 'background-color');
    });
    check(theme + ': description and footer text meet 4.5:1', () => {
        const bg = colourOf('.todo-dialog' + cls, 'background-color');
        const row = colourOf(cls + ' .todo-row', 'background-color');
        const desc = colourOf(cls + ' .todo-row-desc', 'color');
        const keys = colourOf(cls + ' .todo-footer-keys', 'color');
        assert.ok(contrast(desc, bg) >= 4.5, 'description on the window: ' + contrast(desc, bg).toFixed(2));
        assert.ok(contrast(desc, row) >= 4.5, 'description on a row: ' + contrast(desc, row).toFixed(2));
        assert.ok(contrast(keys, bg) >= 4.5, 'footer keys on the window: ' + contrast(keys, bg).toFixed(2));
    });
    check(theme + ': main text meets 4.5:1', () => {
        const bg = colourOf('.todo-dialog' + cls, 'background-color');
        const text = colourOf(cls + ' .todo-row-title', 'color');
        assert.ok(contrast(text, bg) >= 4.5, 'row title: ' + contrast(text, bg).toFixed(2));
    });
});

console.log('  ' + (failures ? 'css checks failed' : 'css checks passed'));
process.exitCode = failures ? 1 : 0;
