// Düşen Zemin arayüzü: joystick (ölü bölge/histerezis), klavye, çoklu dokunma (joystick + düğme aynı anda), çizim sahte 2D bağlamla,
// yıkım temizliği, ui.js/index.html/CSS bağlantısı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../games/parti/mini/dusenzemin-rules.js');
const Ui = require('../games/parti/mini/dusenzemin-ui.js');
const Emoji = require('../core/emoji.js');
const Session = require('../games/parti/mini/dusenzemin-session.js');

test('joyVector: ölü bölge, yumuşak artış, yarıçapta 1, histerezis (aktifken daha küçük eşikte bırakır)', () => {
    const R = 60;
    assert.deepEqual(Ui.joyVector(0, 0, R, false), { mx: 0, my: 0, active: false });
    assert.equal(Ui.joyVector(R * 0.1, 0, R, false).active, false, 'ölü bölge içinde');
    const small = Ui.joyVector(R * 0.3, 0, R, false);
    assert.equal(small.active, true);
    assert.ok(small.mx > 0 && small.mx < 0.3, 'yumuşak başlangıç: ' + small.mx);
    const full = Ui.joyVector(R, 0, R, false);
    assert.ok(Math.abs(full.mx - 1) < 1e-9 && full.my === 0);
    const far = Ui.joyVector(R * 3, 0, R, false);
    assert.ok(Math.abs(Math.hypot(far.mx, far.my) - 1) < 1e-9, 'yarıçap dışında birim vektör');
    const diag = Ui.joyVector(R, R, R, false);
    assert.ok(Math.abs(Math.hypot(diag.mx, diag.my) - 1) < 1e-9);
    assert.ok(Math.abs(diag.mx - diag.my) < 1e-9);
    // histerezis: 0.15 oranı, aktif değilken ölü bölge (0.18) içinde -> pasif; aktifken (0.12 eşik) -> aktif kalır
    assert.equal(Ui.joyVector(R * 0.15, 0, R, false).active, false);
    assert.equal(Ui.joyVector(R * 0.15, 0, R, true).active, true);
    assert.equal(Ui.joyVector(R * 0.1, 0, R, true).active, false);
    assert.deepEqual(Ui.joyVector(5, 5, 0, false), { mx: 0, my: 0, active: false }, 'sıfır yarıçap güvenli');
});

test('klavye: WASD/oklar yön, Boşluk zıpla, E/Shift it; çapraz normalize; ilgisiz tuş yok', () => {
    assert.deepEqual(Ui.keyDir('w'), [0, -1]);
    assert.deepEqual(Ui.keyDir('ArrowLeft'), [-1, 0]);
    assert.equal(Ui.keyDir('x'), null);
    assert.equal(Ui.keyDir('toString'), null, 'prototip anahtarı değil');
    assert.equal(Ui.keyAction(' '), 'jump');
    assert.equal(Ui.keyAction('e'), 'push');
    assert.equal(Ui.keyAction('E'), 'push');
    assert.equal(Ui.keyAction('Shift'), 'push');
    assert.equal(Ui.keyAction('q'), null);
    const v = Ui.keysVector({ w: true, d: true });
    assert.ok(Math.abs(Math.hypot(v.mx, v.my) - 1) < 1e-9);
    assert.deepEqual(Ui.keysVector({ a: true, d: true }), { mx: 0, my: 0 }, 'karşıt tuşlar birbirini siler');
    assert.deepEqual(Ui.keysVector({ w: false }), { mx: 0, my: 0 });
});

test('approach / countdownLabel / shrink', () => {
    const one = Ui.approach({ x: 0, y: 0 }, 40, 0, 100, 120);
    let two = Ui.approach({ x: 0, y: 0 }, 40, 0, 50, 120);
    two = Ui.approach(two, 40, 0, 50, 120);
    assert.ok(Math.abs(one.x - two.x) < 1e-9, 'dt bölünmesinden bağımsız');
    assert.deepEqual(Ui.approach({ x: 0, y: 0 }, 400, 0, 16, 120), { x: 400, y: 0 }, 'büyük sıçrama anında');
    assert.deepEqual(Ui.approach(undefined, 5, 6, 16, 120), { x: 5, y: 6 });
    assert.equal(Ui.countdownLabel(-3900), 'Hazır');
    assert.equal(Ui.countdownLabel(-2500), '3');
    assert.equal(Ui.countdownLabel(-1500), '2');
    assert.equal(Ui.countdownLabel(-500), '1');
    assert.equal(Ui.countdownLabel(100), 'BAŞLA!');
    assert.equal(Ui.countdownLabel(5000), '');
    assert.equal(Ui.shrink(1000, -1), 1);
    assert.equal(Ui.shrink(1000, 1000), 1);
    assert.ok(Ui.shrink(1200, 1000) < 1 && Ui.shrink(1200, 1000) > 0);
    assert.equal(Ui.shrink(5000, 1000), 0);
});

// ---- sahte DOM / bağlam ----
const ops = [];
const ctx = new Proxy({ _fill: '#000', _alpha: 1 }, {
    get(t, k) {
        if (k === 'fillStyle') return t._fill;
        if (typeof k === 'string' && !(k in t)) return (...a) => { ops.push([k, a, t._fill]); };
        return t[k];
    },
    set(t, k, v) { if (k === 'fillStyle') t._fill = v; else t[k] = v; return true; }
});
function fakeEl(tag) {
    const listeners = {};
    const node = {
        tag, className: '', children: [], style: {}, attrs: {}, _text: '', disabled: false,
        appendChild(c) { node.children.push(c); return c; },
        setAttribute(k, v) { node.attrs[k] = v; },
        addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
        fire(t, ev) { (listeners[t] || []).slice().forEach((f) => f(Object.assign({ preventDefault() {} }, ev || {}))); },
        count(t) { return (listeners[t] || []).length; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 }; },
        get textContent() { return node._text; },
        set textContent(v) { node._text = v; node.children = []; }
    };
    if (tag === 'canvas') node.getContext = () => ctx;
    return node;
}
function fakeEnv() {
    const docL = {};
    const doc = {
        createElement: (tag) => fakeEl(tag),
        addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); },
        removeEventListener: (t, f) => { docL[t] = (docL[t] || []).filter((x) => x !== f); },
        listeners: docL
    };
    const raf = { queue: [], id: 0, cancelled: [] };
    return { doc, win: { devicePixelRatio: 1 }, emoji: Emoji, raf: (f) => { raf.queue.push(f); return ++raf.id; }, caf: (id) => raf.cancelled.push(id), rafState: raf };
}

const SEED = 5;
function mount(extra) {
    let t = 100000;
    const calls = { input: [], press: [] };
    let api;
    const players = ['me', 'p2', 'bot1'];
    Session.run(Object.assign({
        type: 'ffa', game: 'dusenzemin', players, bots: ['bot1'], seed: SEED, me: { id: 'me', name: 'Ben' }, startAt: t + 4000,
        net: { send() {}, on: () => () => {} }, now: () => t, register: (a) => { api = a; }
    }, extra && extra.session));
    const realSet = api.setInput;
    const realPress = api.press;
    api.setInput = (x, y) => { calls.input.push([x, y]); return realSet(x, y); };
    api.press = (k, tt) => { calls.press.push(k); return realPress(k, tt); };
    const root = fakeEl('div');
    const env = fakeEnv();
    const ui = Ui.mount(root, api, { now: () => t, me: { id: 'me' }, names: { me: 'Ben', p2: 'Ali', bot1: 'Bot' }, avatars: { me: '🦊', p2: '🐼', bot1: '🤖' }, getEndAt: () => t + 90000 }, env);
    const box = root.children[0];
    const pad = box.children[2];
    return { api, root, env, ui, calls, box, joy: pad.children[0], jump: pad.children[1].children[0], push: pad.children[1].children[1], set: (v) => { t = v; }, get t() { return t; } };
}

test('mount: kanvas + joystick + iki düğme + HUD; çoklu dokunma: joystick tutulurken düğmeler ayrı pointerId ile çalışır', () => {
    const m = mount();
    assert.equal(m.box.className, 'pt-dz');
    assert.equal(m.box.children[1].tag, 'canvas');
    assert.equal(m.jump.className.includes('pt-dz-jump'), true);
    assert.equal(m.push.className.includes('pt-dz-push'), true);
    // joystick: pointer 1 sağa çeker (merkez 60,60; yarıçap 60)
    m.joy.fire('pointerdown', { pointerId: 1, clientX: 120, clientY: 60 });
    let last = m.calls.input[m.calls.input.length - 1];
    assert.ok(last[0] > 0.9 && Math.abs(last[1]) < 1e-9, 'sağa tam: ' + last);
    // aynı anda başka parmakla düğmeler (farklı eleman, farklı pointerId)
    m.set(m.api.startAt + 100);
    m.jump.fire('pointerdown', { pointerId: 2 });
    m.push.fire('pointerdown', { pointerId: 3 });
    assert.deepEqual(m.calls.press, ['jump', 'push']);
    // joystick hâlâ tutuluyor: başka pointerId onu bozmaz
    const before = m.calls.input.length;
    m.joy.fire('pointermove', { pointerId: 9, clientX: 0, clientY: 0 });
    m.joy.fire('pointerup', { pointerId: 9 });
    assert.equal(m.calls.input.length, before, 'başka pointer joystick\'i etkilemez');
    // ikinci parmak joystick'e inemez (ilk parmak tutuyor)
    m.joy.fire('pointerdown', { pointerId: 7, clientX: 0, clientY: 60 });
    assert.equal(m.calls.input.length, before);
    // ilk parmak yukarı kaydırır, sonra bırakır -> durur
    m.joy.fire('pointermove', { pointerId: 1, clientX: 60, clientY: 0 });
    last = m.calls.input[m.calls.input.length - 1];
    assert.ok(last[1] < -0.9 && Math.abs(last[0]) < 1e-9, 'yukarı: ' + last);
    m.joy.fire('pointerup', { pointerId: 1 });
    assert.deepEqual(m.calls.input[m.calls.input.length - 1], [0, 0], 'bırakınca durur');
    // ölü bölge: merkezde dokunuş hareket üretmez
    m.joy.fire('pointerdown', { pointerId: 4, clientX: 62, clientY: 60 });
    assert.deepEqual(m.calls.input[m.calls.input.length - 1], [0, 0]);
    m.joy.fire('pointercancel', { pointerId: 4 });
    assert.deepEqual(m.calls.input[m.calls.input.length - 1], [0, 0]);
});

test('klavye: WASD/oklar yürütür, bırakınca durur; Boşluk zıpla, E/Shift it; repeat yok sayılır (kenar tetikli); klavye joystick\'e baskın', () => {
    const m = mount();
    m.set(m.api.startAt + 100);
    const down = (key, repeat) => { const ev = { key, repeat: !!repeat, prevented: false, preventDefault() { this.prevented = true; } }; m.env.doc.listeners.keydown.forEach((f) => f(ev)); return ev; };
    const up = (key) => m.env.doc.listeners.keyup.forEach((f) => f({ key }));
    const e = down('d');
    assert.equal(e.prevented, true, 'sayfa kaymaz');
    assert.deepEqual(m.calls.input[m.calls.input.length - 1], [1, 0]);
    down('w');
    const v = m.calls.input[m.calls.input.length - 1];
    assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-9 && v[0] > 0 && v[1] < 0, 'çapraz normalize');
    up('d'); up('w');
    assert.deepEqual(m.calls.input[m.calls.input.length - 1], [0, 0]);
    down(' ');
    down(' ', true);
    down('e');
    down('Shift');
    down('Shift', true);
    down('q');
    assert.deepEqual(m.calls.press, ['jump', 'push', 'push'], 'repeat ve ilgisiz tuş yok');
    // klavye + joystick birlikte: klavye baskın
    m.joy.fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 60 });
    down('s');
    assert.deepEqual(m.calls.input[m.calls.input.length - 1], [0, 1]);
    up('s');
    const back = m.calls.input[m.calls.input.length - 1];
    assert.ok(back[0] < -0.9, 'klavye bırakılınca joystick geri gelir');
});

test('çizim: kare döngüsü hata vermez; emoji düz fillStyle (iPhone); kendi/akran/bot çizilir; elenince "Elendin"; hayalet çizilmez; sonraki kare planlanır', () => {
    const m = mount();
    m.env.doc.listeners.keydown.length;                 // dinleyici bağlı
    // akran: oturumun api.peers durumu
    m.api.peers.p2 = { x: 200, y: 210, z: 0, vx: 0, vy: 0, out: -1, at: m.t };
    m.set(m.api.startAt + 2000);
    ops.length = 0;
    m.env.rafState.queue.shift()(1000);
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1][0]);
    ['🦊', '🐼', '🤖'].forEach((emo) => assert.ok(texts.includes(emo), 'çizildi ' + emo));
    ops.filter((o) => o[0] === 'fillText' && /\p{Extended_Pictographic}/u.test(o[1][0])).forEach((o) => assert.equal(typeof o[2], 'string', 'emoji: düz fillStyle'));
    assert.equal(m.env.rafState.queue.length, 1, 'sonraki kare planlandı');
    assert.ok(texts.every((x) => x !== 'Elendin'));
    // geri sayımda yazı
    const c = mount();
    ops.length = 0;
    c.env.rafState.queue.shift()(1000);
    assert.ok(ops.filter((o) => o[0] === 'fillText').some((o) => /Hazır|\d/.test(o[1][0])));
    // elenmiş (resume out): "Elendin", kendi çizilmez (hayalet)
    const g = mount({ session: { resume: { x: 100, y: 100, z: 0, vx: 0, vy: 0, out: 9000 }, startAt: 60000 } });
    g.set(g.api.startAt + 20000);
    ops.length = 0;
    g.env.rafState.queue.shift()(1000);
    const gt = ops.filter((o) => o[0] === 'fillText').map((o) => o[1][0]);
    assert.ok(gt.includes('Elendin'));
    assert.ok(!gt.includes('🦊'), 'hayalet kendi avatarını çizmez');
});

test('yıkım: tüm dinleyiciler/raf temizlenir, giriş sıfırlanır, kök boşalır; yıkık arayüz yeni kare planlamaz', () => {
    const m = mount();
    m.joy.fire('pointerdown', { pointerId: 1, clientX: 120, clientY: 60 });
    assert.equal(m.env.doc.listeners.keydown.length, 1);
    assert.equal(m.env.doc.listeners.keyup.length, 1);
    assert.equal(m.joy.count('pointerdown'), 1);
    m.ui.destroy();
    assert.equal(m.env.doc.listeners.keydown.length, 0);
    assert.equal(m.env.doc.listeners.keyup.length, 0);
    assert.equal(m.joy.count('pointerdown'), 0);
    assert.equal(m.jump.count('pointerdown'), 0);
    assert.deepEqual(m.calls.input[m.calls.input.length - 1], [0, 0], 'giriş sıfırlandı');
    assert.equal(m.root.children.length, 0);
    assert.ok(m.env.rafState.cancelled.length >= 1);
    if (m.env.rafState.queue.length) m.env.rafState.queue.shift()(1000);
    assert.equal(m.env.rafState.queue.length, 0, 'yıkılmış arayüz kare planlamaz');
});

test('bağlantı: index.html betik sırası, CSS (touch-action none, joystick/düğme), ui.js ffa kartı registry başlığı + sürücü satırı kullanır', () => {
    const root = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const at = (s) => html.indexOf(s);
    assert.ok(at('mini/dusenzemin-rules.js') > 0 && at('mini/dusenzemin-rules.js') < at('mini/dusenzemin-ui.js'));
    assert.ok(at('mini/dusenzemin-ui.js') < at('mini/dusenzemin-session.js') && at('mini/dusenzemin-session.js') < at('mini/ffa-drivers.js') && at('mini/ffa-drivers.js') < at('parti/minigame.js'));
    assert.ok(at('core/emoji.js') > 0 && at('core/emoji.js') < at('mini/dusenzemin-ui.js'));
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    ['.pt-dz-canvas', '.pt-dz-joy', '.pt-dz-knob', '.pt-dz-btn'].forEach((c) => assert.ok(css.includes(c), c));
    assert.ok(/\.pt-dz-joy[^}]*touch-action: none/.test(css) && /\.pt-dz-btn[^}]*touch-action: none/.test(css));
    const ui = fs.readFileSync(path.join(root, 'games', 'parti', 'ui.js'), 'utf8');
    assert.ok(/ffaTitle\(mn\.game\)/.test(ui) && /q\.text/.test(ui));
    assert.ok(D.N === 8);
});
