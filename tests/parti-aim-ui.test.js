// Nişan arayüzü (aim-ui.js, sahte DOM): atan çubuk + BIRAK (tek dokunuş, Boşluk), izleyici salt okunur, sonuç etiketi, yumruk şovu engellemez,
// yenileme konumu, ?kit=1 envanter rozetleri, yıkım temizliği, ui.js/CSS bağlantısı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../games/parti/config.js');
const Aim = require('../games/parti/aim.js');
const AimUi = require('../games/parti/aim-ui.js');

function fakeEl(tag) {
    const listeners = {};
    const node = {
        tag, className: '', children: [], style: {}, _text: '',
        appendChild(c) { node.children.push(c); return c; },
        addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
        fire(t, ev) { (listeners[t] || []).slice().forEach((f) => f(Object.assign({ preventDefault() {} }, ev || {}))); },
        count(t) { return (listeners[t] || []).length; },
        get textContent() { return node._text; },
        set textContent(v) { node._text = v; node.children = []; }
    };
    return node;
}
function fakeDoc() {
    const L = {};
    return {
        createElement: (tag) => fakeEl(tag),
        addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); },
        removeEventListener: (t, f) => { L[t] = (L[t] || []).filter((x) => x !== f); },
        listeners: L,
        key(key, repeat) { const ev = { key, repeat: !!repeat, prevented: false, preventDefault() { this.prevented = true; } }; (L.keydown || []).slice().forEach((f) => f(ev)); return ev; }
    };
}

const SEED = 4242;
const AV = { me: '🦊', p2: '🐼', p3: '🐸' };
const NAME = { me: 'Ben', p2: 'Ali', p3: 'Veli' };
let clock = 100000;

function make(extra) {
    const doc = fakeDoc();
    const acts = [];
    const ctl = AimUi.create(doc, { act: (q) => acts.push(q), nameOf: (id) => NAME[id] || id, avatarOf: (id) => AV[id], now: () => clock }, null);
    const find = (cls) => { const out = []; (function walk(n) { if (n.className && n.className.split(' ').includes(cls)) out.push(n); n.children.forEach(walk); })(ctl.el); return out[0]; };
    return Object.assign({ doc, acts, ctl, find }, extra || {});
}

const view = (by, target, startAt, over) => Object.assign({
    me: { id: 'me' }, mode: 'play',
    aim: { w: 'bow', by, target, d: 3, seed: SEED, startAt, elapsed: 0, maxMs: 3000 }
}, over || {});
const spec = () => Aim.makeAim('bow', SEED, 3);
const pct = (s) => parseFloat(s.style.left);

test('atan: çubuk etkileşimli (pt-aim-mine, BIRAK), hedefin emojisi bölgede, solda atanın emojisi; tek dokunuş göstergenin o anki konumunu gönderir ve donar; ikinci dokunuş/Boşluk yok sayılır', () => {
    clock = 100000;
    const m = make();
    m.ctl.sync(view('me', 'p2', clock - 700), clock);
    assert.ok(m.ctl.el.className.includes('pt-aim-mine'), 'atan için etkileşimli');
    assert.ok(!m.ctl.el.className.includes('hidden'));
    assert.equal(m.find('pt-aim-drop').textContent, 'BIRAK');
    assert.equal(m.find('pt-aim-tgt').textContent, '🐼', 'bölgede hedefin avatar emojisi');
    assert.equal(m.find('pt-aim-att').textContent, '🦊');
    assert.match(m.find('pt-aim-title').textContent, /Ali — hedefte BIRAK/);
    const sp = spec();
    const z = m.find('pt-aim-zone');
    assert.ok(Math.abs(parseFloat(z.style.left) - (sp.c - sp.half) * 100) < 1e-9);
    assert.ok(Math.abs(parseFloat(z.style.width) - sp.half * 200) < 1e-9);
    assert.ok(Math.abs(pct(m.find('pt-aim-ind')) - Aim.indicatorAt(sp, 700) * 100) < 1e-9, 'gösterge konumu = indicatorAt');
    // dokunuş (çubuğun herhangi bir yeri): q = o anki gösterge
    m.find('pt-aim-track').fire('pointerdown', {});
    assert.equal(m.acts.length, 1);
    assert.equal(m.acts[0], Math.round(Aim.indicatorAt(sp, 700) * 1000));
    assert.ok(m.ctl.el.className.includes('pt-aim-mine') === false, 'bıraktıktan sonra etkileşim kapanır');
    assert.equal(m.find('pt-aim-drop').textContent === 'BIRAK', false);
    // donmuş: zaman akıp gitse de gösterge bırakılan yerde
    clock += 400;
    m.ctl.sync(view('me', 'p2', clock - 1100), clock);
    assert.ok(Math.abs(pct(m.find('pt-aim-ind')) - m.acts[0] / 10) < 1e-9, 'gösterge dondu');
    m.find('pt-aim-track').fire('pointerdown', {});
    m.find('pt-aim-drop').fire('pointerdown', {});
    m.doc.key(' ');
    assert.equal(m.acts.length, 1, 'tek dokunuş: ikinci bırakma yok');
});

test('çubuk göründükten ilk AIM_MIN_MS (250 ms) dokunuş/Boşluk YOK SAYILIR (gösterge donmaz, mesaj gitmez); 250 ms sonra bırakır', () => {
    clock = 100000;
    const m = make();
    m.ctl.sync(view('me', 'p2', clock - 100), clock);                       // çubuğun 100. ms'si
    assert.ok(m.find('pt-aim-track').className.includes('pt-aim-wait'), 'hazırlanıyor göstergesi (soluk)');
    m.find('pt-aim-track').fire('pointerdown', {});
    m.find('pt-aim-drop').fire('pointerdown', {});
    m.doc.key(' ');
    assert.equal(m.acts.length, 0, 'erken dokunuş mesaj göndermez');
    assert.ok(m.ctl._state().tapped === null, 'gösterge donmadı');
    assert.ok(m.ctl.el.className.includes('pt-aim-mine'), 'atıcı kilitlenmedi');
    clock += 100;
    m.ctl.sync(view('me', 'p2', clock - 200), clock);                       // 200 ms: hâlâ erken
    m.find('pt-aim-track').fire('pointerdown', {});
    assert.equal(m.acts.length, 0);
    clock += 60;
    m.ctl.sync(view('me', 'p2', clock - 260), clock);                       // 260 ms: hazır
    assert.ok(!m.find('pt-aim-track').className.includes('pt-aim-wait'));
    m.find('pt-aim-track').fire('pointerdown', {});
    assert.equal(m.acts.length, 1, 'AIM_MIN_MS sonra bırakır');
    assert.equal(m.acts[0], Math.round(Aim.indicatorAt(spec(), 260) * 1000));
});

test('Boşluk tuşu bırakır (repeat yok sayılır; atan değilken/basılı tutarken etkisiz)', () => {
    clock = 100000;
    const m = make();
    const ev0 = m.doc.key(' ');
    assert.equal(ev0.prevented, false, 'canlı nişan yokken Boşluk\'a karışmaz');
    m.ctl.sync(view('me', 'p3', clock - 500), clock);
    const rep = m.doc.key(' ', true);
    assert.equal(rep.prevented, true, 'sayfa kaymaz');
    assert.equal(m.acts.length, 0, 'repeat bırakmaz');
    m.doc.key(' ');
    assert.equal(m.acts.length, 1);
    assert.equal(m.acts[0], Math.round(Aim.indicatorAt(Aim.makeAim('bow', SEED, 3), 500) * 1000));
    m.doc.key(' ');
    assert.equal(m.acts.length, 1);
});

test('izleyici/hedef: salt okunur (etkileşim yok, dokunuş act göndermez), başlık "Ali → Veli nişan alıyor", gösterge yine çizilir', () => {
    clock = 100000;
    const m = make();
    m.ctl.sync(view('p2', 'p3', clock - 900), clock);
    assert.ok(!m.ctl.el.className.includes('pt-aim-mine'));
    assert.ok(!m.ctl.el.className.includes('hidden'));
    assert.equal(m.find('pt-aim-title').textContent, '🏹 🐼 Ali → Veli nişan alıyor'.replace('🐼 ', ''), 'başlık adlarla');
    assert.equal(m.find('pt-aim-tgt').textContent, '🐸');
    assert.equal(m.find('pt-aim-att').textContent, '🐼');
    assert.ok(Math.abs(pct(m.find('pt-aim-ind')) - Aim.indicatorAt(spec(), 900) * 100) < 1e-9);
    m.find('pt-aim-track').fire('pointerdown', {});
    m.doc.key(' ');
    assert.equal(m.acts.length, 0);
    // izleyici modu (oturum dışı) ve atan olsa bile modu 'spectator' ise etkileşim yok
    const sp2 = make();
    sp2.ctl.sync(view('me', 'p2', clock - 500, { mode: 'spectator' }), clock);
    assert.ok(!sp2.ctl.el.className.includes('pt-aim-mine'));
});

test('süre dolunca (maxMs) atan için etkileşim kapanır ("Süre doldu"), gösterge son konumda; yenileyen/geç katılan doğru konumla açılır', () => {
    clock = 100000;
    const m = make();
    m.ctl.sync(view('me', 'p2', clock - 3200), clock);
    assert.ok(!m.ctl.el.className.includes('pt-aim-mine'));
    assert.equal(m.find('pt-aim-drop').textContent, 'Süre doldu');
    assert.ok(Math.abs(pct(m.find('pt-aim-ind')) - Aim.indicatorAt(spec(), 3000) * 100) < 1e-9, 'son konumda donuk');
    m.find('pt-aim-track').fire('pointerdown', {});
    assert.equal(m.acts.length, 0);
    // yenileme: aim durumu 1500 ms önce başlamış -> gösterge o konumda, atan etkileşimli
    const r = make();
    r.ctl.sync(view('me', 'p2', clock - 1500), clock);
    assert.ok(Math.abs(pct(r.find('pt-aim-ind')) - Aim.indicatorAt(spec(), 1500) * 100) < 1e-9);
    assert.ok(r.ctl.el.className.includes('pt-aim-mine'));
    // geç katılan izleyici
    const g = make();
    g.ctl.sync(view('p2', 'p3', clock - 2200, { mode: 'spectator' }), clock);
    assert.ok(Math.abs(pct(g.find('pt-aim-ind')) - Aim.indicatorAt(spec(), 2200) * 100) < 1e-9);
});

test('sonuç etiketi ~1.4 sn: tam isabet / isabet / kıl payı / ıska; gösterge bırakılan q\'da donuk; süre sonra gizlenir', () => {
    const cases = [['merkez', 50, '🎯 Tam isabet! −50'], ['bolge', 30, 'İsabet −30'], ['kenar', 15, 'Kıl payı −15'], ['iska', 0, 'Iska!']];
    cases.forEach(([tier, dmg, text]) => {
        clock = 100000;
        const m = make();
        m.ctl.sync(view('p2', 'p3', clock - 800), clock);
        m.ctl.result({ t: 'aimres', id: 'p2', w: 'bow', tier, q: tier === 'iska' ? -1 : 420, target: 'p3', dmg }, clock);
        m.ctl.sync({ me: { id: 'me' }, mode: 'play', aim: null }, clock + 10);
        assert.equal(m.find('pt-aim-res').textContent, text, tier);
        assert.ok(!m.ctl.el.className.includes('hidden'), 'etiket görünür');
        assert.ok(!m.ctl.el.className.includes('pt-aim-mine'), 'sonuç etiketi hiçbir şeyi engellemez');
        if (tier !== 'iska') assert.ok(Math.abs(pct(m.find('pt-aim-ind')) - 42) < 1e-9, 'donuk q');
        m.ctl.sync({ me: { id: 'me' }, mode: 'play', aim: null }, clock + C.AIM_RESULT_MS - 5);
        assert.ok(!m.ctl.el.className.includes('hidden'), 'hâlâ görünür');
        m.ctl.sync({ me: { id: 'me' }, mode: 'play', aim: null }, clock + C.AIM_RESULT_MS + 5);
        assert.ok(m.ctl.el.className.includes('hidden'), '1.4 sn sonra gizli');
    });
    assert.equal(C.AIM_RESULT_MS, 1400);
});

test('yumruk şovu (garanti): kısa 👊 etiketi, çubuk yok, etkileşimsiz (pointer-events none) -> UI/zar düğmesini ENGELLEMEZ; 0,9 sn sonra gizli', () => {
    clock = 100000;
    const m = make();
    m.ctl.result({ t: 'aimres', id: 'me', w: 'fist', tier: 'garanti', q: -1, target: 'p2', dmg: 100 }, clock);
    m.ctl.sync({ me: { id: 'me' }, mode: 'play', aim: null }, clock + 20);
    assert.ok(!m.ctl.el.className.includes('hidden'));
    assert.ok(m.ctl.el.className.includes('pt-aim-show'));
    assert.ok(!m.ctl.el.className.includes('pt-aim-mine'), 'şov etkileşim yakalamaz');
    assert.match(m.find('pt-aim-res').textContent, /^👊 −100$/);
    assert.equal(m.find('pt-aim-row').style.display, 'none', 'çubuk yok');
    m.find('pt-aim-track').fire('pointerdown', {});
    assert.equal(m.acts.length, 0);
    m.ctl.sync({ me: { id: 'me' }, mode: 'play', aim: null }, clock + C.WEAPONS.fist.skill.ms + 20);
    assert.ok(m.ctl.el.className.includes('hidden'));
    assert.equal(C.WEAPONS.fist.skill.ms, 900);
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    assert.ok(/\.pt-aim \{[^}]*pointer-events: none/.test(css), 'varsayılan pointer-events: none');
    assert.ok(/\.pt-aim\.pt-aim-mine \{ pointer-events: auto/.test(css), 'yalnız atan çubuğu yakalar');
});

test('?kit=1 envanteri (her silahtan 3, kalkan 1) rozetleri tutarlı: sıra WEAPON_IDS, ×3 yalnız >1, kalkan etiketi sade, NaN/undefined yok', () => {
    const kit = { fist: 3, shotgun: 3, bow: 3, bomb: 3, shield: 1 };
    const list = AimUi.invList(C, { w: kit });
    assert.deepEqual(list.map((e) => e[0]), C.WEAPON_IDS);
    const labels = list.map((e) => AimUi.chipLabel(C, e[0], e[1]));
    assert.deepEqual(labels, ['👊 ×3', '🔫 ×3', '🏹 ×3', '💣 ×3', '🛡️']);
    labels.forEach((l) => assert.ok(!/NaN|undefined/.test(l)));
    assert.deepEqual(AimUi.invList(C, { w: {} }), []);
    assert.deepEqual(AimUi.invList(C, { w: { bow: 1, yok: 4 } }), [['bow', 1]], 'bilinmeyen anahtar yok sayılır');
    assert.equal(AimUi.chipLabel(C, 'bow', 1), '🏹');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'games', 'parti', 'ui.js'), 'utf8');
    assert.ok(/function invList\(p\) \{ return PartiAimUi\.invList\(C, p\); \}/.test(ui), 'ui.js rozetleri aim-ui.js ile paylaşır');
});

test('yıkım: dinleyiciler bırakılır, sonrası dokunuş/Boşluk/sync/result etkisiz', () => {
    clock = 100000;
    const m = make();
    m.ctl.sync(view('me', 'p2', clock - 600), clock);
    const track = m.find('pt-aim-track');
    assert.equal(track.count('pointerdown'), 1);
    assert.equal(m.doc.listeners.keydown.length, 1);
    m.ctl.destroy();
    assert.equal(track.count('pointerdown'), 0);
    assert.equal(m.doc.listeners.keydown.length, 0);
    m.doc.key(' ');
    m.ctl.sync(view('me', 'p2', clock - 600), clock);
    m.ctl.result({ t: 'aimres', id: 'me', w: 'bow', tier: 'bolge', q: 1, target: 'p2', dmg: 30 }, clock);
    assert.equal(m.acts.length, 0);
});

test('ui.js bağlantısı: kalıcı düğüm, kare başına sync, aimres -> result, nişan ipucu/üst çubuk, yıkımda temizlik; index.html betik sırası; CSS', () => {
    const root = path.join(__dirname, '..');
    const ui = fs.readFileSync(path.join(root, 'games', 'parti', 'ui.js'), 'utf8');
    assert.ok(/PartiAimUi\.create\(document,/.test(ui) && /els\.root\.appendChild\(aimCtl\.el\)/.test(ui), 'kalıcı düğüm (overlay yeniden çizilmez)');
    assert.ok(/aimCtl\.sync\(view, Date\.now\(\)\)/.test(ui));
    assert.ok(/e\.t === 'aimres' && aimCtl\) aimCtl\.result\(e, Date\.now\(\)\)/.test(ui));
    assert.ok(/act\(\{ type: 'aim', q: q \}\)/.test(ui));
    assert.ok(/g\.stage === 'aim'/.test(ui));
    assert.ok(/if \(aimCtl\) aimCtl\.destroy\(\)/.test(ui));
    assert.ok(/kit: PartiRules\.parseKitFlag\(location\.search\)/.test(ui));
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const at = (s) => html.indexOf(s);
    assert.ok(at('parti/aim.js') > at('parti/config.js') && at('parti/aim.js') < at('parti/aim-ui.js') && at('parti/aim-ui.js') < at('parti/ui.js') && at('parti/aim.js') < at('parti/rules.js'));
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    ['.pt-aim-track', '.pt-aim-zone', '.pt-aim-ind', '.pt-aim-drop', '.pt-aim-res'].forEach((c) => assert.ok(css.includes(c), c));
    assert.ok(/\.pt-aim-track[^}]*touch-action: none/.test(css), 'dokunmatik: tek dokunuş, kaydırma yok');
});
