// Çoklu eşzamanlı düello (herkes herkesle): 3–7 insan, çiftler + extra, ikinci şans, ödül eşlemesi, devir, zaman aşımı, kopma,
// yetkisiz gönderen, eski snapshot uyumu. Gerçek machine + adapter + hakem + Duel + kurallar; sahte oda yayını. tests/duel-room.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const { room, reachDuel, pairOf, playToWin, mover, cdShoot, rewardsFromFx, MAXHOLD, IDS } = require('./duel-room.js');

const mnOf = (r, id) => r.state(id || 'A').mn;
const sortedIds = (n) => IDS.slice(0, n).sort();

// Tüm ilk tur maçlarını oynatıp ilk başlayanı kazandırır
function winAll(r, game, from, to) {
    for (let i = from || 0; i < (to === undefined ? mnOf(r).nFirst : to); i++) playToWin(r, game, i);
}

test('çoklu düello: 4 insan — iki çift AYNI ANDA oynar; herkes tam bir maçta, lider diğer çiftin hakemi', async () => {
    const r = await reachDuel('xox', { humans: 4 });
    const mn = mnOf(r);
    assert.equal(mn.pm.length, 2);
    assert.equal(mn.ex, null);
    assert.deepEqual(mn.pm.flatMap((x) => x.p).sort(), sortedIds(4), 'her insan tam bir çiftte');
    IDS.slice(0, 4).forEach((id) => {
        assert.equal(r.nodes[id].defs.length, 1, id + ' yalnız kendi maçının oyununu kurdu');
        assert.equal(r.lastDefs(id).view.phase, 'playing');
        const v = r.view(id).mini;
        assert.equal(v.pairs.length, 2);
        assert.equal(v.myPair, mn.pm.findIndex((x) => x.p.includes(id)));
    });
    // başka çiftin mesajı rakip çiftin oyuncusuna iletilmez: her oyuncu yalnız kendi rakibini görür
    const [a, b] = mn.pm[0].p;
    r.lastDefs(mover(r, 0).first).duel.move({ cell: 4 });
    r.flush();
    const [c, d] = mn.pm[1].p;
    [c, d].forEach((id) => assert.equal(r.lastDefs(id).view.board.filter((x) => x !== null).length, 0, id + ' başka maçtan etkilenmedi'));
    assert.ok(a && b);
});

test('çoklu düello: 4 insan — iki maç bitince duelOutcome: 2 kazanan REWARDS[1], 2 kaybeden REWARDS[2]', async () => {
    const r = await reachDuel('connect4', { humans: 4 });
    const win = [mover(r, 0).first, mover(r, 1).first];
    const lose = [mover(r, 0).second, mover(r, 1).second];
    winAll(r, 'connect4');
    await r.settle();
    const mn = mnOf(r);
    assert.ok(mn.applyAt, 'tüm maçlar bitti');
    assert.deepEqual(mn.oc.win.slice().sort(), win.slice().sort());
    assert.deepEqual(mn.oc.lose.slice().sort(), lose.slice().sort());
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    const rewards = rewardsFromFx(r);
    win.forEach((id) => assert.equal(rewards[id], 1));
    lose.forEach((id) => assert.equal(rewards[id], 2));
    assert.equal(Object.keys(rewards).length, 4);
});

test('çoklu düello: 6 insan — 3 kazanan + 3 kaybeden: "4. derece" yok', async () => {
    const r = await reachDuel('xox', { humans: 6 });
    assert.equal(mnOf(r).pm.length, 3);
    const win = [0, 1, 2].map((i) => mover(r, i).first);
    const lose = [0, 1, 2].map((i) => mover(r, i).second);
    winAll(r, 'xox');
    await r.settle();
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    const rewards = rewardsFromFx(r);
    win.forEach((id) => assert.equal(rewards[id], 1));
    lose.forEach((id) => assert.equal(rewards[id], 2));
    assert.ok(Object.values(rewards).every((v) => v === 1 || v === 2));
    assert.equal(Object.keys(rewards).length, 6);
});

test('çoklu düello: 3 insan (lider extra) — ilk maçı lider izler (başsız hakem); ikinci şans: extra ilk bitenin kaybedeniyle', async () => {
    const r = await reachDuel('xox', { humans: 3, pred: (mn) => mn.ex === 'A' });
    const mn0 = mnOf(r);
    assert.equal(mn0.pm.length, 1);
    assert.equal(r.nodes.A.defs.length, 0, 'extra bekler: oyun kurmaz');
    assert.equal(r.view('A').mini.extra, 'A');
    assert.equal(r.view('A').mini.myPair, -1);
    const { first: w, second: l } = mover(r, 0);
    playToWin(r, 'xox', 0);                            // lider A başsız hakem olarak sonucu birleştirdi
    await r.settle();
    const mn = mnOf(r);
    assert.equal(mn.pm.length, 2, 'ikinci şans maçı eklendi');
    assert.equal(mn.ex, null);
    assert.deepEqual(mn.pm[1].p, ['A', l], 'extra ilk bitenin kaybedeniyle');
    assert.ok(!mn.applyAt, 'oyun sürüyor: ikinci şans bitmedi');
    assert.equal(r.nodes.A.defs.length, 0, 'loser hold bitene dek başlamaz');
    r.advance(C.duelHold('xox', 'win') + 300, 50);
    assert.equal(r.nodes.A.defs.length, 1, 'extra oyunu kurdu');
    assert.equal(r.nodes[l].defs.length, 2, 'kaybeden ikinci maçı yeni oturumda oynar');
    assert.equal(r.lastDefs('A').view.phase, 'playing');
    assert.equal(r.lastDefs(l).view.phase, 'playing');
    // extra kazanır -> REWARDS[1]; l kaybeder -> son maç kaybı = REWARDS[2]; w ilk maç kazanç = REWARDS[1]
    playToWin(r, 'xox', 1);
    await r.settle();
    const sc = mover(r, 1);
    assert.ok(mnOf(r).applyAt);
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    const rewards = rewardsFromFx(r);
    assert.equal(rewards[w], 1);
    assert.equal(rewards[sc.first], 1, 'ikinci şans kazananı');
    assert.equal(rewards[sc.second], 2, 'ikinci şans kaybedeni');
    assert.equal(Object.keys(rewards).length, 3);
});

test('çoklu düello: ikinci şansı KAYBEDEN (ilk maçı kaybeden) zaten kayıtlı kayıp; kazanırsa REWARDS[1] alır', async () => {
    const r = await reachDuel('connect4', { humans: 3, pred: (mn) => mn.ex === 'A' });
    const { first: w, second: l } = mover(r, 0);
    playToWin(r, 'connect4', 0);
    await r.settle();
    r.advance(C.duelHold('connect4', 'win') + 300, 50);
    // ikinci şansta L kazansın: ilk başlayan kimse onu kazandır (mover'a göre) — kazananı l olacak şekilde seç
    const sc = mover(r, 1);
    if (sc.first === l) playToWin(r, 'connect4', 1);
    else {
        // l ikinci başlayan: l'nin kazanması için sırayı değiştir: rakibe geçersiz zorlama yok, bu yüzden sütun planını ters çevir
        const dL = r.lastDefs(l); const dE = r.lastDefs('A');
        const aCols = [1, 2, 4, 5];                  // extra yan yana 4 yapamaz; l sütun 0'da dikey 4 yapar
        let k = 0;
        for (let n = 0; n < 8; n++) {
            const d = dL.view.myTurn ? dL : dE;
            d.duel.move({ col: d === dL ? 0 : aCols[k++ % 4] });
            r.flush();
            if (mnOf(r).pm[1].out) break;
        }
    }
    await r.settle();
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    const rewards = rewardsFromFx(r);
    assert.equal(rewards[l], 1, 'ikinci maçı kazanan l: REWARDS[1] (son maç belirler)');
    assert.equal(rewards['A'], 2);
    assert.equal(rewards[w], 1);
});

test('çoklu düello: ilk biten maç beraberlikse extra\'nın rakibi tohumlu biri (determinist)', async () => {
    const r = await reachDuel('xox', { humans: 3, pred: (mn) => mn.ex === 'A' });
    const mn = mnOf(r);
    const expected = mn.pm[0].p[(mn.sd >>> 3) & 1];
    const { first, second } = mover(r, 0);
    const d1 = r.lastDefs(first); const d2 = r.lastDefs(second);
    [[d1, 0], [d2, 1], [d1, 2], [d2, 4], [d1, 3], [d2, 5], [d1, 7], [d2, 6], [d1, 8]].forEach(([d, cell]) => { d.duel.move({ cell }); r.flush(); });
    await r.settle();
    assert.deepEqual(mnOf(r).pm[1].p, ['A', expected]);
});

test('çoklu düello: 5 insan — 2 çift + extra; çiftler paralel, ikinci şans ilk bitenin kaybedeniyle, her insan tam bir ödül alır', async () => {
    const r = await reachDuel('connect4', { humans: 5 });
    const mn0 = mnOf(r);
    assert.equal(mn0.pm.length, 2);
    assert.ok(mn0.ex);
    const ex = mn0.ex;
    // iki çifti de bitir (0. önce)
    playToWin(r, 'connect4', 0);
    await r.settle();
    assert.equal(mnOf(r).pm.length, 3, 'ikinci şans ilk biten maçtan sonra açıldı');
    assert.equal(mnOf(r).pm[2].p[0], ex);
    playToWin(r, 'connect4', 1);
    await r.settle();
    assert.ok(!mnOf(r).applyAt, 'ikinci şans sürüyor');
    r.advance(C.duelHold('connect4', 'win') + 300, 50);
    playToWin(r, 'connect4', 2);
    await r.settle();
    assert.ok(mnOf(r).applyAt);
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    const rewards = rewardsFromFx(r);
    assert.equal(Object.keys(rewards).length, 5);
    assert.ok(Object.values(rewards).every((v) => v === 1 || v === 2));
});

test('çoklu düello: botlar düelloya girmez, sıralamada olmaz (3 insan + 2 bot)', async () => {
    const r = await reachDuel('xox', { humans: 3, bots: 2 });
    const mn = mnOf(r);
    const all = mn.pm.flatMap((x) => x.p).concat(mn.ex ? [mn.ex] : []);
    assert.deepEqual(all.sort(), ['A', 'B', 'C']);
    assert.ok(all.every((id) => !r.state('A').S.find((s) => s.i === id).b));
});

test('çoklu düello: çift başına zaman aşımı — biten çift sonucu kalır, diğeri beraberlikle biter', async () => {
    const r = await reachDuel('connect4', { humans: 4 });
    const win = mover(r, 0).first;
    playToWin(r, 'connect4', 0);
    await r.settle();
    assert.ok(mnOf(r).pm[0].out && !mnOf(r).pm[1].out);
    assert.ok(!mnOf(r).applyAt);
    r.advance(C.duelMs('connect4') + 500);
    await r.settle();
    const mn = mnOf(r);
    assert.ok(mn.applyAt, 'süre dolunca ikinci çift beraberlikle bitti');
    assert.equal(mn.pm[1].out.d, 1);
    assert.deepEqual(mn.oc.win, [win]);
    assert.deepEqual(mn.oc.draw.slice().sort(), mn.pm[1].p.slice().sort());
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    const rewards = rewardsFromFx(r);
    assert.equal(rewards[win], 1);
    mn.pm[1].p.forEach((id) => assert.equal(rewards[id], 2, 'beraberlik REWARDS[2]'));
});

test('çoklu düello: bir çiftteki oyuncu 25 sn içinde dönmezse o maçı kaybeder; diğer maç sürer', async () => {
    const r = await reachDuel('xox', { humans: 4, pred: (mn) => !mn.pm[1].p.includes('A') && !mn.pm[0].p.includes('A') ? false : true });
    const mn = mnOf(r);
    const other = mn.pm[0].p.includes('A') ? 1 : 0;       // A'nın OLMADIĞI çift
    const [p, q] = mn.pm[other].p;
    r.leave(q);
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    await r.settle();
    const o = mnOf(r).pm[other].out;
    assert.ok(o && !o.d && o.l === q && o.w === p && o.r === 'forfeit', 'kopan o maçı kaybetti');
    assert.ok(!mnOf(r).pm[1 - other].out, 'diğer maç sürüyor');
    assert.ok(!mnOf(r).applyAt);
});

test('çoklu düello: lider devri — biten çiftin sonucu kalır, bitmeyen çift aynı tohumla yeniden başlar ve biter', async () => {
    const r = await reachDuel('connect4', { humans: 4, pred: (mn) => mn.pm[0].p.includes('A') });
    const done = 1;
    const winnerDone = mover(r, done).first;
    playToWin(r, 'connect4', done);
    await r.settle();
    const sd = mnOf(r).sd;
    const [ap, bp] = mnOf(r).pm[0].p;                  // A'nın çifti (devam ediyor)
    const mate = ap === 'A' ? bp : ap;
    r.leave('A');
    await r.settle();
    const leader = r.state(mate).ld;
    assert.ok(leader !== 'A');
    const mnL = mnOf(r, leader);
    assert.equal(mnL.sd, sd, 'aynı tohum');
    assert.ok(mnL.pm[done].out, 'biten çiftin sonucu kaybolmadı');
    assert.equal(mnL.pm[done].out.w, winnerDone);
    assert.equal(r.nodes[mate].defs.length, 2, 'bitmeyen çiftin oyuncusu oturumu yeniden kurdu');
    // devam eden çift (A gitti): 25 sn sonra A kaybeder, lider sonucu birleştirir
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    await r.settle();
    assert.ok(mnOf(r, leader).applyAt, 'tüm maçlar bitti');
    assert.ok(mnOf(r, leader).oc.win.includes(winnerDone));
    assert.ok(mnOf(r, leader).oc.lose.includes('A'));
});

test('çoklu düello: yetkisiz gönderen ve başka çiftin jetonu yok sayılır', async () => {
    const r = await reachDuel('xox', { humans: 4 });
    const mn = mnOf(r);
    const ep = r.state('A').ep;
    const mg0 = ep + ':' + mn.sd + ':xox:0';
    const mg1 = ep + ':' + mn.sd + ':xox:1';
    const [p0a] = mn.pm[0].p;
    const [p1a] = mn.pm[1].p;
    const target = mn.pm[0].p.find((id) => id !== 'A') || mn.pm[0].p[0];
    const victim = mn.pm[0].p.includes('A') ? 'A' : target;
    const empty = r.lastDefs(victim).view.board.findIndex((c) => c === null);
    const before = JSON.stringify(r.lastDefs(victim).view.board);
    // 1. çiftin jetonuyla, 2. çiftin oyuncusu hamle taklidi yapar (çiftte değil, lider değil)
    const outsider = mn.pm[1].p.find((id) => id !== 'A') || p1a;
    r.inject(victim, { type: 'pt_mg', mg: mg0, from: outsider, m: { type: 'xox_move', round: 1, cell: empty, ps: 99 } });
    // 2. çiftin jetonunu 1. çiftin oturumuna göndermek: oturum bulunamaz
    r.inject(victim, { type: 'pt_mg', mg: mg1, from: p0a, m: { type: 'xox_move', round: 1, cell: empty, ps: 98 } });
    assert.equal(JSON.stringify(r.lastDefs(victim).view.board), before);
    assert.equal(mnOf(r).applyAt, 0);
});

test('çoklu düello: eski tek çiftli pt_state (pm yok) okunur', async () => {
    const r = await reachDuel('xox', { humans: 2 });
    const snap = JSON.parse(JSON.stringify(r.sent.filter((x) => x.msg.type === 'pt_state' && x.msg.mn && x.from === 'A').pop().msg));
    const t = { pl: snap.mn.pl.slice(), rk: [], sd: snap.mn.sd };
    // eski biçim: pm/ex/nf/oc yok; dl/hd/gm/pl/rk/ms var
    delete snap.mn.pm; delete snap.mn.ex; delete snap.mn.nf; delete snap.mn.oc;
    snap.mn.dl = 50000; snap.mn.hd = -1;
    snap.rv += 100;
    r.nodes.B.m.onMessage(snap);
    const mn = mnOf(r, 'B');
    assert.equal(mn.pm.length, 1);
    assert.deepEqual(mn.pm[0].p, t.pl);
    assert.equal(mn.pm[0].out, null);
    assert.equal(r.view('B').mini.pairs.length, 1);
    // karar verilmiş eski görüntü: rk'den sonuç türetilir
    const snap2 = JSON.parse(JSON.stringify(snap));
    snap2.rv += 1; snap2.mn.rk = [[t.pl[0]], [t.pl[1]]]; snap2.mn.ms = 4000;
    r.nodes.B.m.onMessage(snap2);
    assert.deepEqual(mnOf(r, 'B').pm[0].out && [mnOf(r, 'B').pm[0].out.w, mnOf(r, 'B').pm[0].out.l], [t.pl[0], t.pl[1]]);
});

test('çoklu düello: 7 insan — 3 çift + extra, hepsi aynı oyunu oynar (catdog), her çift kendi sınırında biter', async () => {
    const r = await reachDuel('catdog', { humans: 7 });
    const mn = mnOf(r);
    assert.equal(mn.pm.length, 3);
    assert.ok(mn.ex);
    mn.pm.forEach((x, i) => x.p.forEach((id) => assert.equal(r.lastDefs(id).view.phase, 'playing', `çift ${i}`)));
    for (let k = 0; k < 2 * C.DUEL_CATDOG_SHOTS; k++) mn.pm.forEach((x, i) => cdShoot(r, false, i));
    await r.settle();
    const after = mnOf(r);
    assert.ok(after.pm.slice(0, 3).every((x) => x.out && x.out.d), 'üç çift de sınırda beraberlik');
    assert.equal(after.pm.length, 4, 'ikinci şans maçı eklendi');
});

test('çoklu düello: ikinci şans rakibi kopuksa extra maçı hükmen kazanır; kopan ödül yerine teselli alır', async () => {
    const r = await reachDuel('xox', { humans: 3, pred: (mn) => mn.ex === 'A' });
    const [p, q] = pairOf(r, 0);
    r.leave(q);                                        // q koptu: 25 sn sonra ilk maçı kaybeder
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    await r.settle();
    const mn = mnOf(r);
    assert.equal(mn.pm[0].out.l, q);
    assert.equal(mn.pm.length, 2);
    assert.deepEqual({ w: mn.pm[1].out.w, l: mn.pm[1].out.l, r: mn.pm[1].out.r }, { w: 'A', l: q, r: 'forfeit' }, 'extra hükmen kazandı');
    assert.ok(mn.applyAt, 'tüm maçlar bitti');
    r.state(p).g.P[q].hp = 40;                         // teselli görünür olsun (yalnız lider durumuna bak)
    r.state('A').g.P[q].hp = 40;
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 50);
    const rewards = rewardsFromFx(r);
    assert.equal(rewards[p], 1);
    assert.equal(rewards.A, 1, 'hükmen kazanan extra REWARDS[1]');
    assert.equal(rewards[q], undefined, 'kopan insan ödül almaz');
    assert.equal(r.state('A').g.P[q].hp, 65, 'kopan oyuncu teselli aldı (düello dışı)');
});
