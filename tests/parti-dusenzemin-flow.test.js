// Düşen Zemin (ffa) makine entegrasyonu: gerçek PartiMachine + DusenZemin oturumu/sürücüsü, sahte oda (tests/duel-room.js).
// Sonuç yalnız liderde, raporlardan hesaplanır; botlar ve takvim tohumdan (ağda yok).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const D = require('../games/parti/mini/dusenzemin-rules.js');
const { reachFfa, rewardsFromFx, IDS, NAMES } = require('./duel-room.js');

const GAME = 'dusenzemin';
const leaderOf = (r) => IDS.find((id) => r.nodes[id] && r.nodes[id].online && r.view(id).isLeader) || 'A';
const mn = (r, id) => r.state(id || leaderOf(r)).mn;
const sched = (r) => D.schedule(mn(r).sd, mn(r).pl.length);
const startTile = (r, id) => { const p = D.startPositions(mn(r).sd, mn(r).pl.length)[mn(r).pl.indexOf(id)]; return D.tileOf(p.x, p.y); };
let seq = 5000000;
const msg = (o) => Object.assign({ n: ++seq }, o);
const reportPos = (r, id, x, y) => r.m(leaderOf(r))._ffaReport(id, msg({ k: 'pos', x: Math.round(x), y: Math.round(y), z: 0, vx: 0, vy: 0, a: 1 }));
const reportOut = (r, id, t) => r.m(leaderOf(r))._ffaReport(id, msg({ k: 'out', t: t }));
const toElapsed = (r, ms, step) => { const target = mn(r).ff.stAt + ms; if (target > r.now()) r.advance(target - r.now(), step || 100); };
function untilRanked(r, max) {
    let g = 0;
    while (!(r.view(leaderOf(r)).mini && r.view(leaderOf(r)).mini.ranking.length) && g++ < (max || 2000)) r.advance(250, 250);
}
const ranking = (r) => r.view(leaderOf(r)).mini.ranking.map((g) => g.slice().sort());
// Gerçek oturumlar ilk saniyede kendini bildirir; noFfa testlerinde aynısı elle: oyuncular erkenden (halka yıkılmadan) hedef konuma geçer ve
// raporlanır, sonra sessiz kalır (güvenli karede sessiz oyuncu elenmez; yıkılan karede sessiz oyuncu staleOut ile elenir)
function present(r, ids, x, y) {
    toElapsed(r, 4500);
    ids.forEach((id) => reportPos(r, id, x, y));
}
// tile yıkımıyla elenme: oyuncuyu o karede raporla, yıkılıştan sonra out bildir
function eliminateOnTile(r, id, tile) {
    const ctr = D.tileCenter(tile);
    reportPos(r, id, ctr.x, ctr.y);
    const c = sched(r).collapse[tile];
    toElapsed(r, c + D.FALL_MS + 50);
    reportOut(r, id, c + D.FALL_MS);
    return c;
}

test('başlangıç: ffa jetonu (gm dusenzemin), geri sayım, rep başlangıç halkasında, insanlarda oturum, botlarda yok; izleyici satırları', async () => {
    const r = await reachFfa({ humans: 3, bots: 2, game: GAME });
    const m = mn(r);
    assert.equal(m.ty, 'ffa');
    assert.equal(m.gm, GAME);
    assert.equal(m.pl.length, 5);
    assert.deepEqual(Object.keys(m.ff.rep).sort(), ['A', 'B', 'C'], 'raporlar yalnız insanlar için');
    assert.equal(m.ff.endAt - m.ff.stAt, C.DUSENZEMIN_MS);
    const sp = D.startPositions(m.sd, 5);
    ['A', 'B', 'C'].forEach((id) => {
        const q = m.ff.rep[id];
        const p = sp[m.pl.indexOf(id)];
        assert.deepEqual({ x: q.x, y: q.y, out: q.out }, { x: p.x, y: p.y, out: -1 });
        assert.ok(r.m(id)._session(), id + ' yerel oturum');
        assert.equal(r.view(id).mini.live, true);
        assert.equal(r.view(id).mini.game, GAME);
    });
    assert.deepEqual(Object.keys(r.state('B').mn.ff.rep).sort(), ['A', 'B', 'C']);
    const rows = r.view('B').mini.ff.rows;
    assert.equal(rows.length, 5);
    assert.equal(rows.filter((x) => x.bot).length, 2);
    assert.ok(rows.every((x) => x.alive === true && typeof x.text === 'string'));
    assert.equal(mn(r).pm.length, 0, 'düello çiftleri yok');
});

test('gerçek oturumlar durağan kalırsa: takvim hepsini eler, erken biter (süre dolmadan); sıralama rep.out anahtarlarına göre; ödüller derece 1/2/3', async () => {
    const r = await reachFfa({ humans: 3, game: GAME });
    untilRanked(r);
    const m = mn(r);
    assert.ok(m.applyAt > 0, 'sonuç kaydedildi');
    assert.ok(m.ff.endAt - r.now() > 20000, 'erken bitti (süre dolmadan)');
    const sc = sched(r);
    const outs = {};
    Object.keys(m.ff.rep).forEach((id) => { if (m.ff.rep[id].out >= 0) outs[id] = { key: m.ff.rep[id].out }; });
    assert.ok(Object.keys(outs).length >= 2, 'en az ikisi elendi');
    assert.deepEqual(r.view('A').mini.ranking, D.rank({ players: m.pl, bots: [], seed: m.sd, sched: sc, outs, endMs: 120000 }), 'sıralama = sürücü sıralaması');
    // durağan oyuncu kendi başlangıç karesinin yıkılış anında düşer (anahtar = yıkılış anı)
    Object.keys(outs).forEach((id) => assert.equal(outs[id].key, sc.collapse[startTile(r, id)], id));
    r.advance(C.MINI_HOLD_MS + 500, 250);
    assert.equal(r.state('A').g.stage, 'roll', 'yeni tur');
    assert.equal(r.state('A').g.lm, GAME);
    const rw = rewardsFromFx(r);
    assert.ok(Object.keys(rw).length >= 1);
    ['A', 'B', 'C'].forEach((id) => { if (rw[id] !== undefined) assert.ok([1, 2, 3].includes(rw[id])); });
});

test('süre dolumu: güvenli (son) kareye basan sessiz oyuncular elenmez ve eşit 1.; yıkık karede sessiz kalan donan telefon elenir (staleOut)', async () => {
    const r = await reachFfa({ humans: 3, game: GAME, extra: { noFfa: true } });
    const m = mn(r);
    const sc = sched(r);
    const fin = D.tileCenter(sc.finalTile);
    const ids = ['A', 'B', 'C'];
    const victim = ids.find((id) => sc.collapse[startTile(r, id)] !== Infinity);
    const keep = ids.filter((id) => id !== victim);
    present(r, keep, fin.x, fin.y);                                           // finale yürüdüler (zaman bütçesi yeter), sonra sessiz
    assert.equal(m.ff.rep[victim].out, -1);
    r.advance(1000, 250);
    toElapsed(r, 119000);
    assert.equal(mn(r).ff.rep[victim].out, sc.collapse[startTile(r, victim)], 'donan telefon yıkılış anında elendi: ' + victim);
    keep.forEach((id) => assert.equal(mn(r).ff.rep[id].out, -1, id + ' güvenli karede sessiz: elenmedi'));
    assert.equal(mn(r).applyAt, 0, 'iki oyuncu hayatta: süre dolmadı');
    untilRanked(r);
    assert.ok(r.now() - mn(r).ff.stAt >= C.DUSENZEMIN_MS, 'süre dolunca');
    assert.deepEqual(ranking(r), [keep.slice().sort(), [victim]], 'hayatta kalanlar eşit 1.');
});

test('saçma raporlar yok sayılır: ışınlanma, katı karede out, ortadan kenar out, ileri tarihli out, tekrar n, katılımcı olmayan/bot, push', async () => {
    const r = await reachFfa({ humans: 3, bots: 1, game: GAME, extra: { noFfa: true } });
    const sc = sched(r);
    const rep = () => mn(r).ff.rep;
    const f = D.tileCenter(sc.finalTile);
    present(r, ['A', 'B', 'C'], f.x, f.y);
    toElapsed(r, 20000);
    reportPos(r, 'B', f.x + 1, f.y);
    assert.equal(rep().B.x, Math.round(f.x + 1));
    const bx = rep().B.x;
    // aynı anda arenanın öbür ucuna ışınlanma
    reportPos(r, 'B', f.x > 256 ? 10 : 500, f.y > 256 ? 10 : 500);
    assert.equal(rep().B.x, bx, 'ışınlanma reddedildi');
    // son karede (katı) out -> reddedilir; ortadan kenar out -> reddedilir
    reportOut(r, 'B', 20100);
    assert.equal(rep().B.out, -1, 'katı karede out olamaz');
    // ileri tarihli out
    reportOut(r, 'B', 5000000);
    assert.equal(rep().B.out, -1);
    // tekrar n
    r.m('A')._ffaReport('B', { k: 'pos', n: 3, x: bx, y: rep().B.y, z: 0, vx: 0, vy: 0, a: 1 });
    assert.notEqual(rep().B.n, 3);
    // bozuk
    r.m('A')._ffaReport('B', msg({ k: 'pos', x: 'a', y: 1, z: 0, vx: 0, vy: 0 }));
    r.m('A')._ffaReport('B', msg({ k: 'pos', x: bx, y: rep().B.y, z: 99, vx: 0, vy: 0 }));
    r.m('A')._ffaReport('B', msg({ k: 'push', to: 'C', dx: 100, dy: 0 }));
    r.m('A')._ffaReport('B', null);
    assert.equal(rep().B.x, bx);
    const bot = mn(r).pl.find((id) => !rep()[id]);
    assert.ok(bot);
    reportPos(r, bot, 100, 100);
    reportPos(r, 'ZZZ', 100, 100);
    assert.equal(rep()[bot], undefined);
    assert.equal(rep().ZZZ, undefined);
    // geçerli: yıkık karede out kabul, anahtar yıkılış anı
    const tile = sc.rounds[1].doomed[0];
    const c = eliminateOnTile(r, 'C', tile);
    assert.equal(rep().C.out, c);
});

test('kopan insan beklenmez ve en sona yazılır; kalan bağlılar elenince erken biter', async () => {
    const r = await reachFfa({ humans: 3, game: GAME, extra: { noFfa: true } });
    const sc = sched(r);
    const ids = ['A', 'B', 'C'];
    r.leave('C');
    r.advance(500, 100);
    const t1 = D.tileOf(D.startPositions(mn(r).sd, 3)[0].x, D.startPositions(mn(r).sd, 3)[0].y);
    const tiles = {};
    ['A', 'B'].forEach((id) => { tiles[id] = startTile(r, id); });
    ['A', 'B'].forEach((id) => { if (sc.collapse[tiles[id]] === Infinity) tiles[id] = sc.rounds[1].doomed[ids.indexOf(id)]; });
    ['A', 'B'].forEach((id) => eliminateOnTile(r, id, tiles[id]));
    r.advance(500, 250);
    assert.ok(mn(r).applyAt > 0, 'bağlı hayatta insan kalmadı: C beklenmedi');
    r.advance(C.MINI_HOLD_MS + 500, 250);
    const line = r.state(leaderOf(r)).lg.filter((l) => l.startsWith('🎡')).pop();
    assert.ok(line.indexOf(NAMES[2]) > line.indexOf(NAMES[0]) && line.indexOf(NAMES[2]) > line.indexOf(NAMES[1]), 'C en sonda: ' + line);
    assert.ok(t1 >= 0);
});

test('lider devri: rep.out ve konumlar pt_state ile taşınır; sessizlik sayacı yeni liderde sıfırlanır (haksız eleme yok); yeni lider sonucu hesaplar', async () => {
    const r = await reachFfa({ humans: 3, game: GAME, extra: { noFfa: true } });
    const sc = sched(r);
    const ids = ['A', 'B', 'C'];
    const tile = sc.rounds[1].doomed[0];
    const fin = D.tileCenter(sc.finalTile);
    present(r, ['A', 'C'], fin.x, fin.y);
    const tc = D.tileCenter(tile);
    reportPos(r, 'B', tc.x, tc.y);                                            // B erkenden yıkılacak karede, sonra sessiz
    toElapsed(r, 20000);
    const cB = eliminateOnTile(r, 'B', tile);
    r.advance(1500, 250);
    r.leave('A');                                              // lider düştü
    r.advance(3000, 250);
    const L = leaderOf(r);
    assert.ok(L && L !== 'A');
    assert.equal(mn(r).ff.rep.B.out, cB, 'out taşındı');
    assert.equal(mn(r).ff.rep.C.x, Math.round(fin.x), 'konum taşındı');
    assert.equal(mn(r).ff.rep.C.out, -1, 'güvenli karedeki sessiz oyuncu elenmedi');
    assert.equal(mn(r).applyAt, 0, 'C hayatta: oyun sürüyor');
    // yeni lider raporları işler: C kenardan düşer (kenar düşmesi: anahtar kendi ms'si) -> bağlı hayatta insan kalmadı, erken biter
    const e0 = r.now() - mn(r).ff.stAt;
    reportPos(r, 'C', 500, 256);
    reportOut(r, 'C', e0);
    assert.equal(mn(r).ff.rep.C.out, e0, 'kenar düşmesi kendi ms\'siyle');
    r.advance(500, 250);
    assert.ok(mn(r).applyAt > 0, 'yeni lider sonucu hesapladı');
    assert.equal(ids.length, 3);
    assert.deepEqual(r.view(L).mini.ranking.map((g) => g.slice().sort()), [['A'], ['C'], ['B']], 'A koptu ama hayatta kayıtlı: önce (kopan en sona finishMini yazar); C sonra düştü; B önce düştü');
});

test('8 insan: derece/beraberlik (aynı yıkılış turu eşit), ödül 1/2/3, pt_state 20 KB altında', async () => {
    const r = await reachFfa({ humans: 8, game: GAME, extra: { noFfa: true } });
    const sc = sched(r);
    // tur 1'in ve tur 2'nin yıkık karelerinden dağıt: 3 oyuncu tur 1'de (eşit), 2 oyuncu tur 2'de (eşit), kalanlar elenmeden finalde
    const r1 = sc.rounds[1].doomed;
    const r2 = sc.rounds[2].doomed;
    const fin = D.tileCenter(sc.finalTile);
    toElapsed(r, 6000);
    ['F', 'G', 'H'].forEach((id) => reportPos(r, id, fin.x, fin.y));
    [['A', r1[0]], ['B', r1[1 % r1.length]], ['C', r1[0]]].forEach(([id, t]) => { const q = D.tileCenter(t); reportPos(r, id, q.x, q.y); });
    [['D', r2[0]], ['E', r2[1 % r2.length]]].forEach(([id, t]) => { const q = D.tileCenter(t); reportPos(r, id, q.x, q.y); });
    toElapsed(r, sc.rounds[2].collapseMs + D.FALL_MS + 80);
    ['A', 'B', 'C'].forEach((id) => reportOut(r, id, sc.rounds[1].collapseMs + D.FALL_MS));
    ['D', 'E'].forEach((id) => reportOut(r, id, sc.rounds[2].collapseMs + D.FALL_MS));
    ['A', 'B', 'C'].forEach((id) => assert.equal(mn(r).ff.rep[id].out, sc.rounds[1].collapseMs, id));
    ['D', 'E'].forEach((id) => assert.equal(mn(r).ff.rep[id].out, sc.rounds[2].collapseMs, id));
    // F, G, H sessiz hayatta (güvenli karede): son çağrı yok; süre dolunca eşit 1.
    toElapsed(r, 119000);
    untilRanked(r);
    assert.deepEqual(ranking(r), [['F', 'G', 'H'], ['D', 'E'], ['A', 'B', 'C']]);
    r.advance(C.MINI_HOLD_MS + 500, 250);
    const rw = rewardsFromFx(r);
    assert.deepEqual(rw, { F: 1, G: 1, H: 1 }, 'derece 1,1,1 / 4,4 / 6,6,6: yalnız 1. grup ödüllü (4+ ödülsüz)');
    const max = Math.max.apply(null, r.sent.filter((s) => s.msg.type === 'pt_state').map((s) => JSON.stringify(s.msg).length));
    assert.ok(max < 20000, 'pt_state boyutu ' + max);
    assert.ok(max > 1000);
});

test('iki insan: biri elenince diğeri tek hayatta -> hemen biter; tek insan + botlar: botlar düşünce biter, bot sıralamaya girer', async () => {
    const r = await reachFfa({ humans: 2, game: GAME, extra: { noFfa: true } });
    const sc = sched(r);
    const fin = D.tileCenter(sc.finalTile);
    toElapsed(r, 8000);
    reportPos(r, 'B', fin.x, fin.y);
    const tile = sc.rounds[1].doomed.includes(startTile(r, 'A')) ? startTile(r, 'A') : sc.rounds[1].doomed[0];
    eliminateOnTile(r, 'A', tile);
    r.advance(500, 250);
    assert.ok(mn(r).applyAt > 0, 'B tek başına: erken bitti');
    assert.deepEqual(ranking(r), [['B'], ['A']]);
    // 1 insan + 2 bot
    const r2 = await reachFfa({ humans: 1, bots: 2, game: GAME, extra: { noFfa: true } });
    const m = mn(r2);
    const sc2 = sched(r2);
    const bots = m.pl.filter((id) => id !== 'A');
    const falls = bots.map((id) => D.botFall(m.sd, id, sc2));
    const fin2 = D.tileCenter(sc2.finalTile);
    toElapsed(r2, 8000);
    reportPos(r2, 'A', fin2.x, fin2.y);
    const last = Math.max.apply(null, falls);
    toElapsed(r2, last - 500);
    assert.equal(mn(r2).applyAt, 0, 'bir bot hâlâ hayatta');
    toElapsed(r2, last + 600);
    assert.ok(mn(r2).applyAt > 0, 'botlar düştü, insan tek hayatta');
    const expected = D.rank({ players: m.pl, bots, seed: m.sd, sched: sc2, outs: {}, endMs: last + 600 });
    assert.deepEqual(r2.view('A').mini.ranking.map((g) => g.slice().sort()), expected.map((g) => g.slice().sort()));
    assert.deepEqual(r2.view('A').mini.ranking[0], ['A'], 'insan 1.');
});

// Gerçek oturumları finale yürütür (halka yıkılmadan): girişleri oyuncuya göre ayarlar, varınca durur
function walk(r, ids, target, maxMs) {
    let t = 0;
    while (t < (maxMs || 4000)) {
        let allIn = true;
        ids.forEach((id) => {
            const s = r.m(id)._session();
            const st = s.state();
            const dx = target.x - st.x;
            const dy = target.y - st.y;
            const d = Math.hypot(dx, dy);
            if (d < 6) s.setInput(0, 0); else { allIn = false; s.setInput(dx / d, dy / d); }
        });
        r.advance(100, 100);
        t += 100;
        if (allIn) break;
    }
    ids.forEach((id) => r.m(id)._session().setInput(0, 0));
}

test('out kaybolursa: ilk out ağda düşer, tekrarı kenar düşmesini yakalar -> hayatta ≤ 1 erken bitişi, yanlış eşit 1. yok', async () => {
    const r = await reachFfa({ humans: 2, game: GAME, extra: { dropOuts: 1 } });
    const sc = sched(r);
    const fin = D.tileCenter(sc.finalTile);
    r.advance(Math.max(0, mn(r).ff.stAt + 300 - r.now()), 100);
    // A (lider) finale yürür; B doğuya yürüyüp arenadan düşer (kenar düşmesi: stale ile yakalanamaz, yalnız out bildirir)
    r.m('B')._session().setInput(1, 0);
    walk(r, ['A'], fin, 1500);
    let g = 0;
    while (g++ < 60 && r.m('B')._session().state().alive) r.advance(100, 100);
    const stB = r.m('B')._session().state();
    assert.equal(stB.alive, false, 'B kenardan düştü');
    r.advance(300, 100);
    assert.equal(mn(r).ff.rep.B.out, -1, 'ilk out ağda kayboldu: lider henüz bilmiyor');
    assert.equal(mn(r).applyAt, 0);
    r.advance(C.DUSENZEMIN_HEARTBEAT_MS + 400, 100);
    const outKey = mn(r).ff.rep.B.out;
    assert.ok(outKey >= 0, 'tekrarlanan out kabul edildi');
    assert.equal(outKey, stB.outAt, 'kenar düşmesi: anahtar oyuncunun kendi ms\'si');
    assert.ok(!sc.rounds.some((x) => x.collapseMs === outKey), 'kare yıkımı (staleOut) değil, gerçek out');
    assert.ok(outKey < sc.rounds[0].collapseMs, 'ilk yıkılıştan önce düştü');
    assert.ok(mn(r).applyAt > 0, 'A tek hayatta: erken bitti (süre dolmadan)');
    assert.ok(mn(r).ff.endAt - r.now() > 60000);
    assert.deepEqual(ranking(r), [['A'], ['B']], 'yanlış eşit 1. oluşmadı');
});

test('yenileme: elenmiş oyuncu hayalet kalır (hareket/out yok); hayattaki oyuncu raporlanan konumdan devam eder', async () => {
    const r = await reachFfa({ humans: 3, game: GAME });
    const sc = sched(r);
    const fin = D.tileCenter(sc.finalTile);
    r.advance(Math.max(0, mn(r).ff.stAt + 300 - r.now()), 100);
    // A (lider) ve C finale yürür; B durağan kalır ve kendi karesi yıkılınca düşer (kare B'nin başlangıç karesi hiç yıkılmıyorsa C/B yer değiştirir)
    const stayer = ['B', 'C'].find((id) => sc.collapse[startTile(r, id)] !== Infinity) || 'B';
    const walker = ['B', 'C'].find((id) => id !== stayer);
    walk(r, ['A', walker], fin);
    let g = 0;
    while (g++ < 400 && mn(r).ff.rep[stayer].out < 0) r.advance(250, 250);
    assert.ok(mn(r).ff.rep[stayer].out >= 0, 'durağan oyuncu düştü');
    assert.equal(mn(r).applyAt, 0, 'A ve ' + walker + ' hayatta: oyun sürüyor');
    const outKey = mn(r).ff.rep[stayer].out;
    const sentBefore = r.sent.length;
    const refresh = (id) => { r.leave(id); r.advance(300, 100); r.join(id, NAMES[IDS.indexOf(id)]); r.advance(1200, 100); };
    refresh(stayer);
    const st = r.m(stayer)._session().state();
    assert.deepEqual({ alive: st.alive, ghost: st.ghost }, { alive: false, ghost: true }, 'hayalet');
    r.advance(4000, 250);
    assert.equal(r.sent.slice(sentBefore).filter((s) => s.from === stayer && s.msg.type === 'pt_mg').length, 0, 'yenileme sonrası hiç rapor/out yok (ikinci out yok)');
    r.m(stayer)._session().setInput(1, 0);
    r.advance(500, 100);
    assert.equal(r.m(stayer)._session().state().x, st.x, 'hayalet hareket etmez');
    assert.equal(mn(r).ff.rep[stayer].out, outKey, 'elenme kaydı değişmedi');
    // hayattaki oyuncu: raporlanan konumdan devam
    const q = mn(r).ff.rep[walker];
    assert.equal(q.out, -1);
    refresh(walker);
    const sa = r.m(walker)._session().state();
    assert.equal(sa.ghost, false);
    assert.equal(sa.alive, true);
    assert.ok(Math.abs(sa.x - q.x) < 8 && Math.abs(sa.y - q.y) < 8, 'konum korundu: ' + sa.x + ',' + sa.y + ' / ' + q.x + ',' + q.y);
    r.advance(2500, 250);
    assert.equal(mn(r).ff.rep[walker].out, -1, 'yenilenen hayatta oyuncu elenmedi');
});
