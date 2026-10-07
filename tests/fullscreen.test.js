// Genel tam ekran yardımcısı: mod seçimi (saf) + sahte doc/win/target ile giriş-çıkış, yatay kilit, dış çıkış eşitleme, sahte mod.
const test = require('node:test');
const assert = require('node:assert/strict');
const FS = require('../core/fullscreen.js');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

// Sahte tarayıcı: doc (fullscreenElement, olaylar), target (requestFullscreen isteğe bağlı), win (navigator, matchMedia, screen.orientation)
function env(opts) {
    opts = opts || {};
    const listeners = { doc: {}, win: {} };
    const classes = new Set();
    const calls = { lock: [], unlock: 0, request: [], exit: 0, scroll: 0 };
    const doc = {
        fullscreenElement: null,
        documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } },
        addEventListener: (t, f) => { (listeners.doc[t] = listeners.doc[t] || []).push(f); },
        removeEventListener: (t, f) => { listeners.doc[t] = (listeners.doc[t] || []).filter((x) => x !== f); },
        exitFullscreen: () => { calls.exit++; doc.fullscreenElement = null; fire('fullscreenchange'); return Promise.resolve(); }
    };
    function fire(type) { (listeners.doc[type] || []).slice().forEach((f) => f()); }
    const target = {};
    if (opts.native !== false) {
        target.requestFullscreen = (o) => {
            calls.request.push(o);
            if (opts.requestFails) return Promise.reject(new Error('izin yok'));
            doc.fullscreenElement = target;
            fire('fullscreenchange');
            return Promise.resolve();
        };
    }
    const orientation = opts.noOrientation ? undefined : {
        lock: (v) => { calls.lock.push(v); return opts.lockFails ? Promise.reject(new Error('desteklenmiyor')) : Promise.resolve(); },
        unlock: () => { calls.unlock++; }
    };
    const win = {
        navigator: { userAgent: opts.ua || ANDROID, standalone: opts.iosStandalone, maxTouchPoints: opts.touch === false ? 0 : 5 },
        matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? opts.touch !== false : (opts.displayMode ? q === '(display-mode: ' + opts.displayMode + ')' : false) }),
        screen: { orientation },
        scrollTo: () => { calls.scroll++; },
        addEventListener: () => {}, removeEventListener: () => {}
    };
    return { doc, win, target, classes, calls, fire };
}

test('detect: iPhone sahte, Android native, masaüstü yok, ana ekran uygulaması standalone, API yoksa none', () => {
    assert.equal(FS.detect({ ua: IPHONE, hasNative: false, standalone: false, touch: true }), 'fake');
    assert.equal(FS.detect({ ua: IPHONE, hasNative: true, standalone: false, touch: true }), 'fake', 'iPhone her zaman sahte');
    assert.equal(FS.detect({ ua: ANDROID, hasNative: true, standalone: false, touch: true }), 'native');
    assert.equal(FS.detect({ ua: ANDROID, hasNative: false, standalone: false, touch: true }), 'none');
    assert.equal(FS.detect({ ua: DESKTOP, hasNative: true, standalone: false, touch: false }), 'none', 'dokunmatik değil');
    assert.equal(FS.detect({ ua: IPHONE, hasNative: false, standalone: true, touch: true }), 'standalone');
    assert.equal(FS.detect({ ua: ANDROID, hasNative: true, standalone: true, touch: true }), 'standalone');
    assert.equal(FS.detect(null), 'none');
    assert.equal(FS.detect({}), 'none');
});

test('mod okuma: Android native; iPhone fake; iOS standalone; display-mode standalone; masaüstü none', () => {
    const a = env();
    assert.equal(FS.create({ target: a.target, doc: a.doc, win: a.win }).mode(), 'native');
    const i = env({ ua: IPHONE, native: false });
    assert.equal(FS.create({ target: i.target, doc: i.doc, win: i.win }).mode(), 'fake');
    const s = env({ ua: IPHONE, native: false, iosStandalone: true });
    assert.equal(FS.create({ target: s.target, doc: s.doc, win: s.win }).mode(), 'standalone');
    const d = env({ displayMode: 'fullscreen' });
    assert.equal(FS.create({ target: d.target, doc: d.doc, win: d.win }).mode(), 'standalone');
    const m = env({ ua: DESKTOP, touch: false });
    const fm = FS.create({ target: m.target, doc: m.doc, win: m.win });
    assert.equal(fm.mode(), 'none');
    assert.equal(fm.supported(), false);
});

test('native: giriş tam ekran + yatay kilit, sınıf eklenir, onChange; çıkışta kilit açılır', async () => {
    const e = env();
    const changes = [];
    const fs = FS.create({ target: e.target, doc: e.doc, win: e.win, onChange: (a) => changes.push(a) });
    assert.equal(fs.supported(), true);
    assert.equal(fs.isActive(), false);
    assert.equal(await fs.enter(), true);
    assert.deepEqual(e.calls.request, [{ navigationUI: 'hide' }]);
    assert.deepEqual(e.calls.lock, ['landscape']);
    assert.equal(fs.isActive(), true);
    assert.ok(e.classes.has('fs-active'));
    assert.ok(!e.classes.has('fs-fake'), 'native modda sahte sınıf yok');
    assert.deepEqual(changes, [true]);
    assert.equal(await fs.exit(), false);
    assert.equal(e.calls.unlock, 1);
    assert.equal(e.calls.exit, 1);
    assert.equal(fs.isActive(), false);
    assert.ok(!e.classes.has('fs-active'));
    assert.deepEqual(changes, [true, false]);
});

test('native: yatay kilit hata verirse ya da yoksa sessizce sürer; istek reddedilirse false', async () => {
    const f = env({ lockFails: true });
    const a = FS.create({ target: f.target, doc: f.doc, win: f.win });
    assert.equal(await a.enter(), true);
    const g = env({ noOrientation: true });
    const b = FS.create({ target: g.target, doc: g.doc, win: g.win });
    assert.equal(await b.enter(), true);
    assert.equal(g.calls.lock.length, 0);
    const h = env({ requestFails: true });
    const changes = [];
    const c = FS.create({ target: h.target, doc: h.doc, win: h.win, onChange: (x) => changes.push(x) });
    assert.equal(await c.enter(), false);
    assert.equal(c.isActive(), false);
    assert.ok(!h.classes.has('fs-active'));
    assert.deepEqual(changes, []);
});

test('native: kullanıcı geri hareketiyle çıkarsa durum eşitlenir; toggle iki yönlü', async () => {
    const e = env();
    const changes = [];
    const fs = FS.create({ target: e.target, doc: e.doc, win: e.win, onChange: (a) => changes.push(a) });
    await fs.toggle();
    assert.equal(fs.isActive(), true);
    e.doc.fullscreenElement = null;            // sistem çıkardı (geri hareketi / Esc)
    e.fire('fullscreenchange');
    assert.equal(fs.isActive(), false);
    assert.ok(!e.classes.has('fs-active'));
    assert.deepEqual(changes, [true, false]);
    assert.equal(await fs.toggle(), true);
    assert.equal(await fs.toggle(), false);
    assert.deepEqual(changes, [true, false, true, false]);
    assert.equal(await fs.enter(), true);
    assert.equal(await fs.enter(), true, 'zaten etkinken tekrar istek yok');
    assert.equal(e.calls.request.length, 3);
});

test('fake (iPhone): sınıflar, onChange, ilk girişte ipucu bir kez; çıkışta temizlenir', async () => {
    const e = env({ ua: IPHONE, native: false });
    const changes = [];
    const fs = FS.create({ target: e.target, doc: e.doc, win: e.win, onChange: (a) => changes.push(a) });
    assert.equal(fs.mode(), 'fake');
    assert.equal(fs.supported(), true);
    assert.equal(await fs.enter(), true);
    assert.ok(e.classes.has('fs-active') && e.classes.has('fs-fake'));
    assert.equal(e.calls.scroll, 1);
    assert.equal(e.calls.request.length, 0, 'Fullscreen API çağrılmaz');
    assert.equal(e.calls.lock.length, 0);
    assert.equal(fs.hint(), FS.HINT_TEXT);
    assert.equal(fs.hint(), '', 'ipucu yalnız bir kez');
    assert.equal(await fs.toggle(), false);
    assert.ok(!e.classes.has('fs-active') && !e.classes.has('fs-fake'));
    assert.deepEqual(changes, [true, false]);
});

test('standalone/none: giriş yapmaz, ipucu yok', async () => {
    const s = env({ ua: IPHONE, native: false, iosStandalone: true });
    const fs = FS.create({ target: s.target, doc: s.doc, win: s.win });
    assert.equal(fs.supported(), false);
    assert.equal(await fs.enter(), false);
    assert.equal(fs.hint(), '');
    assert.ok(!s.classes.has('fs-active'));
});

test('destroy: etkinken çıkar, dinleyiciler bırakılır, sonraki olaylar etkisiz', async () => {
    const e = env();
    const changes = [];
    const fs = FS.create({ target: e.target, doc: e.doc, win: e.win, onChange: (a) => changes.push(a) });
    await fs.enter();
    fs.destroy();
    assert.equal(e.calls.exit, 1);
    assert.equal(e.calls.unlock, 1);
    assert.ok(!e.classes.has('fs-active'));
    const before = changes.length;
    e.fire('fullscreenchange');
    assert.equal(changes.length, before, 'dinleyici kalmadı');
    assert.equal(await fs.enter(), false, 'yıkılmış denetleyici giriş yapmaz');
    const f = env({ ua: IPHONE, native: false });
    const g = FS.create({ target: f.target, doc: f.doc, win: f.win });
    await g.enter();
    g.destroy();
    assert.ok(!f.classes.has('fs-active') && !f.classes.has('fs-fake'));
});
