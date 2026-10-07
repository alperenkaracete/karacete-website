// Parti: başsız bot simülasyonu (denge ölçümü). Yalnızca public kural API'sini kullanır.
//   node tests/parti-sim.js [oyunSayısı] [harita]      -> 2/4/8 kişi için tablo
// Koltuk = başta karıştırılan ilk tur sırası (0 = ilk oynayan).
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');
const Mini = require('../games/parti/minigame.js');
const maps = { pirate: require('../games/parti/maps/pirate.js'), space: require('../games/parti/maps/space.js') };

function simulate(opts) {
    const n = opts.players;
    const games = opts.games || 50;
    const mapId = opts.map || 'pirate';
    const g = G.index(maps[mapId]);
    const wins = new Array(n).fill(0);
    const rounds = [];
    let unfinished = 0;
    let deaths = 0;
    let selfBombs = 0;
    for (let k = 0; k < games; k++) {
        const seats = [];
        for (let i = 0; i < n; i++) seats.push({ id: 'p' + i, name: 'P' + i, av: 'x', t: Math.floor(i / 2), bot: true });
        const cfg = { mode: 'solo', goal: opts.goal || 0, map: mapId };      // goal 0 = otomatik (2-3 kişi 15, 4-8 kişi 10)
        let st = R.createGame({ seed: (opts.seed || 1000) + k * 7919, cfg: cfg, seats: seats }, { g: g });
        const firstOrder = st.order.slice();
        let steps = 0;
        while (st.stage !== 'over' && steps++ < 20000) {
            if (st.stage === 'mini') {
                const spec = R.minigameSpec(st, { g: g });
                st = R.applyMinigame(st, { ranking: Mini.wheelRanking(spec) }, { g: g }).state;
                continue;
            }
            const a = R.botAction(st, { g: g });
            const r = R.reduce(st, a, { g: g });
            if (!r.ok) throw new Error('bot eylemi reddedildi: ' + r.error);
            r.events.forEach(function (e) {
                if (e.t === 'death') deaths++;
                if (e.t === 'attack' && e.node !== undefined && st.P[e.id] && st.P[e.id].pos === e.node) selfBombs++;
            });
            st = r.state;
        }
        if (st.stage !== 'over' || !st.winner) { unfinished++; continue; }
        wins[firstOrder.indexOf(st.winner.id)]++;
        rounds.push(st.rd);
    }
    const done = rounds.length || 1;
    rounds.sort(function (a, b) { return a - b; });
    return {
        players: n, games: games, unfinished: unfinished,
        avgRounds: rounds.reduce(function (a, b) { return a + b; }, 0) / done,
        medianRounds: rounds[Math.floor(rounds.length / 2)] || 0, maxRounds: rounds[rounds.length - 1] || 0,
        winShare: wins.map(function (w) { return w / done; }),
        deathsPerGame: deaths / done, selfBombs: selfBombs
    };
}

function format(res) {
    return '| ' + res.players + ' | ' + res.avgRounds.toFixed(1).replace('.', ',') + ' (' + res.medianRounds + '/' + res.maxRounds + ') | ' +
        res.winShare.map(function (s) { return '%' + Math.round(s * 100); }).join(' ') + ' | ' +
        res.deathsPerGame.toFixed(1).replace('.', ',') + ' | ' + res.selfBombs + ' |';
}

if (require.main === module) {
    const games = Number(process.argv[2]) || 240;
    const map = process.argv[3] || 'pirate';
    const goal = Number(process.argv[4]) || 0;            // 0 = otomatik
    console.log('| Kişi | Ort. tur (medyan/maks) | Koltuk sırasına göre kazanma | Ölüm/oyun | Botun kendini bombalaması |');
    console.log('|---|---|---|---|---|');
    [2, 4, 8].forEach(function (n) { console.log(format(simulate({ players: n, games: games, map: map, goal: goal, seed: 1000 }))); });
}

module.exports = { simulate: simulate, format: format };
