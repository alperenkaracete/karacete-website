// Parti düello izleme: oynamayanların salt-okunur canlı tahtası (lider hakeminden kompakt anlık görüntü).
// Saf modül (snapshot/sanitize/render), hakem onUpdate'i ve 3 insanlı odada izleyici (ikinci şans bekleyen) görünümü.
const test = require('node:test');
const assert = require('node:assert/strict');
const Watch = require('../games/parti/mini/duel-watch.js');
const Referee = require('../games/parti/mini/duel-referee.js');
const X = require('../games/xox-rules.js');
const { fakeRoot } = require('./duel-fakes.js');
const { reachDuel, mover, cdShoot, CDR } = require('./duel-room.js');

const doc = () => fakeRoot().ownerDocument;
const names = { A: 'Ayşe', B: 'Bora' };

function collect(node, pred, out) {
    out = out || [];
    if (pred(node)) out.push(node);
    (node.children || []).forEach((c) => collect(c, pred, out));
    return out;
}

// ---- snapshot ----
test('snapshot XOX/Dörtlü: tahta -1/0/1, sıra, sonuç', () => {
    const board = [0, null, 1, null, 0, null, null, null, null];
    const s = Watch.snapshot('xox', { order: ['A', 'B'], turn: 1, board, result: null, shots: [0, 0] });
    assert.deepEqual(s, { g: 'xox', o: ['A', 'B'], t: 1, r: -1, b: [0, -1, 1, -1, 0, -1, -1, -1, -1] });
    const won = Watch.snapshot('xox', { order: ['A', 'B'], turn: 0, board, result: { ranking: [['B'], ['A']], reason: 'win' }, shots: [0, 0] });
    assert.equal(won.r, 1);
    const draw = Watch.snapshot('xox', { order: ['A', 'B'], turn: 0, board, result: { ranking: [['A', 'B']], reason: 'draw' }, shots: [0, 0] });
    assert.equal(draw.r, 2);
    const c4 = Watch.snapshot('connect4', { order: ['A', 'B'], turn: 0, board: new Array(42).fill(null), result: null, shots: [0, 0] });
    assert.equal(c4.b.length, 42);
    assert.equal(Watch.snapshot('xox', { order: ['A', 'B'], turn: 0, board: [1, 2], result: null }), null, 'boyut tutmaz');
    assert.equal(Watch.snapshot('bilinmeyen', { board: [], order: [] }), null);
    assert.equal(Watch.snapshot('xox', null), null);
});

test('snapshot Kedi-Köpek: can, rüzgâr, atış sayısı ve son atış özeti (yörünge taşınmaz)', () => {
    const board = CDR.initial({ seed: 5, order: ['A', 'B'], cat: 'A' });
    const r = CDR.apply(board, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: 'big' }, 0);
    const s = Watch.snapshot('catdog', { order: ['A', 'B'], turn: 1, board: r.board, result: null, shots: [1, 0] }, CDR);
    assert.equal(s.g, 'catdog');
    assert.deepEqual(s.c, ['cat', 'dog']);
    assert.equal(s.wind, CDR.windFor(5, 1));
    assert.deepEqual(s.sh, [1, 0]);
    assert.equal(s.last.k, 's'); assert.equal(s.last.u, 'big'); assert.equal(s.last.a, 45); assert.equal(s.last.p, 60);
    assert.ok(JSON.stringify(s).length < 400, 'küçük yük');
    assert.deepEqual(Watch.sanitize(s), s, 'kendi çıktısı geçerli');
    const heal = CDR.apply(r.board, { kind: 'heal', turn: 1 }, 1);
    const hs = Watch.snapshot('catdog', { order: ['A', 'B'], turn: 0, board: heal.board, result: null, shots: [1, 0] }, CDR);
    assert.equal(hs.last.k, 'h');
});

// ---- sanitize ----
test('sanitize: geçerli kabul; kötü biçimler null (oyunu bozmaz)', () => {
    const ok = { g: 'xox', o: ['A', 'B'], t: 0, r: -1, b: new Array(9).fill(-1) };
    assert.deepEqual(Watch.sanitize(ok), ok);
    assert.notEqual(Watch.sanitize(ok), ok, 'kopya döner');
    const cdOk = { g: 'catdog', o: ['A', 'B'], t: 0, r: -1, c: ['cat', 'dog'], hp: [100, 100], sh: [0, 0], wind: 0, last: null };
    const bad = [
        null, 5, 'x', {}, { ...ok, g: 'tank' }, { ...ok, o: ['A'] }, { ...ok, o: ['A', 'x'.repeat(40)] }, { ...ok, t: 2 }, { ...ok, r: 3 },
        { ...ok, b: new Array(8).fill(-1) }, { ...ok, b: new Array(9).fill(2) }, { ...ok, b: new Array(9).fill('a') }, { ...ok, b: undefined },
        { g: 'connect4', o: ['A', 'B'], t: 0, r: -1, b: new Array(9).fill(-1) },
        { ...cdOk, hp: [100, 101] }, { ...cdOk, c: ['cat', 'cat2'] }, { ...cdOk, wind: 11 },
        { ...cdOk, last: { s: 0, k: 'x', u: '', h: '', d: 0, a: 0, p: 0 } }
    ];
    bad.forEach((b, i) => assert.equal(Watch.sanitize(b), null, 'kötü #' + i));
    const cd = { ...cdOk, t: 1, hp: [70, 100], sh: [1, 0], wind: -3, last: { s: 0, k: 's', u: 'wind', h: 'direct', d: 30, a: 45, p: 60 } };
    assert.deepEqual(Watch.sanitize(cd), cd);
    assert.deepEqual(Watch.sanitize({ ...cd, extra: 'x'.repeat(10000) }), cd, 'fazladan alanlar atılır');
});

// ---- render ----
test('render XOX / Dörtlü: hücre sayısı, sıra ve kazanan vurgusu, beraberlik; isim yoksa kimlik', () => {
    const d = doc();
    const x = Watch.render(d, { g: 'xox', o: ['A', 'B'], t: 1, r: -1, b: [0, -1, 1, -1, -1, -1, -1, -1, -1] }, names);
    const cells = collect(x, (n) => (n.className || '').indexOf('pt-watch-cell') === 0);
    assert.equal(cells.length, 9);
    assert.equal(cells[0].textContent, 'X'); assert.equal(cells[2].textContent, 'O');
    assert.ok(x.textContent.includes('Ayşe') && x.textContent.includes('Bora'));
    assert.ok(!x.textContent.includes('kazandı'));
    const turnChips = collect(x, (n) => (n.className || '').indexOf('pt-watch-who') === 0 && n.className.indexOf('turn') > 0);
    assert.equal(turnChips.length, 1);
    assert.ok(turnChips[0].textContent.includes('Bora'), 'sıra 1. indekste');
    const won = Watch.render(d, { g: 'connect4', o: ['A', 'B'], t: 0, r: 1, b: new Array(42).fill(-1) }, names);
    assert.ok(won.textContent.includes('🏆 Bora kazandı'));
    assert.equal(collect(won, (n) => (n.className || '').indexOf('pt-watch-cell') === 0).length, 42);
    const drawn = Watch.render(d, { g: 'xox', o: ['A', 'B'], t: 0, r: 2, b: new Array(9).fill(0) }, null);
    assert.ok(drawn.textContent.includes('🤝 Beraberlik'));
    assert.ok(drawn.textContent.includes('A') && drawn.textContent.includes('B'), 'isim yoksa kimlik');
    assert.equal(Watch.render(d, null, names), null);
});

test('render Kedi-Köpek: can, son atış, rüzgâr, atış sayısı', () => {
    const snap = { g: 'catdog', o: ['A', 'B'], t: 1, r: -1, c: ['cat', 'dog'], hp: [70, 100], sh: [1, 0], wind: -3,
        last: { s: 0, k: 's', u: 'wind', h: 'direct', d: 30, a: 45, p: 60 } };
    const t = Watch.render(doc(), snap, names).textContent;
    assert.ok(t.includes('🐱') && t.includes('🐶'));
    assert.ok(t.includes('Ayşe: 45° / 60 🎯 · 💥 isabet −30'), t);
    assert.ok(t.includes('Rüzgâr ← 3') && t.includes('atış 1/0'));
    assert.ok(t.includes('70') && t.includes('100'));
    assert.equal(Watch.lastText({ ...snap, last: null }, names), 'Henüz atış yok');
    assert.ok(Watch.lastText({ ...snap, last: { s: 1, k: 's', u: '', h: 'none', d: 0, a: 120, p: 40 } }, names).includes('ıskaladı'));
    assert.ok(Watch.lastText({ ...snap, last: { s: 1, k: 'h', u: '', h: '', d: 25, a: 0, p: 0 } }, names).includes('can iksiri +25'));
    assert.ok(Watch.render(doc(), { ...snap, r: 0 }, names).textContent.includes('🏆 Ayşe kazandı'));
});

// ---- hakem onUpdate ----
test('hakem onUpdate: kabul edilen her mesajda bir kez, reddedilende ve oluşturmada hiç; reset bir kez', () => {
    let n = 0;
    const ref = Referee.create({ prefix: 'xox', rules: X, players: ['A', 'B'], onUpdate: () => { n++; } });
    assert.equal(n, 0, 'oluşturmada yok');
    assert.equal(ref.state().phase, 'waiting');
    assert.equal(ref.feed('A', { type: 'xox_start', first: 'A', round: 1 }), true);
    assert.equal(n, 1);
    assert.equal(ref.feed('B', { type: 'xox_move', round: 1, cell: 0 }), false, 'sırası değil');
    assert.equal(n, 1);
    assert.equal(ref.feed('A', { type: 'xox_move', round: 1, cell: 4 }), true);
    assert.equal(n, 2);
    const st = ref.state();
    assert.equal(st.board[4], 0); assert.equal(st.turn, 1); assert.deepEqual(st.order, ['A', 'B']);
    ref.reset();
    assert.equal(n, 3);
    assert.equal(ref.state().board, null);
});

// ---- Entegrasyon: 3 insan, C izleyici (ikinci şans bekliyor) ----
const watchOf = (r, id, i) => r.view(id).mini.pairs[i || 0].watch;

test('izleyici (XOX): her hamlede tahta güncel; oynayanlar da aynı anlık görüntüyü alır; bitişte sonuç', async () => {
    const r = await reachDuel('xox', { humans: 3 });
    const sp = r.state('A').mn.ex;
    assert.ok(sp && !r.state('A').mn.pm[0].p.includes(sp), 'ikinci şans bekleyen oynamıyor');
    const { first, second } = mover(r, 0);
    const play = (id, cell) => { assert.equal(r.lastDefs(id).duel.move({ cell }), true); r.flush(); };
    play(first, 4);
    await r.settle();
    let w = watchOf(r, sp);
    assert.equal(w.g, 'xox');
    assert.equal(w.b[4], 0);
    assert.equal(w.b.filter((v) => v >= 0).length, 1);
    assert.equal(w.t, 1);
    assert.deepEqual(w.o, [first, second]);
    assert.deepEqual(watchOf(r, 'A'), w);
    play(second, 0);
    await r.settle();
    w = watchOf(r, sp);
    assert.equal(w.b[0], 1);
    assert.equal(w.t, 0);
    play(first, 3); play(second, 1); play(first, 5);        // ilk başlayan 3-4-5 satırını tamamlar
    await r.settle();
    w = watchOf(r, sp);
    assert.equal(w.r, w.o.indexOf(first), 'kazanan işaretli');
});

test('izleyici (Dörtlü): 42 hücre; diğer maçtaki oyuncu kopup dönünce güncel tahtayı görür', async () => {
    const r = await reachDuel('connect4', { humans: 4 });
    const sp = r.state('A').mn.pm[1].p.find((id) => id !== 'A');
    const { first, second } = mover(r, 0);
    r.lastDefs(first).duel.move({ col: 3 });
    r.flush();
    r.lastDefs(second).duel.move({ col: 3 });
    r.flush(); await r.settle();
    let w = watchOf(r, sp);
    assert.equal(w.b.length, 42);
    assert.equal(w.b.filter((v) => v >= 0).length, 2);
    r.leave(sp);
    r.lastDefs(first).duel.move({ col: 4 });
    r.flush(); await r.settle();
    r.reconnect(sp);
    await r.settle();
    r.advance(2000, 100);
    w = watchOf(r, sp);
    assert.ok(w, 'dönen izleyici anlık görüntüyü aldı');
    assert.equal(w.b.filter((v) => v >= 0).length, 3, 'kopukken oynanan hamle dahil');
});

test('izleyici (Kedi-Köpek): atış sonrası can/son atış/atış sayısı; ikinci şans maçı ayrı ve boş başlar', async () => {
    const r = await reachDuel('catdog', { humans: 3 });
    const sp = r.state('A').mn.ex;
    cdShoot(r, true, 0);
    await r.settle();
    const w = watchOf(r, sp);
    assert.equal(w.g, 'catdog');
    assert.equal(w.last.k, 's');
    assert.ok(w.last.d > 0 && w.last.h !== 'none', 'isabet özeti');
    assert.equal(Math.min(...w.hp), 100 - w.last.d);
    assert.equal(w.sh[0] + w.sh[1], 1);
    assert.equal(w.t, 1);
    assert.ok(Math.abs(w.wind) <= 10);
    for (let i = 0; i < 9; i++) cdShoot(r, false, 0);
    await r.settle();
    assert.equal(r.state('A').mn.pm.length, 2, 'ilk maç bitti, ikinci şans kuruldu');
    const done = watchOf(r, sp, 0);
    assert.ok(done.r >= 0, 'biten maçın sonucu işaretli');
    assert.equal(watchOf(r, sp, 1), null, 'ikinci şans maçı henüz oynanmadı: boş');
});
