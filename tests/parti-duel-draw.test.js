// Düello beraberliği: GERÇEK ödül (2. derece: yalnız silah, yıldız yok) ve GÖSTERİM (🥈, günlük satırı, mini.medals) birlikte.
// Tek çift, çoklu düello ve ikinci şans (oyuncunun SON maçı belirler) senaryoları. Gerçek machine + adapter + hakem + Duel.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const { reachDuel, pairOf, playToWin, mover, rewardsFromFx, MAXHOLD } = require('./duel-room.js');

const mnOf = (r) => r.state('A').mn;
const stars = (r, id) => r.state('A').g.P[id].s;

// i. XOX maçını berabere bitirir (sırayla: ilk başlayan X, ikinci O)
function drawXox(r, i) {
    const { first, second } = mover(r, i);
    const d1 = r.lastDefs(first); const d2 = r.lastDefs(second);
    [[d1, 0], [d2, 1], [d1, 2], [d2, 4], [d1, 3], [d2, 5], [d1, 7], [d2, 6], [d1, 8]].forEach(([d, cell]) => {
        assert.equal(d.duel.move({ cell }), true);
        r.flush();
    });
}

// Sonuç kayıtlı; ödül uygulanmadan önce görünümü okumak için: bannerın göründüğü ana ilerle, sonra ödül/tur geçişine
function reachResultView(r) {
    const x = mnOf(r).pm.find((p) => p.out) || mnOf(r).pm[0];
    r.advance(Math.max(0, (x.bAt || r.clock) - r.clock) + 1, 50);
}

const medalCount = (line, medal) => (line.match(new RegExp(medal, 'g')) || []).length;
const lastResultLog = (r) => r.state('A').lg.filter((l) => l.indexOf('🎡') === 0).pop() || '';

test('tek çift beraberlik: ikisi de 2. ödül (yıldız yok), günlükte 🥈🥈 (🥇 yok), mini.medals [1]', async () => {
    const r = await reachDuel('xox');
    const [a, b] = pairOf(r, 0);
    const before = { a: stars(r, a), b: stars(r, b) };
    drawXox(r, 0);
    await r.settle();
    assert.deepEqual(mnOf(r).oc.win, []);
    assert.deepEqual(mnOf(r).oc.lose, []);
    assert.deepEqual(mnOf(r).oc.draw.slice().sort(), [a, b].sort());
    assert.deepEqual(r.view('A').mini.medals, [1], 'kazanan yok: tek grup 2. madalya');
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 100);
    const rw = rewardsFromFx(r);
    assert.deepEqual(rw, { [a]: 2, [b]: 2 });
    assert.equal(stars(r, a), before.a, 'yıldız verilmedi');
    assert.equal(stars(r, b), before.b);
    const line = lastResultLog(r);
    assert.equal(medalCount(line, '🥇'), 0, line);
    assert.equal(medalCount(line, '🥈'), 2, line);
});

test('çoklu düello: bir çift kazanır, diğeri berabere — kazanan 🥇/1., berabere kalanlar 🥈/2.', async () => {
    const r = await reachDuel('xox', { humans: 4 });
    const win = mover(r, 0).first;
    const [d1, d2] = pairOf(r, 1);
    playToWin(r, 'xox', 0);
    drawXox(r, 1);
    await r.settle();
    const mn = mnOf(r);
    assert.deepEqual(mn.oc.win, [win]);
    assert.deepEqual(mn.oc.draw.slice().sort(), [d1, d2].sort());
    reachResultView(r);
    assert.deepEqual(r.view('A').mini.medals, [0, 1]);
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 100);
    const rw = rewardsFromFx(r);
    assert.equal(rw[win], 1);
    assert.equal(rw[d1], 2);
    assert.equal(rw[d2], 2);
    const line = lastResultLog(r);
    assert.equal(medalCount(line, '🥇'), 1, line);
    assert.ok(medalCount(line, '🥈') >= 2, line);
});

// İkinci şans: 3 insan, ilk maç berabere -> ikinci şans maçı; ödül her oyuncunun SON maçına göre
async function secondChance(secondDraws) {
    const r = await reachDuel('xox', { humans: 3 });
    const extra = mnOf(r).ex;
    const [p, q] = pairOf(r, 0);
    drawXox(r, 0);
    await r.settle();
    const mn = mnOf(r);
    assert.equal(mn.pm.length, 2, 'ikinci şans maçı kuruldu');
    assert.deepEqual(mn.pm[0].out.d, 1, 'ilk maç berabere');
    r.advance(mn.pm[1].stAt - r.clock + 1000, 100);
    const [s1, s2] = pairOf(r, 1);
    assert.ok([s1, s2].includes(extra), 'ikinci şans maçında bekleyen oyuncu var');
    if (secondDraws) drawXox(r, 1); else playToWin(r, 'xox', 1);
    await r.settle();
    return { r, extra, p, q, s: [s1, s2], winner: secondDraws ? null : mover(r, 1).first };
}

test('ikinci şans: önce berabere, sonra kazanılır — son maç belirler (kazanan 1., diğerleri 2.)', async () => {
    const { r, extra, p, q, s, winner } = await secondChance(false);
    const loser = s.find((id) => id !== winner);
    reachResultView(r);
    assert.deepEqual(r.view('A').mini.medals, [0, 1]);
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 100);
    const rw = rewardsFromFx(r);
    assert.equal(rw[winner], 1, 'son maçı kazanan 1.');
    assert.equal(rw[loser], 2);
    const drawOnly = [p, q].find((id) => !s.includes(id));
    assert.equal(rw[drawOnly], 2, 'yalnız berabere kalan (ikinci şansta oynamayan) 2.');
    assert.ok(extra);
    assert.equal(medalCount(lastResultLog(r), '🥇'), 1);
});

test('ikinci şans: ikisi de berabere biterse kimse 1. alamaz, hepsi 2. (🥈)', async () => {
    const { r, p, q, s } = await secondChance(true);
    const everyone = [...new Set([p, q, ...s])];
    reachResultView(r);
    assert.deepEqual(r.view('A').mini.medals, [1]);
    const before = {};
    everyone.forEach((id) => { before[id] = stars(r, id); });
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 100);
    const rw = rewardsFromFx(r);
    everyone.forEach((id) => { assert.equal(rw[id], 2, id); assert.equal(stars(r, id), before[id], id + ' yıldız yok'); });
    const line = lastResultLog(r);
    assert.equal(medalCount(line, '🥇'), 0, line);
    assert.equal(medalCount(line, '🥈'), 3, line);
});

test('kazanan/kaybeden akışı değişmedi: tek çiftte 🥇 + 🥈, medals null (sıralamadan türer)', async () => {
    const r = await reachDuel('xox');
    const { first, second } = mover(r, 0);
    playToWin(r, 'xox', 0);
    await r.settle();
    assert.equal(r.view('A').mini.medals, null);
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 100);
    assert.deepEqual(rewardsFromFx(r), { [first]: 1, [second]: 2 });
    const line = lastResultLog(r);
    assert.equal(medalCount(line, '🥇'), 1, line);
    assert.equal(medalCount(line, '🥈'), 1, line);
});
