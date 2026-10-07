const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');
const Machine = require('../games/parti/machine.js');
const maps = { pirate: require('../games/parti/maps/pirate.js'), space: require('../games/parti/maps/space.js') };

// Sahte oda: backend gibi (katılan listenin sonuna eklenir, göndericiye yansıma yok, kopan düşer), saat elle ilerler.
function room(options) {
    options = options || {};
    let clock = 1000;
    let seed = 99;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const nodes = {};
    const queue = [];
    const roomPlayers = [];
    const api = {
        nodes, get clock() { return clock; },
        sent: [],
        m(id) { return nodes[id].m; },
        state(id) { return nodes[id].m._state(); },
        view(id) { return nodes[id].m.getView(); },
        online(id) { return nodes[id] && nodes[id].online; },
        join(id, name) {
            const first = roomPlayers.length === 0;
            roomPlayers.push({ id, name });
            const players = roomPlayers.map((p) => ({ id: p.id, name: p.name }));
            const node = { id, name, online: true, players };
            nodes[id] = node;
            // diğerlerinin listeleri
            Object.values(nodes).forEach((o) => {
                if (o.id !== id && o.online) {
                    o.players.length = 0;
                    roomPlayers.forEach((p) => o.players.push({ id: p.id, name: p.name }));
                    queue.push({ to: o.id, msg: { type: 'player_joined', id, name } });
                }
            });
            node.m = Machine.create({
                me: { id, name }, players: node.players, now: () => clock, rand, maps, creator: first && !options.noCreator,
                send: (msg) => {
                    if (!node.online) return;
                    const copy = JSON.parse(JSON.stringify(msg));
                    api.sent.push({ from: id, msg: copy });
                    Object.values(nodes).forEach((o) => { if (o.id !== id && o.online) queue.push({ to: o.id, msg: copy }); });
                }
            });
            api.flush();
            return node.m;
        },
        leave(id) {
            nodes[id].online = false;
            const at = roomPlayers.findIndex((p) => p.id === id);
            roomPlayers.splice(at, 1);
            Object.values(nodes).forEach((o) => {
                if (o.online) {
                    o.players.length = 0;
                    roomPlayers.forEach((p) => o.players.push({ id: p.id, name: p.name }));
                    queue.push({ to: o.id, msg: { type: 'player_disconnect', id } });
                }
            });
            api.flush();
        },
        // backend'in yeni davranışı: aynı kimlikle gelen oturum eskisinin yerini ALIR (sıra korunur, player_disconnect yok)
        takeover(id) {
            const old = nodes[id];
            old.online = false;
            const node = { id, name: old.name, online: true, players: roomPlayers.map((p) => ({ id: p.id, name: p.name })) };
            nodes[id] = node;
            Object.values(nodes).forEach((o) => {
                if (o.id !== id && o.online) queue.push({ to: o.id, msg: { type: 'player_joined', id, name: old.name } });
            });
            node.m = Machine.create({
                me: { id, name: old.name }, players: node.players, now: () => clock, rand, maps, creator: roomPlayers.length <= 1 && roomPlayers[0].id === id,
                send: (msg) => {
                    if (!node.online) return;
                    const copy = JSON.parse(JSON.stringify(msg));
                    api.sent.push({ from: id, msg: copy });
                    Object.values(nodes).forEach((o) => { if (o.id !== id && o.online) queue.push({ to: o.id, msg: copy }); });
                }
            });
            api.flush();
            return node.m;
        },
        // sayfa yenileme: aynı kimlik, yeni makine, listenin sonunda
        rejoin(id, name) { return api.join(id, name || nodes[id].name); },
        flush() {
            let guard = 0;
            while (queue.length && guard++ < 5000) {
                const q = queue.shift();
                if (nodes[q.to] && nodes[q.to].online) nodes[q.to].m.onMessage(JSON.parse(JSON.stringify(q.msg)));
            }
        },
        advance(ms, step) {
            step = step || 100;
            const end = clock + ms;
            while (clock < end) {
                clock = Math.min(end, clock + step);
                Object.values(nodes).forEach((o) => { if (o.online) o.m.tick(clock); });
                api.flush();
            }
        },
        async settle() { await Promise.resolve(); await Promise.resolve(); api.flush(); }
    };
    return api;
}

function lobby3() {
    const r = room();
    r.join('A', 'Ayse'); r.join('B', 'Bora'); r.join('C', 'Cem');
    return r;
}

function started(n, cfgAction) {
    const r = room();
    const ids = ['A', 'B', 'C', 'D'].slice(0, n);
    ids.forEach((id) => r.join(id, 'Oyuncu' + id));
    if (cfgAction) r.m('A').dispatch(cfgAction);
    r.flush();
    assert.equal(r.m('A').dispatch({ type: 'start' }), true);
    r.flush();
    return r;
}

// sıradaki oyuncunun makinesi
function curId(r) { return R.current(r.state('A').g); }

test('lobi: oda kurucusu lider; katılanlar koltuk alır, benzersiz avatar; herkes aynı durumu görür', () => {
    const r = lobby3();
    assert.equal(r.view('A').isLeader, true);
    assert.equal(r.view('B').isLeader, false);
    assert.equal(r.view('B').mode, 'lobby');
    const seats = r.view('C').seats;
    assert.deepEqual(seats.map((s) => s.i), ['A', 'B', 'C']);
    assert.equal(new Set(seats.map((s) => s.a)).size, 3);
    assert.equal(r.view('B').cfg.gl, 10);
});

test('lobi: avatar benzersiz olmalı; ayarları yalnızca lider değiştirir', () => {
    const r = lobby3();
    const takenByA = r.view('A').meSeat.a;
    r.m('B').dispatch({ type: 'av', av: takenByA });
    r.flush();
    assert.notEqual(r.view('B').meSeat.a, takenByA);
    const free = C.AVATARS.find((a) => !r.view('A').seats.some((s) => s.a === a));
    r.m('B').dispatch({ type: 'av', av: free });
    r.flush();
    assert.equal(r.view('A').seats[1].a, free);
    r.m('B').dispatch({ type: 'cfg', goal: 25, map: 'space', mode: 'team' });
    r.flush();
    assert.equal(r.view('A').cfg.gl, 10);
    r.m('A').dispatch({ type: 'cfg', goal: 25, map: 'space' });
    r.flush();
    assert.deepEqual([r.view('B').cfg.gl, r.view('B').cfg.mp], [25, 'space']);
    r.m('A').dispatch({ type: 'cfg', goal: 7 });
    r.m('A').dispatch({ type: 'cfg', map: 'yok' });
    r.flush();
    assert.deepEqual([r.view('B').cfg.gl, r.view('B').cfg.mp], [25, 'space']);
});

test('lobi: takım modunda oyuncu sayısı çift olmalı; bot ekle/çıkar; en az 2 oyuncu', () => {
    const r = lobby3();
    assert.equal(r.view('A').startBlock, null);
    r.m('A').dispatch({ type: 'cfg', mode: 'team' });
    r.flush();
    assert.match(r.view('A').startBlock, /çift/);
    assert.equal(r.m('A').dispatch({ type: 'start' }), false);      // başlamaz
    r.flush();
    assert.equal(r.view('A').phase, 'lobby');
    r.m('A').dispatch({ type: 'bot_add' });
    r.flush();
    assert.equal(r.view('B').seats.length, 4);
    assert.equal(r.view('A').startBlock, null);
    for (let i = 0; i < 6; i++) r.m('A').dispatch({ type: 'bot_add' });
    r.flush();
    assert.equal(r.view('A').seats.length, 8, 'en çok 8');
    for (let i = 0; i < 9; i++) r.m('A').dispatch({ type: 'bot_del' });
    r.flush();
    assert.equal(r.view('A').seats.length, 3, 'yalnızca botlar silinir');
    // tek oyuncu
    const solo = room();
    solo.join('A', 'Ayse');
    assert.match(solo.view('A').startBlock, /En az 2/);
    solo.m('A').dispatch({ type: 'bot_add' });
    assert.equal(solo.view('A').startBlock, null);
});

test('lobi: takımlar rastgele dağıtılır, lider elle değiştirir; takım başına en çok 2, tam 2 değilse başlamaz', () => {
    const r = room();
    ['A', 'B', 'C', 'D'].forEach((id) => r.join(id, id));
    r.m('A').dispatch({ type: 'cfg', mode: 'team' });
    r.flush();
    const teams = r.view('A').seats.map((s) => s.t);
    assert.deepEqual(teams.slice().sort(), [0, 0, 1, 1]);
    assert.equal(r.view('A').startBlock, null);
    r.m('A').dispatch({ type: 'team', id: 'A', t: 2 });
    r.flush();
    assert.match(r.view('A').startBlock, /tam 2/);
    r.m('A').dispatch({ type: 'team', id: 'B', t: 2 });
    r.flush();
    r.m('A').dispatch({ type: 'team', id: 'C', t: 2 });          // 3. kişi alınmaz
    r.flush();
    assert.equal(r.view('A').seats.filter((s) => s.t === 2).length, 2);
});

test('oyun başlar: herkes aynı tam durumu alır; sıra kimdeyse yalnızca o zar atar', () => {
    const r = started(3);
    assert.equal(r.view('B').mode, 'play');
    assert.equal(r.view('B').game.order.length, 3);
    const cur = curId(r);
    const other = ['A', 'B', 'C'].find((x) => x !== cur);
    const before = r.state('A').rv;
    r.m(other).dispatch({ type: 'roll' });
    r.flush();
    assert.equal(r.state('A').rv, before, 'sırası olmayanın eylemi yok sayıldı');
    r.m(cur).dispatch({ type: 'roll' });
    r.flush();
    assert.ok(r.state('A').rv > before);
    // takipçiler aynı durumu görür
    assert.deepEqual(JSON.stringify(r.state('B').g), JSON.stringify(r.state('A').g));
    assert.deepEqual(JSON.stringify(r.state('C').g), JSON.stringify(r.state('A').g));
    assert.ok(r.view('C').log.length > 0);
});

test('takipçi sahte kimlik/geçersiz mesajlarla durumu bozamaz; geçersiz pt_state yok sayılır', () => {
    const r = started(2);
    const before = JSON.stringify(r.state('B').g);
    const bad = [
        { type: 'pt_state' }, { type: 'pt_state', ep: 'x' }, { type: 'pt_state', ep: 9, rv: 99999, ld: 'X', ph: 'zzz', cf: {}, S: [] },
        { type: 'pt_state', ep: 9, rv: 99999, ld: 'B', ph: 'lobby', cf: { m: 'solo', mp: 'pirate', gl: 10 }, S: new Array(30).fill({}) },
        null, { type: 5 }, {}
    ];
    bad.forEach((m) => r.m('B').onMessage(m));
    assert.equal(JSON.stringify(r.state('B').g), before);
    assert.equal(r.state('B').ep, 1);
    r.m('A').onMessage({ type: 'pt_action', id: 'B', a: null });
    r.m('A').onMessage({ type: 'pt_action', id: 5, a: { type: 'roll' } });
    r.m('A').onMessage({ type: 'pt_action', id: 'B', a: { type: 'start' } });
    r.m('A').onMessage({ type: 'pt_action', id: 'B', a: { type: 'drop', id: 'A' } });
    r.m('A').onMessage({ type: 'pt_action', id: 'B', a: { type: 'again' } });
    assert.equal(r.view('A').phase, 'play');
    assert.equal(r.view('A').seats.length, 2);
});

test('eski anlık görüntü (düşük rv/ep) yok sayılır', () => {
    const r = started(2);
    const old = JSON.parse(JSON.stringify(r.sent.filter((s) => s.msg.type === 'pt_state')[0].msg));
    const rv = r.state('B').rv;
    r.m('B').onMessage(old);
    assert.equal(r.state('B').rv, rv);
});

test('pt_state boyutu: 8 oyuncu, dolu envanter, 30 günlük satırı ile 20 KB altında', () => {
    const r = room();
    for (let i = 0; i < 8; i++) r.join('P' + i, 'Oyuncu numara ' + i);
    r.m('P0').dispatch({ type: 'cfg', map: 'space' });
    r.m('P0').dispatch({ type: 'start' });
    r.flush();
    const M = r.state('P0');
    M.g.order.forEach((id) => { M.g.P[id].w = ['bomb', 'shotgun', 'shield']; M.g.P[id].dmg = { P1: 20, P2: 40 }; M.g.P[id].offers = ['bow']; });
    for (let i = 0; i < 40; i++) M.lg.push('Oyuncu numara 3 silah sandığı açtı: 🔫 Pompalı ' + i);
    M.fx = new Array(40).fill({ t: 'dmg', id: 'P1', by: 'P2', n: 45 });
    r.m('P0').dispatch({ type: 'skipturn' });
    r.flush();
    const states = r.sent.filter((s) => s.msg.type === 'pt_state');
    const size = Math.max.apply(null, states.map((s) => JSON.stringify(s.msg).length));
    assert.ok(size < 20000, 'boyut ' + size);
    assert.ok(size > 1000);
});

test('süre dolunca otomatik: zar atılır; 20 sn sonra yön/seçim/tur sonu otomatik', () => {
    const r = started(2);
    const cur = curId(r);
    const rd0 = r.state('A').rv;
    r.advance(C.STEP_MS - 1000);
    assert.equal(r.state('A').rv, rd0, 'süre dolmadı');
    r.advance(2000);
    assert.ok(r.state('A').fx.some((e) => e.t === 'roll' && e.id === cur), 'zar otomatik atıldı');
    // sıradaki evre ne olursa olsun süre dolunca ilerler ve turu devralan oyuncuya geçer
    for (let i = 0; i < 6 && curId(r) === cur; i++) r.advance(C.STEP_MS + 100);
    assert.notEqual(curId(r), cur);
});

test('botlar sıra kendilerine gelince lider tarafından oynanır; takipçiler görür', () => {
    const r = room();
    r.join('A', 'Ayse');
    r.join('B', 'Bora');
    r.m('A').dispatch({ type: 'bot_add' });
    r.m('A').dispatch({ type: 'start' });
    r.flush();
    const bot = r.state('A').S.find((s) => s.b).i;
    // insanlar sürekli oynasın, bot kendi başına ilerlemeli
    let botMoved = false;
    for (let i = 0; i < 600 && !botMoved; i++) {
        r.advance(500);
        const g = r.state('A').g;
        if (g.stage !== 'mini' && g.stage !== 'over' && !r.state('A').S.find((s) => s.i === R.current(g)).b) {
            const act = R.autoAction(g, { g: G.index(maps.pirate) });
            if (act) r.m(R.current(g)).dispatch(act.type === 'swap' ? { type: 'swap', drop: -1 } : act);
        }
        botMoved = r.state('A').fx.some((e) => e.t === 'roll' && e.id === bot);
    }
    assert.ok(botMoved, 'bot zar attı');
    assert.ok(r.state('B').fx.length > 0);
});

test('minioyun: tur sonunda yer tutucu çark çalışır, sonuç ödül verir, yeni tur başlar', async () => {
    const r2 = started(3);
    let guard = 0;
    while (r2.state('A').g.stage !== 'mini' && guard++ < 200) {
        r2.m(curId(r2)).dispatch(R.autoAction(r2.state('A').g, { g: G.index(maps.pirate) }));
        r2.flush();
    }
    assert.equal(r2.state('A').g.stage, 'mini');
    await r2.settle();
    const mn = r2.view('B').mini;
    assert.ok(mn && mn.ranking.length === mn.players.length, 'çark sonucu herkese gitti (ffa: 3, düello: 2)');
    assert.ok(['ffa', 'duel'].includes(mn.type));
    const rd = r2.state('A').g.rd;
    r2.advance(C.MINI_HOLD_MS + 500);
    assert.equal(r2.state('A').g.stage, 'roll');
    assert.equal(r2.state('A').g.rd, rd + 1);
    assert.equal(r2.view('C').mini, null);
    const winner = mn.ranking[0][0];
    assert.ok(r2.state('A').g.P[winner].s >= 1 || r2.state('A').fx.length > 0);
});

test('kopma: oyun kopan oyuncunun sırasında bekler, süre sayılır; dönünce kaldığı yerden devam eder', () => {
    const r = started(3);
    let guard = 0;
    while (curId(r) === 'A' && guard++ < 10) r.m('A').dispatch({ type: 'skipturn' });     // sıra lider dışında olsun
    const dcId = curId(r);
    assert.notEqual(dcId, 'A');
    r.leave(dcId);
    r.flush();
    const viewer = ['A', 'B', 'C'].find((x) => x !== dcId);
    const v = r.view(viewer);
    assert.ok(v.wait && v.wait.id === dcId, 'bekleme bildirimi');
    assert.ok(v.wait.left > 170000 && v.wait.left <= 180000);
    assert.equal(v.paused, true);
    r.advance(60000);
    assert.equal(curId(r), dcId, 'oyun bekliyor, tur geçmedi');
    assert.ok(r.view('A').wait.left < 125000);
    // geri dönüş: aynı kimlikle; tam durum gelir, sıra yine onda
    r.rejoin(dcId);
    r.flush();
    r.advance(500);
    assert.equal(r.view(dcId).mode, 'play');
    assert.equal(curId(r), dcId);
    assert.equal(r.view('A').wait, null);
    assert.equal(r.view('A').paused, false);
    assert.equal(r.view(dcId).game.order.length, 3);
});

test('kopma: 3 dk dolunca tur otomatik geçilir ve koltuk boşalır', () => {
    const r = started(3);
    let guard = 0;
    while (curId(r) === 'A' && guard++ < 10) r.m('A').dispatch({ type: 'skipturn' });
    const victim = curId(r);
    assert.notEqual(victim, 'A');
    r.leave(victim);
    r.flush();
    r.advance(C.DISCONNECT_MS + 2000, 1000);
    assert.ok(!r.state('A').S.some((s) => s.i === victim), 'koltuk boşaldı');
    assert.equal(r.state('A').g.order.includes(victim), false);
    assert.notEqual(curId(r), victim);
    assert.equal(r.view('A').phase, 'play');
});

test('kopma: lider "turu geç" ve "at" seçebilir', () => {
    const r = started(3);
    let guard = 0;
    while (curId(r) === 'A' && guard++ < 10) r.m('A').dispatch({ type: 'skipturn' });
    const victim = curId(r);
    assert.notEqual(victim, 'A');
    r.leave(victim);
    r.flush();
    assert.equal(r.view('A').paused, true);
    r.m('A').dispatch({ type: 'skipturn' });
    r.flush();
    assert.notEqual(curId(r), victim);
    assert.ok(r.state('A').S.some((s) => s.i === victim), 'koltuk saklı');
    r.m('A').dispatch({ type: 'drop', id: victim });
    r.flush();
    assert.ok(!r.state('A').S.some((s) => s.i === victim));
    assert.ok(r.state('A').kk.includes(victim));
});

test('lider devri: lider düşerse koltuk sırasına göre sıradaki bağlı insan lider olur ve oyun kaldığı yerden sürer', () => {
    const r = started(3);
    const g0 = JSON.stringify(r.state('B').g);
    const stage0 = r.state('B').g.stage;
    r.leave('A');
    r.flush();
    assert.equal(r.state('B').ld, 'B', 'B lider (koltuk sırası A,B,C)');
    assert.equal(r.state('C').ld, 'B');
    assert.equal(r.view('B').isLeader, true);
    assert.equal(r.view('C').isLeader, false);
    assert.equal(r.state('B').ep, 2);
    assert.equal(r.state('C').ep, 2);
    assert.equal(r.state('B').g.stage, stage0);
    assert.equal(JSON.stringify(r.state('B').g.P), JSON.stringify(JSON.parse(g0).P));
    assert.equal(r.view('B').seats.find((s) => s.i === 'A').c, 0, 'eski lider kopmuş sayılır');
    // yeni lider oyunu sürdürür: sıradaki (A değilse) oynar
    r.advance(100);
    let guard = 0;
    while (curId2(r) === 'A' && guard++ < 3) r.advance(1000);
    const cur = curId2(r);
    if (cur !== 'A') {
        const before = r.state('B').rv;
        r.m(cur).dispatch({ type: 'roll' });
        r.flush();
        assert.ok(r.state('B').rv > before, 'yeni lider eylemi işledi');
    }
});

function curId2(r) { return R.current(r.state('B').g); }

test('lider devri: eski lider yeniden katılınca lider olmaz, durumu alır; oyun sürer', () => {
    const r = started(3);
    r.leave('A');
    r.flush();
    r.rejoin('A');
    r.flush();
    r.advance(2000);
    assert.equal(r.view('A').isLeader, false);
    assert.equal(r.state('A').ld, 'B');
    assert.equal(r.state('A').ep, 2);
    assert.equal(r.view('A').mode, 'play');
    assert.equal(r.view('A').seats.find((s) => s.i === 'A').c, 1);
});

test('lider devri: devir iki kez (art arda) çalışır; üç lider zinciri', () => {
    const r = started(3);
    r.leave('A'); r.flush();
    assert.equal(r.state('B').ld, 'B');
    r.leave('B'); r.flush();
    assert.equal(r.state('C').ld, 'C');
    assert.equal(r.state('C').ep, 3);
    assert.equal(r.view('C').isLeader, true);
});

test('lider devri: botlar ve izleyiciler lider olamaz', () => {
    const r = room();
    r.join('A', 'Ayse'); r.join('B', 'Bora');
    r.m('A').dispatch({ type: 'bot_add' });
    r.flush();
    r.m('A').dispatch({ type: 'start' });
    r.flush();
    r.leave('A');
    r.flush();
    assert.equal(r.state('B').ld, 'B');
});

test('lobide lider düşerse de devir olur; lobi sürer', () => {
    const r = lobby3();
    r.leave('A');
    r.flush();
    assert.equal(r.state('B').ld, 'B');
    assert.equal(r.view('B').phase, 'lobby');
    r.m('B').dispatch({ type: 'cfg', goal: 15 });
    r.flush();
    assert.equal(r.view('C').cfg.gl, 15);
});

test('lobide kopan oyuncunun koltuğu hemen boşalır', () => {
    const r = lobby3();
    r.leave('C');
    r.flush();
    assert.deepEqual(r.view('A').seats.map((s) => s.i), ['A', 'B']);
});

test('geç gelen: oyun sürerken tanınmayan kimlik izleyici olur ve durumu alır, eylem yapamaz', () => {
    const r = started(2);
    r.join('Z', 'Gelen');
    r.flush();
    r.advance(2000);
    assert.equal(r.view('Z').mode, 'spectator');
    assert.equal(r.view('Z').game.order.length, 2);
    r.m('Z').dispatch({ type: 'roll' });
    r.flush();
    assert.equal(r.state('A').g.order.length, 2);
});

test('atılan oyuncu "kicked" görür; koltuğu kalkar', () => {
    const r = lobby3();
    r.m('A').dispatch({ type: 'kick', id: 'C' });
    r.flush();
    assert.equal(r.view('C').mode, 'kicked');
    assert.deepEqual(r.view('A').seats.map((s) => s.i), ['A', 'B']);
    r.m('B').dispatch({ type: 'kick', id: 'A' });
    r.flush();
    assert.equal(r.view('A').seats.length, 2, 'lider olmayan atamaz');
});

test('oyun sonu: sıralama gösterilir, lider "yeniden oyna" ile lobiye döner', () => {
    const r = started(2);
    const M = r.state('A');
    const ids = M.g.order;
    M.g.P[ids[0]].s = 9;
    // kazandıracak bir eylem: ödül yerine doğrudan kuralı ihlal etmeden bitir
    M.g.goal = 10;
    M.g.P[ids[0]].s = 10;
    R.checkWin(M.g);
    M.ph = 'over';
    r.m('A').dispatch({ type: 'again' });         // lobiye
    r.flush();
    assert.equal(r.view('B').phase, 'lobby');
    assert.equal(r.view('B').game, null);
    assert.equal(r.view('B').seats.length, 2);
});

test('çevrimdışı/yeniden bağlanma: _reconnected tam durum ister, banner bayrağı yönetilir', () => {
    const r = started(2);
    r.m('B').onMessage({ type: '_connection', state: 'lost' });
    assert.equal(r.view('B').offline, true);
    const n = r.sent.length;
    r.m('B').onMessage({ type: '_reconnected' });
    assert.equal(r.view('B').offline, false);
    assert.ok(r.sent.slice(n).some((s) => s.msg.type === 'pt_sync'));
});

test('lider kopup dönerse eski epoch yayını yok sayılır ve güncel lider onu düzeltir', () => {
    const r = started(3);
    const staleMsg = JSON.parse(JSON.stringify(r.sent.filter((s) => s.msg.type === 'pt_state').pop().msg));
    r.leave('A'); r.flush();
    const ep = r.state('B').ep;
    r.m('C').onMessage(staleMsg);
    assert.equal(r.state('C').ep, ep, 'eski epoch kabul edilmedi');
    const n = r.sent.length;
    r.advance(1000);
    r.m('B').onMessage(staleMsg);
    assert.ok(r.sent.slice(n).some((s) => s.from === 'B' && s.msg.type === 'pt_state' && s.msg.ep === ep), 'güncel lider yayınladı');
});

test('backend devralma: yenilenen lider (player_disconnect yok) lider sayılmaz, durum kaybolmaz; sıra korunur', () => {
    const r = started(3);
    const g0 = JSON.stringify(r.state('B').g.P);
    r.takeover('A');
    r.flush();
    r.advance(2000);
    assert.equal(r.state('B').ld, 'B', 'B lider oldu');
    assert.equal(r.state('C').ld, 'B');
    assert.equal(r.state('A').ld, 'B', 'yenilenen eski lider durumu aldı');
    assert.equal(r.view('A').isLeader, false);
    assert.equal(r.view('A').mode, 'play');
    assert.equal(JSON.stringify(r.state('A').g.P), g0, 'oyun durumu korundu');
    assert.equal(r.view('B').seats.find((s) => s.i === 'A').c, 1, 'dönen oyuncu bağlı sayılır, 3 dk sayacı yok');
    assert.deepEqual(r.view('B').disconnected, []);
});

test('backend devralma: yenilenen takipçi aynı koltukta kalır, tam durumu alır; lider değişmez', () => {
    const r = started(3);
    r.takeover('C');
    r.flush();
    r.advance(1500);
    assert.equal(r.state('A').ld, 'A');
    assert.equal(r.state('A').ep, 1);
    assert.equal(r.view('C').mode, 'play');
    assert.equal(r.view('C').game.order.length, 3);
    assert.equal(r.view('C').isLeader, false);
});

test('backend devralma: tek başına yenilenen kurucu yeni lobi kurar (kaybedecek durum yok)', () => {
    const r = room();
    r.join('A', 'Ayse');
    r.takeover('A');
    assert.equal(r.view('A').isLeader, true);
    assert.equal(r.view('A').phase, 'lobby');
});

test('günlük: minioyun sonucu tek satır (🥇A 🥈B 🥉C), tek tek ödül satırı yok', async () => {
    const r = started(3);
    let guard = 0;
    while (r.state('A').g.stage !== 'mini' && guard++ < 200) {
        r.m(curId(r)).dispatch(R.autoAction(r.state('A').g, { g: G.index(maps.pirate) }));
        r.flush();
    }
    await r.settle();
    r.advance(C.MINI_HOLD_MS + 500);
    const log = r.view('A').log;
    const lines = log.filter((l) => l.startsWith('🎡'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^🎡 🥇\S+ 🥈\S+( 🥉\S+)?$/);          // düelloda iki, ffa'da üç madalya
    assert.ok(!log.some((l) => /minioyunda \d\. oldu/.test(l) || /\(minioyun\)/.test(l)));
});

test('günlük: ölüm satırı yazılır', () => {
    const r = started(2);
    const M = r.state('A');
    const ids = M.g.order;
    const g = G.index(maps.pirate);
    M.g.P[ids[0]].w = ['fist']; M.g.stage = 'act'; M.g.turn = 0;
    const start = g.starts[0];
    const other = g.byId[start].next[0];
    M.g.P[ids[0]].pos = start; M.g.P[ids[1]].pos = other; M.g.P[ids[1]].hp = 5; M.g.P[ids[1]].s = 4;
    r.m(ids[0]).dispatch({ type: 'use', item: 0, target: ids[1] });
    r.flush();
    assert.ok(r.view('B').log.some((l) => /düştü/.test(l)));
});

test('zaman: tick seyrek (250 ms ya da 1 sn) çağrılsa da süre dolunca lider otomatik ilerler, botlar oynar', () => {
    for (const step of [250, 1000]) {
        const r = room();
        r.join('A', 'Ayse'); r.join('B', 'Bora');
        r.m('A').dispatch({ type: 'bot_add' });
        r.m('A').dispatch({ type: 'start' });
        r.flush();
        const rv0 = r.state('A').rv;
        r.advance(C.STEP_MS * 3, step);
        assert.ok(r.state('A').rv > rv0 + 2, 'adım ' + step + ': oyun ilerledi');
        assert.ok(r.state('A').fx.length > 0 || r.state('A').lg.length > 1);
    }
});
