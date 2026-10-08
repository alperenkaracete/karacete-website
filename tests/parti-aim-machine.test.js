// Nişan (aim) aşaması makine entegrasyonu: aimAt/gösterge kenetleme (SLACK/MIN_AIM), süre dolunca ıska, bot/AFK/kopuk atacı, lider devri,
// unpack doğrulaması, pt_state ≤ 20 KB, yenileme, ?kit=1, yumruk şovu engellemez. Gerçek PartiMachine + sahte oda (tests/duel-room.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');
const Aim = require('../games/parti/aim.js');
const { room, curId, gp, IDS, NAMES } = require('./duel-room.js');

const pirate = require('../games/parti/maps/pirate.js');
const loopNode = pirate.nodes.find((n) => n.type === 'normal' && n.next.length === 1);
const nodeAt = (from, d) => { const dist = G.distances(gp, from); return Object.keys(dist).map(Number).filter((n) => dist[n] === d)[0]; };

const leaderOf = (r) => IDS.find((id) => r.nodes[id] && r.nodes[id].online && r.view(id).isLeader) || 'A';
const gs = (r) => r.state(leaderOf(r));

function startGame(n, extra, seed) {
    const r = room(seed || 11, Object.assign({ kit: true }, extra || {}));
    for (let i = 0; i < n; i++) r.join(IDS[i], NAMES[i]);
    r.flush();
    r.m('A').dispatch({ type: 'start' });
    r.flush();
    return r;
}

// Sıradaki oyuncuyu hedefle 2 adım uzağa koy, yayını tazele
function setup(r, targetOffset) {
    const st = gs(r);
    const cur = curId(r);
    const tgt = st.g.order.find((id) => id !== cur);
    st.g.P[cur].pos = loopNode.id;
    st.g.P[tgt].pos = nodeAt(loopNode.id, targetOffset === undefined ? 2 : targetOffset);
    r.m(leaderOf(r))._publish();
    r.flush();
    return { cur, tgt };
}

function useBow(r, cur, tgt) {
    r.m(cur).dispatch({ type: 'use', w: 'bow', target: tgt });
    r.flush();
}

const aimOf = (r) => gs(r).g.aim;
const specOf = (r) => Aim.makeAim(aimOf(r).w, aimOf(r).seed, aimOf(r).d);
const elapsed = (r) => r.now() - gs(r).aimAt;
function toElapsed(r, ms, step) { const d = ms - elapsed(r); if (d > 0) r.advance(d, step || 50); }

test('?kit=1: herkese her silahtan 3 (kalkan 1) verilir; takipçiler de aynı durumu alır (doğrulama geçer)', () => {
    const r = startGame(3);
    ['A', 'B', 'C'].forEach((id) => {
        assert.deepEqual(r.state(id).g.P.A.w, { fist: 3, shotgun: 3, bow: 3, bomb: 3, shield: 1 }, id + ' görünümü');
    });
    assert.equal(r.view('B').game.stage, 'roll');
    const off = room(11);
    ['A', 'B'].forEach((id, i) => off.join(id, NAMES[i]));
    off.flush();
    off.m('A').dispatch({ type: 'start' });
    off.flush();
    assert.deepEqual(off.state('A').g.P.A.w, {}, 'bayrak yoksa envanter boş');
});

test('use yay -> aim aşaması: aimAt lider saatinde, as göreli ms ile yayılır, getView.aim; hasar yok; zar atılamaz', () => {
    const r = startGame(3);
    const { cur, tgt } = setup(r);
    const t0 = r.now();
    useBow(r, cur, tgt);
    const st = gs(r);
    assert.equal(st.g.stage, 'aim');
    assert.equal(st.aimAt, t0, 'aimAt = giriş anı');
    assert.deepEqual({ w: st.g.aim.w, by: st.g.aim.by, target: st.g.aim.target }, { w: 'bow', by: cur, target: tgt });
    assert.equal(st.g.P[tgt].hp, 100);
    const v = r.view('C');
    assert.equal(v.aim.w, 'bow');
    assert.equal(v.aim.by, cur);
    assert.equal(v.aim.target, tgt);
    assert.equal(v.aim.maxMs, 3000);
    assert.equal(r.state('C').aimAt, st.aimAt, 'takipçide aimAt as ile aynı an (gecikmesiz kuyruk)');
    const msg = r.sent.filter((s) => s.msg.type === 'pt_state').pop().msg;
    assert.equal(msg.as, 0);
    assert.equal(msg.g.stage, 'aim');
    r.advance(1000, 100);
    assert.equal(r.view('C').aim.elapsed >= 900, true, 'gösterge süresi akar');
    const msg2 = (r.m(leaderOf(r))._publish(), r.sent.filter((s) => s.msg.type === 'pt_state').pop().msg);
    assert.ok(msg2.as <= -900 && msg2.as >= -1100, 'as göreli ms: ' + msg2.as);
    assert.equal(r.m(cur).dispatch({ type: 'roll' }), true, 'dispatch gönderilir');
    r.flush();
    assert.equal(gs(r).g.stage, 'aim', 'nişan sürerken zar atılamaz');
    assert.equal(R.current(gs(r).g), cur);
});

test('aim eylemi: göstergeye yakın q aynen, uzak q kenetlenir (SLACK)', () => {
    // ±450 ms pencere periyodun (1.2-1.6 sn) büyük kısmını kapsar: kenetlemenin etkili olduğu (merkez göstergeden uzak) bir tohum/an bul
    let r; let cur; let tgt; let spec; let el = null;
    for (let seed = 11; seed < 120 && el === null; seed++) {
        r = startGame(3, undefined, seed);
        ({ cur, tgt } = setup(r));
        useBow(r, cur, tgt);
        spec = specOf(r);
        for (let e = 300; e < 2800; e += 25) if (Math.abs(Aim.clampQ(spec, spec.c, e, C.AIM_SLACK_MS) - spec.c) > 0.3 * spec.half) { el = e; break; }
    }
    assert.notEqual(el, null, 'kenetlemenin etkili olduğu durum bulundu');
    // bölge merkezinin göstergeden uzak olduğu bir an: kenetlenir (merkez isabeti olamaz)
    toElapsed(r, el, 25);
    const sentQ = Math.round(spec.c * 1000);
    r.m(cur).dispatch({ type: 'aim', q: sentQ });
    r.flush();
    const st = gs(r);
    assert.equal(st.g.stage, 'roll');
    const ev = st.fx.find((e) => e.t === 'aimres');
    assert.notEqual(ev.q, sentQ, 'q kenetlendi');
    assert.notEqual(ev.tier, 'merkez');
    assert.ok(Math.abs(ev.q / 1000 - Aim.clampQ(spec, sentQ / 1000, el, C.AIM_SLACK_MS)) < 0.06, 'kenetleme penceresine');
    assert.equal(st.g.atk, 1);
    // aynı durumda göstergeye yakın q kenetlenmeden geçer (merkez isabeti)
    const r2 = startGame(3);
    const s2 = setup(r2);
    useBow(r2, s2.cur, s2.tgt);
    const sp2 = specOf(r2);
    let e2 = null;
    for (let e = 300; e < 2800; e += 25) if (Aim.clampQ(sp2, sp2.c, e, C.AIM_SLACK_MS) === sp2.c) { e2 = e; break; }
    assert.notEqual(e2, null);
    toElapsed(r2, e2, 25);
    r2.m(s2.cur).dispatch({ type: 'aim', q: Math.round(sp2.c * 1000) });
    r2.flush();
    const ev2 = gs(r2).fx.find((e) => e.t === 'aimres');
    assert.equal(ev2.tier, 'merkez');
    assert.equal(gs(r2).g.P[s2.tgt].hp, 50, 'tam isabet 50');
});

test('erken gelen aim (AIM_MIN_MS altı) DÜŞÜRÜLMEZ: kenetlenip kabul edilir, aşama roll a döner, atıcı kilitlenmez', () => {
    for (const early of [0, 60, C.AIM_MIN_MS - 10]) {
        const r = startGame(3);
        const { cur, tgt } = setup(r);
        useBow(r, cur, tgt);
        const spec = specOf(r);
        r.advance(early, 10);
        const sentQ = Math.round(spec.c * 1000);
        r.m(cur).dispatch({ type: 'aim', q: sentQ });
        r.flush();
        const st = gs(r);
        assert.equal(st.g.stage, 'roll', 'erken dokunuş kabul edildi (early=' + early + ')');
        assert.equal(st.g.aim, null);
        assert.equal(st.g.atk, 1);
        const ev = st.fx.find((e) => e.t === 'aimres');
        assert.ok(ev && ev.q >= 0, 'q geçerli');
        const cl = Math.round(Aim.clampQ(spec, sentQ / 1000, early, C.AIM_SLACK_MS) * 1000);
        assert.equal(ev.q, cl, 'q geçerli pencereye kenetlendi');
        assert.equal(r.m(cur).dispatch({ type: 'roll' }), true);
    }
    // aşama dışı / yanlış atıcı hâlâ reddedilir
    const r2 = startGame(3);
    const s2 = setup(r2);
    const rv0 = gs(r2).rv;
    r2.m(s2.cur).dispatch({ type: 'aim', q: 500 });
    r2.flush();
    assert.equal(gs(r2).rv, rv0, 'aim aşaması yokken eylem reddedildi (durum değişmedi)');
    useBow(r2, s2.cur, s2.tgt);
    r2.advance(300, 50);
    r2.m(s2.tgt).dispatch({ type: 'aim', q: 500 });
    r2.flush();
    assert.equal(gs(r2).g.stage, 'aim', 'yanlış atıcı reddedildi');
});

test('süre dolunca (maxMs + 600 ms) lider q=-1 ile çözer: ıska, saldırı hakkı harcandı; bölge içi geç dokunuş (maxMs..+600) hâlâ kenetlenerek işlenir, sonrası ıska', () => {
    const r = startGame(3);
    const { cur, tgt } = setup(r);
    useBow(r, cur, tgt);
    r.advance(3000 + C.AIM_GRACE_MS - 200, 100);
    assert.equal(gs(r).g.stage, 'aim', 'henüz çözülmedi');
    r.advance(400, 50);
    const st = gs(r);
    assert.equal(st.g.stage, 'roll');
    assert.equal(st.g.atk, 1);
    assert.equal(st.g.P[tgt].hp, 100);
    assert.equal(st.fx.find((e) => e.t === 'aimres').tier, 'iska');
    assert.equal(st.fx.find((e) => e.t === 'aimres').q, -1);
    // geç ama süre içi dokunuş (maxMs + 300): işlenir (ıska olmak zorunda değil, q -1 değil)
    const r2 = startGame(3);
    const s2 = setup(r2);
    useBow(r2, s2.cur, s2.tgt);
    toElapsed(r2, 3300, 50);
    const sp = specOf(r2);
    r2.m(s2.cur).dispatch({ type: 'aim', q: Math.round(Aim.indicatorAt(sp, 3300) * 1000) });
    r2.flush();
    assert.notEqual(gs(r2).fx.find((e) => e.t === 'aimres').q, -1, 'süre içi geç dokunuş sayıldı');
});

test('bot atacı: BOT_DELAY sonrası tohumlu botQ ile nişan alır (kenetleme yok, aşama kapanır)', () => {
    const r = startGame(3);
    r.m('A').dispatch({ type: 'bot_add' });
    r.flush();
    // lobide bot eklenmedi çünkü oyun başladı; botlu oyun kur
    const rb = room(11, { kit: true });
    ['A', 'B'].forEach((id, i) => rb.join(id, NAMES[i]));
    rb.flush();
    rb.m('A').dispatch({ type: 'bot_add' });
    rb.flush();
    rb.m('A').dispatch({ type: 'start' });
    rb.flush();
    const st = gs(rb);
    const botId = st.g.order.find((id) => st.g.P[id].bot);
    assert.ok(botId);
    // sırayı bota getir
    st.g.turn = st.g.order.indexOf(botId);
    const tgt = st.g.order.find((id) => id !== botId && !st.g.P[id].bot);
    st.g.P[botId].pos = loopNode.id;
    st.g.P[tgt].pos = nodeAt(loopNode.id, 2);
    st.g.stage = 'roll'; st.g.atk = 0;
    rb.m('A')._publish();
    const beforeHp = st.g.P[tgt].hp;
    const res = R.reduce(st.g, { type: 'use', by: botId, w: 'bow', target: tgt }, { g: gp });
    assert.ok(res.ok);
    // lider içi çalıştırma: makine botAction'ı kendisi çağırır; durumu liderin M.g'sine yaz ve yayınla
    st.g = res.state;
    st.aimAt = rb.now();
    rb.m('A')._publish();
    rb.flush();
    assert.equal(gs(rb).g.stage, 'aim');
    rb.advance(C.BOT_DELAY_MS - 300, 100);
    assert.equal(gs(rb).g.stage, 'aim', 'bot gecikmesi dolmadı');
    rb.advance(1200, 100);
    const after = gs(rb);
    assert.notEqual(after.g.stage, 'aim', 'bot nişan aldı');
    const evs = rb.sent.filter((x) => x.msg.type === 'pt_state').reduce((a, x) => a.concat((x.msg.fx || []).filter((e) => e.t === 'aimres')), []);
    const ev = evs[0];
    assert.ok(ev, 'aimres olayı (yayınlanan durumlarda)');
    const sp = Aim.makeAim('bow', res.state.aim.seed, res.state.aim.d);
    assert.equal(ev.q, Math.round(Aim.botQ(res.state.aim.seed, botId, sp) * 1000), 'q tohumlu botQ');
    assert.equal(after.g.P[tgt].hp, beforeHp - Aim.resolve(sp, ev.q / 1000).dmg);
    assert.ok(r.state('A').g);
});

test('kopuk/AFK atacı: nişan süresi dolunca ıska (bot oynamaz); lider devri nişanı yeniden başlatır', () => {
    const r = startGame(3);
    const { cur, tgt } = setup(r);
    const leader = leaderOf(r);
    const attacker = cur === leader ? tgt : cur;          // lider olmayan atacı kullanmak için hedef/atacı değiş
    useBow(r, cur, tgt);
    assert.equal(gs(r).g.stage, 'aim');
    // atacı koptu (lider devri değil: atacı lider değilse); lider atacıysa devir testi ayrı
    if (cur !== leader) {
        r.leave(cur);
        r.advance(500, 100);
        assert.equal(gs(r).g.stage, 'aim');
        r.advance(3000 + C.AIM_GRACE_MS + 300, 100);
        const st = gs(r);
        assert.notEqual(st.g.stage, 'aim');
        assert.equal(st.fx.find((e) => e.t === 'aimres') && st.fx.find((e) => e.t === 'aimres').tier, 'iska', 'kopuk atacı: ıska');
    }
    assert.ok(attacker);
});

test('lider devri: nişan aşaması yeni liderde yeniden başlar (aimAt = şimdi); sayaç yeni liderden', () => {
    const r = startGame(3);
    const { cur, tgt } = setup(r);
    // atacı lider değilse lider A'yı düşür; atacı A ise başkasını bul
    useBow(r, cur, tgt);
    r.advance(2000, 100);
    const oldAt = gs(r).aimAt;
    const stateBefore = gs(r).g.aim;
    r.leave('A');
    r.advance(3000, 100);
    const L = leaderOf(r);
    assert.notEqual(L, 'A');
    if (gs(r).g.stage === 'aim') {
        assert.ok(gs(r).aimAt > oldAt + 1500, 'aimAt yeniden başladı');
        assert.deepEqual(gs(r).g.aim, stateBefore, 'nişan belirtimi korunur (aynı tohum)');
        // yeni liderin saatinden süre dolunca ıska
        r.advance(3000 + C.AIM_GRACE_MS + 400, 100);
        assert.notEqual(gs(r).g.stage, 'aim');
    } else {
        assert.ok(cur === 'A', 'yalnız atacı koptuysa aşama kapanır');
    }
});

test('unpack doğrulaması: nişan nesnesi olmayan/bozuk aim yayını ve geçersiz as reddedilir; geçerli yayın kabul edilir', () => {
    const r = startGame(3);
    const { cur, tgt } = setup(r);
    useBow(r, cur, tgt);
    const last = r.sent.filter((s) => s.from === leaderOf(r) && s.msg.type === 'pt_state').pop().msg;
    const mk = (fn) => { const m = JSON.parse(JSON.stringify(last)); m.rv = r.state('C').rv + 10; fn(m); return m; };
    const rvC = r.state('C').rv;
    const bads = [
        (m) => { m.g.aim = null; },                                   // stage aim ama aim yok
        (m) => { m.g.aim.w = 'shotgun'; },                            // beceri silahı değil
        (m) => { m.g.aim.w = 'yok'; },
        (m) => { m.g.aim.by = 'zzz'; },
        (m) => { m.g.aim.by = m.g.order.find((id) => id !== m.g.aim.by); },        // sıradaki oyuncu değil
        (m) => { m.g.aim.target = 12; },
        (m) => { m.g.aim.d = 'x'; },
        (m) => { m.g.aim.seed = -1; },
        (m) => { m.g.aim.seed = 1.5; },
        (m) => { m.as = 100000; },
        (m) => { m.as = -9999999; },
        (m) => { m.as = 'x'; }
    ];
    bads.forEach((fn, i) => {
        r.inject('C', mk(fn));
        assert.equal(r.state('C').rv, rvC, 'bozuk yayın reddedildi #' + i);
    });
    const ok = mk((m) => { m.as = -500; });
    r.inject('C', ok);
    assert.equal(r.state('C').rv, ok.rv, 'geçerli yayın kabul edildi');
    assert.equal(r.view('C').aim.elapsed >= 450, true, 'as ile gösterge konumu');
    // aim olmayan yayında aim alanı bozuksa da reddedilir
    const bad2 = mk((m) => { m.g.stage = 'roll'; m.g.aim = { w: 'bow', by: 'zzz', target: 'x', d: 1, seed: 1 }; });
    const rv2 = r.state('C').rv;
    r.inject('C', bad2);
    assert.equal(r.state('C').rv, rv2);
});

test('pt_state boyutu: 8 oyuncu, dolu envanter, nişan aşaması 20 KB altında', () => {
    const r = startGame(8);
    const { cur, tgt } = setup(r);
    useBow(r, cur, tgt);
    r.advance(500, 100);
    const sizes = r.sent.filter((s) => s.msg.type === 'pt_state').map((s) => JSON.stringify(s.msg).length);
    const max = Math.max.apply(null, sizes);
    assert.ok(max < 20000, 'boyut ' + max);
    assert.ok(max > 1000);
    assert.equal(gs(r).g.stage, 'aim');
});

test('yenileme/geç katılan: aim durumundan doğru gösterge süresiyle açılır; skipturn nişanı temizler', () => {
    const r = startGame(3);
    const { cur, tgt } = setup(r);
    const other = ['A', 'B', 'C'].find((id) => id !== cur && id !== leaderOf(r));
    useBow(r, cur, tgt);
    r.advance(1200, 100);
    r.leave(other);
    r.advance(300, 100);
    r.join(other, NAMES[IDS.indexOf(other)]);
    r.advance(500, 100);
    const v = r.view(other);
    assert.ok(v.aim, 'yenileyen aim görür');
    assert.ok(Math.abs(v.aim.elapsed - elapsed(r)) < 350, 'gösterge konumu liderle uyumlu: ' + v.aim.elapsed + ' / ' + elapsed(r));
    assert.equal(v.aim.seed, aimOf(r).seed);
    // lider atlatır
    r.m(leaderOf(r)).dispatch({ type: 'skipturn' });
    r.flush();
    assert.notEqual(gs(r).g.stage, 'aim');
    assert.equal(gs(r).g.aim, null);
    assert.equal(gs(r).aimAt, 0);
});

test('yumruk şovu aşama açmaz: hasar anlık, zar hemen atılır (UI/zar engellenmez)', () => {
    const r = startGame(3);
    const { cur, tgt } = setup(r, 1);
    r.m(cur).dispatch({ type: 'use', w: 'fist', target: tgt });
    r.flush();
    const st = gs(r);
    assert.notEqual(st.g.stage, 'aim');
    assert.equal(st.aimAt, 0);
    const ev = st.fx.find((e) => e.t === 'aimres');
    assert.deepEqual({ tier: ev.tier, dmg: ev.dmg, w: ev.w }, { tier: 'garanti', dmg: 100, w: 'fist' });
    assert.equal(r.view(cur === 'A' ? 'B' : 'A').aim, null);
    const rv = st.rv;
    r.m(cur).dispatch({ type: 'roll' });
    r.flush();
    assert.ok(gs(r).rv > rv, 'zar hemen atıldı');
});
