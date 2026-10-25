/* Runtime regression tests with a minimal Lampa/jQuery mock. No network or TV required. */
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('lampa-rescue-core.js', 'utf8');
const callbacks = [];
const componentFactories = {};
const followHandlers = {};
const contentNodes = [];

function makeNode(selector) {
    return {
        selector: selector || '',
        length: 1,
        htmlValue: '',
        find: function (query) {
            const node = makeNode(query);
            if (query === '.lr-content') contentNodes.push(node);
            return node;
        },
        html: function (value) {
            if (value === undefined) return this.htmlValue;
            this.htmlValue = value;
            return this;
        },
        text: function () { return this; },
        appendTo: function () { return this; },
        off: function () { return this; },
        on: function () { return this; },
        first: function () { return this; },
        append: function () { return this; },
        remove: function () { this.removed = true; return this; },
        attr: function () { return '0'; }
    };
}

function jQuery(arg) { return makeNode(typeof arg === 'string' ? arg : 'wrapped'); }
jQuery.fn = {};

const window = {
    appready: true,
    jQuery,
    Lampa: {
        Listener: { follow: function (name, callback) { followHandlers[name] = callback; } },
        Component: {
            add: function (name, factory) { componentFactories[name] = factory; },
            get: function () { return null; }
        },
        Activity: { push: function () {} },
        Player: { play: function () {} },
        Noty: { show: function () {} }
    }
};

const sandbox = {
    window,
    Lampa: window.Lampa,
    jQuery,
    console: { log: function () {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Array,
    String,
    Error,
    parseInt,
    isNaN
};
vm.runInNewContext(source, sandbox, { timeout: 2000 });

const api = window.LampaRescue;
assert.ok(api, 'core should initialise');
assert.equal(api.registerProvider({ id: 'bad', name: 'bad' }), false, 'reject provider without search');

api.registerProvider({
    id: 'mock',
    name: 'Mock source',
    search: function (movie, done) {
        callbacks.push({ movie, done });
    }
});

const factory = componentFactories.lampa_rescue_sources;
assert.equal(typeof factory, 'function', 'component should register');

function createComponent(movie) {
    const component = {};
    factory.call(component, { movie });
    component.create();
    return component;
}

const oldScreen = createComponent({ title: 'Old movie', release_date: '2020-01-01' });
assert.equal(callbacks.length, 1, 'first screen should start one provider request');

const newScreen = createComponent({ title: 'New movie', release_date: '2024-01-01' });
assert.equal(callbacks.length, 2, 'second screen should start a new provider request');

// Destroying the older screen must not cancel the newer screen's active request.
oldScreen.onDestroy();
callbacks[1].done(null, [
    { title: 'New movie result', url: 'https://example.test/new.mp4' },
    { title: 'JavaScript scheme must be rejected', url: 'javascript:alert(1)' },
    { title: 'File scheme must be rejected', url: 'file:///etc/passwd' },
    { title: 'Missing URL must be rejected', url: '' }
]);
assert.equal(api.getResults().length, 1, 'new result survives old screen teardown and unsafe URLs are rejected');
assert.equal(api.getResults()[0].title, 'New movie result');
assert.equal(api.getResults()[0].url, 'https://example.test/new.mp4', 'only the valid HTTPS result is kept');

const countAfterFirstCallback = api.getResults().length;
callbacks[1].done(null, [{ title: 'Duplicate callback', url: 'https://example.test/second.mp4' }]);
assert.equal(api.getResults().length, countAfterFirstCallback, 'provider callback should be accepted only once');

callbacks[0].done(null, [{ title: 'Stale result', url: 'https://example.test/old.mp4' }]);
assert.equal(api.getResults().length, 1, 'stale cancelled search must not overwrite current results');

newScreen.onDestroy();

console.log('Runtime regression checks passed: provider validation, search ownership, callback-once, stale result isolation.');
