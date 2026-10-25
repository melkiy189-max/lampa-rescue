/* Lampa Rescue experimental bundle. Not production-ready; Filmix API/proxy/playback unverified. */
(function () {
    'use strict';

    /*
     * Lampa Rescue — aggregator core prototype
     * Target: legacy Lampa WebView / LG webOS.
     *
     * Providers are intentionally not fabricated. A provider must be registered
     * with a real search implementation before it can return visible results.
     */

    var NAME = 'Lampa Rescue';
    var VERSION = '0.2.0-core';
    var FLAG = '__lampa_rescue_core_020__';
    var COMPONENT = 'lampa_rescue_sources';
    var SEARCH_TIMEOUT = 12000;
    var providers = [];
    var activeSearch = null;
    var currentMovie = null;
    var currentResults = [];
    var stylesAdded = false;

    if (window[FLAG]) return;
    window[FLAG] = true;

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[' + NAME + ']');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function safeText(value, max) {
        if (value === undefined || value === null) return '';
        return String(value).replace(/[<>]/g, '').slice(0, max || 300);
    }

    function esc(value) {
        return safeText(value, 500)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function addStyles() {
        if (stylesAdded || !window.jQuery) return;
        stylesAdded = true;
        var css = [
            '.lr-screen{padding:1.2em 2em 4em;color:#eef4ff}',
            '.lr-heading{font-size:1.7em;font-weight:700;margin:0 0 .25em}',
            '.lr-subtitle{opacity:.68;margin-bottom:1.4em;font-size:1em}',
            '.lr-toolbar{display:flex;align-items:center;justify-content:space-between;gap:1em;margin-bottom:1em}',
            '.lr-count{display:inline-block;border-radius:2em;background:rgba(45,117,255,.2);padding:.35em .8em;font-size:.85em}',
            '.lr-list{display:flex;flex-direction:column;gap:.5em}',
            '.lr-source{display:flex;align-items:center;gap:1em;padding:.9em 1em;border:2px solid rgba(130,160,210,.12);border-radius:.8em;background:rgba(15,28,52,.82);min-height:4.2em;cursor:pointer}',
            '.lr-source.focus{border-color:#1684ff;background:rgba(20,65,130,.55)}',
            '.lr-source-logo{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:2.8em;height:2.8em;border-radius:.65em;background:linear-gradient(135deg,#087dff,#5625d8);font-size:1.15em;font-weight:800}',
            '.lr-source-name{font-size:1.05em;font-weight:700}',
            '.lr-source-detail{font-size:.82em;opacity:.68;margin-top:.25em}',
            '.lr-source-meta{display:flex;align-items:center;gap:.45em;flex-wrap:wrap;margin-left:auto}',
            '.lr-chip{font-size:.78em;border-radius:2em;padding:.35em .65em;background:rgba(105,135,185,.15);white-space:nowrap}',
            '.lr-status{font-size:.82em;color:#40d9a0;white-space:nowrap}',
            '.lr-empty{padding:2em 1em;text-align:center;border:1px dashed rgba(130,160,210,.3);border-radius:.8em;line-height:1.65;opacity:.8}',
            '.lr-empty strong{display:block;font-size:1.1em;margin-bottom:.45em;opacity:1}',
            '.lr-spinner{display:inline-block;width:1em;height:1em;border:2px solid rgba(255,255,255,.25);border-top-color:#2587ff;border-radius:50%;animation:lrspin .7s linear infinite;vertical-align:middle;margin-right:.55em}',
            '@keyframes lrspin{to{transform:rotate(360deg)}}',
            '.lr-back{display:inline-block;padding:.6em .9em;border-radius:.6em;background:rgba(130,160,210,.14);margin-bottom:1em}',
            '.lr-error{color:#ffb6b6}',
            '@media(max-width:900px){.lr-screen{padding:1em}.lr-source-meta{max-width:48%}.lr-status{display:none}}'
        ].join('');
        jQuery('<style id="lampa-rescue-core-style">').text(css).appendTo('head');
    }

    function movieTitle(movie) {
        if (!movie) return 'Выбранный фильм';
        return safeText(movie.title || movie.name || movie.original_title || movie.original_name || 'Выбранный фильм', 180);
    }

    function movieYear(movie) {
        var date = movie && (movie.release_date || movie.first_air_date || '');
        return date ? String(date).slice(0, 4) : '';
    }

    function normalizeResult(provider, raw, movie) {
        raw = raw || {};
        var item = {
            id: safeText(raw.id || raw.url || (provider.id + '-' + Math.random().toString(36).slice(2)), 200),
            providerId: provider.id,
            providerName: provider.name,
            title: safeText(raw.title || movieTitle(movie), 180),
            year: safeText(raw.year || movieYear(movie), 8),
            quality: safeText(raw.quality || '', 40),
            voice: safeText(raw.voice || raw.translation || '', 100),
            season: raw.season === undefined ? null : raw.season,
            episode: raw.episode === undefined ? null : raw.episode,
            subtitles: safeText(raw.subtitles || '', 100),
            url: typeof raw.url === 'string' ? raw.url : '',
            play: typeof raw.play === 'function' ? raw.play : null,
            raw: raw
        };
        if (!item.url && !item.play) return null;
        return item;
    }

    function registerProvider(provider) {
        if (!provider || !provider.id || !provider.name || typeof provider.search !== 'function') {
            log('Rejected invalid provider registration');
            return false;
        }
        for (var i = 0; i < providers.length; i++) {
            if (providers[i].id === provider.id) {
                providers[i] = provider;
                return true;
            }
        }
        providers.push(provider);
        return true;
    }

    /*
     * Provider API:
     * {
     *   id: 'provider-id',
     *   name: 'Provider name',
     *   search: function(movie, done) {
     *     done(null, [{ title, url OR play, quality, voice, season, episode }]);
     *   }
     * }
     *
     * The optional done callback can be called once. A provider may also return
     * an array synchronously. Each provider is isolated from failures/timeouts.
     */
    window.LampaRescue = window.LampaRescue || {};
    window.LampaRescue.registerProvider = registerProvider;
    window.LampaRescue.getProviders = function () {
        return providers.map(function (p) {
            return { id: p.id, name: p.name, enabled: p.enabled !== false };
        });
    };
    window.LampaRescue.getResults = function () {
        return currentResults.slice();
    };

    function cancelSearch() {
        if (!activeSearch) return;
        activeSearch.cancelled = true;
        if (activeSearch.timer) clearTimeout(activeSearch.timer);
        if (activeSearch.providerTimers) {
            activeSearch.providerTimers.forEach(function (timer) {
                clearTimeout(timer);
            });
            activeSearch.providerTimers = [];
        }
        activeSearch = null;
    }

    function searchAll(movie, render) {
        cancelSearch();
        currentMovie = movie;
        currentResults = [];

        var enabled = providers.filter(function (p) { return p.enabled !== false; });
        var state = {
            cancelled: false,
            pending: enabled.length,
            completed: 0,
            errors: 0,
            timer: null,
            providerTimers: []
        };
        activeSearch = state;

        if (!enabled.length) {
            render('empty', { results: [], message: 'Источники пока не подключены.' });
            return;
        }

        render('loading', { results: [], pending: enabled.length });

        state.timer = setTimeout(function () {
            if (state.cancelled) return;
            state.cancelled = true;
            activeSearch = null;
            render('complete', {
                results: currentResults.slice(),
                pending: 0,
                errors: state.errors,
                message: currentResults.length ? '' : 'Источники не вернули доступных вариантов. Попробуй позже.'
            });
        }, SEARCH_TIMEOUT);

        function finishOne(provider, error, items) {
            if (state.cancelled) return;
            state.completed++;
            if (error) {
                state.errors++;
                log('Provider failed:', provider.id, safeText(error.message || error, 180));
            } else if (Array.isArray(items)) {
                items.forEach(function (raw) {
                    var result = normalizeResult(provider, raw, movie);
                    if (result) {
                        var duplicate = currentResults.some(function (old) {
                            return old.providerId === result.providerId &&
                                old.url && result.url && old.url === result.url;
                        });
                        if (!duplicate) currentResults.push(result);
                    }
                });
            }

            render(state.completed >= enabled.length ? 'complete' : 'progress', {
                results: currentResults.slice(),
                pending: Math.max(0, enabled.length - state.completed),
                completed: state.completed,
                total: enabled.length,
                errors: state.errors
            });

            if (state.completed >= enabled.length) {
                clearTimeout(state.timer);
                activeSearch = null;
            }
        }

        enabled.forEach(function (provider) {
            var settled = false;
            var localTimer = setTimeout(function () {
                if (settled) return;
                settled = true;
                finishOne(provider, new Error('Provider timeout'), []);
            }, SEARCH_TIMEOUT - 500);
            state.providerTimers.push(localTimer);

            function done(error, items) {
                if (settled) return;
                settled = true;
                clearTimeout(localTimer);
                finishOne(provider, error, items);
            }

            try {
                var returned = provider.search(movie, done);
                if (Array.isArray(returned)) done(null, returned);
            } catch (e) {
                done(e, []);
            }
        });
    }

    function renderScreen(component, payload) {
        if (!component || !component.container) return;
        var root = component.container;
        var content = root.find('.lr-content');
        if (!content.length) return;

        var html = '';
        if (payload.state === 'loading' || payload.state === 'progress') {
            html += '<div class="lr-empty"><strong><span class="lr-spinner"></span>Ищем доступные источники</strong>';
            html += 'Проверено: ' + (payload.completed || 0) + ' из ' + (payload.total || payload.pending || 0) + '. ';
            html += 'Результаты будут появляться по мере ответа сервисов.</div>';
        } else if (payload.results && payload.results.length) {
            html += '<div class="lr-list">';
            payload.results.forEach(function (item, index) {
                html += '<div class="lr-source selector" data-lr-index="' + index + '">';
                html += '<div class="lr-source-logo">' + esc(item.providerName.slice(0, 1).toUpperCase()) + '</div>';
                html += '<div><div class="lr-source-name">' + esc(item.providerName) + '</div>';
                html += '<div class="lr-source-detail">' + esc(item.title) + '</div></div>';
                html += '<div class="lr-source-meta">';
                if (item.quality) html += '<span class="lr-chip">' + esc(item.quality) + '</span>';
                if (item.voice) html += '<span class="lr-chip">' + esc(item.voice) + '</span>';
                html += '<span class="lr-status">● Найдено</span></div><span>›</span></div>';
            });
            html += '</div>';
        } else {
            html += '<div class="lr-empty"><strong>' + (payload.state === 'empty' ? 'Источники ещё не подключены' : 'Пока ничего не найдено') + '</strong>';
            html += esc(payload.message || 'Когда подключённые источники вернут результаты, они появятся здесь.');
            html += '<br><br><span class="lr-source-detail">Версия ядра ' + VERSION + '</span></div>';
        }
        content.html(html);

        content.find('.lr-source').off('hover:enter').on('hover:enter', function () {
            var index = parseInt(jQuery(this).attr('data-lr-index'), 10);
            var item = currentResults[index];
            if (!item) return;
            try {
                if (item.play) item.play(item.raw, currentMovie);
                else if (item.url && Lampa.Player && Lampa.Player.play) {
                    Lampa.Player.play({ url: item.url, title: item.title, quality: item.quality, subtitles: item.subtitles });
                }
            } catch (e) {
                log('Playback launch failed:', e && e.message);
                if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Lampa Rescue: не удалось запустить этот вариант.');
            }
        });
    }

    function openScreen(movie) {
        if (!window.Lampa || !Lampa.Activity || !Lampa.Component) return;
        Lampa.Activity.push({
            url: '',
            component: COMPONENT,
            title: 'Lampa Rescue',
            movie: movie,
            page: 1
        });
    }

    function addMovieButton(event) {
        if (!event || event.type !== 'complite' || !event.data || !event.data.movie || !window.jQuery) return;
        var movie = event.data.movie;
        var root = event.body || (event.object && event.object.activity && event.object.activity.render && event.object.activity.render());
        if (!root) return;
        root = jQuery(root);
        if (root.find('.view--lampa-rescue').length) return;
        var buttons = root.find('.full-start-new__buttons, .full-start__buttons').first();
        if (!buttons.length) return;
        var button = jQuery('<div class="full-start__button selector view--lampa-rescue"><span>Lampa Rescue</span></div>');
        button.on('hover:enter', function () { openScreen(movie); });
        buttons.append(button);
    }

    function init() {
        if (!window.Lampa || !window.Lampa.Listener || !window.jQuery) {
            log('Waiting for Lampa APIs');
            return;
        }
        addStyles();

        if (Lampa.Component && Lampa.Component.add && Lampa.Activity) {
            if (!Lampa.Component.get || !Lampa.Component.get(COMPONENT)) Lampa.Component.add(COMPONENT, function (object) {
                var self = this;
                var movie = object && object.movie ? object.movie : currentMovie || {};
                self.container = jQuery('<div class="lr-screen"></div>');
                self.create = function () {
                    var html = '<div class="lr-heading">Доступные источники</div>';
                    html += '<div class="lr-subtitle">' + esc(movieTitle(movie)) + (movieYear(movie) ? ' · ' + esc(movieYear(movie)) : '') + '</div>';
                    html += '<div class="lr-toolbar"><span class="lr-count">Lampa Rescue ' + VERSION + '</span><span class="lr-source-detail">Единый список источников</span></div>';
                    html += '<div class="lr-content"><div class="lr-empty">Подготовка поиска…</div></div>';
                    self.container.html(html);
                    self.startSearch();
                    return self.render();
                };
                self.render = function () { return self.container; };
                self.startSearch = function () {
                    searchAll(movie, function (state, payload) {
                        payload.state = state;
                        renderScreen(self, payload);
                    });
                };
                self.onDestroy = function () { cancelSearch(); };
                self.start = function () {};
                self.stop = function () { cancelSearch(); };
                self.destroy = function () { cancelSearch(); self.container.remove(); };
            });
        }

        Lampa.Listener.follow('full', addMovieButton);
        log('Core loaded:', VERSION, 'providers:', providers.length);
    }

    /*
     * Bootstrap defensively: some installers inject the extension before Lampa
     * and jQuery are ready. A one-shot check here used to leave the plugin inert
     * forever if the APIs appeared a little later.
     */
    var bootstrapTimer = null;
    var appListenerBound = false;
    var initComplete = false;

    function bootstrap() {
        if (initComplete) return;
        if (!window.Lampa || !window.Lampa.Listener || !window.jQuery) {
            if (!bootstrapTimer) {
                bootstrapTimer = setInterval(function () {
                    if (window.appready && window.Lampa && window.Lampa.Listener && window.jQuery) {
                        clearInterval(bootstrapTimer);
                        bootstrapTimer = null;
                        init();
                        initComplete = true;
                    } else if (window.Lampa && window.Lampa.Listener && window.Lampa.Listener.follow && !appListenerBound) {
                        bindAppReady();
                    }
                }, 250);
            }
            return;
        }

        if (window.appready) {
            init();
            initComplete = true;
        } else {
            bindAppReady();
        }
    }

    function bindAppReady() {
        if (appListenerBound || !window.Lampa || !window.Lampa.Listener || !window.Lampa.Listener.follow) return;
        appListenerBound = true;
        window.Lampa.Listener.follow('app', function (event) {
            if (event && event.type === 'ready' && !initComplete) {
                if (bootstrapTimer) {
                    clearInterval(bootstrapTimer);
                    bootstrapTimer = null;
                }
                init();
                initComplete = true;
            }
        });
    }

    bootstrap();
})();

/* --- Filmix adapter --- */
(function () {
    'use strict';

    /*
     * Lampa Rescue — Filmix adapter (experimental).
     * Uses the Filmix API shape exposed by the public Lampa Filmix extension.
     * It reuses only the user's existing Lampa Storage settings; it never asks
     * for a password. Any configured proxy can see request parameters, including
     * the Filmix token, so do not use a proxy you do not trust. This adapter
     * currently emits movie links only, not series episodes.
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
        var proxy = Lampa.Storage.get('fxapi_proxy', '');
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
        if (!apiBase()) return done(new Error('Filmix proxy is not configured; configure a trusted HTTPS proxy first'), []);

        request('search?story=' + encodeURIComponent(title), function (cards) {
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
