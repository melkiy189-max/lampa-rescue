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
const timers = new Map();
let nextTimerId = 1;

function fakeSetTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay, active: true });
    return id;
}

function fakeClearTimeout(id) {
    timers.delete(id);
}

function runTimerWithDelay(delay) {
    const entry = Array.from(timers.entries()).find(function (pair) {
        return pair[1].delay === delay;
    });
    assert.ok(entry, 'expected a scheduled timer with delay ' + delay);
    timers.delete(entry[0]);
    entry[1].callback();
}

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
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetTimeout,
    clearInterval: fakeClearTimeout,
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

// A failing provider must not erase results returned by another provider.
api.registerProvider({
    id: 'mock',
    name: 'Mock source',
    search: function () {
        return [
            { title: 'Shared result', url: 'https://example.test/shared.mp4' },
            { title: 'Duplicate URL', url: 'https://example.test/shared.mp4' }
        ];
    }
});
api.registerProvider({
    id: 'broken',
    name: 'Broken source',
    search: function (movie, done) {
        done(new Error('simulated provider failure'), []);
    }
});

const mixedScreen = createComponent({ title: 'Mixed results movie', release_date: '2023-01-01' });
assert.equal(api.getResults().length, 1, 'one failed provider must not remove successful results');
assert.equal(api.getResults()[0].title, 'Shared result', 'duplicate URLs from one provider should be deduplicated');
assert.ok(contentNodes[contentNodes.length - 1].htmlValue.includes('Shared result'),
    'successful result should still be rendered when another provider fails');
mixedScreen.onDestroy();

// A timed-out provider must not erase a result from a provider that already succeeded.
api.registerProvider({
    id: 'mock',
    name: 'Fast source',
    search: function () {
        return [{ title: 'Fast result survives timeout', url: 'https://example.test/fast.mp4' }];
    }
});
api.registerProvider({
    id: 'broken',
    name: 'Hanging source',
    search: function () {
        // Deliberately never calls done().
    }
});

const timeoutScreen = createComponent({ title: 'Timeout movie', release_date: '2022-01-01' });
assert.equal(api.getResults().length, 1, 'fast provider result should be visible before timeout');
assert.equal(api.getResults()[0].title, 'Fast result survives timeout');
runTimerWithDelay(11500);
assert.equal(api.getResults().length, 1, 'timed-out provider must not erase successful results');
assert.equal(api.getResults()[0].title, 'Fast result survives timeout');
timeoutScreen.onDestroy();

console.log('Runtime regression checks passed: provider validation, search ownership, callback-once, stale result isolation, unsafe URL rejection, provider error isolation, URL deduplication, provider timeout isolation.');
