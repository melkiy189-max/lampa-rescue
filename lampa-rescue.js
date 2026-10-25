(function () {
    'use strict';

    var PLUGIN = 'Lampa Rescue';
    var VERSION = '0.1.0';
    var READY_FLAG = '__lampa_rescue_010__';
    var LOG_KEY = 'lampa_rescue_log_v1';
    var MAX_LOGS = 30;
    var active = false;
    var lastNoticeAt = 0;
    var lastStart = null;

    if (window[READY_FLAG]) return;
    window[READY_FLAG] = true;

    function safeString(value, max) {
        if (value === undefined || value === null) return '';
        var text = '';
        try {
            text = typeof value === 'string' ? value : JSON.stringify(value);
        } catch (e) {
            text = String(value);
        }
        return String(text || '').slice(0, max || 240);
    }

    function getLogs() {
        try {
            var value = window.localStorage.getItem(LOG_KEY);
            var logs = value ? JSON.parse(value) : [];
            return Array.isArray(logs) ? logs : [];
        } catch (e) {
            return [];
        }
    }

    function saveLog(eventName, details) {
        var item = {
            time: new Date().toISOString(),
            event: safeString(eventName, 40),
            title: safeString(lastStart && lastStart.title, 120),
            error: safeString(details && (details.error || details.message || details.reason || details), 240),
            fatal: !!(details && details.fatal),
            platform: safeString(Lampa.Platform && Lampa.Platform.tv ? 'tv' : 'web', 20)
        };

        try {
            var logs = getLogs();
            logs.push(item);
            if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
            window.localStorage.setItem(LOG_KEY, JSON.stringify(logs));
        } catch (e) {
            // Storage can be disabled or full; logging must never break playback.
        }

        try {
            console.warn('[' + PLUGIN + ']', item);
        } catch (e) {}
    }

    function notify(message) {
        var now = Date.now();
        if (now - lastNoticeAt < 8000) return;
        lastNoticeAt = now;

        try {
            if (Lampa.Noty && typeof Lampa.Noty.show === 'function') {
                Lampa.Noty.show(message);
            } else if (Lampa.Notice && typeof Lampa.Notice.show === 'function') {
                Lampa.Notice.show(message);
            }
        } catch (e) {}
    }

    function onPlayerStart(data) {
        lastStart = data || {};
        active = true;
        saveLog('player_start', {
            title: data && data.title,
            url: data && data.url ? 'stream URL present' : 'stream URL missing'
        });

        // PlayerVideo is recreated for each playback session, so bind here.
        try {
            if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
                Lampa.PlayerVideo.listener.follow('error', onVideoError);
                Lampa.PlayerVideo.listener.follow('canplay', onCanPlay);
            }
        } catch (e) {
            saveLog('listener_setup_error', e && e.message);
        }
    }

    function onCanPlay() {
        saveLog('video_canplay', {});
    }

    function onVideoError(data) {
        saveLog('video_error', data || {});
        if (data && data.fatal === false) return;
        notify('Lampa Rescue: ошибка воспроизведения. Попробуй повторить запуск или выбрать другой источник/озвучку.');
    }

    function onPlayerDestroy() {
        active = false;
        try {
            if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
                Lampa.PlayerVideo.listener.remove('error', onVideoError);
                Lampa.PlayerVideo.listener.remove('canplay', onCanPlay);
            }
        } catch (e) {}
        saveLog('player_destroy', {});
        lastStart = null;
    }

    var initAttempts = 0;
    var initTimer = null;

    function init() {
        if (window.__lampa_rescue_initialized__) return true;

        // On older TV builds, app-ready can fire before PlayerVideo is available.
        // Retry briefly instead of permanently marking the plugin initialized too early.
        if (!Lampa.Player || !Lampa.Player.listener || !Lampa.PlayerVideo || !Lampa.PlayerVideo.listener) {
            initAttempts++;
            if (initAttempts === 1) {
                console.warn('[' + PLUGIN + '] Lampa player API is not ready yet; waiting briefly.');
            }
            if (initAttempts < 80 && !initTimer && typeof window.setTimeout === 'function') {
                initTimer = window.setTimeout(function () {
                    initTimer = null;
                    init();
                }, 250);
            } else if (initAttempts >= 80) {
                saveLog('plugin_init_failed', { message: 'Lampa player API unavailable after retries' });
            }
            return false;
        }

        window.__lampa_rescue_initialized__ = true;

        Lampa.Player.listener.follow('start', onPlayerStart);
        Lampa.Player.listener.follow('destroy', onPlayerDestroy);

        // Capture errors even if a particular player engine reports them at Player level.
        Lampa.Player.listener.follow('error', function (data) {
            saveLog('player_error', data || {});
        });

        saveLog('plugin_ready', { version: VERSION });
        console.log('[' + PLUGIN + '] ' + VERSION + ' loaded');
        return true;
    }

    if (window.appready) {
        init();
    } else if (Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (event) {
            if (event && event.type === 'ready') init();
        });
    }
})();