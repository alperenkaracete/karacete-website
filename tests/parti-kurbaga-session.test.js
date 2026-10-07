// Kurbağa oturumu (DOM'suz çekirdek): hamle sınırı, çarpışma, ağ raporu birleştirme, kalp atışı, varış, görüntü için akran mesajları.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/parti/mini/kurbaga-rules.js');
const C = require('../games/parti/config.js');
const Session = require('../games/parti/mini/kurbaga-session.js');

const SEED = 4242;

function setup(extra) {
    let t = 100000;
    const sent = [];
    const handlers = [];
    const reports = [];
    const ac = new AbortController();
    let api = null;
    const net = { send: (m) => sent.push(JSON.parse(JSON.stringify(m))), on: (fn) => { handlers.push(fn); return () => { handlers.splice(handlers.indexOf(fn), 1); }; } };
    const spec = Object.assign({
        type: 'ffa', game: 'kurbaga', players: ['me', 'p2', 'bot1'], bots: ['bot1'], seed: SEED, me: { id: 'me', name: 'Ben' }, net, signal: ac.signal,
        now: () => t, startAt: t + 4000, onReport: (m) => reports.push(m), register: (a) => { api = a; }
    }, extra || {});
    const promise = Session.run(spec);
    return { api, sent, reports, handlers, ac, promise, set: (v) => { t = v; }, get t() { return t; }, startAt: spec.startAt };
}
const at = (s, e) => s.set(s.startAt + e);

// (seed, hücre) için aracın tam üstüne denk gelen bir zaman bul: satır 1, sütun c
function findHitTime(c) {
    const ls = K.lanes(SEED);
    for (let e = 0; e < 60000; e += 5) if (K.hit(ls, 1, c, e)) return e;
    throw new Error('çarpışma zamanı yok');
}
function findSafeTime(c) {
    const ls = K.lanes(SEED);
    for (let e = 0; e < 60000; e += 5) if (!K.hit(ls, 1, c, e)) return e;
    throw new Error('güvenli zaman yok');
}

test('başlangıç: ilk tick ilk raporu hemen gönderir (n=1, ortada 0. satır); lider onReport alır', () => {
    const s = setup();
    s.api.tick(s.t);
    assert.equal(s.sent.length, 1);
    assert.deepEqual(s.sent[0], { k: 'pos', r: 0, c: 4, d: 0, n: 1 });
    assert.deepEqual(s.reports, s.sent);
    s.api.tick(s.t + 100);
    assert.equal(s.sent.length, 1, 'değişiklik yok: yeni mesaj yok');
});

test('geri sayım bitmeden sıçrama yok; sonra tek dokunuş = tek sıçrama, HOP_MS bekleme, hedefte yukarı durur', () => {
    const s = setup();
    assert.equal(s.api.hop('left'), false, 'geri sayım');
    at(s, 0);
    const safe = findSafeTime(4);
    at(s, safe);
    assert.equal(s.api.hop('left', s.t), true);
    assert.equal(s.api.state().c, 3);
    at(s, safe + K.HOP_MS - 1);
    assert.equal(s.api.hop('left', s.t), false, 'bekleme dolmadı (basılı tutma/repeat yok)');
    at(s, safe + K.HOP_MS);
    assert.equal(s.api.hop('left', s.t), true);
    assert.equal(s.api.state().c, 2);
    // kenarda yerinde sıçrama yok sayılır ve bekleme başlatmaz
    s.api.hop('left', s.t + 150); s.api.hop('left', s.t + 300); s.api.hop('left', s.t + 450);
    const c = s.api.state().c;
    assert.equal(c, 0);
    assert.equal(s.api.hop('left', s.t + 600), false);
    assert.equal(s.api.hop('down', s.t + 600), false, 'altı yok');
});

test('çarpışma: araç hücredeyken sıçrayınca başlangıca döner, ölüm sayacı artar ve hemen raporlanır', () => {
    const s = setup();
    const e = findHitTime(4);
    at(s, e);
    s.api.tick(s.t);                                   // ilk rapor
    const before = s.sent.length;
    assert.equal(s.api.hop('up', s.t), true);
    const st = s.api.state();
    assert.equal(st.r, 0);
    assert.equal(st.d, 1);
    assert.equal(st.c, 4, 'sütun korunur');
    s.api.tick(s.t);
    assert.equal(s.sent.length, before + 1, 'ölüm anında hemen rapor (birleştirme beklemez)');
    assert.deepEqual(s.sent[s.sent.length - 1], { k: 'pos', r: 0, c: 4, d: 1, n: s.sent[s.sent.length - 1].n });
});

test('duran kurbağaya araç gelirse tick çarpışmayı yakalar', () => {
    const s = setup();
    // araçsız bir anda satır 1'e çık
    const ls = K.lanes(SEED);
    let e0 = null;
    for (let e = 200; e < 60000 && e0 === null; e += 5) {
        if (!K.hit(ls, 1, 4, e)) {
            // sonraki 3 sn içinde bir araç gelecek mi
            for (let d = 5; d < 3000; d += 5) if (K.hit(ls, 1, 4, e + d)) { e0 = e; break; }
        }
    }
    assert.notEqual(e0, null);
    at(s, e0);
    assert.equal(s.api.hop('up', s.t), true);
    assert.equal(s.api.state().r, 1, 'güvenle çıktı');
    let died = false;
    for (let e = e0; e < e0 + 3500 && !died; e += 25) { at(s, e); s.api.tick(s.t); died = s.api.state().d === 1; }
    assert.ok(died, 'bekleyen kurbağa araca çarptı');
    assert.equal(s.api.state().r, 0);
});

test('rapor birleştirme: aralıkta tek mesaj, n artar; kalp atışı 2 sn; bitiş/ölüm anında hemen', () => {
    const s = setup();
    at(s, 0);
    s.api.tick(s.t);                                   // n=1
    const e = findSafeTime(4);
    at(s, e + 10);
    s.api.hop('left', s.t);                            // c=3
    s.api.tick(s.t);
    const n1 = s.sent.length;
    at(s, e + 20);
    s.api.hop('left', s.t);                            // henüz hop bekleme doldu mu: HOP_MS=150 -> yok sayılır
    at(s, e + 10 + K.HOP_MS);
    s.api.hop('right', s.t);
    s.api.tick(s.t);
    assert.ok(s.sent.length - n1 <= 1, 'SEND_MS içinde birleşti');
    // bekleyen birleşik rapor SEND_MS sonra gider; sonra kalp atışı: değişmeden 2 sn sonra yeniden
    s.set(s.t + C.KURBAGA_SEND_MS); s.api.tick(s.t);
    assert.equal(s.sent[s.sent.length - 1].c, 4, 'son birleşik durum gitti');
    const k = s.sent.length;
    s.set(s.t + C.KURBAGA_HEARTBEAT_MS - 1); s.api.tick(s.t);
    assert.equal(s.sent.length, k);
    s.set(s.t + 2); s.api.tick(s.t);
    assert.equal(s.sent.length, k + 1, 'kalp atışı');
    const ns = s.sent.map((m) => m.n);
    assert.deepEqual(ns, ns.slice().sort((a, b) => a - b));
    assert.equal(new Set(ns).size, ns.length, 'n tekrar etmez');
});

test('varış: 9. satıra ulaşınca e (ms) ile hemen raporlanır, sonra donar', () => {
    const s = setup();
    // araçsız yolda hızlı tırmanış: çarpışmayı kapatmak için şeritleri boş sayan sahte tohum yerine her adımda güvenli anı bekle
    const ls = K.lanes(SEED);
    let e = 500;
    let guard = 0;
    while (s.api.state().r < 9 && guard++ < 20000) {
        at(s, e);
        s.api.tick(s.t);
        const next = s.api.state().r + 1;
        const safeNow = next > 8 || (!K.hit(ls, next, 4, e) && !K.hit(ls, next, 4, e + 60) && !K.hit(ls, next, 4, e + 120));
        if (safeNow && s.api.hop('up', s.t)) { e += K.HOP_MS; } else e += 20;
    }
    const st = s.api.state();
    assert.equal(st.r, 9);
    assert.ok(st.f >= 9 * K.HOP_MS, 'varış süresi alt sınırın üstünde: ' + st.f);
    assert.ok(st.f <= e + 5);
    s.api.tick(s.t);
    const last = s.sent[s.sent.length - 1];
    assert.equal(last.r, 9);
    assert.equal(last.e, st.f);
    const cnt = s.sent.length;
    assert.equal(s.api.hop('down', s.t + 1000), false, 'varınca hareket yok');
    assert.equal(s.api.state().r, 9);
    assert.ok(cnt >= 1);
});

test('resume: raporlanan durumdan devam (yeniden bağlanan)', () => {
    const s = setup({ resume: { r: 3, c: 6, d: 2, f: -1 } });
    assert.deepEqual({ r: s.api.state().r, c: s.api.state().c, d: s.api.state().d, f: s.api.state().f }, { r: 3, c: 6, d: 2, f: -1 });
    const f = setup({ resume: { r: 9, c: 1, d: 0, f: 12345 } });
    at(f, 20000);
    assert.equal(f.api.hop('left', f.t), false, 'varmış, hareket etmez');
    f.api.tick(f.t);
    assert.equal(f.sent[f.sent.length - 1].e, 12345);
    const bad = setup({ resume: { r: 99, c: -4, d: 'x', f: 1.5 } });
    assert.deepEqual({ r: bad.api.state().r, c: bad.api.state().c, d: bad.api.state().d, f: bad.api.state().f }, { r: 0, c: 4, d: 0, f: -1 }, 'geçersiz resume yok sayılır');
});

test('akran mesajları görüntü için tutulur; kendi, bot ve katılımcı olmayan, bozuk mesajlar yok sayılır', () => {
    const s = setup();
    const feed = (from, m) => s.handlers.slice().forEach((fn) => fn(from, m));
    feed('p2', { k: 'pos', r: 4, c: 2, d: 1, n: 9 });
    assert.deepEqual({ r: s.api.peers.p2.r, c: s.api.peers.p2.c, d: s.api.peers.p2.d, f: s.api.peers.p2.f }, { r: 4, c: 2, d: 1, f: -1 });
    feed('p2', { k: 'pos', r: 9, c: 2, d: 1, n: 10, e: 20500 });
    assert.equal(s.api.peers.p2.f, 20500);
    feed('me', { k: 'pos', r: 5, c: 5, d: 0, n: 1 });
    feed('bot1', { k: 'pos', r: 5, c: 5, d: 0, n: 1 });
    feed('zzz', { k: 'pos', r: 5, c: 5, d: 0, n: 1 });
    feed('p2', { k: 'pos', r: 99, c: 2, d: 1, n: 11 });
    feed('p2', { k: 'x', r: 1, c: 1, d: 0 });
    feed('p2', null);
    assert.deepEqual(Object.keys(s.api.peers), ['p2']);
    assert.equal(s.api.peers.p2.r, 9, 'bozuk mesaj önceki durumu bozmaz');
});

test('abort: oturum yıkılır, Promise aborted ile biter, dinleyici bırakılır, sonrası tick/sıçrama etkisiz', async () => {
    const s = setup();
    s.api.tick(s.t);
    assert.equal(s.handlers.length, 1);
    s.ac.abort();
    assert.deepEqual(await s.promise, { ranking: null, aborted: true });
    assert.equal(s.handlers.length, 0);
    const n = s.sent.length;
    at(s, 5000);
    s.api.tick(s.t);
    assert.equal(s.api.hop('left', s.t), false);
    assert.equal(s.sent.length, n);
});
