// Genel tam ekran yardımcısı (oyuna özgü kod yok; DOM'a yalnızca enjekte edilen doc/win/target üzerinden dokunur, Node'da test edilir).
//
//   var fs = Fullscreen.create({ target, doc?, win?, onChange(active)? });
//   fs.mode()      'native'     Fullscreen API var (Android Chrome vb.): gerçek tam ekran + yatay kilit (varsa)
//                  'fake'       iPhone/iPod Safari (element tam ekranı yok): sayfayı pencerenin tamamına yayan "sahte tam ekran"
//                  'standalone' ana ekrandan açılmış uygulama: zaten tam ekran (düğme gerekmez)
//                  'none'       dokunmatik değil ya da destek yok (düğme gösterilmez)
//   fs.supported() mode 'native' ya da 'fake'
//   fs.isActive(), fs.enter(), fs.exit(), fs.toggle()   (hepsi Promise<boolean> = etkin mi; toggle/enter kullanıcı dokunuşundan çağrılmalı)
//   fs.hint()      sahte modda ilk girişte kullanıcıya gösterilecek ipucu metni, yoksa ''
//   fs.destroy()   dinleyicileri bırakır, etkinse çıkar
//
// Etkinken <html> öğesine `fs-active` (her iki mod) ve `fs-fake` (yalnız sahte mod) sınıfları eklenir; düzen CSS'te (style.css).
// iPhone'da adres çubuğu koddan gizlenemez: sahte mod yalnızca alanı en çok açar; tam ekran için "Ana Ekrana Ekle" önerilir.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Fullscreen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var ACTIVE_CLASS = 'fs-active';
    var FAKE_CLASS = 'fs-fake';
    var HINT_TEXT = 'iPhone\'da adres çubuğunu gizlemek için Paylaş → "Ana Ekrana Ekle" ile aç.';

    // Saf: env = { ua, hasNative, standalone, touch } -> 'native' | 'fake' | 'standalone' | 'none'
    function detect(env) {
        if (!env) return 'none';
        if (env.standalone) return 'standalone';
        if (!env.touch) return 'none';
        if (/iPhone|iPod/i.test(env.ua || '')) return 'fake';
        return env.hasNative ? 'native' : 'none';
    }

    function readEnv(doc, win, target) {
        var nav = (win && win.navigator) || {};
        function mq(q) { try { return !!(win && win.matchMedia && win.matchMedia(q).matches); } catch (e) { return false; } }
        return {
            ua: nav.userAgent || '',
            hasNative: !!(target && (target.requestFullscreen || target.webkitRequestFullscreen)),
            standalone: nav.standalone === true || mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)'),
            touch: mq('(pointer: coarse)') || (nav.maxTouchPoints || 0) > 0
        };
    }

    function create(options) {
        var target = options.target;
        var doc = options.doc || (typeof document !== 'undefined' ? document : null);
        var win = options.win || (typeof window !== 'undefined' ? window : null);
        var onChange = options.onChange || function () {};
        var mode = detect(readEnv(doc, win, target));
        var fakeOn = false;
        var hinted = false;
        var last = false;
        var destroyed = false;
        var cleanups = [];

        function html() { return doc && doc.documentElement; }
        function nativeEl() { return doc ? (doc.fullscreenElement || doc.webkitFullscreenElement || null) : null; }
        function isActive() { return mode === 'native' ? nativeEl() === target : (mode === 'fake' ? fakeOn : false); }

        function setClasses(on) {
            var h = html();
            if (!h || !h.classList) return;
            if (on) h.classList.add(ACTIVE_CLASS); else h.classList.remove(ACTIVE_CLASS);
            if (mode === 'fake') { if (on) h.classList.add(FAKE_CLASS); else h.classList.remove(FAKE_CLASS); }
        }

        function sync() {
            if (destroyed) return;
            var now = isActive();
            setClasses(now);
            if (now !== last) { last = now; onChange(now); }
        }

        function listen(t, type, fn) {
            if (!t || !t.addEventListener) return;
            t.addEventListener(type, fn);
            cleanups.push(function () { t.removeEventListener(type, fn); });
        }

        if (mode === 'native') {
            listen(doc, 'fullscreenchange', sync);
            listen(doc, 'webkitfullscreenchange', sync);
        }

        function lockOrientation() {
            try {
                var so = win && win.screen && win.screen.orientation;
                if (so && so.lock) {
                    var p = so.lock('landscape');
                    if (p && p.catch) p.catch(function () { /* destek yok / izin yok: sessiz */ });
                }
            } catch (e) { /* sessiz */ }
        }

        function unlockOrientation() {
            try {
                var so = win && win.screen && win.screen.orientation;
                if (so && so.unlock) so.unlock();
            } catch (e) { /* sessiz */ }
        }

        function enter() {
            if (destroyed || !target) return Promise.resolve(false);
            if (isActive()) return Promise.resolve(true);
            if (mode === 'fake') {
                fakeOn = true;
                if (win && win.scrollTo) { try { win.scrollTo(0, 0); } catch (e) { /* sessiz */ } }
                sync();
                return Promise.resolve(true);
            }
            if (mode !== 'native') return Promise.resolve(false);
            var req = target.requestFullscreen || target.webkitRequestFullscreen;
            var p;
            try { p = req.call(target, { navigationUI: 'hide' }); } catch (e) { return Promise.resolve(false); }
            return Promise.resolve(p).then(function () {
                lockOrientation();
                sync();
                return isActive();
            }, function () { return false; });
        }

        function exit() {
            if (destroyed) return Promise.resolve(false);
            if (mode === 'fake') {
                fakeOn = false;
                sync();
                return Promise.resolve(false);
            }
            if (mode !== 'native' || !isActive()) return Promise.resolve(false);
            unlockOrientation();
            var ex = doc.exitFullscreen || doc.webkitExitFullscreen;
            var p;
            try { p = ex ? ex.call(doc) : null; } catch (e) { p = null; }
            return Promise.resolve(p).then(function () { sync(); return isActive(); }, function () { sync(); return isActive(); });
        }

        function toggle() { return isActive() ? exit() : enter(); }

        function hint() {
            if (mode !== 'fake' || hinted) return '';
            hinted = true;
            return HINT_TEXT;
        }

        function destroy() {
            if (destroyed) return;
            if (isActive()) {
                if (mode === 'fake') { fakeOn = false; setClasses(false); } else { unlockOrientation(); var ex = doc.exitFullscreen || doc.webkitExitFullscreen; try { if (ex) ex.call(doc); } catch (e) { /* sessiz */ } setClasses(false); }
            }
            destroyed = true;
            cleanups.forEach(function (c) { c(); });
            cleanups = [];
        }

        return {
            mode: function () { return mode; },
            supported: function () { return mode === 'native' || mode === 'fake'; },
            isActive: isActive, enter: enter, exit: exit, toggle: toggle, hint: hint, destroy: destroy
        };
    }

    return { create: create, detect: detect, ACTIVE_CLASS: ACTIVE_CLASS, FAKE_CLASS: FAKE_CLASS, HINT_TEXT: HINT_TEXT };
});
