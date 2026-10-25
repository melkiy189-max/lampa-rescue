/* Runtime regression test for the legacy playback-diagnostics plugin startup. */
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('lampa-rescue.js', 'utf8');
const scheduled = [];
const stored = {};
const playerEvents = {};
const videoEvents = {};
const logs = [];

const window = {
    appready: true,
    localStorage: {
        getItem: function (key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
        setItem: function (key, value) { stored[key] = String(value); }
    },
    setTimeout: function (callback, delay) {
        scheduled.push({ callback: callback, delay: delay });
        return scheduled.length;
    },
    Lampa: {
        Player: {
            listener: {
                follow: function (event, callback) {
                    (playerEvents[event] = playerEvents[event] || []).push(callback);
                }
            }
        },
        Noty: { show: function () {} }
    }
};
const sandbox = {
    window: window,
    Lampa: window.Lampa,
    console: {
        log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
        warn: function () {}
    },
    Date: Date,
    JSON: JSON,
    Array: Array,
    String: String,
    Error: Error
};

vm.runInNewContext(source, sandbox, { timeout: 2000 });
assert.equal(window.__lampa_rescue_initialized__, undefined,
    'plugin must not mark itself initialized while PlayerVideo is unavailable');
assert.equal(scheduled.length, 1, 'plugin should schedule a retry');
assert.equal(scheduled[0].delay, 250, 'retry delay should be short');

window.Lampa.PlayerVideo = {
    listener: {
        follow: function (event, callback) {
            (videoEvents[event] = videoEvents[event] || []).push(callback);
        },
        remove: function () {}
    }
};
scheduled.shift().callback();

assert.equal(window.__lampa_rescue_initialized__, true,
    'plugin should initialize once player APIs become available');
assert.equal(playerEvents.start.length, 1, 'player start listener should be registered once');
assert.equal(playerEvents.destroy.length, 1, 'player destroy listener should be registered once');
assert.ok(logs.some(function (line) { return line.indexOf('loaded') !== -1; }),
    'successful initialization should be logged');
const records = JSON.parse(stored.lampa_rescue_log_v1);
assert.ok(records.some(function (record) { return record.event === 'plugin_ready'; }),
    'successful initialization should persist a diagnostic event');

vm.runInNewContext(source, sandbox, { timeout: 2000 });
assert.equal(playerEvents.start.length, 1,
    'duplicate script load must not register duplicate player listeners');

console.log('Diagnostic startup regression checks passed: delayed player API, successful retry, persisted ready event, duplicate-load guard.');
