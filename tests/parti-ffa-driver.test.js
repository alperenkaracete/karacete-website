// ffa sürücü arayüzü (mini/ffa-drivers.js): her sürücü sözleşmedeki her parçayı sağlar; Kurbağa sürücüsü davranışı.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const K = require('../games/parti/mini/kurbaga-rules.js');
const Drivers = require('../games/parti/mini/ffa-drivers.js');
const Registry = require('../games/parti/mini/registry.js');

const FUNCS = ['newRep', 'packRep', 'unpackRep', 'accept', 'allDone', 'rank', 'resume', 'onTakeover', 'summaryRow'];

test('sözleşme: her sürücü kimlik, süreler ve tüm işlevleri sağlar; yalnız registry ffa oyunları için', () => {
    Object.keys(Drivers).forEach((id) => {
        const d = Drivers[id];
        assert.equal(d.id, id);
        assert.ok(Registry.get(id) && Registry.get(id).kind === 'ffa', id + ' registry ffa oyunu');
        assert.ok(d.countdownMs > 0 && d.durationMs > d.countdownMs && d.publishMs > 0);
        FUNCS.forEach((f) => assert.equal(typeof d[f], 'function', id + '.' + f));
    });
    assert.ok(Drivers.kurbaga);
    assert.equal(Drivers.kurbaga.countdownMs, C.KURBAGA_COUNTDOWN_MS);
    assert.equal(Drivers.kurbaga.durationMs, C.KURBAGA_MS);
});

const mkFf = (stAt) => ({ stAt, endAt: stAt + C.KURBAGA_MS, sn: 0, rep: { a: Drivers.kurbaga.newRep('a', { stAt }), b: Drivers.kurbaga.newRep('b', { stAt }) }, pubAt: 0, dirty: false });

test('kurbaga: newRep başlangıçta ortada, packRep/unpackRep gidiş-dönüş, geçersiz ham veri null', () => {
    const d = Drivers.kurbaga;
    const q = d.newRep('a', { stAt: 1000 });
    assert.deepEqual({ r: q.r, c: q.c, d: q.d, f: q.f, n: q.n, at: q.at, seen: q.seen }, { r: 0, c: 4, d: 0, f: -1, n: -1, at: 1000, seen: 0 });
    const raw = d.packRep({ r: 5, c: 2, d: 3, f: -1 });
    assert.deepEqual(raw, [5, 2, 3, -1]);
    const u = d.unpackRep(raw, { stAt: 7000 });
    assert.deepEqual({ r: u.r, c: u.c, d: u.d, f: u.f, n: u.n, at: u.at, seen: u.seen }, { r: 5, c: 2, d: 3, f: -1, n: -1, at: 7000, seen: 1 });
    [null, [], [1, 2, 3], [10, 0, 0, -1], [0, 9, 0, -1], [0, 0, -1, -1], [0, 0, 0, -2], [0.5, 0, 0, -1], 'x', { r: 1 }].forEach((bad) => assert.equal(d.unpackRep(bad, { stAt: 0 }), null, JSON.stringify(bad)));
});

test('kurbaga accept: geçerli rapor changed/final, tekrar n reddedilir, ışınlanma reddedilir, ilk varış son çağrı kurar, varmış donuk', () => {
    const d = Drivers.kurbaga;
    const ff = mkFf(0);
    const t = 30000;
    let r = d.accept(ff, 'a', { k: 'pos', r: 1, c: 4, d: 0, n: 5 }, t);
    assert.deepEqual(r, { ok: true, changed: true, final: true }, 'ilk rapor: hemen yayın');
    assert.equal(ff.sn, 1);
    r = d.accept(ff, 'a', { k: 'pos', r: 1, c: 4, d: 0, n: 5 }, t + 10);
    assert.equal(r.ok, false, 'tekrar n');
    r = d.accept(ff, 'a', { k: 'pos', r: 6, c: 4, d: 0, n: 6 }, t + 10);
    assert.equal(r.ok, false, 'ışınlanma');
    r = d.accept(ff, 'a', { k: 'pos', r: 2, c: 4, d: 0, n: 7 }, t + 200);
    assert.deepEqual(r, { ok: true, changed: true, final: false });
    r = d.accept(ff, 'a', { k: 'pos', r: 2, c: 4, d: 0, n: 8 }, t + 400);
    assert.deepEqual(r, { ok: true, changed: false, final: false }, 'değişiklik yok');
    assert.equal(d.accept(ff, 'zzz', { k: 'pos', r: 0, c: 4, d: 0, n: 1 }, t).ok, false, 'rep yok');
    assert.equal(d.accept(ff, 'a', { k: 'x', r: 2, c: 4, d: 0, n: 9 }, t).ok, false, 'k yanlış');
    assert.equal(d.accept(ff, 'a', null, t).ok, false);
    // varış: 9 satıra tırman
    let n = 20; let tt = t + 1000;
    for (let row = 3; row <= 8; row++) { d.accept(ff, 'a', { k: 'pos', r: row, c: 4, d: 0, n: ++n }, tt); tt += 160; }
    const end0 = ff.endAt;
    r = d.accept(ff, 'a', { k: 'pos', r: 9, c: 4, d: 0, n: ++n, e: 29000 }, tt);
    assert.equal(r.final, true);
    assert.equal(ff.endAt, tt + C.KURBAGA_LAST_CALL_MS, 'son çağrı');
    assert.ok(ff.endAt < end0);
    const endAfter = ff.endAt;
    r = d.accept(ff, 'a', { k: 'pos', r: 0, c: 4, d: 1, n: ++n }, tt + 100);
    assert.deepEqual(r, { ok: true, changed: false, final: false }, 'varmış: donuk');
    assert.equal(ff.rep.a.r, 9);
    // ikinci varış uzatmaz
    n = 40; tt += 500;
    for (let row = 1; row <= 8; row++) { d.accept(ff, 'b', { k: 'pos', r: row, c: 4, d: 0, n: ++n }, tt); tt += 160; }
    d.accept(ff, 'b', { k: 'pos', r: 9, c: 4, d: 0, n: ++n, e: 31000 }, tt);
    assert.equal(ff.endAt, endAfter);
});

test('kurbaga allDone / rank / resume / onTakeover / summaryRow', () => {
    const d = Drivers.kurbaga;
    const ff = mkFf(0);
    assert.equal(d.allDone(ff, []), false, 'canlı insan yok');
    assert.equal(d.allDone(ff, ['a', 'b']), false);
    ff.rep.a.f = 20000; ff.rep.b.f = 21000;
    assert.equal(d.allDone(ff, ['a', 'b']), true);
    assert.equal(d.allDone(ff, ['a']), true);
    // rank: rapor yok -> null (makine çarka düşer); rapor varsa sıralama
    assert.equal(d.rank({ players: ['a', 'b'], bots: [], seed: 1, ff, endMs: 1000 }), null);
    ff.sn = 2;
    assert.deepEqual(d.rank({ players: ['a', 'b'], bots: [], seed: 1, ff, endMs: 60000 }), [['a'], ['b']]);
    // resume
    assert.equal(d.resume(d.newRep('a', { stAt: 0 })), null, 'hiç rapor yok: resume yok');
    assert.deepEqual(d.resume({ seen: 1, r: 3, c: 2, d: 1, f: -1 }), { r: 3, c: 2, d: 1, f: -1 });
    assert.deepEqual(d.resume({ seen: 1, r: 9, c: 2, d: 0, f: 12000 }), { r: 9, c: 2, d: 0, f: 12000 });
    // onTakeover
    ff.rep.a.n = 99; ff.rep.a.at = 12345;
    d.onTakeover(ff);
    assert.equal(ff.rep.a.n, -1);
    assert.equal(ff.rep.a.at, ff.stAt);
    // summaryRow: insan (rep var) ve bot (tohumdan)
    const row = d.summaryRow(ff, 'a', 30000, { seed: 9 });
    assert.deepEqual({ id: row.id, bot: row.bot, row: row.row, fin: row.fin, d: row.d, done: row.done }, { id: 'a', bot: false, row: 0, fin: 20000, d: 0, done: true });
    assert.match(row.text, /🏁 20\.0 sn/);
    assert.equal(row.pct, 0);
    const bot = d.summaryRow(ff, 'botX', 30000, { seed: 9 });
    assert.equal(bot.bot, true);
    assert.equal(bot.row, K.botProgress(9, 'botX', 30000));
    assert.ok(/\d\/9|🏁/.test(bot.text));
    assert.ok(bot.pct >= 0 && bot.pct <= 1);
});

const { reachFfa } = require('./duel-room.js');

test('GEÇİCİ (aşama 1): sürücüsü olmayan ffa oyunu (dusenzemin) seçilirse çark yedeğine düşer, takılmaz; aşama 3 te kalkar', async () => {
    assert.equal(Drivers.dusenzemin, undefined);
    assert.ok(Registry.get('dusenzemin'), 'kayıtlı ama sürücüsüz');
    const r = await reachFfa({ humans: 3, game: 'dusenzemin' });
    const mn = r.state('A').mn;
    assert.ok(!mn.ff, 'ffa jetonu yok');
    assert.equal(mn.gm, null, 'oyun kimliği yok: çark');
    r.advance(200, 100);
    assert.ok(r.state('A').mn.applyAt > 0 || r.state('A').g.stage !== 'mini', 'çark sonucu kaydedildi');
    r.advance(6000, 250);
    assert.equal(r.state('A').g.stage, 'roll', 'yeni tur: takılmadı');
    assert.equal(r.state('A').g.lm, undefined, 'çark yedeği lm yazmaz');
});
