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

// ---- Düşen Zemin sürücüsü ----
const DZ = require('../games/parti/mini/dusenzemin-rules.js');
const dz = Drivers.dusenzemin;
const PLY = ['a', 'b', 'c'];
const CTX = { seed: 5, n: 3 };
const mkDz = (stAt) => ({ stAt, endAt: stAt + C.DUSENZEMIN_MS, sn: 0, rep: { a: dz.newRep('a', { stAt, seed: 5, players: PLY }), b: dz.newRep('b', { stAt, seed: 5, players: PLY }) }, pubAt: 0, dirty: false });

test('dusenzemin: sürücü sözleşmesi, süreler, newRep başlangıç halkası, packRep/unpackRep gidiş-dönüş ve geçersiz veri', () => {
    assert.equal(dz.countdownMs, C.DUSENZEMIN_COUNTDOWN_MS);
    assert.equal(dz.durationMs, C.DUSENZEMIN_MS);
    assert.equal(typeof dz.watch, 'function');
    const sp = DZ.startPositions(5, 3);
    const q = dz.newRep('b', { stAt: 1000, seed: 5, players: PLY });
    assert.deepEqual({ x: q.x, y: q.y, out: q.out, n: q.n, at: q.at, seen: q.seen, atMs: q.atMs }, { x: sp[1].x, y: sp[1].y, out: -1, n: -1, at: 1000, seen: 0, atMs: 0 });
    const raw = dz.packRep({ x: 10, y: 20, z: 5, vx: -30, vy: 40, out: 12345, atMs: 9000 });
    assert.deepEqual(raw, [10, 20, 5, -30, 40, 12345, 9000]);
    const u = dz.unpackRep(raw, { stAt: 7000 });
    assert.deepEqual({ x: u.x, y: u.y, z: u.z, vx: u.vx, vy: u.vy, out: u.out, atMs: u.atMs, n: u.n, at: u.at, seen: u.seen }, { x: 10, y: 20, z: 5, vx: -30, vy: 40, out: 12345, atMs: 9000, n: -1, at: 7000, seen: 1 });
    [null, [], [1, 2, 3], [0, 0, 0, 0, 0, 0], [999, 0, 0, 0, 0, -1, 0], [0, 0, 99, 0, 0, -1, 0], [0, 0, 0, 900, 0, -1, 0], [0, 0, 0, 0, 0, -2, 0], [0, 0, 0, 0, 0, -1, -1], [0.5, 0, 0, 0, 0, -1, 0], 'x'].forEach((bad) => assert.equal(dz.unpackRep(bad, { stAt: 0 }), null, JSON.stringify(bad)));
});

test('dusenzemin accept(pos): makul rapor kabul, ışınlanma/tekrar n/yanlış tür reddedilir, ilk rapor final, push liderde yok sayılır', () => {
    const ff = mkDz(0);
    const sp = DZ.startPositions(5, 3)[0];
    const P = (o) => Object.assign({ k: 'pos', n: 1, x: sp.x, y: sp.y, z: 0, vx: 0, vy: 0, a: 1 }, o);
    let r = dz.accept(ff, 'a', P({ n: 5 }), 20000, CTX);
    assert.deepEqual(r, { ok: true, changed: false, final: true }, 'ilk rapor');
    assert.equal(ff.sn, 1);
    assert.equal(ff.rep.a.atMs, 20000);
    r = dz.accept(ff, 'a', P({ n: 5 }), 20100, CTX);
    assert.equal(r.ok, false, 'tekrar n');
    r = dz.accept(ff, 'a', P({ n: 6, x: sp.x + 300 }), 20100, CTX);
    assert.equal(r.ok, false, 'ışınlanma');
    r = dz.accept(ff, 'a', P({ n: 7, x: sp.x + 40 }), 20125, CTX);
    assert.deepEqual(r, { ok: true, changed: true, final: false });
    assert.equal(dz.accept(ff, 'a', P({ k: 'push', to: 'b', dx: 1, dy: 1, n: 8 }), 20200, CTX).ok, false, 'push liderde yok sayılır');
    assert.equal(dz.accept(ff, 'zzz', P({ n: 1 }), 20200, CTX).ok, false);
    assert.equal(dz.accept(ff, 'a', null, 20200, CTX).ok, false);
    assert.equal(dz.accept(ff, 'a', P({ n: 9, z: 99 }), 20200, CTX).ok, false, 'yükseklik sınırı');
});

test('dusenzemin accept(out): kare yıkımı -> anahtar yıkılış anı (aynı turda eşit); kenar -> kendi ms; ortada reddedilir; ikinci out donuk', () => {
    const sc = DZ.schedule(5, 3);
    const r1 = sc.rounds[1];
    const [ta, tb] = r1.doomed;
    const A = DZ.tileCenter(ta);
    const B = DZ.tileCenter(tb);
    const c = r1.collapseMs;
    const ff = mkDz(0);
    ff.rep.a.x = A.x; ff.rep.a.y = A.y; ff.rep.a.atMs = c - 100; ff.rep.a.seen = 1;
    ff.rep.b.x = B.x; ff.rep.b.y = B.y; ff.rep.b.atMs = c - 100; ff.rep.b.seen = 1;
    ff.sn = 2;
    const t = c + 300;
    let r = dz.accept(ff, 'a', { k: 'out', t: c + 150, n: 3 }, t, CTX);
    assert.deepEqual(r, { ok: true, changed: true, final: true });
    assert.equal(ff.rep.a.out, c);
    r = dz.accept(ff, 'b', { k: 'out', t: c + 420, n: 3 }, t + 300, CTX);
    assert.equal(r.ok, true);
    assert.equal(ff.rep.b.out, c, 'aynı yıkılış turu: aynı anahtar');
    r = dz.accept(ff, 'a', { k: 'out', t: c + 160, n: 4 }, t + 400, CTX);
    assert.deepEqual(r, { ok: true, changed: false, final: false }, 'ikinci out yok sayılır');
    assert.equal(ff.rep.a.out, c);
    r = dz.accept(ff, 'a', { k: 'pos', n: 5, x: 1, y: 1, z: 0, vx: 0, vy: 0, a: 1 }, t + 500, CTX);
    assert.equal(r.changed, false);
    assert.equal(ff.rep.a.x, A.x, 'pos elenmişi değiştirmez');
    const ff2 = mkDz(0);
    ff2.rep.a.x = 256; ff2.rep.a.y = 256; ff2.rep.a.atMs = 50000;
    assert.equal(dz.accept(ff2, 'a', { k: 'out', t: 50300, n: 1 }, 50400, CTX).ok, false, 'merkezden out olamaz');
    ff2.rep.a.x = 500;
    assert.equal(dz.accept(ff2, 'a', { k: 'out', t: 50300 + 9000, n: 1 }, 50400, CTX).ok, false, 'liderin saatinden ileri');
    const e = dz.accept(ff2, 'a', { k: 'out', t: 50300, n: 2 }, 50400, CTX);
    assert.equal(e.ok, true);
    assert.equal(ff2.rep.a.out, 50300, 'kenar düşmesi: kendi ms');
});

test('dusenzemin out kaybolursa: ilk out düşer, tekrarlanan ikincisi kabul edilir -> doğru derece; sonraki tekrarlar sonucu/eşitliği DEĞİŞTİRMEZ', () => {
    const sc = DZ.schedule(5, 3);
    const c = sc.rounds[1].collapseMs;
    const A = DZ.tileCenter(sc.rounds[1].doomed[0]);
    const B = DZ.tileCenter(sc.rounds[1].doomed[1]);
    const ff = mkDz(0);
    ff.rep.a.x = A.x; ff.rep.a.y = A.y; ff.rep.a.atMs = c - 100; ff.rep.a.seen = 1;
    ff.rep.b.x = B.x; ff.rep.b.y = B.y; ff.rep.b.atMs = c - 100; ff.rep.b.seen = 1;
    ff.sn = 2;
    // a'nın ilk out'u ağda kayboldu (liderde hiç yok): henüz elenmedi
    assert.equal(ff.rep.a.out, -1);
    // b aynı turda düştü, raporu geldi
    assert.equal(dz.accept(ff, 'b', { k: 'out', t: c + 130, n: 5 }, c + 200, CTX).ok, true);
    // 2 sn sonra a'nın TEKRAR out'u (n arttı) gelir: kabul edilir, aynı yıkılış turu -> eşit derece
    const r = dz.accept(ff, 'a', { k: 'out', t: c + 130, n: 6 }, c + 2200, CTX);
    assert.deepEqual(r, { ok: true, changed: true, final: true });
    assert.equal(ff.rep.a.out, c);
    const before = JSON.stringify(ff.rep);
    // sonraki tekrarlar (b ve a) hiçbir şeyi değiştirmez
    [['a', 7, c + 4300], ['b', 6, c + 4300], ['a', 8, c + 6400], ['b', 7, c + 6400]].forEach(([id, n, t]) => {
        const rr = dz.accept(ff, id, { k: 'out', t: c + 130, n }, t, CTX);
        assert.deepEqual(rr, { ok: true, changed: false, final: false }, id + ' tekrarı');
    });
    const after = JSON.parse(JSON.stringify(ff.rep));
    ['a', 'b'].forEach((id) => { assert.equal(after[id].out, c); assert.equal(after[id].x, JSON.parse(before)[id].x); });
    ff.sn = 2;
    const rk = (extra) => dz.rank(Object.assign({ players: PLY, bots: [], seed: 5, ff, endMs: 120000 }, extra));
    assert.deepEqual(rk().map((g) => g.slice().sort()), [['c'], ['a', 'b']], 'c hayatta 1.; a ve b aynı turda eşit');
});

test('dusenzemin watch (donan telefon): 5 sn sessizlik + yıkılmış kare -> elenir; güvenli kare / <5 sn -> elenmez', () => {
    const sc = DZ.schedule(5, 3);
    const gone = sc.rounds[1].doomed[0];
    const c = sc.collapse[gone];
    const G = DZ.tileCenter(gone);
    const F = DZ.tileCenter(sc.finalTile);
    const ff = mkDz(0);
    ff.rep.a.x = G.x; ff.rep.a.y = G.y; ff.rep.a.atMs = c - 1000; ff.rep.a.seen = 1;
    ff.rep.b.x = F.x; ff.rep.b.y = F.y; ff.rep.b.atMs = c - 1000; ff.rep.b.seen = 1;
    assert.equal(dz.watch(ff, c + 3900, CTX), false, '4.9 sn: henüz değil');
    assert.equal(ff.rep.a.out, -1);
    assert.equal(dz.watch(ff, c + 4100, CTX), true, '5.1 sn + yıkık kare');
    assert.equal(ff.rep.a.out, c);
    assert.equal(ff.rep.b.out, -1, 'güvenli kareye basan sessiz oyuncu elenmez');
    assert.equal(dz.watch(ff, c + 60000, CTX), false, 'tekrar değişiklik yok');
});

test('dusenzemin allDone / rank / resume / onTakeover / summaryRow', () => {
    const sc = DZ.schedule(5, 3);
    const c1 = sc.rounds[1].collapseMs;
    const ff = mkDz(0);
    const ctx = (bots) => ({ seed: 5, players: PLY, bots: bots || [] });
    assert.equal(dz.allDone(ff, [], 10000, ctx()), false, 'iki hayatta');
    ff.rep.a.out = c1;
    assert.equal(dz.allDone(ff, ['a', 'b'], 10000, ctx()), true, 'hayatta ≤ 1 (b tek başına)');
    ff.rep.a.out = -1; ff.rep.b.out = -1;
    assert.equal(dz.allDone(ff, ['a', 'b'], 10000, ctx(['c'])), false, '2 insan + 1 bot hayatta');
    ff.rep.a.out = c1; ff.rep.b.out = c1;
    assert.equal(dz.allDone(ff, ['a', 'b'], 10000, ctx(['c'])), true, 'bağlı hayatta insan yok');
    assert.equal(dz.allDone(ff, [], 10000, ctx()), true, 'hepsi elendi (hayatta 0)');
    const f2 = mkDz(0);
    f2.rep.a.out = c1;
    const fall = DZ.botFall(5, 'c', sc);
    assert.equal(dz.allDone(f2, ['b'], fall - 1, ctx(['c'])), false, 'bot daha düşmedi');
    assert.equal(dz.allDone(f2, ['b'], fall + 1, ctx(['c'])), true, 'bot düştü, tek hayatta insan');
    const f3 = mkDz(0);
    assert.equal(dz.rank({ players: PLY, bots: ['c'], seed: 5, ff: f3, endMs: 1000 }), null, 'rapor yok: çark');
    f3.sn = 2;
    f3.rep.a.out = c1;
    const rk = dz.rank({ players: PLY, bots: ['c'], seed: 5, ff: f3, endMs: 120000 });
    assert.equal(rk.flat().length, 3);
    assert.deepEqual(rk, DZ.rank({ players: PLY, bots: ['c'], seed: 5, sched: sc, outs: { a: { key: c1 } }, endMs: 120000 }));
    assert.equal(dz.resume(dz.newRep('a', { stAt: 0, seed: 5, players: PLY })), null);
    assert.deepEqual(dz.resume({ seen: 1, x: 10, y: 20, z: 0, vx: 1, vy: 2, out: -1 }), { x: 10, y: 20, z: 0, vx: 1, vy: 2, out: -1 });
    assert.equal(dz.resume({ seen: 1, x: 10, y: 20, z: 0, vx: 0, vy: 0, out: 5555 }).out, 5555, 'elenmiş: out taşınır (hayalet)');
    const f4 = mkDz(1000);
    f4.rep.a.n = 99; f4.rep.a.at = 4242; f4.rep.a.atMs = 100; f4.rep.b.out = 777; f4.rep.b.atMs = 333;
    dz.onTakeover(f4, 61000);
    assert.equal(f4.rep.a.n, -1);
    assert.equal(f4.rep.a.at, 1000);
    assert.equal(f4.rep.a.atMs, 60000, 'sessizlik sayacı sıfırlandı');
    assert.equal(f4.rep.b.atMs, 333, 'elenmişe dokunulmaz');
    const f5 = mkDz(0);
    f5.rep.a.out = 12000;
    const ra = dz.summaryRow(f5, 'a', 30000, { seed: 5, players: PLY });
    assert.deepEqual({ bot: ra.bot, alive: ra.alive, out: ra.out, done: ra.done }, { bot: false, alive: false, out: 12000, done: true });
    assert.match(ra.text, /💀 12\.0 sn/);
    const rb = dz.summaryRow(f5, 'b', 30000, { seed: 5, players: PLY });
    assert.equal(rb.alive, true);
    assert.match(rb.text, /Hayatta/);
    const rc = dz.summaryRow(f5, 'c', DZ.botFall(5, 'c', sc) + 1, { seed: 5, players: PLY });
    assert.deepEqual({ bot: rc.bot, alive: rc.alive }, { bot: true, alive: false });
    assert.equal(dz.summaryRow(f5, 'c', DZ.botFall(5, 'c', sc) - 1, { seed: 5, players: PLY }).alive, true);
});
