/* Static regression checks for Lampa Rescue. These do not prove live provider or TV playback. */
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');
const core = read('lampa-rescue-core.js');
const filmix = read('lampa-rescue-filmix.js');
const bundle = read('lampa-rescue-experimental-bundle.js');

for (const [name, source] of [['core', core], ['bundle', bundle]]) {
    assert.ok(source.includes('registerProvider'), name + ': provider registration API');
    assert.ok(source.includes('if (item.url && !/^https?:') &&
        source.includes('.test(item.url)) return null;'), name + ': web URL validation');
    assert.ok(source.includes('var renderedResults = payload.results || [];'),
        name + ': rendered result snapshot');
    assert.ok(source.includes('if (state.cancelled) return;'),
        name + ': cancelled search callback guard');
}

assert.ok(filmix.includes('if (!/^https:') && filmix.includes('.test(proxy)) return'),
    'Filmix: reject non-HTTPS proxy');
assert.ok(filmix.includes("replace(/ё/g, 'е')"), 'Filmix: normalize ё to е');
assert.ok(filmix.includes('movie-only experimental adapter'), 'Filmix must remain marked experimental');

assert.ok(bundle.includes(core.trim()), 'bundle must include the exact current core');
assert.ok(bundle.includes(filmix.trim()), 'bundle must include the exact current Filmix adapter');

console.log('Static regression checks passed. Live API and LG playback remain unverified.');
