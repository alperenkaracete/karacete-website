// Kurbağa (ffa) makine entegrasyonu: gerçek PartiMachine + KurbagaSession, sahte oda (tests/duel-room.js).
// Sonuç yalnız liderde, raporlardan hesaplanır; oturumlar her insan istemcide yerel; botlar tohumdan.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const K = require('../games/parti/mini/kurbaga-rules.js');
const { reachFfa, rewardsFromFx, IDS } = require('./duel-room.js');

const mn = (r, id) => r.state(id || leaderOf(r)).mn;
const key = (r) => 'f:' + mn(r).sd + ':' + mn(r).gm;
let seq = 1000000;
// Lider denetimli rapor girişi (n büyük: oturumların kendi kalp atışları sonradan gelip ezmez)
const leaderOf = (r) => IDS.find((id) => r.nodes[id] && r.nodes[id].online && r.view(id).isLeader) || 'A';
function report(r, from, o) { r.m(leaderOf(r))._ffaReport(from, Object.assign({ k: 'pos', c: 4, d: 0, n: ++seq }, o)); }
function toElapsed(r, ms) { const target = mn(r).ff.stAt + ms; if (target > r.now()) r.advance(target - r.now(), 250); }
// Gerçekçi tırmanış: her satır ayrı rapor, aralarında sıçrama süresi (lider makullük denetimi 1 hücre / ~150 ms bütçesi verir)
function climb(r, id, toRow) {
    for (let row = mn(r).ff.rep[id].r + 1; row <= toRow; row++) { report(r, id, { r: row }); r.advance(160, 160); }
}
// 8. satıra tırmanır, sonra e ms (istemcinin ölçtüğü süre) ile varış raporu; varış anındaki saati döndürür
function finish(r, id, e) {
    climb(r, id, 8);
    report(r, id, { r: 9, e });
    return r.now();
}
function untilRanked(r, max) {
    let g = 0;
    while (!(r.view('A').mini && r.view('A').mini.ranking.length) && g++ < (max || 1000)) r.advance(250, 250);
}
const ranking = (r) => r.view('A').mini.ranking.map((g) => g.slice().sort());

test('başlangıç: ffa jetonu (gm kurbaga, geri sayım), her insan istemcide yerel oturum, botlarda oturum yok', async () => {
    const r = await reachFfa({ humans: 3, bots: 2 });
    const m = mn(r);
    assert.equal(m.ty, 'ffa');
    assert.equal(m.gm, 'kurbaga');
    assert.equal(m.pl.length, 5);
    assert.deepEqual(Object.keys(m.ff.rep).sort(), ['A', 'B', 'C'], 'raporlar yalnız insanlar için');
    assert.equal(m.ff.endAt - m.ff.stAt, C.KURBAGA_MS);
    assert.equal(m.ff.stAt - r.now() <= C.KURBAGA_COUNTDOWN_MS, true);
    IDS.slice(0, 3).forEach((id) => {
        assert.ok(r.m(id)._session(), id + ' yerel oturum');
        assert.equal(r.view(id).mini.live, true);
        assert.equal(r.view(id).mini.game, 'kurbaga');
    });
    // diğer istemciler jetonu pt_state ile aldı (araçlar/botlar ağda yok)
    assert.deepEqual(Object.keys(r.state('B').mn.ff.rep).sort(), ['A', 'B', 'C']);
    assert.ok(r.state('B').mn.ff.stAt > 0);
    const sent = JSON.stringify(r.state('A').mn.ff);
    assert.ok(sent.length < 400, 'ff yükü küçük: ' + sent.length);
    assert.equal(mn(r).pm.length, 0, 'düello çiftleri yok');
    assert.equal(r.view('A').mini.pairs.length, 0);
});

test('tüm bağlı insanlar varınca erken biter; varanlar süreye göre (eşit ms eşit derece), ödüller derece 1/1/3', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 30000);
    finish(r, 'A', 25000);
    finish(r, 'B', 25000);
    assert.equal(mn(r).applyAt, 0, 'C varmadı: bitmedi');
    climb(r, 'C', 6);
    r.advance(1000, 250);
    assert.equal(mn(r).applyAt, 0);
    finish(r, 'C', 31000);
    r.advance(250, 250);
    assert.ok(mn(r).applyAt > 0, 'hepsi vardı: erken bitti');
    assert.ok(mn(r).ff.endAt - r.now() > 10000, 'süre dolmadan');
    assert.deepEqual(ranking(r), [['A', 'B'], ['C']]);
    r.advance(C.MINI_HOLD_MS + 500, 250);
    assert.equal(r.state('A').g.stage, 'roll', 'yeni tur');
    assert.deepEqual(rewardsFromFx(r), { A: 1, B: 1, C: 3 });
    assert.equal(r.state('A').g.lm, 'kurbaga');
    assert.ok(r.state('A').lg.some((l) => l.startsWith('🎡')));
});

test('ilk varıştan sonra kalan süre 20 sn: kalanlar anlık satıra göre, varan her zaman önde', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 40000);
    climb(r, 'B', 8);
    climb(r, 'C', 3);
    const t0 = finish(r, 'A', 38000);
    assert.equal(mn(r).ff.endAt, t0 + C.KURBAGA_LAST_CALL_MS, 'son çağrı: 20 sn');
    r.advance(C.KURBAGA_LAST_CALL_MS - 500, 250);
    assert.equal(mn(r).applyAt, 0);
    untilRanked(r, 20);
    assert.deepEqual(ranking(r), [['A'], ['B'], ['C']]);
    // sonraki varış süreyi uzatmaz
});

test('ikinci varış son çağrıyı uzatmaz; ilk varıştan önceki 120 sn sınırı korunur', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 80000);
    finish(r, 'A', 79000);
    const end1 = mn(r).ff.endAt;
    assert.equal(end1 - r.now(), C.KURBAGA_LAST_CALL_MS);
    r.advance(5000, 250);
    finish(r, 'B', 84000);
    assert.equal(mn(r).ff.endAt, end1, 'uzamadı');
});

test('süre (120 sn) dolunca biter; kimse varmadıysa herkes satırına göre sıralanır', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 100000);
    climb(r, 'B', 6);
    untilRanked(r);
    assert.ok(mn(r).applyAt > 0);
    assert.deepEqual(ranking(r), [['B'], ['A', 'C']]);
    assert.ok(r.now() - mn(r).ff.stAt >= C.KURBAGA_MS, 'süre dolmadan bitmedi');
});

test('hiç rapor yoksa acil yedek çark (oturumlar rapor vermezse)', async () => {
    const r = await reachFfa({ humans: 3, extra: { noFfa: true } });
    assert.equal(mn(r).ff.sn, 0);
    r.advance(C.KURBAGA_COUNTDOWN_MS + C.KURBAGA_MS + 500, 250);
    assert.ok(mn(r).applyAt > 0, 'takılmadı');
    assert.equal(r.view('A').mini.ranking.flat().length, 3, 'çark herkesi sıraladı');
    r.advance(C.MINI_HOLD_MS + 500, 250);
    assert.equal(r.state('A').g.stage, 'roll');
    assert.equal(r.state('A').g.lm, 'kurbaga');
});

test('saçma raporlar yok sayılır: ışınlanma, geri sayım, erken/uzak varış, tekrar n, katılımcı olmayan/bot', async () => {
    const r = await reachFfa({ humans: 3, bots: 1 });
    toElapsed(r, 20000);
    const rep = () => mn(r).ff.rep;
    report(r, 'B', { r: 1 });                                  // makul: zaman bütçesi var
    assert.equal(rep().B.r, 1);
    report(r, 'B', { r: 6 });                                  // aynı anda 5 satır atlama
    assert.equal(rep().B.r, 1, 'ışınlanma reddedildi');
    r.m('A')._ffaReport('B', { k: 'pos', r: 2, c: 4, d: 0, n: 5 });
    assert.equal(rep().B.r, 1, 'eski/tekrar sıra no reddedildi');
    report(r, 'B', { r: 1, c: 8 });                            // yatay 4 hücre, süre yok
    assert.equal(rep().B.c, 4);
    report(r, 'C', { r: 9, e: 100 });                          // 9 sıçrama süresinden hızlı
    assert.equal(rep().C.f, -1);
    report(r, 'C', { r: 9, e: 99999 });                        // liderin saatinden ileri
    assert.equal(rep().C.f, -1);
    report(r, 'C', { r: 9 });                                  // varış süresi yok
    assert.equal(rep().C.f, -1);
    report(r, 'C', { d: -1, r: 0 });
    report(r, 'C', { d: 1.5, r: 0 });
    assert.equal(rep().C.d, 0);
    const bot = mn(r).pl.find((id) => !rep()[id]);
    assert.ok(bot, 'bot var');
    report(r, bot, { r: 3 });
    report(r, 'ZZZ', { r: 3 });
    assert.equal(rep()[bot], undefined);
    assert.equal(rep().ZZZ, undefined);
    r.m('A')._ffaReport('B', { k: 'x', r: 2, c: 4, d: 0, n: ++seq });
    r.m('A')._ffaReport('B', null);
    assert.equal(rep().B.r, 1);
});

test('pt_mg yönlendirme: lider gelen raporu işler, başka kimse işlemez; görüntü için herkesin oturumuna ulaşır', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 10000);
    // B oturumu gerçekten sıçrasın (satır 0'da yan sıçrama güvenli): A (lider) ve C görür
    const sB = r.m('B')._session();
    const e = r.now() - mn(r).ff.stAt;
    assert.ok(e > 0);
    assert.equal(sB.hop('left', r.now()), true);
    r.advance(1000, 250);
    assert.equal(r.state('A').mn.ff.rep.B.c, 3, 'lider raporu kabul etti');
    assert.equal(r.m('C')._session().peers.B.c, 3, 'C görüntü için aldı (≤2/sn publish\'e bağlı değil)');
    assert.equal(r.m('A')._session().peers.B.c, 3);
    assert.equal(r.state('C').mn.ff.rep.B.c <= 4, true);
    // lider olmayan bir istemci inject edilen rapora aldanmaz
    r.inject('C', { type: 'pt_mg', mg: key(r), from: 'B', m: { k: 'pos', r: 9, c: 4, d: 0, n: ++seq, e: 30000 } });
    assert.equal(r.state('C').mn.ff.rep.B.f, -1);
    // lider, yanlış jeton (başka maç) taşıyan rapora aldanmaz
    r.inject('A', { type: 'pt_mg', mg: 'f:1:kurbaga', from: 'B', m: { k: 'pos', r: 1, c: 3, d: 0, n: ++seq } });
    assert.equal(r.state('A').mn.ff.rep.B.r, 0);
    // doğru jetonla lider işler
    r.inject('A', { type: 'pt_mg', mg: key(r), from: 'B', m: { k: 'pos', r: 1, c: 3, d: 0, n: ++seq } });
    assert.equal(r.state('A').mn.ff.rep.B.r, 1);
});

test('ilerleme yayını sınırlı (~500 ms); varış anında hemen; izleyici çubukları rows (bot = tohumdan)', async () => {
    const r = await reachFfa({ humans: 2, bots: 2 });
    toElapsed(r, 30000);
    const sentBefore = r.sent.filter((s) => s.msg.type === 'pt_state').length;
    for (let i = 0; i < 6; i++) { report(r, 'B', { r: i + 1 }); r.advance(50, 50); }
    const during = r.sent.filter((s) => s.msg.type === 'pt_state').length - sentBefore;
    assert.ok(during <= 2, '300 ms içinde en çok 1-2 yayın: ' + during);
    climb(r, 'B', 8);
    r.advance(600, 100);
    const before = r.sent.filter((s) => s.msg.type === 'pt_state').length;
    report(r, 'B', { r: 9, e: 29000 });
    assert.equal(r.sent.filter((s) => s.msg.type === 'pt_state').length, before + 1, 'varış hemen yayınlanır');
    r.flush();
    const rows = r.view('B').mini.ff.rows;
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((x) => x.bot).length, 2);
    const botRow = rows.find((x) => x.bot);
    const el = r.view('B').mini.ff.elapsed;
    assert.equal(botRow.row, K.botProgress(mn(r).sd, botRow.id, el));
    assert.equal(rows.find((x) => x.id === 'B').fin, 29000);
});

test('kopan insan beklenmez ve en sona yazılır; kalan bağlılar varınca erken biter', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 20000);
    r.leave('C');
    r.advance(500, 250);
    finish(r, 'A', 18000);
    finish(r, 'B', 19000);
    r.advance(500, 250);
    assert.ok(mn(r).applyAt > 0, 'bağlı herkes vardı: C beklenmedi');
    r.advance(C.MINI_HOLD_MS + 500, 250);
    const line = r.state('A').lg.filter((l) => l.startsWith('🎡')).pop();
    assert.ok(/C$/.test(line.trim()) || line.indexOf('Cem') > line.indexOf('Bora'), 'C en sonda: ' + line);
});

test('lider devri: rapor durumu pt_state ile taşınır, oturum sıfırlanmaz, yeni lider sonucu hesaplar', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 20000);
    climb(r, 'A', 4);                                          // lider A'nın raporu (A'nın kendi oturumu satır 0'da kalır; n küçük, ezmez)
    r.advance(1500, 250);
    const s0 = r.m('B')._session();
    const s0c = r.m('C')._session();
    assert.ok(s0 && s0c);
    r.leave('A');                                              // lider düştü
    r.advance(3000, 250);
    const newLeader = ['B', 'C'].find((id) => r.view(id).isLeader);
    assert.ok(newLeader, 'yeni lider');
    assert.equal(r.m('B')._session(), s0, 'oturum aynı (ilerleme sıfırlanmadı)');
    assert.equal(r.state(newLeader).mn.ff.rep.A.r, 4, 'rapor durumu pt_state ile taşındı');
    // yeni lider raporları işler ve sonucu hesaplar
    const L = r.m(newLeader);
    // yeni lider (n sıfırlandı, zaman bütçesi oyun başından): tırmanış raporları kabul edilir
    for (let row = 1; row <= 8; row++) { L._ffaReport('B', { k: 'pos', r: row, c: 4, d: 0, n: ++seq }); L._ffaReport('C', { k: 'pos', r: row, c: 4, d: 0, n: ++seq }); r.advance(160, 160); }
    L._ffaReport('B', { k: 'pos', r: 9, c: 4, d: 0, n: ++seq, e: r.now() - mn(r, newLeader).ff.stAt - 10 });
    L._ffaReport('C', { k: 'pos', r: 9, c: 4, d: 0, n: ++seq, e: r.now() - mn(r, newLeader).ff.stAt - 5 });
    r.advance(500, 250);
    assert.ok(r.state(newLeader).mn.applyAt > 0, 'A koptu: kalan bağlılar varınca bitti');
    assert.deepEqual(r.state(newLeader).mn.rk[0].length >= 1, true);
});

test('8 insan: derece 1/2/3 ödülü, 4+ ödülsüz; pt_state 20 KB altında', async () => {
    const r = await reachFfa({ humans: 8 });
    toElapsed(r, 60000);
    IDS.slice(0, 8).forEach((id, i) => finish(r, id, 30000 + i * 1000));      // gerçek varış anları farklı; derece e'ye göre
    r.advance(500, 250);
    assert.ok(mn(r).applyAt > 0);
    assert.deepEqual(r.view('A').mini.ranking, IDS.slice(0, 8).map((id) => [id]));
    r.advance(C.MINI_HOLD_MS + 500, 250);
    const rw = rewardsFromFx(r);
    assert.deepEqual(rw, { A: 1, B: 2, C: 3 }, '4. ve sonrası ödülsüz (mevcut REWARDS)');
    const max = Math.max.apply(null, r.sent.filter((s) => s.msg.type === 'pt_state').map((s) => JSON.stringify(s.msg).length));
    assert.ok(max < 20000, 'pt_state boyutu ' + max);
    assert.ok(max > 1000);
});

test('1 insan + botlar: insan varınca biter; bot sıralamaya aynı kurallarla girer', async () => {
    const r = await reachFfa({ humans: 1, bots: 2 });
    const m = mn(r);
    assert.equal(m.pl.length, 3);
    assert.deepEqual(Object.keys(m.ff.rep), ['A']);
    toElapsed(r, 30000);
    finish(r, 'A', 25000);
    untilRanked(r, 20);
    const got = r.view('A').mini.ranking;
    const endMs = r.now() - m.ff.stAt;
    const bots = m.pl.filter((id) => id !== 'A');
    const expected = K.rank({ players: m.pl, bots, seed: m.sd, reports: { A: { r: 9, f: 25000, d: 0 } }, endMs });
    assert.deepEqual(got, expected);
    assert.equal(got.flat().length, 3);
});

test('doğrulama: bozuk ff yükü reddedilir; ffa jetonu 2 oyunculu eski düello yoluna girmez', async () => {
    const r = await reachFfa({ humans: 3 });
    r.advance(1000, 250);
    const last = r.sent.filter((s) => s.from === 'A' && s.msg.type === 'pt_state').pop().msg;
    const bump = (m) => { m.rv = r.state('C').rv + 5; return m; };
    const bad = bump(JSON.parse(JSON.stringify(last)));
    bad.mn.ff.rp.B[0] = 99;
    const rvBefore = r.state('C').rv;
    r.inject('C', bad);
    assert.equal(r.state('C').rv, rvBefore, 'r=99 reddedildi');
    const bad2 = bump(JSON.parse(JSON.stringify(last)));
    bad2.mn.ff.st = 'x';
    r.inject('C', bad2);
    assert.equal(r.state('C').rv, rvBefore);
    const bad3 = bump(JSON.parse(JSON.stringify(last)));
    bad3.mn.ff.rp.B = [1, 2, 3];
    r.inject('C', bad3);
    assert.equal(r.state('C').rv, rvBefore);
    // ffa + gm + 2 oyuncu + pm yok: eski tek-çift düello okumasına girmemeli
    const legacy = bump(JSON.parse(JSON.stringify(last)));
    delete legacy.mn.pm;
    delete legacy.mn.ff;
    legacy.mn.pl = ['A', 'B'];
    r.inject('C', legacy);
    assert.equal(r.state('C').mn.pm.length, 0, 'düello çifti uydurulmadı');
});

// ---- Sayfa yenileme: varış / ilerleme korunur ----
const { NAMES } = require('./duel-room.js');
function refresh(r, id) {
    r.leave(id);
    r.advance(300, 100);
    r.join(id, NAMES[IDS.indexOf(id)]);
    r.advance(1200, 100);
}
const sessState = (r, id) => r.m(id)._session().state();
const lastFrom = (r, id, from) => r.sent.filter((s) => s.from === id && s.msg.type === 'pt_mg').slice(from || 0);

test('varıp yenileyen oyuncu hedefte açılır: hareket kilitli, varış raporu yeniden gönderilmez, sıralama değişmez', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 30000);
    finish(r, 'B', 25000);
    r.advance(600, 100);
    const before = r.sent.length;
    refresh(r, 'B');
    const st = sessState(r, 'B');
    assert.deepEqual({ r: st.r, f: st.f, d: st.d }, { r: 9, f: 25000, d: 0 }, 'hedefte, varış süresi korundu');
    assert.equal(r.m('B')._session().hop('left', r.now()), false, 'hareket kilitli');
    assert.equal(r.m('B')._session().hop('down', r.now()), false);
    // yeni oturum yenilemeden sonra bir varış raporu (ilk anlık rapor) göndermedi
    assert.equal(r.sent.slice(before).filter((s) => s.from === 'B' && s.msg.type === 'pt_mg').length, 0, 'yenilemeden sonra ilk saniyelerde rapor yok');
    r.advance(1000, 100);
    const beat = r.sent.slice(before).filter((s) => s.from === 'B' && s.msg.type === 'pt_mg');
    assert.equal(beat.length, 1, '2 sn sonra yalnız kalp atışı');
    assert.equal(beat[0].msg.m.e, 25000, 'kalp atışı vardı durumunu taşır');
    assert.equal(r.state('A').mn.ff.rep.B.f, 25000, 'lider kaydı değişmedi');
    finish(r, 'A', 26000);
    finish(r, 'C', 27000);
    r.advance(500, 250);
    assert.deepEqual(ranking(r), [['B'], ['A'], ['C']], 'sıralama yenilemeden etkilenmedi');
});

test('ortada yenileme eskisi gibi: raporlanan satır/sütundan devam, yeni oturum raporları lider tarafından kabul edilir', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 10000);
    const s0 = r.m('B')._session();
    r.advance(400, 100);
    s0.hop('left', r.now());
    s0.hop('left', r.now() + 200);
    r.advance(5000, 250);                                     // kalp atışları: liderde n yükseldi
    const rep0 = Object.assign({}, r.state('A').mn.ff.rep.B);
    assert.ok(rep0.c <= 3);
    refresh(r, 'B');
    const st = sessState(r, 'B');
    assert.equal(st.c, rep0.c, 'sütun korundu');
    assert.equal(st.r, rep0.r);
    assert.equal(st.f, -1, 'varmadı');
    r.advance(500, 100);
    assert.equal(r.m('B')._session().hop('left', r.now()), true, 'hareket edebilir');
    r.advance(1500, 250);
    assert.equal(r.state('A').mn.ff.rep.B.c, Math.max(0, rep0.c - 1), 'yeni oturumun raporu lider tarafından kabul edildi (n çakışması yok)');
});

test('lider yenilemesi: varış bilgisi (rep.f) yeni lidere taşınır, sıralama ve son çağrı bozulmaz', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 30000);
    finish(r, 'B', 25000);
    r.advance(600, 100);
    const end1 = r.state('A').mn.ff.endAt;
    refresh(r, 'A');                                          // lider sayfayı yeniledi
    const L = ['B', 'C', 'A'].find((id) => r.view(id).isLeader);
    assert.ok(L && L !== 'A', 'başka biri lider oldu');
    assert.equal(r.state(L).mn.ff.rep.B.f, 25000, 'rep.f korundu');
    assert.ok(Math.abs(r.state(L).mn.ff.endAt - end1) <= 400, 'son çağrı sayacı sıfırlanmadı/uzamadı (yayın gecikmesi payı)');
    // A'nın yeni oturumu da kayıtlı (vardıysa) durumunu geri alır
    finish(r, 'A', 26000);
    finish(r, 'C', 27000);
    r.advance(500, 250);
    assert.deepEqual(ranking(r), [['B'], ['A'], ['C']]);
});

test('son çağrı: varan yenilese de 20 sn sayacı sıfırlanmaz ve uzamaz; tüm insanlar varınca erken biter', async () => {
    const r = await reachFfa({ humans: 3 });
    toElapsed(r, 30000);
    const t0 = finish(r, 'A', 28000);
    const end1 = r.state('A').mn.ff.endAt;
    assert.equal(end1, t0 + C.KURBAGA_LAST_CALL_MS);
    r.advance(5000, 250);
    refresh(r, 'A');
    const near = (id) => Math.abs(r.state(id).mn.ff.endAt - end1) <= 400;
    assert.ok(near(['A', 'B', 'C'].find((id) => r.view(id).isLeader)), 'yenileme sayacı değiştirmedi');
    finish(r, 'B', 29000);
    assert.ok(near(['A', 'B', 'C'].find((id) => r.view(id).isLeader)), 'ikinci varış uzatmadı');
    const L = ['A', 'B', 'C'].find((id) => r.view(id).isLeader);
    assert.equal(r.state(L).mn.applyAt, 0, 'C varmadı');
    const lead = r.m(L);
    for (let row = 1; row <= 8; row++) { lead._ffaReport('C', { k: 'pos', r: row, c: 4, d: 0, n: ++seq }); r.advance(160, 160); }
    lead._ffaReport('C', { k: 'pos', r: 9, c: 4, d: 0, n: ++seq, e: r.now() - r.state(L).mn.ff.stAt - 10 });
    r.advance(500, 250);
    assert.ok(r.state(L).mn.applyAt > 0, 'yenileyen A dahil tüm insanlar vardı: erken bitti');
    assert.ok(r.state(L).mn.ff.endAt - r.now() > 5000);
});

test('tek insan + bot: varıp yenileyince oyun erken bitişi bozulmaz', async () => {
    const r = await reachFfa({ humans: 1, bots: 2 });
    toElapsed(r, 30000);
    finish(r, 'A', 25000);
    // A lider ve tek insan: varınca erken biter; yenilemeden önce sonuç kaydedilmiş olmalı
    untilRanked(r, 20);
    assert.ok(r.view('A').mini.ranking.length > 0);
    assert.equal(r.view('A').mini.ranking.flat().length, 3);
});
