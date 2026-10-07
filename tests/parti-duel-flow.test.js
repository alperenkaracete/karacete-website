// Tarayıcısız entegrasyon (TEK ÇİFTLİ düello: 2 insan): gerçek machine + adapter + hakem + core/duel.js + *-rules.js.
// Çoklu çift senaryoları tests/parti-duel-multi.test.js içinde. Ortak oda: tests/duel-room.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const { room, curId, reachDuel, pairOf, playToWin, mover, cdShoot, rewardsFromFx, gp, N, MAXHOLD } = require('./duel-room.js');

// Sayaç/sonuç anını kaçırmamak için küçük adımlarla ilerler (sonuç gelince durur)
function advanceUntilOut(r, i, step, max) {
    for (let t = 0; t < max && !r.state('A').mn.pm[i].out; t += step) r.advance(step, step);
}

const strip = (r, id) => r.nodes[id].root.children.find((c) => c.className === 'pt-duel-strip');
const locked = (r, id) => r.nodes[id].root.classList.set.has('pt-duel-locked');

for (const game of ['xox', 'connect4']) {
    test(`düello akışı (${game}): tam akış, sonuç, şerit, hold ve ödül dağılımı (2 insan)`, async () => {
        const r = await reachDuel(game);
        const mn0 = r.state('A').mn;
        assert.equal(mn0.pm.length, 1);
        assert.equal(mn0.ex, null);
        const pl = pairOf(r, 0);
        assert.equal(r.view('B').mini.game, game);
        assert.equal(r.view('B').mini.duelLeft, -1, 'toplam süre sınırı yok: kalan süre gösterilmez');
        pl.forEach((id) => assert.equal(r.lastDefs(id).view.phase, 'playing'));
        const rvBefore = r.state('A').rv;
        const { first, second } = mover(r, 0);
        playToWin(r, game, 0);
        await r.settle();
        const mn = r.state('A').mn;
        assert.ok(mn.applyAt, 'lider sonucu onayladı');
        assert.deepEqual(mn.rk, [[first], [second]]);
        assert.ok(r.state('A').rv > rvBefore);
        ['A', 'B'].forEach((id) => assert.deepEqual(r.view(id).mini.ranking, [[first], [second]], id + ' sonucu gördü'));
        pl.forEach((id) => { assert.ok(locked(r, id)); assert.ok(strip(r, id).textContent.includes('🏆')); });
        assert.ok(r.view('A').mini.live, 'hold: oyun açık');
        r.advance(C.duelHold(game, 'win') + 300, 50);
        pl.forEach((id) => assert.equal(r.nodes[id].root.textContent, '', 'hold bitince oturum kapandı, kök temiz'));
        const rd = r.state('A').g.rd;
        r.advance(MAXHOLD + C.MINI_HOLD_MS + 500);
        assert.equal(r.state('A').g.rd, rd + 1, 'yeni tur başladı');
        assert.deepEqual(rewardsFromFx(r), { [first]: 1, [second]: 2 });
        assert.equal(r.view('B').mini, null);
    });
}

test('düello: beraberlikte [[a,b]] ikisi de 2. ödül (REWARDS[2]), şerit 🤝', async () => {
    const r = await reachDuel('xox');
    const { first, second } = mover(r, 0);
    const d1 = r.lastDefs(first); const d2 = r.lastDefs(second);
    [[d1, 0], [d2, 1], [d1, 2], [d2, 4], [d1, 3], [d2, 5], [d1, 7], [d2, 6], [d1, 8]].forEach(([d, cell]) => { d.duel.move({ cell }); r.flush(); });
    await r.settle();
    assert.deepEqual(r.state('A').mn.rk, [pairOf(r, 0).slice()]);
    assert.ok(strip(r, 'A').textContent.includes('🤝'));
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 200, 50);
    assert.deepEqual(rewardsFromFx(r), { [first]: 2, [second]: 2 });
});

test('düello: toplam süre sınırı yok — hamle yapıldıkça maç dakikalarca sürer, yarıda kesilmez', async () => {
    assert.equal(C.duelMs, undefined, 'süre tablosu kaldırıldı');
    const r = await reachDuel('catdog');
    const { first, second } = mover(r, 0);
    for (let i = 0; i < 2 * N - 1; i++) {
        cdShoot(r, i === 0, 0);                              // ilk başlayan bir kez isabet ettirir
        r.advance(150000, 5000);                             // her hamle arası 2,5 dk (boşta sınırı 3 dk): toplam > 20 dk
        assert.ok(!r.state('A').mn.applyAt, (i + 1) + '. hamle sonrası sonuç yok');
        assert.equal(r.state('A').mn.pm[0].out, null);
    }
    cdShoot(r, false, 0);
    await r.settle();
    assert.equal(r.state('A').mn.pm[0].out.r, 'limit', 'maç atış sınırıyla bitti, süreyle değil');
    assert.deepEqual(r.state('A').mn.rk, [[first], [second]]);
});

test('düello: boşta sınırı — sırası gelen 3 dk hiç hamle yapmazsa o maçı kaybeder (hükmen, bekleme yok)', async () => {
    const r = await reachDuel('xox');
    const { first, second } = mover(r, 0);
    r.advance(C.DUEL_IDLE_MS - 5000, 5000);
    assert.ok(!r.state('A').mn.applyAt, 'sınırdan önce sonuç yok');
    advanceUntilOut(r, 0, 1000, 20000);
    await r.settle();
    const x = r.state('A').mn.pm[0];
    assert.equal(x.out.r, 'idle');
    assert.deepEqual(r.state('A').mn.rk, [[second], [first]], 'sırası gelen kaybeder');
    assert.equal(x.bAt, 0);
    assert.equal(x.hAt, 0, 'hükmen: tutma yok');
    r.advance(C.MINI_HOLD_MS + 500, 100);
    assert.deepEqual(rewardsFromFx(r), { [second]: 1, [first]: 2 });
});

test('düello: boşta sayacı her hamlede sıfırlanır', async () => {
    const r = await reachDuel('xox');
    const { first, second } = mover(r, 0);
    r.advance(C.DUEL_IDLE_MS - 10000, 5000);
    assert.equal(r.lastDefs(first).duel.move({ cell: 0 }), true);
    r.flush();
    r.advance(C.DUEL_IDLE_MS - 10000, 5000);                 // ilk hamleden beri sınırın altında; oyun başından beri çok uzun
    await r.settle();
    assert.ok(!r.state('A').mn.applyAt, 'sayaç hamlede sıfırlandı');
    advanceUntilOut(r, 0, 1000, 30000);
    await r.settle();
    assert.equal(r.state('A').mn.pm[0].out.r, 'idle');
    assert.deepEqual(r.state('A').mn.rk, [[first], [second]], 'şimdi sırası gelen ikinci oyuncu kaybetti');
});

test('düello: oyuncu kopar ve 25 sn içinde dönmezse kopan kaybeder (forfeit)', async () => {
    const r = await reachDuel('xox');
    r.leave('B');
    r.advance(C.DUEL_RECONNECT_MS - 2000);
    assert.ok(!r.state('A').mn.applyAt, 'bekleme sürüyor');
    r.advance(3000);
    await r.settle();
    assert.deepEqual(r.state('A').mn.rk.slice(0, 2), [['A'], ['B']]);
});

test('düello: kopan oyuncu 25 sn içinde dönerse düello kaldığı yerden sürer', async () => {
    const r = await reachDuel('xox');
    const dA = r.lastDefs('A'); const dO = r.lastDefs('B');
    let cell = 0;
    while (!(dA.view.myTurn && cell >= 2)) {
        const d = dA.view.myTurn ? dA : dO;
        assert.equal(d.duel.move({ cell: cell++ }), true);
        r.flush();
    }
    r.leave('B');                                     // rakip kopar, A'nın hamlesini kaçırır
    assert.equal(dA.duel.move({ cell: 8 }), true);
    r.flush();
    assert.equal(dO.view.board[8], null);
    r.advance(10000);
    assert.ok(!r.state('A').mn.applyAt, 'bekleme sürüyor');
    r.reconnect('B');                                 // aynı sayfa geri döndü
    r.advance(500);
    assert.equal(dO.inits, 1, 'oyun yeniden kurulmadı');
    assert.equal(r.nodes.B.defs.length, 1);
    assert.equal(dO.view.board[8], dA.view.myIndex, 'kaçırdığı hamle yetişti');
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    assert.ok(!r.state('A').mn.applyAt, 'döndü: forfeit olmadı');
    assert.equal(dA.view.phase, 'playing');
    assert.equal(dO.view.phase, 'playing');
});

test('düello: lider düelloda ve kopar -> yeni lider yeniden başlatır; kopan 25 sn sonra kaybeder', async () => {
    const r = await reachDuel('xox');
    r.leave('A');
    await r.settle();
    assert.equal(r.state('B').ld, 'B');
    assert.equal(r.nodes.B.defs.length, 2, 'rakip oturumu yeniden kurdu');
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    await r.settle();
    assert.deepEqual(r.state('B').mn.rk.slice(0, 2), [['B'], ['A']]);
});

test('düello: sayfası yenilenen oyuncu geri gelince düello iki tarafta sıfırlanır ve sürer', async () => {
    const r = await reachDuel('xox');
    const { first } = mover(r, 0);
    r.lastDefs(first).duel.move({ cell: 4 });
    r.flush();
    r.nodes.B.online = false;
    r.leave('B');
    r.join('B', r.nodes.B.name);                      // yeni sayfa
    r.advance(1000);
    await r.settle();
    const d = r.lastDefs('B');
    assert.ok(d.view, 'yeni oturum kuruldu');
    assert.equal(d.view.board.filter((c) => c !== null).length, 0, 'sıfırdan başladı');
    assert.equal(r.lastDefs('A').view.board.filter((c) => c !== null).length, 0);
    assert.equal(d.view.phase, 'playing');
    playToWin(r, 'xox', 0);
    await r.settle();
    assert.ok(r.state('A').mn.applyAt, 'yenilemeden sonra düello bitti');
});

test('düello: hold sırasında lider devri sonucu kaybettirmez ve oyunu yeniden başlatmaz', async () => {
    const r = await reachDuel('connect4');
    playToWin(r, 'connect4', 0);
    await r.settle();
    const rk = JSON.parse(JSON.stringify(r.state('A').mn.rk));
    const defsBefore = r.nodes.B.defs.length;
    r.leave('A');                                     // lider hold sırasında düştü
    await r.settle();
    assert.equal(r.state('B').ld, 'B');
    assert.deepEqual(r.state('B').mn.rk, rk, 'sonuç korundu');
    assert.ok(r.state('B').mn.applyAt);
    assert.equal(r.nodes.B.defs.length, defsBefore, 'oturum yeniden başlamadı');
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500);
    assert.equal(r.state('B').mn, null, 'yeni lider sonucu uyguladı');
});

test('düello: pt_mg durum değildir (rv artmaz); yanlış jeton ve yankı yok sayılır', async () => {
    const r = await reachDuel('xox');
    const mate = 'B';
    const mg = r.state('A').ep + ':' + r.state('A').mn.sd + ':xox:0';
    const rv = r.state('A').rv;
    const empty = r.lastDefs(mate).view.board.findIndex((c) => c === null);
    r.inject('A', { type: 'pt_mg', mg: '9:9:xox:0', from: mate, m: { type: 'xox_move', round: 1, cell: empty } });
    r.inject('A', { type: 'pt_mg', mg, from: 'A', m: { type: 'xox_move', round: 1, cell: empty } });
    r.inject('A', { type: 'pt_mg', mg, from: mate, m: 'x' });
    r.inject('A', { type: 'pt_mg', mg: mg.replace(/:0$/, ':5'), from: mate, m: { type: 'xox_move', round: 1, cell: empty } });
    assert.ok(r.lastDefs('A').view.board.filter((c) => c !== null).length <= 1);
    assert.equal(r.state('A').rv, rv);
    assert.equal(r.state('A').mn.applyAt, 0);
});

// ---- ?mini= test bayrağı (lider tarayıcısında okunur) ----
test('?mini bayrağı: lider makinede her tur belirtilen düello oyunu seçilir (3 insan: çift + extra)', async () => {
    for (const game of ['catdog', 'connect4', 'xox']) {
        for (let seed = 1; seed < 6; seed++) {
            const r = room(seed, { forceMini: { game } });
            r.join('A', 'Ayse'); r.join('B', 'Bora'); r.join('C', 'Cem');
            r.m('A').dispatch({ type: 'start' });
            r.flush();
            let guard = 0;
            while (r.state('A').g.stage !== 'mini' && guard++ < 300) {
                r.m(curId(r)).dispatch(R.autoAction(r.state('A').g, { g: gp }));
                r.flush();
            }
            const mn = r.state('A').mn;
            assert.equal(mn.ty, 'duel');
            assert.equal(mn.gm, game);
            assert.equal(mn.pm.length, 1);
            assert.ok(mn.ex, '3 insan: bir kişi extra');
        }
    }
});

// ---- Kedi - Köpek ----
for (const _ of [1]) {
    test('düello (catdog): N atış sonunda kalan cana göre sonuç, kilit ve şerit; son atış animasyonu + 500 ms gecikme', async () => {
        const r = await reachDuel('catdog');
        const pl = pairOf(r, 0);
        const { first, second } = mover(r, 0);
        cdShoot(r, true, 0);
        for (let i = 0; i < 2 * N - 2; i++) cdShoot(r, false, 0);
        await r.settle();
        assert.ok(!r.state('A').mn.applyAt, 'son atıştan önce sonuç yok');
        pl.forEach((id) => assert.ok(!locked(r, id)));
        cdShoot(r, false, 0);
        await r.settle();
        const mn = r.state('A').mn;
        assert.deepEqual(mn.rk, [[first], [second]]);
        assert.ok(mn.applyAt, 'sonuç hakemden hemen kaydedildi');
        pl.forEach((id) => { assert.ok(locked(r, id), id + ' tahtası kilitli'); assert.equal(strip(r, id), undefined, 'şerit henüz yok'); });
        const D = mn.pm[0].bAt - r.clock;                     // son atış animasyonu + ağ payı
        assert.ok(D >= 500 + 700 + C.ANIM_NET_PAD_MS && D <= 2600 + 700 + C.ANIM_NET_PAD_MS, 'tek atış: 1700-3800 ms');
        r.advance(D - 200, 50);
        pl.forEach((id) => assert.equal(strip(r, id), undefined));
        r.advance(400, 50);
        pl.forEach((id) => {
            assert.ok(strip(r, id).textContent.includes('Atışlar bitti'));
            assert.ok(strip(r, id).textContent.includes('🏆'));
            assert.ok(r.lastDefs(id).view, 'oyun alanı hâlâ duruyor');
        });
        r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
        assert.deepEqual(rewardsFromFx(r), { [first]: 1, [second]: 2 });
    });

    test('düello (catdog): iki taraf da ıskalarsa beraberlik; şerit "Atışlar bitti · 🤝"', async () => {
        const r = await reachDuel('catdog');
        for (let i = 0; i < 2 * N; i++) cdShoot(r, false, 0);
        await r.settle();
        assert.deepEqual(r.state('A').mn.rk, [pairOf(r, 0).slice()]);
        const D = r.state('A').mn.pm[0].bAt - r.clock;
        r.advance(D - 200, 50);
        pairOf(r, 0).forEach((id) => assert.equal(strip(r, id), undefined));
        r.advance(400, 50);
        pairOf(r, 0).forEach((id) => assert.ok(strip(r, id).textContent.includes('Beraberlik')));
    });

    test('düello (catdog): heal atış sayılmaz; 5 atış sınırı heal sonrası sayılır', async () => {
        const r = await reachDuel('catdog');
        const { first, second } = mover(r, 0);
        assert.equal(r.lastDefs(first).duel.move({ kind: 'heal', turn: 0 }), true);
        r.flush();
        cdShoot(r, false, 0);                                 // ikinci başlayan
        cdShoot(r, true, 0);                                  // ilk başlayan isabet (1. atış)
        for (let i = 0; i < 2 * N - 3; i++) cdShoot(r, false, 0);   // toplam 2N-1 atış: heal sayılmadı
        await r.settle();
        assert.ok(!r.state('A').mn.applyAt, '2N-1 atış: sınır dolmadı');
        cdShoot(r, false, 0);
        await r.settle();
        assert.ok(r.state('A').mn.applyAt, '2N. atış: kalan cana göre');
        assert.deepEqual(r.state('A').mn.rk, [[first], [second]]);
    });
}
