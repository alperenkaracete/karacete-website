// Düello entegrasyon testleri için ortak oda: sahte oda yayını (gönderilen mesaj gönderen HARİÇ herkese gider) üzerinde
// GERÇEK PartiMachine + PartiMinigame + DuelAdapter + hakem + core/duel.js + *-rules.js. Elle ilerletilen saat.
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
const N = C.DUEL_CATDOG_SHOTS;
const MAXHOLD = C.duelHold('catdog', 'limit');   // en uzun sonuç tutma

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
const NAMES = ['Ayse', 'Bora', 'Cem', 'Deniz', 'Ece', 'Fatih', 'Gul', 'Hakan'];
const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Seed tarayarak istenen düelloyu bulur. opts: { humans (varsayılan 2), bots (0), pred(mn) } — lider her zaman A.
async function reachDuel(game, opts) {
    opts = opts || {};
    const humans = opts.humans || 2;
    for (let seed = 1; seed < 600; seed++) {
        const r = room(seed, opts.extra);
        for (let i = 0; i < humans; i++) r.join(IDS[i], NAMES[i]);
        for (let i = 0; i < (opts.bots || 0); i++) r.m('A').dispatch({ type: 'bot_add' });
        r.flush();
        r.m('A').dispatch({ type: 'start' });
        r.flush();
        let guard = 0;
        while (r.state('A').g.stage !== 'mini' && guard++ < 300) {
            r.m(curId(r)).dispatch(R.autoAction(r.state('A').g, { g: gp }));
            r.flush();
        }
        const mn = r.state('A').mn;
        if (!mn || mn.ty !== 'duel' || (game && mn.gm !== game)) continue;
        if (opts.pred && !opts.pred(mn)) continue;
        await r.settle();
        return r;
    }
    throw new Error('uygun düello bulunamadı: ' + game);
}

const pairOf = (r, i) => r.state('A').mn.pm[i].p;

// i. maçı oynayıp ilk başlayanı kazandırır. XOX: üst satır; Dörtlü: sütun 0 dikey (diğeri sütun 1).
function playToWin(r, game, i) {
    i = i || 0;
    const [p1, p2] = pairOf(r, i);
    const defs = { [p1]: r.lastDefs(p1), [p2]: r.lastDefs(p2) };
    const used = { [p1]: 0, [p2]: 0 };
    for (let n = 0; n < 20; n++) {
        const mv0 = defs[p1].view.myTurn ? p1 : (defs[p2].view.myTurn ? p2 : null);
        if (!mv0) break;
        const k = used[mv0]++;
        const mv = game === 'xox'
            ? { cell: defs[mv0].view.myIndex === 0 ? k : 3 + k }
            : { col: defs[mv0].view.myIndex === 0 ? 0 : 1 };
        if (!defs[mv0].duel.move(mv)) break;
        r.flush();
        const x = r.state('A').mn && r.state('A').mn.pm[i];
        if (!x || x.out) break;
    }
}

// i. maçta ilk/ikinci başlayan
function mover(r, i) {
    i = i || 0;
    const [p1, p2] = pairOf(r, i);
    return { first: r.lastDefs(p1).view.myIndex === 0 ? p1 : p2, second: r.lastDefs(p1).view.myIndex === 0 ? p2 : p1 };
}

// i. maçta sıradaki oyuncu için (isabet / iki taraf da hasarsız) bir atış bulup oynatır
function cdShoot(r, wantHit, i) {
    i = i || 0;
    const [p1, p2] = pairOf(r, i);
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

const rewardsFromFx = (r, id) => {
    const out = {};
    r.state(id || 'A').fx.filter((e) => e.t === 'reward').forEach((e) => { out[e.id] = e.rank; });
    return out;
};

module.exports = { room, curId, reachDuel, pairOf, playToWin, mover, cdShoot, rewardsFromFx, gp, N, MAXHOLD, RULES, CDR, IDS, NAMES };
