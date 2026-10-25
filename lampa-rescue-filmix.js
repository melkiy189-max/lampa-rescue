(function () {
    'use strict';

    /*
     * Lampa Rescue — Filmix adapter (experimental).
     * Uses the Filmix API shape exposed by the public Lampa Filmix extension.
     * It reuses only the user's existing Lampa Storage settings; it never asks
     * for a password or sends tokens to any host other than the configured API
     * proxy. This adapter currently emits movie links only, not series episodes.
     */

    var PROVIDER_ID = 'filmix';
    var PROVIDER_NAME = 'Filmix';
    var API_URL = 'http://filmixapp.vip/api/v2/';
    var WAIT_MS = 15000;
    var registered = false;

    function log(message) {
        try { console.log('[Lampa Rescue / Filmix] ' + message); } catch (e) {}
    }

    function text(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function normalize(value) {
        return text(value).toLowerCase().replace(/[^a-zа-я0-9]/g, '');
    }

    function movieYear(movie) {
        var date = movie && (movie.release_date || movie.first_air_date || '');
        var year = parseInt(text(date).slice(0, 4), 10);
        return isNaN(year) ? 0 : year;
    }

    function deviceId() {
        var id = Lampa.Storage.get('fxapi_uid', '');
        if (!id) {
            id = Lampa.Utils.uid(16);
            Lampa.Storage.set('fxapi_uid', id);
        }
        return id;
    }

    function token() {
        return Lampa.Storage.get('fxapi_token', '');
    }

    function apiBase() {
        var proxy = Lampa.Storage.get('fxapi_proxy', 'https://cors.jacred.stream/');
        if (!proxy) return '';
        if (proxy.charAt(proxy.length - 1) !== '/') proxy += '/';
        return proxy + API_URL;
    }

    function deviceParams() {
        return 'app_lang=ru_RU&user_dev_apk=2.2.13&user_dev_id=' +
            encodeURIComponent(deviceId()) +
            '&user_dev_name=Xiaomi%2B24069PC21G&user_dev_os=12&user_dev_token=' +
            encodeURIComponent(token()) + '&user_dev_vendor=Xiaomi';
    }

    function addQuery(url, query) {
        return url + (url.indexOf('?') === -1 ? '?' : '&') + query;
    }

    function request(path, callback, fail) {
        var network = new Lampa.Reguest();
        var settled = false;
        var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            network.clear();
            fail(new Error('Filmix request timeout'));
        }, WAIT_MS);

        network.timeout(WAIT_MS - 500);
        network.silent(addQuery(apiBase() + path, deviceParams()), function (data) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(data);
        }, function (a, b) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fail(new Error(network.errorDecode ? network.errorDecode(a, b) : 'Filmix request failed'));
        });
    }

    function matchCard(cards, movie, query) {
        if (!Array.isArray(cards)) return null;
        var year = movieYear(movie);
        var original = movie && (movie.original_title || movie.original_name || '');
        var wanted = normalize(original || movie.title || movie.name || query);
        var candidates = cards.filter(function (card) {
            var cardYear = parseInt(card.year || text(card.alt_name).split('-').pop(), 10);
            return !year || !cardYear || Math.abs(cardYear - year) <= 1;
        });
        var exact = candidates.filter(function (card) {
            return normalize(card.original_title || card.title || card.name) === wanted;
        });
        if (exact.length) return exact[0];
        if (candidates.length === 1) return candidates[0];
        return null;
    }

    function movieStreams(post, card, done) {
        var links = post && post.player_links && post.player_links.movie;
        var output = [];
        if (!Array.isArray(links)) return done(null, output);

        links.forEach(function (entry) {
            if (!entry || !entry.link) return;
            var qualityMatch = text(entry.link).match(/\[([\d,\s]*)\]/);
            if (!qualityMatch) return;
            var qualities = qualityMatch[1].split(',').map(function (q) {
                return parseInt(q, 10);
            }).filter(function (q) { return q > 0 && q <= 2160; });
            if (!qualities.length) return;
            qualities.sort(function (a, b) { return b - a; });

            var selected = qualities[0];
            var url = text(entry.link).replace(/_\[([\d,\s]*)\]\.mp4/i, '_' + selected + '.mp4');
            if (!/^https?:\/\//i.test(url)) return;
            output.push({
                id: 'filmix-' + text(card.id) + '-' + normalize(entry.translation || 'original') + '-' + selected,
                title: text(card.title || card.name || 'Filmix'),
                url: url,
                quality: selected + 'p',
                voice: text(entry.translation || 'Озвучка не указана')
            });
        });

        done(null, output);
    }

    function search(movie, done) {
        var title = text(movie && (movie.title || movie.name || movie.original_title || movie.original_name)).trim();
        if (!title) return done(null, []);
        if (!apiBase()) return done(new Error('Filmix proxy is not configured'), []);

        request('search&story=' + encodeURIComponent(title), function (cards) {
            var card = matchCard(cards, movie, title);
            if (!card || !card.id) return done(null, []);

            request('post/' + encodeURIComponent(card.id), function (post) {
                if (!post || !post.player_links || !Array.isArray(post.player_links.movie)) {
                    return done(null, []);
                }
                movieStreams(post, card, done);
            }, function (error) {
                done(error, []);
            });
        }, function (error) {
            done(error, []);
        });
    }

    function init() {
        if (registered || !window.LampaRescue || !Lampa.Reguest || !Lampa.Storage || !Lampa.Utils) return false;
        registered = LampaRescue.registerProvider({
            id: PROVIDER_ID,
            name: PROVIDER_NAME,
            enabled: true,
            search: search
        });
        if (registered) log('registered; movie-only experimental adapter');
        return registered;
    }

    function bootstrap() {
        if (init()) return;
        if (window.setInterval) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (init() || attempts >= 80) clearInterval(timer);
            }, 250);
        }
    }

    bootstrap();
})();
