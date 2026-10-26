'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('lampa-rescue-host-test.js', 'utf8');
assert.ok(source.includes('https://rutube.ru/play/embed/'), 'RUTUBE must use embed URL');
assert.ok(source.includes('https://vkvideo.ru/video_ext.php?oid='), 'VK must use video_ext embed');
assert.ok(source.includes('function parseHostUrl(value)'), 'URL parser exists');
assert.match(source, /Lampa\.Input\.edit\(\{\s*title: 'Ссылка на публичное видео',[\s\S]*?nomask: true\s*\}, function \(value\) \{/ ,
    'Lampa keyboard result must be received through Input.edit second callback');
assert.ok(!source.includes('onSelect: function (value)'), 'do not pass the input callback as an unsupported option');
assert.ok(source.includes('if (!parsed)'), 'invalid URLs must be rejected');
assert.ok(source.includes("frame.attr('src', parsed.src)"), 'iframe src must come from validated embed URL');
assert.ok(source.includes("host === 'rutube.ru'") && source.includes("host === 'vkvideo.ru'"), 'known video hosts are checked');
assert.ok(!source.includes('eval('), 'no dynamic code evaluation');
console.log('Host player test static checks passed. Actual embeds require manual LG webOS verification.');
