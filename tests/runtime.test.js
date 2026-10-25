/* Runtime regression tests with a minimal Lampa/jQuery mock. No network or TV required. */
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('lampa-rescue-core.js', 'utf8');
const callbacks = [];
const componentFactories = {};
const followHandlers = {};
let componentAddCalls = 0;
let listenerFollowCalls = 0;
const contentNodes = [];
const playHandlers = [];
const playerCalls = [];
const notyMessages = [];
let playerShouldThrow = false;
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
        on: function (event, callback) {
            if (this.selector === '.lr-source' && event === 'hover:enter') playHandlers.push(callback);
            return this;
        },
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
        Listener: { follow: function (name, callback) { listenerFollowCalls++; followHandlers[name] = callback; } },
        Component: {
            add: function (name, factory) { componentAddCalls++; componentFactories[name] = factory; },
            get: function () { return null; }
        },
        Activity: { push: function () {} },
        Player: { play: function (payload) {
            if (playerShouldThrow) throw new Error('simulated player failure');
            playerCalls.push(payload);
        } },
        Noty: { show: function (message) { notyMessages.push(message); } }
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

// Loading the same core script again must not register duplicate components or listeners.
const initialComponentAddCalls = componentAddCalls;
const initialListenerFollowCalls = listenerFollowCalls;
const initialFactory = componentFactories.lampa_rescue_sources;
vm.runInNewContext(source, sandbox, { timeout: 2000 });
assert.equal(componentAddCalls, initialComponentAddCalls, 'second script load must not register a duplicate component');
assert.equal(listenerFollowCalls, initialListenerFollowCalls, 'second script load must not bind duplicate listeners');
assert.equal(componentFactories.lampa_rescue_sources, initialFactory, 'second script load must preserve the original component');

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

const handlersBeforePlayback = playHandlers.length;
const mixedScreen = createComponent({ title: 'Mixed results movie', release_date: '2023-01-01' });
assert.equal(api.getResults().length, 1, 'one failed provider must not remove successful results');
assert.equal(api.getResults()[0].title, 'Shared result', 'duplicate URLs from one provider should be deduplicated');
assert.ok(contentNodes[contentNodes.length - 1].htmlValue.includes('Shared result'),
    'successful result should still be rendered when another provider fails');
assert.ok(playHandlers.length > handlersBeforePlayback, 'rendered result should have a selection handler');
playHandlers[playHandlers.length - 1]();
assert.equal(playerCalls.length, 1, 'selecting a result should invoke the player');
assert.equal(playerCalls[0].url, 'https://example.test/shared.mp4', 'player should receive the exact selected URL');

playerShouldThrow = true;
playHandlers[playHandlers.length - 1]();
assert.ok(notyMessages.some(function (message) {
    return message.includes('не удалось запустить');
}), 'player launch failure should show a user-facing notification');
playerShouldThrow = false;
mixedScreen.onDestroy();

// Selecting a rendered result must launch its exact URL; player errors must be surfaced.
const handlersBeforePlayback = playHandlers.length;
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

// If providers finish without any usable result, the screen must show a clear empty state.
api.registerProvider({
    id: 'mock',
    name: 'Invalid-only source',
    search: function () {
        return [
            { title: 'Unsafe result', url: 'javascript:alert(1)' },
            { title: 'No URL result', url: '' }
        ];
    }
});
api.registerProvider({
    id: 'broken',
    name: 'Failed source',
    search: function (movie, done) {
        done(new Error('simulated provider failure'), []);
    }
});

const emptyScreen = createComponent({ title: 'No playable sources', release_date: '2021-01-01' });
assert.equal(api.getResults().length, 0, 'invalid and failed results must not appear as playable options');
assert.ok(contentNodes[contentNodes.length - 1].htmlValue.includes('Пока ничего не найдено'),
    'screen should show the empty-results message when no usable sources remain');
emptyScreen.onDestroy();

// Rapidly switching between movies must isolate each search lifecycle and late response.
const rapidCallbacks = [];
api.registerProvider({
    id: 'mock',
    name: 'Rapid-switch source',
    search: function (movie, done) {
        rapidCallbacks.push({ movie, done });
    }
});
api.registerProvider({
    id: 'broken',
    name: 'Immediate empty source',
    search: function () {
        return [];
    }
});

const screenA = createComponent({ title: 'Rapid movie A', release_date: '2019-01-01' });
const screenB = createComponent({ title: 'Rapid movie B', release_date: '2020-01-01' });
const screenC = createComponent({ title: 'Rapid movie C', release_date: '2021-01-01' });
assert.equal(rapidCallbacks.length, 3, 'each rapid movie switch should start its own request');

// Late destruction events from older screens must not cancel the newest search.
screenA.onDestroy();
screenB.onDestroy();
rapidCallbacks[2].done(null, [
    { title: 'Movie C result', url: 'https://example.test/movie-c.mp4' }
]);
assert.equal(api.getResults().length, 1, 'latest search should keep its own result after older screens are destroyed');
assert.equal(api.getResults()[0].title, 'Movie C result');

// Responses arriving after cancellation must not pollute the current movie's results.
rapidCallbacks[0].done(null, [
    { title: 'Late movie A result', url: 'https://example.test/movie-a.mp4' }
]);
rapidCallbacks[1].done(null, [
    { title: 'Late movie B result', url: 'https://example.test/movie-b.mp4' }
]);
assert.equal(api.getResults().length, 1, 'late results from previous searches must be ignored');
assert.equal(api.getResults()[0].title, 'Movie C result');
screenC.onDestroy();

// When every provider is disabled, show a setup hint instead of a misleading search result.
api.registerProvider({
    id: 'mock',
    name: 'Disabled mock source',
    enabled: false,
    search: function () {
        throw new Error('disabled provider must not be called');
    }
});
api.registerProvider({
    id: 'broken',
    name: 'Disabled second source',
    enabled: false,
    search: function () {
        throw new Error('disabled provider must not be called');
    }
});
const noProvidersScreen = createComponent({ title: 'No providers enabled', release_date: '2020-01-01' });
assert.equal(api.getResults().length, 0, 'disabled providers must not generate results');
assert.ok(contentNodes[contentNodes.length - 1].htmlValue.includes('Источники ещё не подключены'),
    'screen should explain that no sources are configured');
noProvidersScreen.onDestroy();

console.log('Runtime regression checks passed: provider validation, search ownership, rapid movie switching, late-response isolation, callback-once, unsafe URL rejection, provider error isolation, URL deduplication, provider timeout isolation, empty-results state, no-enabled-providers state, exact playback handoff, player-error notification, duplicate-load guard.');
