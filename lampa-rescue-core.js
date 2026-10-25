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
            timer: null
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

    function renderScreen(event, payload) {
        if (!event || !event.activity || !event.activity.render) return;
        var root = jQuery(event.activity.render());
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

        if (Lampa.Component && Lampa.Component.add && Lampa.Activity && Lampa.Scroll) {
            Lampa.Component.add(COMPONENT, function () {
                var self = this;
                var movie = this.movie || currentMovie || {};
                this.create = function () {
                    var html = '<div class="lr-screen"><div class="lr-heading">Доступные источники</div>';
                    html += '<div class="lr-subtitle">' + esc(movieTitle(movie)) + (movieYear(movie) ? ' · ' + esc(movieYear(movie)) : '') + '</div>';
                    html += '<div class="lr-toolbar"><span class="lr-count">Lampa Rescue ' + VERSION + '</span><span class="lr-source-detail">Единый список источников</span></div>';
                    html += '<div class="lr-content"><div class="lr-empty">Подготовка поиска…</div></div></div>';
                    self.render = jQuery(html);
                    self.activity.loader(false);
                    self.activity.toggle();
                    self.startSearch();
                    return self.render;
                };
                this.startSearch = function () {
                    searchAll(movie, function (state, payload) {
                        payload.state = state;
                        renderScreen(self, payload);
                    });
                };
                this.onDestroy = function () { cancelSearch(); };
                this.start = function () {};
                this.render = function () { return self.render; };
            });
        }

        Lampa.Listener.follow('full', addMovieButton);
        log('Core loaded:', VERSION, 'providers:', providers.length);
    }

    if (window.appready) init();
    else if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (event) {
            if (event && event.type === 'ready') init();
        });
    }
})();