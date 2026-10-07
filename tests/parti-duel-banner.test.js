// Parti düello: sonuç bannerı son atışın animasyonu bitene kadar gecikir (kayıt ve ödül hemen yazılır).
// Saf yardımcılar (animMs/bannerMs), catdog.js ile sayı ayrışması, makine akışı, ikinci şans zamanı, 'limit' şeridi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../games/parti/config.js');
const Adapter = require('../games/parti/mini/duel-adapter.js');
const { reachDuel, pairOf, playToWin, mover, cdShoot, rewardsFromFx, N, MAXHOLD, CDR } = require('./duel-room.js');
const { fakeRoot, makeDefs, clock } = require('./duel-fakes.js');

const shotsOf = (...frames) => ({ kind: 'shot', shots: frames.map((f) => ({ frames: f })) });
const strips = (root) => root.children.filter((c) => c.className === 'pt-duel-strip');
const strip = (r, id) => strips(r.nodes[id].root)[0];

// ---- Saf yardımcılar ----
test('animMs: tek atış, ×2 iki mermi, sınırlar, atış olmayan hamle', () => {
    assert.equal(Adapter.animMs(shotsOf(60)), 1000 + 700, 'tek atış: uçuş + son bekleme');
    assert.equal(Adapter.animMs(shotsOf(60, 60)), 1000 + 650 + 1000 + 700, '×2: iki mermi, aralarında 650');
    assert.equal(Adapter.animMs(shotsOf(5)), 500 + 700, 'uçuş en az 500');
    assert.equal(Adapter.animMs(shotsOf(1200)), 2600 + 700, 'uçuş en çok 2600');
    assert.equal(Adapter.animMs(shotsOf(1200, 1200)), 2600 + 650 + 2600 + 700, 'en kötü durum 6550');
    assert.equal(Adapter.animMs({ kind: 'heal', shooter: 0 }), 0);
    assert.equal(Adapter.animMs(null), 0);
    assert.equal(Adapter.animMs({ kind: 'shot', shots: [] }), 0);
    assert.equal(Adapter.animMs(shotsOf(120), 1 / 30), 2600 > 4000 ? 2600 : 4000 > 2600 ? 2600 + 700 : 0, 'dt parametresi uçuşu ölçekler (kenetlenir)');
});

test('bannerMs = animMs + ANIM_NET_PAD_MS; animasyon yoksa (XOX/Dörtlü/forfeit) pad eklenmez', () => {
    assert.equal(C.ANIM_NET_PAD_MS, 500);
    assert.equal(Adapter.bannerMs(1700), 1700 + C.ANIM_NET_PAD_MS);
    assert.equal(Adapter.bannerMs(0), 0);
    assert.equal(Adapter.GAMES.xox.anim, undefined);
    assert.equal(Adapter.GAMES.connect4.anim, undefined);
});

test('animMs sayıları games/catdog.js animasyonuyla ayrışmaz (500/2600/650/700)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'catdog.js'), 'utf8');
    assert.match(src, /Math\.max\(500, Math\.min\(2600, shot\.frames \* R\.DT \* 1000\)\)/, 'uçuş süresi formülü');
    assert.match(src, /anim\.shotIndex \+ 1 < last\.shots\.length \? 650 : 700/, 'bekleme süreleri');
    assert.equal(CDR.DT, 1 / 60);
});

test('duelHold: banner gecikmesi hold içinde değil (limit payı yok); forfeit/fuse 0', () => {
    assert.equal(C.duelHold('catdog', 'limit'), C.duelHold('catdog', 'win'));
    assert.equal(C.duelHold('catdog', 'win'), 4000);
    assert.equal(C.duelHold('xox', 'win'), 2500);
    assert.equal(C.duelHold('catdog', 'forfeit'), 0);
    assert.equal(C.duelHold('catdog', 'fuse'), 0);
});

// ---- Makine akışı ----
// i. maçta sıradaki oyuncu için DOĞRUDAN isabet (30 hasar) bulup oynatır
function shootDirect(r, i) {
    const [p1, p2] = pairOf(r, i || 0);
    const d = r.lastDefs(p1).view.myTurn ? r.lastDefs(p1) : r.lastDefs(p2);
    const v = d.view;
    for (let a = 0; a <= 180; a += 1) {
        for (let p = 0; p <= 100; p += 1) {
            const mv = { kind: 'shot', turn: v.board.turn, angle: a, power: p, powerUp: null };
            const n = CDR.apply(v.board, mv, v.myIndex).board;
            const before = v.board.players[1 - v.myIndex].hp;
            if (before - n.players[1 - v.myIndex].hp === Math.min(30, before)) {   // son isabette can 30'dan az kalmış olabilir
                assert.equal(d.duel.move(mv), true);
                r.flush();
                return;
            }
        }
    }
    throw new Error('doğrudan isabet bulunamadı');
}

// ilk başlayan 4 doğrudan isabetle bitirir (arada ikinci başlayan hasarsız atar): ölümle bitiş, reason 'win'
function winByKill(r, i) {
    for (let k = 0; k < 4; k++) {
        shootDirect(r, i);
        if (k < 3) cdShoot(r, false, i);
    }
}

test('Kedi-Köpek ölümle bitiş: kayıt ve ödül hemen; banner verisi animasyon + 500 ms dolunca', async () => {
    const r = await reachDuel('catdog');
    const { first, second } = mover(r, 0);
    winByKill(r, 0);
    await r.settle();
    const mn = r.state('A').mn;
    const x = mn.pm[0];
    const last = r.lastDefs(first).view.board.last;
    const bm = Adapter.bannerMs(Adapter.animMs(last));
    assert.ok(x.out && !x.out.d, 'sonuç hemen kaydedildi');
    assert.deepEqual(mn.rk, [[first], [second]], 'ödül sıralaması hemen yazıldı');
    assert.ok(mn.applyAt, 'ödül zamanı belli');
    assert.equal(x.bAt - r.clock, bm, 'bAt = kayıt + animasyon + ağ payı');
    // süre dolmadan banner verisi YOK
    ['A', 'B'].forEach((id) => {
        const p = r.view(id).mini.pairs[0];
        assert.equal(p.done, false); assert.equal(p.winner, null); assert.equal(p.draw, false); assert.equal(p.reason, '');
        assert.deepEqual(r.view(id).mini.ranking, []);
        assert.equal(r.view(id).mini.left, -1);
        assert.equal(strip(r, id), undefined, id + ' şerit/banner yok');
    });
    r.advance(bm - 100, 50);
    ['A', 'B'].forEach((id) => { assert.equal(r.view(id).mini.pairs[0].done, false); assert.equal(strip(r, id), undefined); });
    // dolunca banner verisi VAR
    r.advance(200, 50);
    ['A', 'B'].forEach((id) => {
        const p = r.view(id).mini.pairs[0];
        assert.equal(p.done, true); assert.equal(p.winner, first); assert.equal(p.reason, 'win');
        assert.deepEqual(r.view(id).mini.ranking, [[first], [second]]);
        assert.ok(strip(r, id).textContent.includes('🏆'));
    });
    // zaman sırası: bAt <= hAt <= applyAt
    assert.ok(x.bAt <= x.hAt, 'bAt <= hAt');
    assert.equal(x.hAt - x.bAt, C.duelHold('catdog', 'win'), 'hAt = bAt + sonuç tutma');
    assert.ok(mn.applyAt >= x.hAt, 'applyAt >= hAt');
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    assert.deepEqual(rewardsFromFx(r), { [first]: 1, [second]: 2 });
});

test('bAt yoksa (eski durum) banner gecikmesiz görünür', async () => {
    const r = await reachDuel('catdog');
    winByKill(r, 0);
    await r.settle();
    assert.equal(r.view('A').mini.pairs[0].done, false, 'gecikme sürüyor');
    r.state('A').mn.pm[0].bAt = 0;
    const p = r.view('A').mini.pairs[0];
    assert.equal(p.done, true);
    assert.ok(p.winner);
});

test('XOX/Dörtlü: banner gecikmesiz (bAt yok, veri hemen)', async () => {
    for (const game of ['xox', 'connect4']) {
        const r = await reachDuel(game);
        const { first } = mover(r, 0);
        playToWin(r, game, 0);
        await r.settle();
        const x = r.state('A').mn.pm[0];
        assert.equal(x.bAt, 0, game);
        assert.equal(x.hAt - r.clock, C.duelHold(game, 'win'), game + ': hAt yalnız tutma kadar');
        const p = r.view('A').mini.pairs[0];
        assert.equal(p.done, true); assert.equal(p.winner, first);
    }
});

test('forfeit: banner gecikmesiz, hold 0', async () => {
    const r = await reachDuel('catdog');
    r.leave('B');
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    await r.settle();
    const x = r.state('A').mn.pm[0];
    assert.ok(x.out);
    assert.equal(x.bAt, 0);
    assert.equal(r.view('A').mini.pairs[0].done, true);
});

// ---- İkinci şans ----
test('ikinci şans maçı ilk maçın hAt zamanından önce başlamaz (hAt >= bAt > kayıt)', async () => {
    const r = await reachDuel('catdog', { humans: 3 });
    const mn0 = r.state('A').mn;
    assert.equal(mn0.pm.length, 1);
    assert.ok(mn0.ex, 'üçüncü kişi ikinci şansa bekliyor');
    const t0 = r.clock;
    winByKill(r, 0);
    await r.settle();
    const mn = r.state('A').mn;
    assert.equal(mn.pm.length, 2, 'ikinci şans maçı kuruldu');
    assert.ok(mn.pm[0].bAt > t0, 'banner gecikmeli');
    assert.ok(mn.pm[0].hAt >= mn.pm[0].bAt);
    assert.ok(mn.pm[1].stAt >= mn.pm[0].hAt, 'ikinci şans en erken ilk maçın hAt zamanında');
    assert.ok(mn.pm[1].stAt > mn.pm[0].bAt, 'kaybeden bannerı görmeden ekran değişmez');
    // L oturumu hAt'e kadar açık kalır
    const loser = mn.pm[0].out.l;
    r.advance(mn.pm[0].hAt - r.clock - 200, 50);
    assert.ok(r.nodes[loser].root.textContent !== '', 'kaybeden hAt dolmadan yeni maça geçmedi');
});

// ---- 'limit' şeridi ----
function catdogRoom(options) {
    const clk = clock();
    const players = ['A', 'B'];
    const names = { A: 'Ayşe', B: 'Bora' };
    const members = {};
    const queue = [];
    const held = [];
    const api = { clk, members, held, results: {} };
    function join(id) {
        const root = fakeRoot();
        const defs = makeDefs('cd', CDR);
        const handler = { fn: null };
        const net = {
            send: (m) => {
                const copy = JSON.parse(JSON.stringify(m));
                Object.keys(members).forEach((o) => {
                    if (o === id) return;
                    if (options.holdResult && o === 'B' && copy.k === 'result') held.push({ from: id, m: copy }); else queue.push({ to: o, from: id, m: copy });
                });
                if (!api.flushing) api.flush();
            },
            on: (fn) => { handler.fn = fn; return () => { handler.fn = null; }; }
        };
        members[id] = { id, root, defs, handler };
        Adapter.run({
            type: 'duel', game: 'catdog', players, seed: 7, me: { id, name: names[id] }, isLeader: id === 'A', leader: 'A',
            root, net, deadlineMs: 120000, signal: new AbortController().signal, defs, names, timers: clk.timers, now: clk.now
        }).then((res) => { api.results[id] = res; });
    }
    api.flushing = false;
    api.flush = () => {
        api.flushing = true;
        while (queue.length) { const q = queue.shift(); const m = members[q.to]; if (m && m.handler.fn) m.handler.fn(q.from, q.m); }
        api.flushing = false;
    };
    api.join = join;
    api.shoot = () => {
        const id = members.A.defs.view.myTurn ? 'A' : 'B';
        const v = members[id].defs.view;
        for (let a = 0; a <= 180; a += 3) {
            for (let p = 0; p <= 100; p += 3) {
                const mv = { kind: 'shot', turn: v.board.turn, angle: a, power: p, powerUp: null };
                const n = CDR.apply(v.board, mv, v.myIndex).board;
                if (n.players[0].hp === v.board.players[0].hp && n.players[1].hp === v.board.players[1].hp) {
                    assert.equal(members[id].defs.duel.move(mv), true);
                    api.flush();
                    return;
                }
            }
        }
        throw new Error('hasarsız atış bulunamadı');
    };
    return api;
}

async function limitMatch(options) {
    const t = catdogRoom(options);
    t.join('A'); t.join('B');
    t.flush();
    for (let i = 0; i < 2 * N; i++) t.shoot();
    await Promise.resolve(); await Promise.resolve();
    return t;
}

test("'limit': sonuç şeritten ÖNCE gelirse 'hesaplanıyor' hiç görünmez; tek eleman, banner gecikmeli", async () => {
    const t = await limitMatch({});
    const last = t.members.A.defs.view.board.last;
    const D = Adapter.bannerMs(Adapter.animMs(last));
    assert.ok(D > 0);
    ['A', 'B'].forEach((id) => assert.equal(strips(t.members[id].root).length, 0, 'süre dolmadan şerit yok'));
    const seen = [];
    for (let t0 = 0; t0 < D - 100; t0 += 100) {
        t.clk.advance(100);
        ['A', 'B'].forEach((id) => assert.equal(strips(t.members[id].root).length, 0));
    }
    t.clk.advance(300);
    ['A', 'B'].forEach((id) => {
        const s = strips(t.members[id].root);
        assert.equal(s.length, 1, id + ': tek şerit elemanı');
        assert.ok(s[0].textContent.startsWith(Adapter.limitInfo().title + ' · '), 'şerit + banner birlikte');
        assert.ok(!s[0].textContent.includes('hesaplanıyor'));
        seen.push(s[0].textContent);
    });
    assert.ok(seen.every((x) => /🏆|🤝/.test(x)));
});

test("'limit': sonuç GEÇ gelirse önce 'hesaplanıyor' şeridi, sonra banner AYNI elemanın yerini alır (üst üste yok)", async () => {
    const t = await limitMatch({ holdResult: true });
    const D = Adapter.bannerMs(Adapter.animMs(t.members.A.defs.view.board.last));
    const bRoot = t.members.B.root;
    assert.equal(t.held.length, 1, 'B için sonuç tutuldu');
    t.clk.advance(D - 50);
    assert.equal(strips(bRoot).length, 0);
    t.clk.advance(100);
    assert.equal(strips(bRoot).length, 1);
    assert.equal(strips(bRoot)[0].textContent, Adapter.limitInfo().text, "önce 'hesaplanıyor'");
    const el = strips(bRoot)[0];
    t.members.B.handler.fn(t.held[0].from, t.held[0].m);          // sonuç şimdi gelir
    assert.equal(strips(bRoot).length, 1, 'ikinci eleman yok');
    assert.equal(strips(bRoot)[0], el, 'aynı eleman');
    assert.ok(el.textContent.startsWith(Adapter.limitInfo().title + ' · ') && /🏆|🤝/.test(el.textContent), 'banner şeridin yerini aldı');
    assert.ok(!el.textContent.includes('hesaplanıyor'));
});
