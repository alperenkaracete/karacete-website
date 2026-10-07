// Kedi-Köpek canlı izleme sahnesi: atış yörüngesi anlık görüntüde taşınır, izleyicide catdog.js ile aynı sürelerle yeniden oynatılır.
// Saf model (createModel) + kompakt snapshot/sanitize + kalıcı kanvas denetleyicisi + eski lider uyumu.
const test = require('node:test');
const assert = require('node:assert/strict');
const Watch = require('../games/parti/mini/duel-watch.js');
const Adapter = require('../games/parti/mini/duel-adapter.js');
const Emoji = require('../core/emoji.js');
const { fakeRoot } = require('./duel-fakes.js');
const { CDR } = require('./duel-room.js');

const names = { A: 'Ayşe', B: 'Bora' };

function board0(seed) { return CDR.initial({ seed: seed || 11, order: ['A', 'B'], cat: 'A' }); }

// Gerçek kurallarla bir atış uygular ve izleme anlık görüntüsünü üretir
function snapAfter(board, move, shooter, shotsCount) {
    const r = CDR.apply(board, move, shooter);
    const shots = [0, 0];
    shots[shooter] = shotsCount || 1;
    const snap = Watch.snapshot('catdog', { order: ['A', 'B'], turn: r.board.turn % 2, board: r.board, result: null, shots }, CDR);
    return { board: r.board, snap };
}

function findHit(board, shooter) {
    for (let a = 0; a <= 180; a++) {
        for (let p = 0; p <= 100; p++) {
            const r = CDR.apply(board, { kind: 'shot', turn: board.turn, angle: a, power: p, powerUp: null }, shooter);
            if (r.board.last.shots[0].damage > 0) return { angle: a, power: p };
        }
    }
    throw new Error('isabet yok');
}

test('snapshot Kedi-Köpek: tohum, hamle no ve son atış yörüngesi (≤80 nokta, tamsayı) taşınır; çift atışta iki yörünge', () => {
    const b = board0(11);
    const hit = findHit(b, 0);
    const { snap } = snapAfter(b, { kind: 'shot', turn: 0, angle: hit.angle, power: hit.power, powerUp: null }, 0);
    assert.equal(snap.sd, 11);
    assert.equal(snap.tn, 1);
    assert.equal(snap.shots.length, 1);
    const sh = snap.shots[0];
    assert.ok(sh.p.length >= 4 && sh.p.length <= 2 * 82 && sh.p.length % 2 === 0);
    assert.ok(sh.p.every(Number.isInteger));
    assert.ok(sh.fr > 0 && sh.fr <= 1200);
    assert.ok(sh.d > 0 && sh.h !== 'none');
    assert.deepEqual(sh.hp.length, 2);
    assert.ok(JSON.stringify(snap).length < 3500, 'tek atış yükü küçük: ' + JSON.stringify(snap).length);
    assert.deepEqual(Watch.sanitize(snap), snap, 'kendi çıktısı geçerli');
    const dbl = snapAfter(b, { kind: 'shot', turn: 0, angle: 40, power: 30, powerUp: 'double' }, 0);
    assert.equal(dbl.snap.shots.length, 2);
    assert.ok(JSON.stringify(dbl.snap).length < 6500, 'çift atış yükü: ' + JSON.stringify(dbl.snap).length);
    const heal = CDR.apply(dbl.board, { kind: 'heal', turn: 1 }, 1);
    const hs = Watch.snapshot('catdog', { order: ['A', 'B'], turn: 0, board: heal.board, result: null, shots: [1, 0] }, CDR);
    assert.deepEqual(hs.shots, [], 'iksirde atış yok');
    assert.equal(hs.tn, 2);
});

test('sanitize: kötü atış yörüngeleri (uzunluk, tip, aralık, fazla atış) null; eski lider (sd/shots yok) kabul', () => {
    const b = board0(3);
    const { snap } = snapAfter(b, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: null }, 0);
    const clone = () => JSON.parse(JSON.stringify(snap));
    const bad = [];
    let x = clone(); x.shots[0].p = [1, 2]; bad.push(x);                               // çok kısa
    x = clone(); x.shots[0].p = [1, 2, 3]; bad.push(x);                                // tek sayıda
    x = clone(); x.shots[0].p = new Array(400).fill(1); bad.push(x);                   // çok uzun
    x = clone(); x.shots[0].p[0] = 'a'; bad.push(x);
    x = clone(); x.shots[0].p[1] = 99999; bad.push(x);
    x = clone(); x.shots[0].fr = 5000; bad.push(x);
    x = clone(); x.shots[0].h = 'bomba'; bad.push(x);
    x = clone(); x.shots[0].d = 101; bad.push(x);
    x = clone(); x.shots[0].hp = [1]; bad.push(x);
    x = clone(); x.shots[0].e = [1]; bad.push(x);
    x = clone(); x.shots = [x.shots[0], x.shots[0], x.shots[0]]; bad.push(x);
    bad.forEach((b2, i) => assert.equal(Watch.sanitize(b2), null, 'kötü #' + i));
    x = clone(); delete x.sd; delete x.tn; delete x.shots;
    const old = Watch.sanitize(x);
    assert.ok(old, 'eski lider kabul');
    assert.equal(old.sd, null); assert.deepEqual(old.shots, []);
    x = clone(); x.sd = -1; assert.equal(Watch.sanitize(x).sd, null, 'geçersiz tohum: sahnesiz');
});

// ---- Model: zaman çizelgesi ----
function modelWith(seed) {
    const model = Watch.createModel(CDR);
    const b = board0(seed || 11);
    model.update(Watch.snapshot('catdog', { order: ['A', 'B'], turn: 0, board: b, result: null, shots: [0, 0] }, CDR));
    return { model, b };
}

test('model: ilk görüş/yeni maç animasyonsuz; atış gelince mermi uçar, can ÇARPMA anında düşer', () => {
    const { model, b } = modelWith(11);
    let f = model.frame();
    assert.deepEqual(f.hp, [100, 100]);
    assert.equal(f.proj, null);
    assert.equal(f.busy, false);
    const hit = findHit(b, 0);
    const { snap } = snapAfter(b, { kind: 'shot', turn: 0, angle: hit.angle, power: hit.power, powerUp: null }, 0);
    const flight = Math.max(500, Math.min(2600, snap.shots[0].fr * 1000 / 60));
    model.update(snap);
    f = model.frame();
    assert.ok(f.proj, 'mermi havada');
    assert.equal(f.proj.char, 'cat');
    assert.deepEqual(f.hp, [100, 100], 'çarpmadan önce can aynı');
    model.advance(Math.min(100, flight - 50));
    for (let t = 100; t < flight - 150; t += 100) model.advance(100);
    f = model.frame();
    assert.deepEqual(f.hp, [100, 100], 'uçuş sürerken can aynı');
    for (let i = 0; i < 6; i++) model.advance(50);
    f = model.frame();
    assert.deepEqual(f.hp, snap.hp, 'çarpınca can düştü');
    assert.ok(f.effects.some((e) => e.kind === 'boom'));
    assert.ok(f.effects.some((e) => e.kind === 'text' && e.text === '-' + snap.shots[0].d));
    assert.equal(f.proj, null);
    for (let i = 0; i < 40; i++) model.advance(50);
    f = model.frame();
    assert.equal(f.busy, false, 'bitti');
    assert.deepEqual(f.hp, snap.hp);
});

test('model: toplam süre adaptördeki animMs ile aynı (tek ve çift atış; catdog.js ile aynı sayılar)', () => {
    for (const powerUp of [null, 'double']) {
        const { model, b } = modelWith(11);
        const move = { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp };
        const r = CDR.apply(b, move, 0);
        const { snap } = snapAfter(b, move, 0);
        const expected = Adapter.animMs(r.board.last, CDR.DT);
        model.update(snap);
        let elapsed = 0;
        while (model.state().anim && elapsed < 20000) { model.advance(10); elapsed += 10; }
        assert.ok(Math.abs(elapsed - expected) <= 20, `${powerUp}: model ${elapsed} ms, animMs ${expected} ms`);
    }
});

test('model: arka arkaya iki hamle kuyruğa girer ve sırayla oynar; iksir (atışsız) canı hemen günceller; yeni tohum sıfırlar', () => {
    const { model, b } = modelWith(11);
    const s1 = snapAfter(b, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: null }, 0);
    const s2 = snapAfter(s1.board, { kind: 'shot', turn: 1, angle: 135, power: 55, powerUp: null }, 1, 1);
    model.update(s1.snap);
    model.update(s2.snap);
    assert.equal(model.state().queue.length, 1, 'ikinci hamle kuyrukta');
    assert.equal(model.state().anim.ev.shooter, 0, 'ilk hamle önce oynar');
    let guard = 0;
    while ((model.state().anim || model.state().queue.length) && guard++ < 3000) model.advance(20);
    assert.deepEqual(model.frame().hp, s2.snap.hp);
    // iksir: atış yok -> animasyonsuz, can hemen
    const heal = CDR.apply(s2.board, { kind: 'heal', turn: 2 }, 0);
    const hs = Watch.snapshot('catdog', { order: ['A', 'B'], turn: 1, board: heal.board, result: null, shots: [1, 1] }, CDR);
    model.update(hs);
    assert.deepEqual(model.frame().hp, hs.hp);
    assert.equal(model.state().anim, null);
    // yeni maç (başka tohum): animasyonsuz sıfırlama
    const nb = board0(99);
    const ns = snapAfter(nb, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: null }, 0);
    model.update(ns.snap);
    assert.equal(model.state().anim, null, 'yeni tohumda geçmiş atış oynatılmaz');
    assert.equal(model.state().seed, 99);
});

test('model: dt kenetlenir (sekme arkada kalıp dönünce tek karede sonsuz atlama yok); uçuş konumu yörüngeyi izler', () => {
    const { model, b } = modelWith(11);
    const { snap } = snapAfter(b, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: null }, 0);
    model.update(snap);
    const p0 = model.frame().proj;
    assert.equal(p0.x, snap.shots[0].p[0]);
    assert.equal(p0.y, snap.shots[0].p[1]);
    model.advance(60000);                                  // dev dt: en çok 100 ms ilerler
    assert.ok(model.state().anim, 'hâlâ animasyonda (kenetlendi)');
    const xs = [];
    for (let i = 0; i < 20 && model.frame().proj; i++) { xs.push(model.frame().proj.x); model.advance(50); }
    assert.ok(xs.length >= 3);
});

// ---- Denetleyici (kalıcı kanvas) + render ----
function fakeDoc() {
    const painted = [];
    const doc = fakeRoot().ownerDocument;
    const orig = doc.createElement;
    doc.createElement = (tag) => {
        const n = orig(tag);
        if (tag === 'canvas') {
            n.getContext = () => new Proxy({}, {
                get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => { painted.push(String(k)); }),
                set: () => true
            });
        }
        return n;
    };
    return { doc, painted };
}

test('createScene: aynı kanvas elemanı korunur; animasyonlu karelerde çizer, boştayken (kirli değilse) çizmez', () => {
    const { doc, painted } = fakeDoc();
    const scene = Watch.createScene(doc, CDR, Emoji);
    assert.equal(scene.el.className, 'pt-watch-canvas');
    assert.equal(scene.el.width, 640); assert.equal(scene.el.height, 400);
    const b = board0(11);
    scene.update(Watch.snapshot('catdog', { order: ['A', 'B'], turn: 0, board: b, result: null, shots: [0, 0] }, CDR));
    scene.tick(1000);
    const first = painted.length;
    assert.ok(first > 10, 'ilk karede çizdi');
    scene.tick(1016);
    assert.equal(painted.length, first, 'boşta ve değişiklik yok: çizmez');
    const { snap } = snapAfter(b, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: null }, 0);
    scene.update(snap);
    scene.tick(1032);
    assert.ok(painted.length > first, 'atış animasyonu çiziliyor');
    const el = scene.el;
    scene.update(snap);
    assert.equal(scene.el, el);
});

test('render(opts.scene): Kedi-Köpek kanvası eklenir, DOM can çubukları yerine; sahne yok / eski lider (sd yok) için eski can çubuğu', () => {
    const { doc } = fakeDoc();
    const scene = Watch.createScene(doc, CDR, Emoji);
    const b = board0(11);
    const { snap } = snapAfter(b, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: null }, 0);
    const el = Watch.render(doc, snap, names, { scene });
    const kids = [];
    (function walk(n) { kids.push(n); (n.children || []).forEach(walk); })(el);
    assert.ok(kids.includes(scene.el), 'kanvas eklendi');
    assert.ok(!kids.some((n) => n.className === 'pt-watch-bars'), 'DOM can çubukları yok');
    assert.ok(el.textContent.includes('atış') && el.textContent.includes('Ayşe'), 'son atış metni ve isimler duruyor');
    const noScene = Watch.render(doc, snap, names);
    const k2 = [];
    (function walk(n) { k2.push(n); (n.children || []).forEach(walk); })(noScene);
    assert.ok(k2.some((n) => n.className === 'pt-watch-bars'), 'sahnesiz çağrıda eski görünüm');
    const old = Object.assign({}, snap, { sd: null });
    const k3 = [];
    (function walk(n) { k3.push(n); (n.children || []).forEach(walk); })(Watch.render(doc, old, names, { scene }));
    assert.ok(k3.some((n) => n.className === 'pt-watch-bars'), 'sd yoksa sahne denenmez');
});
