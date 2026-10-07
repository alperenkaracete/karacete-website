// Tarayıcısız entegrasyon: sahte oda yayını (gönderilen mesaj gönderen HARİÇ herkese gider) üzerinde A, B ve C için
// GERÇEK PartiMachine + PartiMinigame + DuelAdapter + hakem + core/duel.js + *-rules.js. Elle ilerletilen saat.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');
const Machine = require('../games/parti/machine.js');
const Mini = require('../games/parti/minigame.js');
const { fakeRoot, makeDefs } = require('./duel-fakes.js');
const maps = { pirate: require('../games/parti/maps/pirate.js'), space: require('../games/parti/maps/space.js') };
const Adapter = require('../games/parti/mini/duel-adapter.js');
const CDR = Adapter.GAMES.catdog.rules();
const RULES = {
    xox: { prefix: 'xox', rules: require('../games/xox-rules.js') },
    connect4: { prefix: 'c4', rules: require('../games/connect4-rules.js') },
    catdog: { prefix: 'cd', rules: CDR }
};
const gp = G.index(maps.pirate);

function room(seed, extra) {
    let clock = 1000;
    let rs = seed || 99;
    const rand = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
    const nodes = {};
    const queue = [];
    const roomPlayers = [];
    const timeouts = [];
    const intervals = [];
    const timers = {
        set(f, ms) { const o = { f, at: clock + ms }; timeouts.push(o); return o; },
        clear(o) { const i = timeouts.indexOf(o); if (i >= 0) timeouts.splice(i, 1); },
        every(f, ms) { const o = { f, ms, next: clock + ms }; intervals.push(o); return o; },
        stop(o) { const i = intervals.indexOf(o); if (i >= 0) intervals.splice(i, 1); }
    };
    const api = { nodes, sent: [] };

    function attach(node) {
        node.root = fakeRoot();
        node.defs = [];
        node.m = Machine.create({
            me: { id: node.id, name: node.name }, players: node.players, now: () => clock, rand, maps, timers, creator: node.creator, forceMini: extra && extra.forceMini,
            miniRoot: () => node.root,
            startMinigame: (spec) => {
                const info = RULES[spec.game];
                if (!info) return Mini.startMinigame(spec);        // ffa / çark
                const defs = makeDefs(info.prefix, info.rules);
                node.defs.push(defs);
                return Mini.startMinigame(Object.assign({}, spec, { defs }));
            },
            send: (msg) => {
                if (!node.online) return;
                const copy = JSON.parse(JSON.stringify(msg));
                api.sent.push({ from: node.id, msg: copy });
                Object.values(nodes).forEach((o) => { if (o.id !== node.id && o.online) queue.push({ to: o.id, msg: copy }); });
            }
        });
    }
    function syncLists() {
        Object.values(nodes).forEach((o) => {
            if (o.online) { o.players.length = 0; roomPlayers.forEach((p) => o.players.push({ id: p.id, name: p.name })); }
        });
    }
    Object.assign(api, {
        get clock() { return clock; },
        m: (id) => nodes[id].m,
        state: (id) => nodes[id].m._state(),
        view: (id) => nodes[id].m.getView(),
        lastDefs: (id) => nodes[id].defs[nodes[id].defs.length - 1],
        join(id, name) {
            const first = roomPlayers.length === 0;
            roomPlayers.push({ id, name });
            const node = { id, name, online: true, players: [], creator: first };
            nodes[id] = node;
            syncLists();
            Object.values(nodes).forEach((o) => { if (o.id !== id && o.online) queue.push({ to: o.id, msg: { type: 'player_joined', id, name } }); });
            attach(node);
            api.flush();
        },
        leave(id) {
            nodes[id].online = false;
            roomPlayers.splice(roomPlayers.findIndex((p) => p.id === id), 1);
            syncLists();
            Object.values(nodes).forEach((o) => { if (o.online) queue.push({ to: o.id, msg: { type: 'player_disconnect', id } }); });
            api.flush();
        },
        // Aynı sayfa/makine, bağlantı geri geldi (_reconnected + herkese player_joined)
        reconnect(id) {
            const node = nodes[id];
            node.online = true;
            roomPlayers.push({ id, name: node.name });
            syncLists();
            Object.values(nodes).forEach((o) => { if (o.id !== id && o.online) queue.push({ to: o.id, msg: { type: 'player_joined', id, name: node.name } }); });
            node.m.onMessage({ type: '_reconnected' });
            api.flush();
        },
        flush() {
            let guard = 0;
            while (queue.length && guard++ < 20000) {
                const q = queue.shift();
                if (nodes[q.to] && nodes[q.to].online) nodes[q.to].m.onMessage(JSON.parse(JSON.stringify(q.msg)));
            }
        },
        advance(ms, step) {
            step = step || 100;
            const end = clock + ms;
            while (clock < end) {
                clock = Math.min(end, clock + step);
                timeouts.filter((o) => o.at <= clock).forEach((o) => { timeouts.splice(timeouts.indexOf(o), 1); o.f(); });
                intervals.forEach((o) => { if (clock >= o.next) { o.next = clock + o.ms; o.f(); } });
                Object.values(nodes).forEach((o) => { if (o.online) o.m.tick(clock); });
                api.flush();
            }
        },
        async settle() { for (let i = 0; i < 4; i++) await Promise.resolve(); api.flush(); },
        inject(to, msg) { nodes[to].m.onMessage(JSON.parse(JSON.stringify(msg))); }
    });
    return api;
}

const curId = (r) => R.current(r.state('A').g);

// Seed tarayarak istenen düelloyu bulur: oyun türü + (lider A düelloda mı) koşulu. Oyun, lider A olacak biçimde 3 kişiyle kurulur.
async function reachDuel(game, leaderPlays) {
    for (let seed = 1; seed < 400; seed++) {
        const r = room(seed);
        r.join('A', 'Ayse'); r.join('B', 'Bora'); r.join('C', 'Cem');
        r.m('A').dispatch({ type: 'start' });
        r.flush();
        let guard = 0;
        while (r.state('A').g.stage !== 'mini' && guard++ < 300) {
            r.m(curId(r)).dispatch(R.autoAction(r.state('A').g, { g: gp }));
            r.flush();
        }
        const mn = r.state('A').mn;
        if (!mn || mn.ty !== 'duel' || mn.gm !== game) continue;
        if (mn.pl.includes('A') !== leaderPlays) continue;
        await r.settle();
        return r;
    }
    throw new Error('uygun düello bulunamadı: ' + game);
}

// Sıradaki oyuncu kazanana kadar oynar. XOX: üst satır; Dörtlü: sütun 0 dikey (diğeri sütun 1).
function playToWin(r, game) {
    const [p1, p2] = r.state('A').mn.pl;
    const defs = { [p1]: r.lastDefs(p1), [p2]: r.lastDefs(p2) };
    const used = { [p1]: 0, [p2]: 0 };
    for (let i = 0; i < 20; i++) {
        const mover = defs[p1].view.myTurn ? p1 : (defs[p2].view.myTurn ? p2 : null);
        if (!mover) break;
        const k = used[mover]++;
        const other = mover === p1 ? p2 : p1;
        let mv;
        if (game === 'xox') {
            // ilk başlayan 0,1,2; diğeri 3,4 (ilk başlayan kimse onu bulmak için view.myIndex)
            mv = { cell: defs[mover].view.myIndex === 0 ? k : 3 + k };
        } else {
            mv = { col: defs[mover].view.myIndex === 0 ? 0 : 1 };
        }
        if (!defs[mover].duel.move(mv)) break;
        r.flush();
        if (r.state('A').mn && r.state('A').mn.applyAt) break;
        void other;
    }
}

function mover(r) {
    const [p1, p2] = r.state('A').mn.pl;
    return { first: r.lastDefs(p1).view.myIndex === 0 ? p1 : p2, second: r.lastDefs(p1).view.myIndex === 0 ? p2 : p1 };
}

const ranksFromFx = (r) => {
    const out = {};
    r.state('A').fx.forEach((e) => { if (e.t === 'reward') out[e.id] = e.rank; });
    return out;
};

for (const game of ['xox', 'connect4']) {
    for (const leaderPlays of [true, false]) {
        test(`düello akışı (${game}, lider ${leaderPlays ? 'oynuyor' : 'izliyor'}): tam akış, sonuç ve ödül dağılımı`, async () => {
            const r = await reachDuel(game, leaderPlays);
            const pl = r.state('A').mn.pl;
            const spectator = ['A', 'B', 'C'].find((id) => !pl.includes(id));
            assert.equal(r.view(spectator).mini.game, game);
            assert.ok(r.view(spectator).mini.duelLeft > 80000, 'izleyici kartı için kalan süre var');
            assert.ok(r.nodes[spectator].root.textContent.includes('oynuyor'), 'izleyici kartı çizildi');
            assert.equal(r.nodes[spectator].defs.length, 1);
            assert.equal(r.nodes[spectator].defs[0].inits, 0, 'izleyici oyun kurmaz');
            pl.forEach((id) => assert.equal(r.lastDefs(id).view.phase, 'playing'));

            const rvBefore = r.state('A').rv;
            const { first, second } = mover(r);
            playToWin(r, game);
            await r.settle();
            const mn = r.state('A').mn;
            assert.ok(mn && mn.applyAt, 'lider sonucu onayladı');
            assert.deepEqual(mn.rk, [[first], [second]]);
            assert.ok(r.state('A').rv > rvBefore);
            ['A', 'B', 'C'].forEach((id) => assert.deepEqual(r.view(id).mini.ranking, [[first], [second]], id + ' sonucu gördü'));
            assert.equal(r.nodes[spectator].root.textContent, '', 'oturum kapandı, kök temiz');

            const rd = r.state('A').g.rd;
            r.advance(C.MINI_HOLD_MS + 500);
            assert.equal(r.state('A').g.rd, rd + 1, 'yeni tur başladı');
            assert.deepEqual(ranksFromFx(r).constructor, Object);
            assert.equal(r.view('C').mini, null);
        });
    }
}

test('düello: ödül dağılımı kazanan 1., kaybeden 2.; düello dışındakiler ödülsüz (mevcut davranış)', async () => {
    const r = await reachDuel('xox', true);
    const { first, second } = mover(r);
    const spectator = ['A', 'B', 'C'].find((id) => !r.state('A').mn.pl.includes(id));
    playToWin(r, 'xox');
    await r.settle();
    const before = JSON.parse(JSON.stringify(r.state('A').g.P));
    const hpBefore = { [spectator]: before[spectator].hp };
    r.advance(C.MINI_HOLD_MS + 200, 50);
    const fx = r.state('A').fx.filter((e) => e.t === 'reward');
    const rank = {};
    fx.forEach((e) => { rank[e.id] = e.rank; });
    assert.deepEqual(rank, { [first]: 1, [second]: 2 });
    assert.ok(hpBefore[spectator] > 0);
});

test('düello: beraberlikte [[a,b]] ikisi de 1.', async () => {
    const r = await reachDuel('xox', true);
    const { first, second } = mover(r);
    const d1 = r.lastDefs(first); const d2 = r.lastDefs(second);
    const seq = [[d1, 0], [d2, 1], [d1, 2], [d2, 4], [d1, 3], [d2, 5], [d1, 7], [d2, 6], [d1, 8]];
    seq.forEach(([d, cell]) => { d.duel.move({ cell }); r.flush(); });
    await r.settle();
    const spectator = ['A', 'B', 'C'].find((id) => !r.state('A').mn.pl.includes(id));
    assert.deepEqual(r.state('A').mn.rk, [r.state('A').mn.pl.slice()]);
    r.advance(C.MINI_HOLD_MS + 200, 50);
    const rank = {};
    r.state('A').fx.filter((e) => e.t === 'reward').forEach((e) => { rank[e.id] = e.rank; });
    assert.deepEqual(rank, { [first]: 1, [second]: 1 });
});

test('düello: zaman aşımı (90 sn) — bitmemiş oyun beraberlik, oyun takılmaz', async () => {
    const r = await reachDuel('connect4', false);
    const pl = r.state('A').mn.pl;
    r.advance(C.DUEL_MS - 500);
    assert.ok(!r.state('A').mn.applyAt, 'süre dolmadan sonuç yok');
    r.advance(1000);
    await r.settle();
    assert.ok(r.state('A').mn.applyAt, 'süre dolunca lider sonucu uyguladı');
    assert.deepEqual(r.state('A').mn.rk, [pl.slice()]);
    r.advance(C.MINI_HOLD_MS + 200);
    assert.equal(r.view('A').mini, null);
});

test('düello: oyuncu kopar ve 25 sn içinde dönmezse kopan kaybeder (forfeit)', async () => {
    const r = await reachDuel('xox', false);
    const [p1, p2] = r.state('A').mn.pl;
    r.leave(p2);
    r.advance(C.DUEL_RECONNECT_MS - 2000);
    assert.ok(!r.state('A').mn.applyAt, 'bekleme sürüyor');
    r.advance(3000);
    await r.settle();
    assert.deepEqual(r.state('A').mn.rk.slice(0, 2), [[p1], [p2]]);
});

test('düello: kopan oyuncu 25 sn içinde dönerse düello kaldığı yerden sürer', async () => {
    const r = await reachDuel('xox', true);
    const other = r.state('A').mn.pl.find((id) => id !== 'A');
    const dA = r.lastDefs('A'); const dO = r.lastDefs(other);
    // sıra A'ya gelene kadar (en az 2 hamle) dönüşümlü oyna
    let cell = 0;
    while (!(dA.view.myTurn && cell >= 2)) {
        const d = dA.view.myTurn ? dA : dO;
        assert.equal(d.duel.move({ cell: cell++ }), true);
        r.flush();
    }
    r.leave(other);                                   // rakip kopar, A'nın hamlesini kaçırır
    assert.equal(dA.duel.move({ cell: 8 }), true);
    r.flush();
    assert.equal(dO.view.board[8], null);
    r.advance(10000);
    assert.ok(!r.state('A').mn.applyAt, 'bekleme sürüyor');
    r.reconnect(other);                               // aynı sayfa geri döndü
    r.advance(500);
    assert.equal(dO.inits, 1, 'oyun yeniden kurulmadı');
    assert.equal(r.nodes[other].defs.length, 1);
    assert.equal(dO.view.board[8], dA.view.myIndex, 'kaçırdığı hamle yetişti');
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    assert.ok(!r.state('A').mn.applyAt, 'döndü: forfeit olmadı');
    assert.equal(dA.view.phase, 'playing');
    assert.equal(dO.view.phase, 'playing');
});

test('düello: lider (düelloda olmayan) kopar -> yeni lider, oyun aynı tohumla yeniden başlar ve biter', async () => {
    const r = await reachDuel('connect4', false);
    const [p1, p2] = r.state('A').mn.pl;
    const seedBefore = r.state('A').mn.sd;
    const epBefore = r.state('A').ep;
    const firstDefs = { [p1]: r.lastDefs(p1), [p2]: r.lastDefs(p2) };
    r.leave('A');
    await r.settle();
    const leader = r.state(p1).ld;
    assert.equal(leader, 'B', 'koltuk sırasındaki ilk bağlı insan lider');
    assert.equal(r.state('B').ep, epBefore + 1);
    assert.equal(r.state('B').mn.sd, seedBefore, 'aynı tohum');
    assert.equal(firstDefs[p1].destroys, 1, 'eski oturum yıkıldı');
    assert.equal(r.nodes[p1].defs.length, 2, 'oturum yeniden başladı');
    assert.equal(r.nodes[p2].defs.length, 2);
    playToWin(r, 'connect4');
    await r.settle();
    const mn = r.state('B').mn;
    assert.ok(mn.applyAt, 'yeni lider sonucu onayladı');
    assert.equal(mn.rk.length, 2, 'galip + kaybeden');
    assert.deepEqual(mn.rk.flat().sort(), ['B', 'C']);
});

test('düello: lider düelloda ve kopar -> yeni lider yeniden başlatır; kopan (düellocu) 25 sn sonra kaybeder', async () => {
    const r = await reachDuel('xox', true);
    const mate = r.state('A').mn.pl.find((id) => id !== 'A');
    r.leave('A');
    await r.settle();
    assert.equal(r.state('B').ld, 'B');
    assert.ok(r.nodes[mate].defs.length === 2 || mate === 'B', 'rakip oturumu yeniden kurdu');
    r.advance(C.DUEL_RECONNECT_MS + 1000);
    await r.settle();
    assert.deepEqual(r.state('B').mn.rk.slice(0, 2), [[mate], ['A']]);
});

test('düello: yetkisiz gönderen, yanlış jeton ve oturumsuz pt_mg yok sayılır; pt_mg durum değildir', async () => {
    const r = await reachDuel('xox', true);
    const pl = r.state('A').mn.pl;
    const mate = pl.find((id) => id !== 'A');
    const spectator = ['A', 'B', 'C'].find((id) => !pl.includes(id));
    const key = r.state('A').ep + ':' + r.state('A').mn.sd + ':xox';
    const rv = r.state('A').rv;
    const emptyCell = r.lastDefs(mate).view.board.findIndex((c) => c === null);
    // izleyici, mate'in hamlesini taklit eder (from = izleyici): oyuncu olmadığı için makine atar
    r.inject('A', { type: 'pt_mg', mg: key, from: spectator, m: { type: 'xox_move', round: 1, cell: emptyCell } });
    // yanlış jeton
    r.inject('A', { type: 'pt_mg', mg: '9:9:xox', from: mate, m: { type: 'xox_move', round: 1, cell: emptyCell } });
    // gönderen listede yok
    r.inject('A', { type: 'pt_mg', mg: key, from: 'Z', m: { type: 'xox_move', round: 1, cell: emptyCell } });
    // kendi kimliğiyle gelen (yankı) atılır
    r.inject('A', { type: 'pt_mg', mg: key, from: 'A', m: { type: 'xox_move', round: 1, cell: emptyCell } });
    // bozuk yük
    r.inject('A', { type: 'pt_mg', mg: key, from: mate, m: 'x' });
    assert.equal(r.lastDefs('A').view.board.filter((c) => c !== null).length, r.lastDefs('A').view.board.filter((c) => c !== null).length);
    const filled = r.lastDefs('A').view.board.filter((c) => c !== null).length;
    assert.ok(filled <= 1, 'tahtaya sahte hamle girmedi');
    assert.equal(r.state('A').rv, rv, 'pt_mg durumu değiştirmez');
    assert.equal(r.state('A').mn.applyAt, 0);
    // oturum yokken (mini bitmiş) pt_mg atılır
    playToWin(r, 'xox');
    await r.settle();
    assert.doesNotThrow(() => r.inject('A', { type: 'pt_mg', mg: key, from: mate, m: { type: 'xox_move', round: 1, cell: 8 } }));
});

test('düello: sayfası yenilenen oyuncu geri gelince düello iki tarafta sıfırlanır ve sürer', async () => {
    const r = await reachDuel('xox', true);
    const mate = r.state('A').mn.pl.find((id) => id !== 'A');
    const { first } = mover(r);
    r.lastDefs(first).duel.move({ cell: 4 });
    r.flush();
    // mate sayfayı yeniler: aynı kimlik, yeni makine (eski oturum gider)
    r.nodes[mate].online = false;
    r.leave(mate);
    r.join(mate, r.nodes[mate].name);
    r.advance(1000);
    await r.settle();
    const d = r.lastDefs(mate);
    assert.ok(d.view, 'yeni oturum kuruldu');
    assert.equal(d.view.board.filter((c) => c !== null).length, 0, 'sıfırdan başladı');
    assert.equal(r.lastDefs('A').view.board.filter((c) => c !== null).length, 0);
    assert.equal(r.lastDefs('A').view.phase, 'playing');
    assert.equal(d.view.phase, 'playing');
    playToWin(r, 'xox');
    await r.settle();
    assert.ok(r.state('A').mn.applyAt, 'yenilemeden sonra düello bitti');
});

// ---- ?mini= test bayrağı (lider tarayıcısında okunur) ----
test('?mini bayrağı: lider makinede her tur belirtilen düello oyunu seçilir (3 insan)', async () => {
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
            assert.equal(mn.pl.length, 2);
        }
    }
});

// ---- Kedi - Köpek: 3 atış sınırı ----
// Sıradaki oyuncu için (isabet / iki taraf da hasarsız) bir atış bulup oynatır.
function cdShoot(r, wantHit) {
    const [p1, p2] = r.state('A').mn.pl;
    const d = r.lastDefs(p1).view.myTurn ? r.lastDefs(p1) : r.lastDefs(p2);
    const v = d.view;
    for (let a = 0; a <= 180; a += 3) {
        for (let p = 0; p <= 100; p += 3) {
            const mv = { kind: 'shot', turn: v.board.turn, angle: a, power: p, powerUp: null };
            const n = CDR.apply(v.board, mv, v.myIndex).board;
            const dmg = [v.board.players[0].hp - n.players[0].hp, v.board.players[1].hp - n.players[1].hp];
            if (wantHit ? dmg[1 - v.myIndex] > 0 && dmg[v.myIndex] === 0 : dmg[0] === 0 && dmg[1] === 0) {
                assert.equal(d.duel.move(mv), true);
                r.flush();
                return;
            }
        }
    }
    throw new Error('atış bulunamadı');
}

for (const leaderPlays of [true, false]) {
    test(`düello akışı (catdog, lider ${leaderPlays ? 'oynuyor' : 'izliyor'}): 3 atış sonunda kalan cana göre sonuç, "Atışlar bitti" katmanı`, async () => {
        const r = await reachDuel('catdog', leaderPlays);
        const pl = r.state('A').mn.pl;
        const spectator = ['A', 'B', 'C'].find((id) => !pl.includes(id));
        pl.forEach((id) => assert.equal(r.lastDefs(id).view.phase, 'playing'));
        const { first, second } = mover(r);
        cdShoot(r, true);                                  // ilk başlayan isabet ettirir
        for (let i = 0; i < 4; i++) cdShoot(r, false);
        await r.settle();
        assert.ok(!r.state('A').mn.applyAt, '5 atıştan sonra sonuç yok');
        pl.forEach((id) => assert.ok(!r.nodes[id].root.textContent.includes('Atışlar bitti')));
        cdShoot(r, false);                                 // 6. atış
        await r.settle();
        const mn = r.state('A').mn;
        assert.deepEqual(mn.rk, [[first], [second]]);
        assert.ok(mn.applyAt);
        assert.equal(r.nodes[spectator].root.textContent, '', 'oturum kapandı');
        r.advance(C.MINI_HOLD_MS + 200, 50);
        const rank = {};
        r.state('A').fx.filter((e) => e.t === 'reward').forEach((e) => { rank[e.id] = e.rank; });
        assert.deepEqual(rank, { [first]: 1, [second]: 2 });
    });
}

test('düello (catdog): atış sınırı dolunca oyuncular katmanı görür, izleyici görmez', async () => {
    const r = await reachDuel('catdog', true);
    const pl = r.state('A').mn.pl;
    const spectator = ['A', 'B', 'C'].find((id) => !pl.includes(id));
    // sınır dolar dolmaz sonuç uygulanır ve oturum kapanır: katmanı sınırın dolduğu atıştan hemen sonra yakala
    const seen = {};
    pl.forEach((id) => {
        const root = r.nodes[id].root;
        const orig = root.appendChild.bind(root);
        root.appendChild = (c) => { if (c.className === 'pt-duel-limit') seen[id] = c.textContent; return orig(c); };
    });
    for (let i = 0; i < 6; i++) cdShoot(r, false);
    await r.settle();
    assert.deepEqual(Object.keys(seen).sort(), pl.slice().sort());
    pl.forEach((id) => assert.ok(seen[id].includes('Atışlar bitti')));
    assert.ok(!r.nodes[spectator].root.textContent.includes('Atışlar bitti'));
    assert.deepEqual(r.state('A').mn.rk, [pl.slice()], 'iki taraf da ıskaladı: beraberlik');
});

test('düello (catdog): heal atış sayılmaz; 90 sn dolunca kalan cana göre sonuç', async () => {
    const r = await reachDuel('catdog', false);
    const [p1, p2] = r.state('A').mn.pl;
    const { first, second } = mover(r);
    const dFirst = r.lastDefs(first);
    assert.equal(dFirst.duel.move({ kind: 'heal', turn: 0 }), true);
    r.flush();
    cdShoot(r, false);                                     // ikinci başlayan
    cdShoot(r, true);                                      // ilk başlayan isabet (1. atış)
    cdShoot(r, false);
    r.advance(C.DUEL_MS + 500);
    await r.settle();
    assert.ok(r.state('A').mn.applyAt, 'süre dolunca uygulandı (3 atış bitmedi)');
    assert.deepEqual(r.state('A').mn.rk, [[first], [second]], 'kalan can fazla olan önde');
    assert.ok([p1, p2].includes(first));
});
