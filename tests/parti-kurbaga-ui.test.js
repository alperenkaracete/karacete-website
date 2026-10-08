// Kurbağa arayüzü: giriş eşlemesi (tek dokunuş, repeat yok), yumuşatma, çizim sahte 2D bağlamla, yıkım temizliği, ui.js bağlantısı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../games/parti/mini/kurbaga-rules.js');
const Ui = require('../games/parti/mini/kurbaga-ui.js');
const Emoji = require('../core/emoji.js');
const Session = require('../games/parti/mini/kurbaga-session.js');

test('keyToDir: oklar ve WASD; diğer tuşlar yok', () => {
    assert.equal(Ui.keyToDir('ArrowUp'), 'up');
    assert.equal(Ui.keyToDir('ArrowDown'), 'down');
    assert.equal(Ui.keyToDir('ArrowLeft'), 'left');
    assert.equal(Ui.keyToDir('ArrowRight'), 'right');
    assert.equal(Ui.keyToDir('w'), 'up');
    assert.equal(Ui.keyToDir('A'), 'left');
    assert.equal(Ui.keyToDir('s'), 'down');
    assert.equal(Ui.keyToDir('D'), 'right');
    assert.equal(Ui.keyToDir(' '), null);
    assert.equal(Ui.keyToDir('toString'), null, 'prototip anahtarı değil');
    assert.equal(Ui.keyToDir(undefined), null);
});

test('approach: dt bölünmesinden bağımsız, aşmaz, büyük sıçramada anında', () => {
    const one = Ui.approach({ x: 0, y: 0 }, 40, 0, 100, 90);
    let two = { x: 0, y: 0 };
    two = Ui.approach(two, 40, 0, 50, 90);
    two = Ui.approach(two, 40, 0, 50, 90);
    assert.ok(Math.abs(one.x - two.x) < 1e-9, 'iki yarım adım = bir tam adım');
    assert.ok(one.x > 0 && one.x < 40);
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 200; i++) p = Ui.approach(p, 40, 0, 16, 90);
    assert.ok(p.x <= 40 && p.x > 39.99);
    assert.deepEqual(Ui.approach({ x: 0, y: 0 }, 400, 0, 16, 90), { x: 400, y: 0 }, 'ölüm / ışınlanma: anında');
    assert.deepEqual(Ui.approach(undefined, 80, 40, 16, 90), { x: 80, y: 40 }, 'ilk görünüm: anında');
});

test('countdownLabel: Hazır, 3, 2, 1, BAŞLA!', () => {
    assert.equal(Ui.countdownLabel(-3900), 'Hazır');
    assert.equal(Ui.countdownLabel(-3000), '3');
    assert.equal(Ui.countdownLabel(-2500), '3');
    assert.equal(Ui.countdownLabel(-2000), '2');
    assert.equal(Ui.countdownLabel(-1500), '2');
    assert.equal(Ui.countdownLabel(-1000), '1');
    assert.equal(Ui.countdownLabel(-1), '1');
    assert.equal(Ui.countdownLabel(100), 'BAŞLA!');
    assert.equal(Ui.countdownLabel(5000), '');
});

// ---- sahte DOM / bağlam ----
function fakeEl(tag) {
    const listeners = {};
    const node = {
        tag, className: '', children: [], style: {}, attrs: {}, _text: '',
        appendChild(c) { node.children.push(c); return c; },
        setAttribute(k, v) { node.attrs[k] = v; },
        addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
        fire(t, ev) { (listeners[t] || []).slice().forEach((f) => f(ev || {})); },
        count(t) { return (listeners[t] || []).length; },
        get textContent() { return node._text; },
        set textContent(v) { node._text = v; node.children = []; }
    };
    if (tag === 'canvas') node.getContext = () => ctx;
    return node;
}
const ops = [];
const ctx = new Proxy({ _fill: '#000', _alpha: 1 }, {
    get(t, k) {
        if (k === 'fillStyle') return t._fill;
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (typeof k === 'string' && !(k in t)) return (...a) => { ops.push([k, a, t._fill]); };
        return t[k];
    },
    set(t, k, v) { if (k === 'fillStyle') t._fill = v; else t[k] = v; return true; }
});

function fakeEnv() {
    const docL = {};
    const doc = {
        createElement: (tag) => fakeEl(tag),
        addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); },
        removeEventListener: (t, f) => { docL[t] = (docL[t] || []).filter((x) => x !== f); },
        listeners: docL
    };
    const raf = { queue: [], id: 0, cancelled: [] };
    return {
        doc, win: { devicePixelRatio: 1 }, emoji: Emoji,
        raf: (f) => { raf.queue.push(f); return ++raf.id; }, caf: (id) => raf.cancelled.push(id), rafState: raf
    };
}

function mount() {
    let t = 50000;
    const sent = [];
    const handlers = [];
    let api;
    Session.run({
        type: 'ffa', game: 'kurbaga', players: ['me', 'p2', 'bot1'], bots: ['bot1'], seed: 77, me: { id: 'me', name: 'Ben' }, startAt: t + 4000,
        net: { send: (m) => sent.push(m), on: (fn) => { handlers.push(fn); return () => {}; } }, now: () => t, register: (a) => { api = a; }
    });
    const root = fakeEl('div');
    const env = fakeEnv();
    const ui = Ui.mount(root, api, { now: () => t, me: { id: 'me' }, names: { me: 'Ben', p2: 'Ali', bot1: 'Bot' }, avatars: { me: '🦊', p2: '🐼', bot1: '🤖' }, getEndAt: () => t + 90000 }, env);
    return { api, root, env, ui, sent, handlers, set: (v) => { t = v; }, get t() { return t; } };
}

test('mount: kanvas + 4 düğme + HUD; klavye ve düğmeler api.hop çağırır, repeat ve basılı tutma yok sayılır', () => {
    const m = mount();
    const box = m.root.children[0];
    assert.equal(box.className, 'pt-frog');
    assert.equal(box.children.length, 3);
    assert.equal(box.children[1].tag, 'canvas');
    assert.equal(box.children[2].children.length, 4, 'ok düğmeleri');
    const hops = [];
    const origHop = m.api.hop;
    m.api.hop = (d, t) => { hops.push(d); return origHop(d, t); };
    const press = (key, repeat) => { const ev = { key, repeat: !!repeat, prevented: false, preventDefault() { this.prevented = true; } }; m.env.doc.listeners.keydown.forEach((f) => f(ev)); return ev; };
    m.set(m.api.startAt + 100);
    const a = press('ArrowLeft');
    assert.equal(a.prevented, true, 'sayfa kaymaz');
    press('ArrowLeft', true);
    press('x');
    assert.deepEqual(hops, ['left'], 'repeat ve ilgisiz tuş yok');
    // ekran düğmesi: pointerdown tek sıçrama
    const left = box.children[2].children.find((b) => /left/.test(b.className));
    left.fire('pointerdown', { preventDefault() {} });
    assert.equal(hops.length, 2);
    assert.equal(hops[1], 'left');
});

test('çizim: kare döngüsü hata vermez; emoji çizimi düz fillStyle ile (iPhone), kendi + akran + bot çizilir; döngü yeniden planlanır', () => {
    const m = mount();
    m.handlers.forEach((fn) => fn('p2', { k: 'pos', r: 3, c: 2, d: 0, n: 1 }));
    m.set(m.api.startAt + 2000);
    ops.length = 0;
    m.env.rafState.queue.shift()(1000);
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1][0]);
    ['🦊', '🐼', '🤖', '🏁'].forEach((e) => assert.ok(texts.includes(e), 'çizildi: ' + e));
    ops.filter((o) => o[0] === 'fillText' && /\p{Extended_Pictographic}/u.test(o[1][0])).forEach((o) => assert.equal(typeof o[2], 'string', 'emoji: düz fillStyle'));
    assert.equal(m.env.rafState.queue.length, 1, 'sonraki kare planlandı');
    // geri sayımda yazı
    const c = setupCountdown();
    assert.ok(c.some((x) => /Hazır|\d/.test(x)));
    function setupCountdown() {
        const mm = mount();
        ops.length = 0;
        mm.env.rafState.queue.shift()(1000);
        return ops.filter((o) => o[0] === 'fillText').map((o) => o[1][0]);
    }
});

test('destroy: klavye dinleyicisi, düğme olayları ve kare döngüsü temizlenir; kök boşalır', () => {
    const m = mount();
    const box = m.root.children[0];
    const btn = box.children[2].children[0];
    assert.equal(m.env.doc.listeners.keydown.length, 1);
    assert.equal(btn.count('pointerdown'), 1);
    m.ui.destroy();
    assert.equal(m.env.doc.listeners.keydown.length, 0);
    assert.equal(btn.count('pointerdown'), 0);
    assert.equal(m.root.children.length, 0);
    assert.ok(m.env.rafState.cancelled.length >= 1);
    const before = m.env.rafState.queue.length;
    if (before) m.env.rafState.queue.shift()(1000);
    assert.equal(m.env.rafState.queue.length, 0, 'yıkılmış arayüz yeni kare planlamaz');
});

// ---- ui.js bağlantısı (statik) ----
test('ui.js: ffa kartı (oynayan kökü, izleyici çubukları, sıralama) ve betik/CSS bağlantısı', () => {
    const root = path.join(__dirname, '..');
    const ui = fs.readFileSync(path.join(root, 'games', 'parti', 'ui.js'), 'utf8');
    assert.ok(/function ffaCard/.test(ui));
    assert.ok(/ffaGame\(mn\) && mn\.live/.test(ui), 'oynayan bağlı insan kalıcı köke çizer');
    assert.ok(/if \(ffaGame\(mn\)\) return ffaCard\(v, c\)/.test(ui), 'ffa çark gibi dönmez');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const at = (s) => html.indexOf(s);
    assert.ok(at('mini/registry.js') > 0 && at('mini/registry.js') < at('parti/config.js'));
    assert.ok(at('mini/kurbaga-rules.js') < at('mini/kurbaga-ui.js') && at('mini/kurbaga-ui.js') < at('mini/kurbaga-session.js') && at('mini/kurbaga-session.js') < at('parti/minigame.js'));
    assert.ok(at('core/emoji.js') > 0 && at('core/emoji.js') < at('mini/kurbaga-ui.js'));
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    assert.ok(/\.pt-frog-canvas/.test(css) && /\.pt-frog-pad/.test(css) && /touch-action: none/.test(css));
});
