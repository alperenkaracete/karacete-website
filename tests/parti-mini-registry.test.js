// Minioyun kaydı (mini/registry.js) + oyun-türü tabanlı seçim: şema, eşit dağılım, tekrar yok, çark yalnız acil yedek,
// state.lm (son OYNANAN oyun) yalnız applyMinigame'de yazılır.
const test = require('node:test');
const assert = require('node:assert/strict');
const Registry = require('../games/parti/mini/registry.js');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');

const space = G.index(require('../games/parti/maps/space.js'));
const seat = (id, i, bot) => ({ id, name: id, av: C.AVATARS[i], t: 0, bot: !!bot });
const mk = (seed, seats) => { const st = R.createGame({ seed, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats }, { g: space }); st.stage = 'mini'; return st; };
const humansAndBot = [seat('h1', 0), seat('h2', 1), seat('h3', 2), seat('b1', 3, true)];
const oneHuman = [seat('h1', 0), seat('b1', 1, true), seat('b2', 2, true)];

test('registry: şema, beş oyun, tür ve sınırlar; config.DUEL_GAMES registry\'den türer', () => {
    assert.deepEqual(Registry.GAMES.map((g) => g.id), ['xox', 'connect4', 'catdog', 'kurbaga', 'dusenzemin']);
    Registry.GAMES.forEach((g) => {
        assert.equal(typeof g.name, 'string');
        assert.equal(typeof g.icon, 'string');
        assert.ok(Registry.KINDS.includes(g.kind), g.id);
        assert.ok(g.min >= 1 && g.max >= g.min, g.id);
        assert.equal(g.weight, 1, g.id);
    });
    assert.deepEqual(Registry.ids('duel'), ['xox', 'connect4', 'catdog']);
    assert.deepEqual(Registry.ids('ffa'), ['kurbaga', 'dusenzemin']);
    assert.ok(Registry.KINDS.includes('grup'), 'grup şemada tanımlı');
    assert.deepEqual(C.DUEL_GAMES, Registry.ids('duel'));
    assert.equal(Registry.get('kurbaga').kind, 'ffa');
    assert.equal(Registry.get('yok'), null);
});

test('registry.eligible: düello ≥2 İNSAN ister; ffa 1 insanla da; grup hiç seçilmez', () => {
    assert.deepEqual(Registry.eligible(0).map((g) => g.id), []);
    assert.deepEqual(Registry.eligible(1).map((g) => g.id), ['kurbaga', 'dusenzemin']);
    assert.deepEqual(Registry.eligible(2).map((g) => g.id), ['xox', 'connect4', 'catdog', 'kurbaga', 'dusenzemin']);
    const grup = { id: 'grupdeneme', name: 'G', icon: 'G', kind: 'grup', min: 1, max: 8, weight: 1 };
    Registry.GAMES.push(grup);
    try {
        assert.ok(!Registry.eligible(5).some((g) => g.id === 'grupdeneme'));
        for (let seed = 1; seed < 200; seed++) assert.notEqual(R.minigameSpec(mk(seed, humansAndBot), { g: space }).game, 'grupdeneme');
    } finally { Registry.GAMES.pop(); }
});

// Rasgele tohumlar yerine tek durum üzerinde ardışık çekiliş (gerçek oyundaki gibi rs ilerler); oynanan oyun lm'ye yazılır
function sweep(seats, n) {
    const st = mk(7, seats);
    const counts = {};
    const seq = [];
    for (let i = 0; i < n; i++) {
        const spec = R.minigameSpec(st, { g: space });
        counts[spec.game] = (counts[spec.game] || 0) + 1;
        seq.push(spec.game);
        st.lm = spec.game;                      // applyMinigame'in yaptığı
    }
    return { counts, seq };
}

test('dağılım: 2+ insanda beş oyun ≈ %20 (düello 3/5, ffa 2/5; üst üste tekrar yok); 1 insanda iki ffa oyunu ≈ %50/%50', () => {
    const N = 10000;
    const a = sweep(humansAndBot, N);
    ['xox', 'connect4', 'catdog', 'kurbaga', 'dusenzemin'].forEach((id) => {
        const p = a.counts[id] / N;
        assert.ok(p > 0.17 && p < 0.23, id + ' oranı ' + p.toFixed(3));
    });
    const duel = (a.counts.xox + a.counts.connect4 + a.counts.catdog) / N;
    assert.ok(duel > 0.55 && duel < 0.65, 'düello 3/5: ' + duel.toFixed(3));
    for (let i = 1; i < a.seq.length; i++) assert.notEqual(a.seq[i], a.seq[i - 1], 'üst üste aynı oyun: ' + i);
    const b = sweep(oneHuman, 4000);
    assert.deepEqual(Object.keys(b.counts).sort(), ['dusenzemin', 'kurbaga']);
    ['kurbaga', 'dusenzemin'].forEach((id) => {
        const p = b.counts[id] / 4000;
        assert.ok(p > 0.45 && p < 0.55, id + ' tek insanda ' + p.toFixed(3));
    });
    assert.ok(b.seq.some((x, i) => i && x === b.seq[i - 1]), 'havuz ≤2: önceki oyun hariç tutulmaz, aynı oyun üst üste gelebilir');
});

test('spec saf: lm minigameSpec içinde yazılmaz; applyMinigame oynanan oyunu yazar; çark yedeği lm\'yi değiştirmez', () => {
    const st = mk(11, humansAndBot);
    const spec = R.minigameSpec(st, { g: space });
    assert.equal(st.lm, undefined, 'spec lm yazmadı');
    const done = R.applyMinigame(st, { ranking: [st.order.slice()], game: spec.game }, { g: space }).state;
    assert.equal(done.lm, spec.game);
    const st2 = mk(12, humansAndBot);
    st2.lm = 'xox';
    const wheel = R.applyMinigame(st2, { ranking: [st2.order.slice()] }, { g: space }).state;
    assert.equal(wheel.lm, 'xox', 'çark yedeği (game yok) lm\'yi bozmaz');
    const bogus = R.applyMinigame(mk(13, humansAndBot), { ranking: [], game: 'olmayan' }, { g: space }).state;
    assert.equal(bogus.lm, undefined, 'kayıtta olmayan oyun yazılmaz');
});

test('tam akış: havuz>2 iken applyMinigame zinciri üst üste aynı oyunu getirmez (lm durumda taşınır)', () => {
    let st = mk(21, humansAndBot);
    let prev = null;
    for (let i = 0; i < 300; i++) {
        const spec = R.minigameSpec(st, { g: space });
        if (prev) assert.notEqual(spec.game, prev, 'tur ' + i);
        prev = spec.game;
        st = R.applyMinigame(st, { ranking: [st.order.slice()], game: spec.game }, { g: space }).state;
        assert.equal(st.lm, spec.game);
        st = JSON.parse(JSON.stringify(st));          // pt_state gibi seri hale gidip gelir: lm kaybolmaz
        st.stage = 'mini';
    }
});

test('çark yalnız acil yedek: uygun oyun yoksa game:null; bayrak uygun değilse yok sayılır', () => {
    const botsOnly = mk(5, [seat('b1', 0, true), seat('b2', 1, true)]);
    assert.equal(R.minigameSpec(botsOnly, { g: space }).game, null);
    assert.equal(R.minigameSpec(botsOnly, { g: space }).type, 'ffa');
    const st = mk(6, oneHuman);
    assert.ok(['kurbaga', 'dusenzemin'].includes(R.minigameSpec(st, { g: space, mini: { game: 'catdog' } }).game), 'düello bayrağı 1 insanda yok sayılır (ffa havuzu)');
    const two = mk(7, humansAndBot);
    two.lm = 'xox';
    assert.equal(R.minigameSpec(two, { g: space, mini: { game: 'xox' } }).game, 'xox', 'bayrakla tek oyun: havuz 1 olduğundan lm hariç tutulmaz');
});

// ---- Makine: lm pt_state ile taşınır, lider devrinde kaybolmaz ----
const { reachDuel, playToWin, MAXHOLD } = require('./duel-room.js');

test('makine: oynanan düello lm olarak herkese yayılır ve lider devrinde korunur', async () => {
    const r = await reachDuel('xox');
    playToWin(r, 'xox', 0);
    await r.settle();
    r.advance(MAXHOLD + C.MINI_HOLD_MS + 500, 100);
    assert.equal(r.state('A').g.stage, 'roll', 'yeni tur başladı');
    ['A', 'B'].forEach((id) => assert.equal(r.state(id).g.lm, 'xox', id));
    r.leave('A');                                         // lider düştü: B devralır
    r.advance(5000, 100);
    assert.equal(r.state('B').ld, 'B');
    assert.equal(r.state('B').g.lm, 'xox', 'lm lider devrinde kaybolmadı');
});
