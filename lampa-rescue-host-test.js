(function () {
    'use strict';

    var VERSION = '0.1.0-host-test';
    var COMPONENT = 'lampa_rescue_host_test';
    var FLAG = '__lampa_rescue_host_test_010__';
    if (window[FLAG]) return;
    window[FLAG] = true;

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[Lampa Rescue Hosts]');
        if (window.console && console.log) console.log.apply(console, args);
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseHostUrl(value) {
        var input = String(value || '').replace(/^\s+|\s+$/g, '');
        var url;
        var match;
        if (!input || !/^https?:\/\//i.test(input)) return null;
        try { url = document.createElement('a'); url.href = input; } catch (e) { return null; }
        var host = String(url.hostname || '').toLowerCase();
        var path = String(url.pathname || '');
        var query = String(url.search || '');
        if ((host === 'rutube.ru' || host === 'www.rutube.ru') &&
                (match = path.match(/\/(?:video|play\/embed)\/([a-zA-Z0-9-]{6,})/))) {
            return { name: 'RUTUBE', src: 'https://rutube.ru/play/embed/' + encodeURIComponent(match[1]) };
        }
        if ((host === 'vkvideo.ru' || host === 'www.vkvideo.ru' || host === 'vk.com' || host === 'www.vk.com') &&
                /video_ext\.php$/i.test(path)) {
            var oid = (query.match(/[?&]oid=(-?\d+)/) || [])[1];
            var id = (query.match(/[?&]id=(\d+)/) || [])[1];
            var hash = (query.match(/[?&]hash=([a-zA-Z0-9_-]+)/) || [])[1];
            var hd = (query.match(/[?&]hd=(\d+)/) || [])[1];
            if (oid && id && hash) {
                return { name: 'VK Видео', src: 'https://vkvideo.ru/video_ext.php?oid=' +
                    encodeURIComponent(oid) + '&id=' + encodeURIComponent(id) +
                    '&hash=' + encodeURIComponent(hash) + (hd ? '&hd=' + encodeURIComponent(hd) : '') };
            }
        }
        return null;
    }

    function openTestScreen() {
        if (!window.Lampa || !Lampa.Activity || !Lampa.Component) return;
        Lampa.Activity.push({ url: '', component: COMPONENT, title: 'Lampa Rescue — тест плееров', page: 1 });
    }

    function init() {
        if (!window.Lampa || !Lampa.Listener || !window.jQuery || !Lampa.Component || !Lampa.Activity) return;
        if (!Lampa.Component.get || !Lampa.Component.get(COMPONENT)) {
            Lampa.Component.add(COMPONENT, function () {
                var self = this;
                self.container = jQuery('<div class="lr-host-test" style="padding:2em;color:#fff;"></div>');
                self.create = function () {
                    self.container.html(
                        '<div style="font-size:1.5em;margin-bottom:.5em;">Тест встроенных плееров</div>' +
                        '<div style="opacity:.8;margin-bottom:1em;">Lampa Rescue ' + VERSION +
                        '. Вставь ссылку на публичное видео RUTUBE или VK Видео.</div>' +
                        '<input class="lr-host-url" type="text" placeholder="Ссылка на видео" ' +
                        'style="width:95%;padding:.8em;font-size:1em;color:#111;background:#fff;" />' +
                        '<div style="margin:1em 0;opacity:.8;">Для VK нужна ссылка video_ext.php с параметрами oid, id и hash. Обычная ссылка на ролик пока не поддерживается.</div>' +
                        '<div class="lr-host-error" style="color:#ffb4a9;margin:.5em 0;"></div>' +
                        '<div class="lr-host-player" style="width:100%;"></div>'
                    );
                    self.container.find('.lr-host-url').on('keydown', function (e) {
                        if (e.keyCode === 13) self.tryPlay();
                    });
                    self.container.find('.lr-host-url').on('hover:enter', function () {
                        if (Lampa.Input && Lampa.Input.edit) Lampa.Input.edit({
                            title: 'Ссылка на публичное видео',
                            value: jQuery(this).val(),
                            free: true,
                            nomask: true,
                            onBack: function () {},
                            onSelect: function (value) {
                                jQuery('.lr-host-url').val(value);
                            }
                        });
                    });
                    self.container.find('.lr-host-url').addClass('selector');
                    self.container.append('<div class="selector lr-host-open" style="margin-top:1em;padding:1em;background:rgba(255,255,255,.12);">Открыть встроенный плеер</div>');
                    self.container.find('.lr-host-open').on('hover:enter', function () { self.tryPlay(); });
                    return self.render();
                };
                self.render = function () { return self.container; };
                self.tryPlay = function () {
                    var parsed = parseHostUrl(self.container.find('.lr-host-url').val());
                    var frame;
                    if (!parsed) {
                        self.container.find('.lr-host-error').text('Ссылка не распознана. Нужна ссылка на видео RUTUBE или VK video_ext.php с oid, id и hash.');
                        self.container.find('.lr-host-player').empty();
                        return;
                    }
                    self.container.find('.lr-host-error').text('Проверка встраивания: ' + parsed.name + '. Если плеер не появится, это может быть ограничение старого WebView или самого сервиса.');
                    frame = jQuery('<iframe title="Тест видеоплеера" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen="allowfullscreen" frameborder="0" style="width:100%;height:360px;background:#000;" referrerpolicy="no-referrer"></iframe>');
                    frame.attr('src', parsed.src);
                    self.container.find('.lr-host-player').empty().append(frame);
                };
                self.destroy = function () { self.container.find('iframe').attr('src', 'about:blank'); self.container.remove(); };
                self.stop = function () {};
                self.start = function () {};
            });
        }
        Lampa.Listener.follow('full', function (event) {
            if (!event || event.type !== 'complite' || !event.data || !event.data.movie || !window.jQuery) return;
            var root = event.body || (event.object && event.object.activity && event.object.activity.render && event.object.activity.render());
            if (!root) return;
            root = jQuery(root);
            if (root.find('.view--lampa-rescue-host-test').length) return;
            var buttons = root.find('.full-start-new__buttons, .full-start__buttons').first();
            if (!buttons.length) return;
            var button = jQuery('<div class="full-start__button selector view--lampa-rescue-host-test"><span>Тест RUTUBE / VK</span></div>');
            button.on('hover:enter', openTestScreen);
            buttons.append(button);
        });
        log('Loaded', VERSION);
    }

    var tries = 0;
    var timer = setInterval(function () {
        tries++;
        if (window.Lampa && Lampa.Listener && window.jQuery && Lampa.Component && Lampa.Activity) {
            clearInterval(timer);
            init();
        } else if (tries >= 80) {
            clearInterval(timer);
            log('Lampa APIs not ready; plugin not activated');
        }
    }, 250);
})();