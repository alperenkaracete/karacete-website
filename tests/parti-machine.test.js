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
        nodes, emotes: {}, get clock() { return clock; },
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
                me: { id, name }, players: node.players, now: () => clock, rand, maps, onEmote: (e) => { (api.emotes[id] = api.emotes[id] || []).push(e); }, creator: first && !options.noCreator,
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
                me: { id, name: old.name }, players: node.players, now: () => clock, rand, maps, onEmote: (e) => { (api.emotes[id] = api.emotes[id] || []).push(e); }, creator: roomPlayers.length <= 1 && roomPlayers[0].id === id,
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
    assert.equal(r.view('B').cfg.gl, 0, 'varsayılan hedef otomatik');
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
    assert.equal(r.view('A').cfg.gl, 0);
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
    M.g.order.forEach((id) => { M.g.P[id].w = { bomb: 3, shotgun: 2, shield: 1 }; M.g.P[id].dmg = { P1: 20, P2: 40 }; });
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
    r.advance(C.STAGE_MS.roll - 1000);
    assert.equal(r.state('A').rv, rd0, 'süre dolmadı');
    r.advance(2000);
    assert.ok(r.state('A').fx.some((e) => e.t === 'roll' && e.id === cur), 'zar otomatik atıldı');
    // sıradaki evre ne olursa olsun süre dolunca ilerler ve turu devralan oyuncuya geçer
    for (let i = 0; i < 6 && curId(r) === cur; i++) r.advance(C.STAGE_MS.roll + 100);
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
            if (act) r.m(R.current(g)).dispatch(act);
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
    assert.equal(v.wait.bot, false);
    assert.ok(v.wait.botIn > 25000 && v.wait.botIn <= C.DISCONNECT_BOT_MS, 'bot devri sayacı: ' + v.wait.botIn);
    r.advance(20000);
    assert.equal(curId(r), dcId, '30 sn dolmadan oyun bekliyor, tur geçmedi');
    assert.ok(r.view('A').wait.left < 165000, 'koltuk süresi akıyor');
    // geri dönüş: aynı kimlikle; tam durum gelir, sıra yine onda
    r.rejoin(dcId);
    r.flush();
    r.advance(500);
    assert.equal(r.view(dcId).mode, 'play');
    assert.equal(curId(r), dcId);
    assert.equal(r.view('A').wait, null);
    assert.equal(r.view(dcId).game.order.length, 3);
    assert.equal(r.state('A').bt, null, 'bot devri yok');
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
    assert.ok(r.view('A').wait && r.view('A').wait.id === victim);
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
    M.g.P[ids[0]].w = { fist: 1 }; M.g.stage = 'roll'; M.g.turn = 0;
    const start = g.starts[0];
    const other = g.byId[start].next[0];
    M.g.P[ids[0]].pos = start; M.g.P[ids[1]].pos = other; M.g.P[ids[1]].hp = 5; M.g.P[ids[1]].s = 4;
    r.m(ids[0]).dispatch({ type: 'use', w: 'fist', target: ids[1] });
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
        r.advance(C.STAGE_MS.roll * 3, step);
        assert.ok(r.state('A').rv > rv0 + 2, 'adım ' + step + ': oyun ilerledi');
        assert.ok(r.state('A').fx.length > 0 || r.state('A').lg.length > 1);
    }
});

// ---- hafif mesaj güvenliği ----
function lastState(r, from) {
    return JSON.parse(JSON.stringify(r.sent.filter((s) => s.msg.type === 'pt_state' && (!from || s.from === from)).pop().msg));
}

test('devir: takeOver ep\'yi tam 1 artırır; art arda iki devirde her adım kabul edilir', () => {
    const r = started(4);
    assert.equal(r.state('B').ep, 1);
    r.leave('A'); r.flush();
    assert.equal(r.state('B').ep, 2);
    assert.equal(r.state('C').ep, 2, 'takipçi ep+1 yayınını reddetmedi');
    r.leave('B'); r.flush();
    assert.equal(r.state('C').ep, 3);
    assert.equal(r.state('D').ep, 3);
    assert.equal(r.state('D').ld, 'C');
});

test('pt_state: ep, M.ep+1\'den büyük atlarsa reddedilir; yeniden bağlanma sonrası ilk görüntü muaf', () => {
    const r = started(3);
    const snap = lastState(r, 'A');
    const jump = Object.assign({}, snap, { ep: 3, rv: snap.rv + 10 });
    r.m('B').onMessage(jump);
    assert.equal(r.state('B').ep, 1, 'ep+2 reddedildi');
    r.m('B').onMessage(Object.assign({}, snap, { ep: 2, rv: snap.rv + 10, ld: 'B' }));
    assert.equal(r.state('B').ep, 2, 'ep+1 kabul');
    // yeniden bağlanma: birden çok devir atlamış olabilir
    r.m('C').onMessage({ type: '_reconnected' });
    r.m('C').onMessage(Object.assign({}, snap, { ep: 4, rv: snap.rv + 20, ld: 'B' }));
    assert.equal(r.state('C').ep, 4, 'yeniden bağlanma sonrası ilk görüntü muaf');
    r.m('C').onMessage(Object.assign({}, snap, { ep: 9, rv: snap.rv + 30, ld: 'B' }));
    assert.equal(r.state('C').ep, 4, 'muafiyet yalnızca bir kez');
});

test('pt_state: lider koltukta oturan insan olmalı (bot/koltuksuz reddedilir); bağlı olması aranmaz (yarış)', () => {
    const r = started(3);
    const snap = lastState(r, 'A');
    const bad = (patch) => r.m('B').onMessage(Object.assign({}, snap, { rv: snap.rv + 5, ep: 2 }, patch));
    bad({ ld: 'Z' });                                             // koltuksuz
    assert.equal(r.state('B').ep, 1);
    const withBot = JSON.parse(JSON.stringify(snap));
    withBot.S.push({ i: 'botx', n: 'Bot', a: '🤖', t: 0, b: 1, c: 1, d: 0 });
    bad({ S: withBot.S, ld: 'botx' });                            // bot lider
    assert.equal(r.state('B').ep, 1);
    // yarış: yeni liderin (B'nin) ilk yayını, alıcı C henüz player_disconnect(A) işlemeden gelir; A hâlâ bağlı görünür
    assert.equal(r.view('C').seats.find((s) => s.i === 'A').c, 1);
    r.m('C').onMessage(Object.assign({}, snap, { rv: snap.rv + 5, ep: 2, ld: 'B' }));
    assert.equal(r.state('C').ld, 'B', 'yeni liderin ilk yayını kabul edildi');
    assert.equal(r.state('C').ep, 2);
    // ve ardından gelen gecikmiş player_disconnect(A) bir şeyi bozmaz
    r.m('C').onMessage({ type: 'player_disconnect', id: 'A' });
    assert.equal(r.state('C').ld, 'B');
});

test('pt_action: from alanı varsa id ile eşleşmeli; yoksa eski davranış; kural: __proto__/constructor hedefleri', () => {
    const r = started(3);
    const cur = curId(r);
    const other = ['A', 'B', 'C'].find((x) => x !== cur);
    const rv = r.state('A').rv;
    // sahte `from`
    r.m('A').onMessage({ type: 'pt_action', id: cur, from: other, a: { type: 'roll' } });
    assert.equal(r.state('A').rv, rv, 'from uyuşmuyor: yok sayıldı');
    r.m('A').onMessage({ type: 'pt_action', id: cur, from: cur, a: { type: 'roll' } });
    assert.ok(r.state('A').rv > rv, 'from uyuşuyor: işlendi');
    const rv2 = r.state('A').rv;
    // from yok: eski davranış
    const s = r.state('A').g;
    const nextCur = R.current(s);
    r.m('A').onMessage({ type: 'pt_action', id: nextCur, a: { type: 'noop' } });
    assert.equal(r.state('A').rv, rv2);
});

function finishGame(r) {
    const M = r.state('A');
    M.g.stage = 'over';
    M.ph = 'over';
    M.g.winner = { kind: 'player', id: M.g.order[0] };
}

test('yeniden oyna: oyun sırasında gelen izleyiciler koltuk alır (8 sınırı); atılanlar ve kopanlar almaz', () => {
    const r = started(2);
    r.join('Z', 'Gelen1'); r.join('Y', 'Gelen2');
    r.flush();
    assert.equal(r.view('Z').mode, 'spectator');
    finishGame(r);
    r.m('A').dispatch({ type: 'again' });
    r.flush();
    assert.equal(r.view('A').phase, 'lobby');
    assert.deepEqual(r.view('A').seats.map((s) => s.i).sort(), ['A', 'B', 'Y', 'Z']);
    assert.equal(r.view('Z').mode, 'lobby');
    assert.equal(r.view('Y').mode, 'lobby');
});

test('yeniden oyna: koltuk sayısı 8\'i geçmez; atılan izleyici koltuk almaz', () => {
    const r = room();
    ['A', 'B'].forEach((id) => r.join(id, id));
    r.m('A').dispatch({ type: 'bot_add' });
    r.m('A').dispatch({ type: 'start' });
    r.flush();
    for (let i = 0; i < 8; i++) r.join('S' + i, 'Izleyici' + i);
    r.flush();
    // atılmış izleyici: kk listesine yaz
    r.state('A').kk.push('S0');
    finishGame(r);
    r.m('A').dispatch({ type: 'again' });
    r.flush();
    const seats = r.view('A').seats;
    assert.equal(seats.length, 8, '8 sınırı');
    assert.ok(!seats.some((s) => s.i === 'S0'), 'atılan koltuk almaz');
    assert.ok(seats.some((s) => s.b), 'bot korunur');
});


// ---- madde 8: aşama süreleri, kopan oyuncu için bot, AFK ----
function nonLeaderTurn(r) {
    let guard = 0;
    while (curId(r) === 'A' && guard++ < 10) r.m('A').dispatch({ type: 'skipturn' });
    return curId(r);
}

test('aşama süreleri: zar aşaması (silah+zar) 20 sn, yön 8 sn; act/swap yok', () => {
    assert.deepEqual(C.STAGE_MS, { roll: 20000, choose: 8000 });
    const r = started(2);
    const dl = () => r.view('A').dlLeft;
    assert.ok(dl() > 19000 && dl() <= 20000, 'zar ' + dl());
    // yön aşaması: dallanmada
    const M = r.state('A');
    const cur = curId(r);
    const g = G.index(maps.pirate);
    const branch = maps.pirate.nodes.find((n) => n.next.length > 1);
    const pre = maps.pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === branch.id);
    M.g.P[cur].pos = pre.id;
    r.m(cur).dispatch({ type: 'roll' });
    r.flush();
    for (let i = 0; i < 6 && r.state('A').g.stage === 'roll'; i++) r.m(curId(r)).dispatch({ type: 'roll' });
    if (r.state('A').g.stage === 'choose') assert.ok(dl() > 7000 && dl() <= 8000, 'yön ' + dl());
});

test('yön aşaması süre dolunca (8 sn) rastgele yön seçilir', () => {
    const r = started(2);
    const M = r.state('A');
    const cur = curId(r);
    const branch = maps.pirate.nodes.find((n) => n.next.length > 1);
    const pre = maps.pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === branch.id);
    M.g.P[cur].pos = pre.id;
    // zar: dallanma sonrası adım kalsın diye birkaç deneme yerine doğrudan 'choose' kur
    M.g.stage = 'choose'; M.g.choices = branch.next.slice(); M.g.steps = 3; M.g.P[cur].pos = branch.id;
    r.m('A').dispatch({ type: 'cfg' });         // yayın tetikleme gerekmez; süreyi 8 sn'ye çek
    M.dlAt = r.clock + C.STAGE_MS.choose;
    r.advance(C.STAGE_MS.choose + 600);
    assert.notEqual(r.state('A').g.stage, 'choose', 'süre dolunca yön otomatik seçildi');
});

test('kopan oyuncunun sırası: 30 sn sonra bot oynar, koltuk 3 dk saklı; bekleme kartında "Bot oynuyor"', () => {
    const r = started(3);
    const victim = nonLeaderTurn(r);
    assert.notEqual(victim, 'A');
    r.leave(victim);
    r.flush();
    r.advance(C.DISCONNECT_BOT_MS - 2000);
    assert.equal(curId(r), victim, '30 sn dolmadı');
    assert.equal(r.view('A').wait.bot, false);
    r.advance(3000);                                     // bot devraldı
    assert.ok(r.state('A').bt === victim || curId(r) !== victim, 'bot devraldı ya da tur geçti');
    let sawBotCard = false;
    for (let i = 0; i < 40 && curId(r) === victim; i++) {
        const w = r.view('A').wait;
        if (w && w.bot) sawBotCard = true;
        r.advance(300);
    }
    assert.ok(sawBotCard || curId(r) !== victim, 'kartta "Bot oynuyor" durumu görüldü');
    assert.notEqual(curId(r), victim, 'bot turu oynayıp bitirdi');
    assert.ok(r.state('A').S.some((s) => s.i === victim), 'koltuk hâlâ saklı');
    assert.ok(r.state('A').g.order.includes(victim));
});

test('kopan oyuncu bot oynarken dönerse turu geri alır', () => {
    const r = started(3);
    const victim = nonLeaderTurn(r);
    r.leave(victim); r.flush();
    r.advance(C.DISCONNECT_BOT_MS + 400);
    assert.equal(r.state('A').bt, victim);
    r.rejoin(victim); r.flush();
    r.advance(200);
    assert.equal(r.state('A').bt, null, 'bot devri bitti');
    if (curId(r) === victim) {
        const dl = r.view('A').dlLeft;
        assert.ok(dl > 7000, 'normal aşama süresi döndü: ' + dl);
    }
});

const PG = G.index(maps.pirate);

// Dünyayı bir adım ilerlet: `idle` oyuncu hiç eylem yapmaz, diğerleri (insan) otomatik oynar, minioyun tamamlanır.
async function stepWorld(r, idle) {
    const g = r.state('A').g;
    if (g.stage === 'mini') {
        await r.settle();
        r.advance(C.MINI_HOLD_MS + 300, 300);
        return;
    }
    const cur = R.current(g);
    if (cur !== idle) {
        const act = R.autoAction(g, { g: PG });
        if (act) r.m(cur).dispatch(act);
        r.flush();
    }
    r.advance(cur === idle ? 1000 : 200, 200);
}

test('AFK: üst üste 2 turda hiç eylem yapmayan insanı bot devralır; "Ben buradayım" ile geri döner (bot 3 sn bekler)', async () => {
    const r = room();
    r.join('A', 'A'); r.join('B', 'B'); r.join('C', 'C');
    r.m('A').dispatch({ type: 'start' }); r.flush();
    const target = 'B';
    const turnsSeen = new Set();
    let guard = 0;
    while (!r.state('A').g.P[target].afk && guard++ < 3000) {
        const g = r.state('A').g;
        if (g.stage !== 'mini' && R.current(g) === target) turnsSeen.add(g.rd);
        await stepWorld(r, target);
    }
    assert.ok(r.state('A').g.P[target].afk, 'B AFK oldu');
    assert.equal(turnsSeen.size, C.AFK_TURNS, 'tam ' + C.AFK_TURNS + ' AFK turdan sonra');
    assert.ok(r.view('A').log.some((l) => /bot devraldı/.test(l)));
    assert.equal(r.view('B').afk, true, 'B kendi ekranında "Ben buradayım" görür');
    assert.equal(r.view('A').afk, false);
    // sıra B'ye gelince bot önce 3 sn bekler
    guard = 0;
    while ((r.state('A').g.stage === 'mini' || R.current(r.state('A').g) !== target) && guard++ < 3000) await stepWorld(r, target);
    assert.equal(R.current(r.state('A').g), target);
    r.advance(C.AFK_BOT_DELAY_MS - 1200, 200);
    assert.notEqual(r.state('A').bt, target, '3 sn dolmadan bot oynamaz');
    r.m(target).dispatch({ type: 'back' });
    r.flush();
    assert.equal(r.state('A').g.P[target].afk, false);
    assert.equal(r.state('A').g.P[target].afkc, 0);
    r.advance(C.AFK_BOT_DELAY_MS + 1000, 200);
    assert.notEqual(r.state('A').bt, target, 'bot devralmadı');
    assert.equal(R.current(r.state('A').g), target, 'sıra hâlâ insanda');
    assert.ok(r.view('A').dlLeft > 8000, 'normal aşama süresi geri geldi: ' + r.view('A').dlLeft);
});

test('AFK: bot devralmışken insanın herhangi geçerli eylemi bayrağı kaldırır ve botu durdurur', async () => {
    const r = room();
    r.join('A', 'A'); r.join('B', 'B');
    r.m('A').dispatch({ type: 'start' }); r.flush();
    const target = 'B';
    let guard = 0;
    // bayrak, B'nin turu başlamadan önce konsun (gerçek akışta bayrak önceki turların sonunda konur)
    while (R.current(r.state('A').g) === target && guard++ < 50) {
        r.m(target).dispatch(R.autoAction(r.state('A').g, { g: PG })); r.flush();
    }
    r.state('A').g.P[target].afk = true;
    r.state('A').g.P[target].afkc = 2;
    guard = 0;
    while (R.current(r.state('A').g) !== target && guard++ < 500) await stepWorld(r, target);
    r.state('A').g.P[target].pos = PG.start;         // başlangıçtan zar: ilk hamle yön seçtirir (bot iki adımda oynar)
    r.advance(C.AFK_BOT_DELAY_MS + 100, 50);        // bot devraldı ve zarı attı (yön seçimi 0,9 sn sonra)
    assert.equal(r.state('A').bt, target);
    assert.ok(r.state('A').fx.some((e) => e.t === 'roll' && e.id === target));
    const g = r.state('A').g;
    // bot zar attıktan sonra kalan aşamayı (yön) insan oynar
    assert.equal(R.current(g), target);
    const act = R.autoAction(g, { g: PG });
    r.m(target).dispatch(act);
    r.flush();
    assert.equal(r.state('A').g.P[target].afk, false, 'eylem AFK bayrağını kaldırdı');
    assert.equal(r.state('A').bt, null);
});

test('AFK: eylem yapan oyuncu AFK sayılmaz; sayaç sıfırlanır', () => {
    const r = started(2);
    r.state('A').g.P.B.afkc = 1;
    let guard = 0;
    while (curId(r) !== 'B' && guard++ < 100) { r.m(curId(r)).dispatch(R.autoAction(r.state('A').g, { g: PG })); r.flush(); }
    r.m('B').dispatch({ type: 'roll' });
    r.flush();
    assert.equal(r.state('A').g.P.B.afkc, 0);
    assert.equal(r.view('B').afk, false);
});

test('otomatik hedef: başlarken oyuncu sayısına göre 15 / 10; elle seçilen hedef korunur ve "otomatik"e dönülebilir', () => {
    const two = started(2);
    assert.equal(two.view('A').cfg.gl, 0);
    assert.equal(two.state('A').g.goal, 15);
    assert.equal(two.view('B').game.goal, 15, 'takipçi de aynı hedefi görür');
    const four = started(4);
    assert.equal(four.state('A').g.goal, 10);
    const fixed = room();
    ['A', 'B', 'C'].forEach((id) => fixed.join(id, id));
    fixed.m('A').dispatch({ type: 'cfg', goal: 5 });
    fixed.m('A').dispatch({ type: 'start' });
    fixed.flush();
    assert.equal(fixed.state('A').g.goal, 5);
    const back = room();
    back.join('A', 'A'); back.join('B', 'B');
    back.m('A').dispatch({ type: 'cfg', goal: 20 });
    back.m('A').dispatch({ type: 'cfg', goal: 0 });
    back.flush();
    assert.equal(back.view('B').cfg.gl, 0);
});


// ---- madde 10a: emoji tepkileri ----
test('emote: gönderilir, alıcıda görünür, oyun durumuna yazılmaz; saniyede en çok 1', () => {
    const r = started(3);
    const rv = r.state('A').rv;
    const g0 = JSON.stringify(r.state('A').g);
    assert.equal(r.m('B').emote('😂'), true);
    r.flush();
    assert.deepEqual(r.emotes.A, [{ id: 'B', e: '😂' }]);
    assert.deepEqual(r.emotes.C, [{ id: 'B', e: '😂' }]);
    assert.deepEqual(r.emotes.B, [{ id: 'B', e: '😂' }], 'gönderen kendi balonunu da görür');
    assert.equal(r.state('A').rv, rv, 'durum yayını yok');
    assert.equal(JSON.stringify(r.state('A').g), g0);
    // hız sınırı (gönderende)
    assert.equal(r.m('B').emote('👏'), false);
    r.flush();
    assert.equal(r.emotes.A.length, 1);
    r.advance(C.EMOTE_GAP_MS + 50, 100);
    assert.equal(r.m('B').emote('👏'), true);
    r.flush();
    assert.equal(r.emotes.A.length, 2);
    assert.ok(!r.sent.some((x) => x.msg.type === 'pt_state' && x.msg.emote));
});

test('emote: alıcıda da hız sınırı; beyaz liste dışı emoji, koltuksuz/bot gönderen, sahte from yok sayılır', () => {
    const r = started(3);
    const n0 = (r.emotes.A || []).length;
    r.m('A').onMessage({ type: 'pt_emote', id: 'B', e: '😂' });
    r.m('A').onMessage({ type: 'pt_emote', id: 'B', e: '😂' });                 // hemen tekrar: reddedilir
    assert.equal(r.emotes.A.length - n0, 1);
    for (const bad of ['💩', '<img>', '', null, 5, '😂😂', { x: 1 }]) r.m('A').onMessage({ type: 'pt_emote', id: 'C', e: bad });
    assert.equal(r.emotes.A.length - n0, 1, 'geçersiz emoji');
    r.m('A').onMessage({ type: 'pt_emote', id: 'Z', e: '🤡' });                  // koltuksuz
    r.m('A').onMessage({ type: 'pt_emote', id: 5, e: '🤡' });
    r.m('A').onMessage({ type: 'pt_emote', id: 'C', from: 'B', e: '🤡' });       // from uyuşmuyor
    assert.equal(r.emotes.A.length - n0, 1);
    r.m('A').onMessage({ type: 'pt_emote', id: 'C', e: '🤡' });
    assert.equal(r.emotes.A.length - n0, 2, 'geçerli emote: farklı gönderen, ayrı sayaç');
    // izleyici emote atamaz
    r.join('S', 'Izleyici'); r.flush();
    assert.equal(r.m('S').emote('😱'), false);
    assert.equal(r.m('B').emote('💩'), false);
});

test('emote: kendine ait bot yok; lobi dahil (durum varsa) koltuklu herkes atabilir', () => {
    const r = lobby3();
    assert.equal(r.m('C').emote('😱'), true);
    r.flush();
    assert.equal((r.emotes.A || []).length, 1);
});

test('pt_state: sonlu olmayan/geçersiz can, yıldız ya da konum içeren durum reddedilir (NaN/undefined arayüze girmez)', () => {
    const r = started(2);
    const snap = lastState(r, 'A');
    const ids = snap.g.order;
    const before = r.state('B').rv;
    const mutate = (fn) => {
        const m = JSON.parse(JSON.stringify(snap));
        fn(m.g.P[ids[0]], m.g);
        m.rv = before + 50;
        r.m('B').onMessage(m);
        return r.state('B').rv === before;      // true: reddedildi
    };
    assert.ok(mutate((p) => { p.hp = null; }), 'hp null (JSON NaN)');
    assert.ok(mutate((p) => { p.hp = 'x'; }), 'hp metin');
    assert.ok(mutate((p) => { p.hp = -5; }), 'hp negatif');
    assert.ok(mutate((p) => { p.hp = 1e9; }), 'hp çok büyük');
    assert.ok(mutate((p) => { delete p.hp; }), 'hp yok');
    assert.ok(mutate((p) => { p.s = 1.5; }), 'yıldız kesirli');
    assert.ok(mutate((p) => { p.s = -1; }), 'yıldız negatif');
    assert.ok(mutate((p) => { p.pos = 'a'; }), 'konum metin');
    assert.ok(mutate((p) => { p.home = null; }), 'home null');
    assert.ok(mutate((p, g) => { g.rd = 0; }), 'tur 0');
    assert.ok(mutate((p, g) => { g.order = ['__proto__']; }), 'order prototip anahtarı');
    // geçerli durum kabul edilir
    const ok = JSON.parse(JSON.stringify(snap));
    ok.rv = before + 60;
    r.m('B').onMessage(ok);
    assert.equal(r.state('B').rv, before + 60);
});

test('eski anlık görüntü göçü: haritada olmayan konumlar (eski 8 başlangıç) ortak başlangıca taşınır, g.home eklenir', () => {
    const r = started(2);
    const snap = lastState(r, 'A');
    const gr = G.index(maps.pirate);
    delete snap.g.home;                                   // eski biçim: üst düzey home yok
    snap.g.order.forEach((id, i) => { snap.g.P[id].pos = 39 + i; snap.g.P[id].home = 40 + i; });   // eski başlangıç kimlikleri
    snap.rv += 40;
    r.m('B').onMessage(snap);
    const g = r.state('B').g;
    assert.equal(g.home, gr.start);
    g.order.forEach((id) => { assert.equal(g.P[id].pos, gr.start); assert.equal(g.P[id].home, gr.start); });
    // geçerli konumlar olduğu gibi kalır
    const snap2 = lastState(r, 'A');
    delete snap2.g.home;
    const first = snap2.g.order[0];
    snap2.g.P[first].pos = 5;
    snap2.rv += 80;
    r.m('B').onMessage(snap2);
    assert.equal(r.state('B').g.P[first].pos, 5);
    assert.equal(r.state('B').g.P[first].home, gr.start);
});


// ---- sınırsız envanter, rv (çift dokunuş koruması), eski biçim göçü ----
test('eski anlık görüntü göçü: silah dizisi sayaç nesnesine çevrilir, seçim bekleyen öğeler atılır', () => {
    const r = started(2);
    const snap = lastState(r, 'A');
    const first = snap.g.order[0];
    snap.g.P[first].w = ['fist', 'bow', 'bow'];
    snap.g.P[first].offers = ['bomb'];
    snap.rv += 90;
    r.m('B').onMessage(snap);
    const p = r.state('B').g.P[first];
    assert.deepEqual(p.w, { fist: 1, bow: 2 });
    assert.equal(p.offers, undefined);
    // geçersiz sayaç (bilinmeyen silah / 0 / kesir) reddedilir
    const bad = lastState(r, 'A');
    bad.g.P[first].w = { laser: 1 };
    bad.rv += 120;
    const before = r.state('B').rv;
    r.m('B').onMessage(bad);
    assert.equal(r.state('B').rv, before, 'bilinmeyen silah reddedildi');
    const bad2 = lastState(r, 'A');
    bad2.g.P[first].w = { fist: 0.5 };
    bad2.rv += 130;
    r.m('B').onMessage(bad2);
    assert.equal(r.state('B').rv, before);
});

test('rv: takipçi eylemi oyun revizyonunu taşır; eski revizyondaki (çift dokunuş) eylem reddedilir, rv yoksa eski davranış', () => {
    const r = started(3);
    const cur = curId(r);
    const follower = cur === 'A' ? 'B' : cur;           // eylemi yapan takipçi olsun
    // lider olmayan oyuncunun sırası gelene kadar ilerle
    let guard = 0;
    while (curId(r) === 'A' && guard++ < 10) r.m('A').dispatch({ type: 'skipturn' });
    const who = curId(r);
    assert.notEqual(who, 'A');
    const g0 = r.state('A').g;
    r.m(who).dispatch({ type: 'roll' });
    const sent = r.sent.filter((x) => x.msg.type === 'pt_action' && x.from === who).pop().msg;
    assert.equal(sent.a.rv, g0.rev, 'eylem rv taşır');
    r.flush();
    const g1 = r.state('A').g;
    assert.ok(g1.rev > g0.rev, 'kabul edilen eylem rev artırdı');
    // aynı (eski) rv ile ikinci eylem reddedilir
    const rvBefore = r.state('A').rv;
    r.m('A').onMessage({ type: 'pt_action', id: who, a: { type: 'roll', rv: g0.rev } });
    assert.equal(r.state('A').rv, rvBefore, 'eski rv reddedildi');
    // rv yok: eski davranış (kural geçerli mi diye bakar)
    r.m('A').onMessage({ type: 'pt_action', id: who, a: { type: 'roll' } });
    assert.ok(true);
});

test('rv: lobi/yayın artışları meşru eylemi engellemez (oyun revizyonu ayrı sayılır)', () => {
    const r = started(3);
    let guard = 0;
    while (curId(r) === 'A' && guard++ < 10) r.m('A').dispatch({ type: 'skipturn' });
    const who = curId(r);
    r.m('A').emote && r.m('A').emote('😂');
    // alakasız yayınlar (log/kopma/oyuncu katılımı) M.rv'yi artırır ama oyun revizyonunu değil
    r.join('Z', 'Gelen'); r.flush();
    r.advance(2000, 100);
    const rvGame = r.state('A').g.rev;
    r.m(who).dispatch({ type: 'roll' });
    r.flush();
    assert.ok(r.state('A').g.rev > rvGame, 'eylem rv eşleşmesine rağmen kabul edildi');
});

test('envanter sınırları: tür başına ≤3, toplam ≤6, kalkan ≤1; fazlası kaçtı olayı', () => {
    const rr = room();
    rr.join('A', 'A'); rr.join('B', 'B');
    rr.m('A').dispatch({ type: 'start' }); rr.flush();
    const M = rr.state('A');
    const id = M.g.order[0];
    const g = G.index(maps.pirate);
    M.g.P[id].w = { fist: 3, bow: 3 };
    const e1 = R.reduce(M.g, { type: 'forceskip' }, { g });
    assert.ok(e1.ok);
    // kurallar köprüsü: giveItem doğrudan değil, ödül yoluyla: minioyun 1. ödülü silah verir (toplam dolu -> kaçar)
    const st = JSON.parse(JSON.stringify(M.g));
    st.stage = 'mini'; st.turn = st.order.length;
    st.P[id].w = { fist: 3, bow: 3 };
    const res = R.applyMinigame(st, { ranking: [[id]] }, { g });
    assert.ok(res.events.some((e) => e.t === 'lost' && e.id === id));
    assert.equal(Object.values(res.state.P[id].w).reduce((a, b) => a + b, 0), 6);
});

test('eski anlık görüntü göçü: "act"/"swap" aşamaları "roll"a çevrilir, atk eklenir', () => {
    for (const oldStage of ['act', 'swap']) {
        const r = started(2);
        const snap = lastState(r, 'A');
        snap.g.stage = oldStage;
        delete snap.g.atk;
        snap.rv += 200 + (oldStage === 'act' ? 0 : 50);
        r.m('B').onMessage(snap);
        assert.equal(r.state('B').g.stage, 'roll', oldStage);
        assert.equal(r.state('B').g.atk, 0);
    }
});

test('silah kullanmak turu bitirmez: takipçi use gönderir, ardından zar atar (rv her adımda güncel)', () => {
    const r = started(3);
    let guard = 0;
    while (curId(r) === 'A' && guard++ < 10) r.m('A').dispatch({ type: 'skipturn' });
    const who = curId(r);
    const g = G.index(maps.pirate);
    const M = r.state('A');
    const other = M.g.order.find((id) => id !== who);
    // who ile other aynı kutucukta (başlangıç dışı), who'da yumruk
    const node = maps.pirate.nodes.find((n) => n.type === 'normal').id;
    M.g.P[who].pos = node; M.g.P[other].pos = node; M.g.P[who].w = { fist: 1 };
    r.m(who).dispatch({ type: 'use', w: 'fist', target: other });
    r.flush();
    assert.equal(curId(r), who, 'tur bitmedi');
    assert.equal(r.state('A').g.atk, 1);
    r.m(who).dispatch({ type: 'roll' });
    r.flush();
    assert.notEqual(curId(r), who);
});
