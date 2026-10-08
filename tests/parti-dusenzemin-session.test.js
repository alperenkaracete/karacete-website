// Düşen Zemin oturumu (DOM'suz çekirdek): sabit adım fizik, ≤8 Hz rapor birleştirme, it (yalnız hedefte uygulanır), out tek sefer,
// yenileme (resume: elenmiş hayalet kalır, ikinci out yok), kalp atışı, geçmeli yakalama, akran mesajları.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const D = require('../games/parti/mini/dusenzemin-rules.js');
const Session = require('../games/parti/mini/dusenzemin-session.js');

const SEED = 5;
const PLAYERS = ['me', 'p2', 'bot1'];
const SC = D.schedule(SEED, PLAYERS.length);

function setup(extra) {
    let t = 100000;
    const sent = [];
    const handlers = [];
    const reports = [];
    const ac = new AbortController();
    let api = null;
    const sentAt = [];
    const net = { send: (m) => { sentAt.push(t); sent.push(JSON.parse(JSON.stringify(m))); }, on: (fn) => { handlers.push(fn); return () => { handlers.splice(handlers.indexOf(fn), 1); }; } };
    const spec = Object.assign({
        type: 'ffa', game: 'dusenzemin', players: PLAYERS, bots: ['bot1'], seed: SEED, me: { id: 'me', name: 'Ben' }, net, signal: ac.signal,
        now: () => t, startAt: t + 4000, onReport: (m) => reports.push(m), register: (a) => { api = a; }
    }, extra || {});
    const promise = Session.run(spec);
    const feed = (from, m) => handlers.slice().forEach((fn) => fn(from, m));
    return { api, sent, sentAt, reports, handlers, ac, promise, feed, set: (v) => { t = v; }, get t() { return t; }, startAt: spec.startAt };
}
const at = (s, e) => s.set(s.startAt + e);
// belirli aralıkta 16 ms'lik kareler: tick sürer
function advance(s, ms, frame) {
    const end = s.t + ms;
    while (s.t < end) { s.set(Math.min(end, s.t + (frame || 16))); s.api.tick(s.t); }
}
const posMsgs = (s) => s.sent.filter((m) => m.k === 'pos');

test('başlangıç: ilk tick ilk raporu hemen gönderir (başlangıç halkası konumu); geri sayımda hareket ve düğme yok', () => {
    const s = setup();
    s.api.tick(s.t);
    assert.equal(posMsgs(s).length, 1);
    const start = D.startPositions(SEED, PLAYERS.length)[0];
    const m = posMsgs(s)[0];
    assert.deepEqual({ x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, a: m.a }, { x: start.x, y: start.y, z: 0, vx: 0, vy: 0, a: 1 });
    assert.deepEqual(s.reports, s.sent, 'lider onReport alır');
    s.api.setInput(1, 0);
    advance(s, 2000);
    assert.equal(s.api.state().x, start.x, 'geri sayımda hareket yok');
    assert.equal(s.api.press('jump', s.t), false);
    assert.equal(s.api.press('push', s.t), false);
});

test('hareket: sabit adımla yürür; rapor ≤ ~8 Hz birleştirilir; durunca yalnız kalp atışı (2 sn)', () => {
    const s = setup();
    at(s, 0);
    s.api.tick(s.t);
    s.api.setInput(1, 0);
    const n0 = posMsgs(s).length;
    const t0 = s.t;
    advance(s, 1000);
    const x1 = s.api.state().x;
    assert.ok(x1 > D.startPositions(SEED, 3)[0].x + 100, 'yürüdü');
    const per = posMsgs(s).length - n0;
    assert.ok(per <= Math.ceil(1000 / C.DUSENZEMIN_SEND_MS) + 1, '1 sn içinde ≤ 9 rapor: ' + per);
    assert.ok(per >= 5, 'hareket raporlanıyor: ' + per);
    // duran oyuncu: yalnız kalp atışı
    s.api.setInput(0, 0);
    advance(s, 1500);
    const k = posMsgs(s).length;
    advance(s, 1500);
    assert.ok(posMsgs(s).length - k <= 2, 'durunca yalnız kalp atışı');
    const ns = posMsgs(s).map((m) => m.n);
    assert.deepEqual(ns, ns.slice().sort((a, b) => a - b));
    assert.equal(new Set(ns).size, ns.length, 'n tekrar etmez');
    assert.ok(t0 > 0);
});

test('zıplama: anında rapor (z>0), bekleme 1.4 sn; it bekleme 1.2 sn; basılı tutma gerekmez (kenar tetikli)', () => {
    const s = setup();
    at(s, 0);
    s.api.tick(s.t);
    advance(s, 100);
    const before = posMsgs(s).length;
    assert.equal(s.api.press('jump', s.t), true);
    advance(s, 60);
    assert.ok(posMsgs(s).length > before, 'zıplama anında rapor');
    const jumpMsg = posMsgs(s).find((m, i) => i >= before && m.z > 0) || posMsgs(s)[posMsgs(s).length - 1];
    assert.ok(jumpMsg.z >= 0);
    assert.equal(s.api.state().airborne, true);
    advance(s, 700);
    assert.equal(s.api.state().airborne, false);
    s.api.press('jump', s.t);
    advance(s, 40);
    assert.equal(s.api.state().airborne, false, 'bekleme dolmadı (başlangıçtan 1.4 sn)');
    advance(s, 800);
    s.api.press('jump', s.t);
    advance(s, 40);
    assert.equal(s.api.state().airborne, true, 'bekleme dolunca zıplar');
});

test('it: koni/menzildeki en yakın hayatta insana push gider (to, dx, dy, n); hedef yoksa mesaj yok; bot hedef olmaz', () => {
    const s = setup();
    at(s, 0);
    s.api.tick(s.t);
    advance(s, 200);
    const me = s.api.state();
    s.api.setInput(1, 0);
    advance(s, 120);                                    // bakış yönü +x
    s.api.setInput(0, 0);
    advance(s, 400);
    const cur = s.api.state();
    // hedef yok -> push mesajı yok (ama bekleme harcanır)
    s.api.press('push', s.t);
    advance(s, 60);
    assert.equal(s.sent.filter((m) => m.k === 'push').length, 0, 'hedef yok');
    advance(s, 1300);
    // p2 önümde
    s.feed('p2', { k: 'pos', n: 1, x: Math.round(cur.x + 2 * D.R + 25), y: Math.round(cur.y), z: 0, vx: 0, vy: 0, a: 1 });
    s.feed('bot1', { k: 'pos', n: 1, x: Math.round(cur.x + 30), y: Math.round(cur.y), z: 0, vx: 0, vy: 0, a: 1 });
    s.api.press('push', s.t);
    advance(s, 60);
    const pushes = s.sent.filter((m) => m.k === 'push');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].to, 'p2');
    assert.ok(Math.abs(Math.hypot(pushes[0].dx, pushes[0].dy) - D.PUSH_IMPULSE) <= 1.5);
    assert.ok(pushes[0].dx > 0);
    assert.ok(me);
});

test('itilen: yalnız hedef (to) kendi üzerine uygular; bekleme, menzil, bilinmeyen/elenmiş gönderen, aşırı vektör reddedilir', () => {
    const s = setup();
    at(s, 0);
    s.api.tick(s.t);
    advance(s, 300);
    const st0 = s.api.state();
    const near = (dx) => ({ k: 'pos', n: 1, x: Math.round(st0.x + dx), y: Math.round(st0.y), z: 0, vx: 0, vy: 0, a: 1 });
    // gönderen bilinmiyor (hiç pos görülmedi) -> yok sayılır
    s.feed('p2', { k: 'push', to: 'me', dx: 300, dy: 0, n: 5 });
    assert.equal(Math.abs(s.api.state().vx) < 1, true, 'bilinmeyen gönderen');
    s.feed('p2', near(40));
    // başkasına giden itme: etkisiz
    s.feed('p2', { k: 'push', to: 'bot1', dx: 300, dy: 0, n: 6 });
    assert.ok(Math.abs(s.api.state().vx) < 1, 'to=ben değil');
    // aşırı vektör
    s.feed('p2', { k: 'push', to: 'me', dx: 5000, dy: 0, n: 7 });
    assert.ok(Math.abs(s.api.state().vx) < 1, 'aşırı vektör');
    // geçerli
    s.feed('p2', { k: 'push', to: 'me', dx: -300, dy: 0, n: 8 });
    assert.ok(s.api.state().vx <= -299, 'uygulandı: ' + s.api.state().vx);
    assert.equal(s.api.state().pushedAt, s.t);
    // bekleme: hemen ikinci itme reddedilir
    const v1 = s.api.state().vx;
    s.feed('p2', { k: 'push', to: 'me', dx: -300, dy: 0, n: 9 });
    assert.equal(s.api.state().vx, v1, 'bekleme dolmadı');
    // 1.2 sn sonra yeniden (konum tazelenir)
    advance(s, 1300);
    const st1 = s.api.state();
    s.feed('p2', { k: 'pos', n: 2, x: Math.round(st1.x + 40), y: Math.round(st1.y), z: 0, vx: 0, vy: 0, a: 1 });
    s.feed('p2', { k: 'push', to: 'me', dx: 0, dy: 300, n: 10 });
    assert.ok(s.api.state().vy >= 299);
    // menzil dışı gönderen
    advance(s, 1300);
    const st2 = s.api.state();
    s.feed('p2', { k: 'pos', n: 3, x: Math.round(st2.x + 400), y: Math.round(st2.y), z: 0, vx: 0, vy: 0, a: 1 });
    const v3 = s.api.state().vy;
    s.feed('p2', { k: 'push', to: 'me', dx: 0, dy: -300, n: 11 });
    assert.equal(s.api.state().vy, v3, 'menzil dışı');
    // elenmiş gönderen
    s.feed('p2', { k: 'out', t: 12345, n: 12 });
    s.feed('p2', { k: 'push', to: 'me', dx: 0, dy: -300, n: 13 });
    assert.equal(s.api.state().vy, v3);
});

// ---- elenme ----
function onDoomedTile(round) {
    const tile = SC.rounds[round].doomed[0];
    return { tile, c: SC.collapse[tile], ctr: D.tileCenter(tile) };
}

test('elenme: yerdeyken zemin yıkılınca ≈ yıkılış + 120 ms sonra TEK out raporu; sonrası pos yok; ikinci out yok', () => {
    const { c, ctr } = onDoomedTile(1);
    const s = setup({ resume: { x: ctr.x, y: ctr.y, z: 0, vx: 0, vy: 0, out: -1 } });
    at(s, c - 600);
    s.api.tick(s.t);
    advance(s, 400);
    assert.equal(s.api.state().alive, true);
    advance(s, 600);
    const st = s.api.state();
    assert.equal(st.alive, false);
    assert.ok(Math.abs(st.outAt - (c + D.FALL_MS)) <= 40, 'outAt ' + st.outAt + ' / ' + (c + D.FALL_MS));
    const outs = s.sent.filter((m) => m.k === 'out');
    assert.equal(outs.length, 1);
    assert.equal(outs[0].t, st.outAt);
    const posAfter = posMsgs(s).length;
    advance(s, 6500);
    assert.equal(posMsgs(s).length, posAfter, 'elenince pos yok');
    // out kaybolabilir: aynı rapor kalp atışı aralığında tekrarlanır (n artar), aralığa en çok 1 mesaj
    const all = s.sent.map((m, i) => ({ m, at: s.sentAt[i] })).filter((x) => x.m.k === 'out');
    assert.ok(all.length >= 3 && all.length <= 4, 'tekrar sayısı ' + all.length);
    all.forEach((x) => assert.equal(x.m.t, st.outAt, 'aynı elenme anı'));
    for (let i = 1; i < all.length; i++) {
        assert.ok(all[i].at - all[i - 1].at >= C.DUSENZEMIN_HEARTBEAT_MS - 1, 'en çok 1 mesaj/HEARTBEAT');
        assert.ok(all[i].m.n > all[i - 1].m.n, 'n artar');
    }
    assert.equal(s.api.press('jump', s.t), false);
    s.api.setInput(1, 0);
    advance(s, 500);
    assert.equal(s.api.state().x, st.x, 'elenmiş hareket etmez');
});

test('yenileme (resume): elenmiş oyuncu hayalet açılır, tekrar oynamaz, hiç rapor/out göndermez; hayattaki son konumdan devam eder', () => {
    const ghost = setup({ resume: { x: 100, y: 100, z: 0, vx: 0, vy: 0, out: 12345 } });
    at(ghost, 30000);
    ghost.api.tick(ghost.t);
    advance(ghost, 5000);
    assert.equal(ghost.sent.length, 0, 'hayalet hiçbir şey göndermez (ikinci out yok)');
    const g = ghost.api.state();
    assert.deepEqual({ alive: g.alive, ghost: g.ghost, outAt: g.outAt, x: g.x, y: g.y }, { alive: false, ghost: true, outAt: 12345, x: 100, y: 100 });
    ghost.api.setInput(1, 0);
    advance(ghost, 500);
    assert.equal(ghost.api.state().x, 100);
    assert.equal(ghost.api.press('push', ghost.t), false);
    // hayatta: raporlanan konumdan devam, sıra no oyun saatinden
    const ft = D.tileCenter(SC.finalTile);
    const alive = setup({ resume: { x: ft.x, y: ft.y, z: 0, vx: 0, vy: 0, out: -1 }, startAt: 60000 });      // oyun 40 sn önce başladı (yenileme)
    at(alive, 40000);
    alive.api.tick(alive.t);
    advance(alive, 600);
    const a = alive.api.state();
    assert.equal(a.alive, true);
    assert.ok(Math.abs(a.x - ft.x) < 1 && Math.abs(a.y - ft.y) < 1, 'konum korundu');
    assert.ok(posMsgs(alive)[0].n >= 40000, 'n oyun saatinden başlar: ' + posMsgs(alive)[0].n);
    // geçersiz resume yok sayılır
    const bad = setup({ resume: { x: 9999, y: 'a', vx: 99999, vy: 1.5, out: 'x' } });
    const sp = D.startPositions(SEED, 3)[0];
    assert.deepEqual({ x: bad.api.state().x, y: bad.api.state().y, alive: bad.api.state().alive }, { x: sp.x, y: sp.y, alive: true });
});

test('geçmeli yakalama: uzun süre tick gelmezse (arka plan) en çok 2 sn ileri sarar, dönüşte tek karede yakalar', () => {
    const s = setup();
    at(s, 0);
    s.api.tick(s.t);
    s.api.setInput(0, 1);
    advance(s, 100);
    const y0 = s.api.state().y;
    at(s, 20000);                                         // 20 sn sessizlik
    s.api.tick(s.t);
    const y1 = s.api.state();
    assert.ok(y1.y - y0 > 100 || !y1.alive, 'yakaladı (ya da kenardan düştü)');
    assert.ok(y1.y - y0 <= D.MAXV * 2 + 30, 'ama yalnızca 2 sn: ' + (y1.y - y0));
});

test('akran mesajları görüntü için tutulur; kendi, bot ve katılımcı olmayan, bozuk mesajlar yok sayılır', () => {
    const s = setup();
    s.feed('p2', { k: 'pos', n: 1, x: 200, y: 210, z: 12, vx: 30, vy: -5, a: 1 });
    assert.deepEqual({ x: s.api.peers.p2.x, y: s.api.peers.p2.y, z: s.api.peers.p2.z, out: s.api.peers.p2.out }, { x: 200, y: 210, z: 12, out: -1 });
    s.feed('p2', { k: 'out', t: 33333, n: 2 });
    assert.equal(s.api.peers.p2.out, 33333);
    s.feed('p2', { k: 'pos', n: 3, x: 1, y: 1, z: 0, vx: 0, vy: 0, a: 1 });
    assert.equal(s.api.peers.p2.out, 33333, 'elenmiş akran geri dönmez');
    s.feed('me', { k: 'pos', n: 1, x: 5, y: 5, z: 0, vx: 0, vy: 0, a: 1 });
    s.feed('bot1', { k: 'pos', n: 1, x: 5, y: 5, z: 0, vx: 0, vy: 0, a: 1 });
    s.feed('zzz', { k: 'pos', n: 1, x: 5, y: 5, z: 0, vx: 0, vy: 0, a: 1 });
    s.feed('p2', null);
    s.feed('p2', { k: 'pos', n: 4, x: 9999, y: 5, z: 0, vx: 0, vy: 0, a: 1 });
    assert.deepEqual(Object.keys(s.api.peers), ['p2']);
});

test('abort: oturum yıkılır, Promise aborted ile biter, dinleyici bırakılır, sonrası tick/giriş etkisiz', async () => {
    const s = setup();
    s.api.tick(s.t);
    assert.equal(s.handlers.length, 1);
    s.ac.abort();
    assert.deepEqual(await s.promise, { ranking: null, aborted: true });
    assert.equal(s.handlers.length, 0);
    const n = s.sent.length;
    at(s, 5000);
    s.api.tick(s.t);
    assert.equal(s.api.press('jump', s.t), false);
    assert.equal(s.sent.length, n);
});
