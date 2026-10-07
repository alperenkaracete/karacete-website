const test = require('node:test');
const assert = require('node:assert/strict');
const Mini = require('../games/parti/minigame.js');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');

test('sözleşme: ffa ve eksik alanlı düello (eski çağrı biçimi) çark sonucu verir', async () => {
    const a = await Mini.startMinigame({ type: 'ffa', players: ['a', 'b', 'c'], seed: 5 });
    assert.deepEqual(a.ranking.map((g) => g.length), [1, 1, 1]);
    assert.deepEqual(a.ranking.flat().sort(), ['a', 'b', 'c']);
    const d = await Mini.startMinigame({ type: 'duel', players: ['a', 'b'], seed: 5 });
    assert.deepEqual(d, { ranking: Mini.wheelRanking({ players: ['a', 'b'], seed: 5 }) });
});

test('sözleşme: bilinmeyen oyun / kök-ağ yok -> çark yedek', async () => {
    const base = { type: 'duel', players: ['a', 'b'], seed: 9, me: { id: 'a', name: 'A' }, net: { send() {}, on: () => () => {} } };
    const unknown = await Mini.startMinigame(Object.assign({ game: 'yok', root: {} }, base));
    assert.deepEqual(unknown.ranking, Mini.wheelRanking(base));
    const noRoot = await Mini.startMinigame(Object.assign({ game: 'xox' }, base));
    assert.deepEqual(noRoot.ranking, Mini.wheelRanking(base));
});

test('sözleşme: oyun tanımı kurulamazsa çark (takılmaz)', async () => {
    const root = { ownerDocument: {}, classList: { add() {} }, textContent: '' };
    const res = await Mini.startMinigame({
        type: 'duel', game: 'xox', players: ['a', 'b'], seed: 3, me: { id: 'a', name: 'A' }, isLeader: true, leader: 'a', root,
        net: { send() {}, on: () => () => {} }, deadlineMs: 1000,
        defs: { init() { throw new Error('bozuk'); }, onMessage() {}, destroy() {} }
    });
    assert.deepEqual(res.ranking, Mini.wheelRanking({ players: ['a', 'b'], seed: 3 }));
});

test('sözleşme: signal iptali Promise\'i aborted ile bitirir', async () => {
    const ac = new AbortController();
    const root = { ownerDocument: {}, classList: { add() {} }, textContent: 'x' };
    const p = Mini.startMinigame({
        type: 'duel', game: 'xox', players: ['a', 'b'], seed: 3, me: { id: 'a', name: 'A' }, isLeader: true, leader: 'a', root,
        net: { send() {}, on: () => () => {} }, deadlineMs: 1000, signal: ac.signal,
        defs: { init() {}, onMessage() {}, destroy() {} }
    });
    ac.abort();
    assert.deepEqual(await p, { ranking: null, aborted: true });
    assert.equal(root.textContent, '');
});

const seat = (id, i, bot) => ({ id, name: id, av: C.AVATARS[i], t: 0, bot: !!bot });

test('minigameSpec: düello yalnız insanlar arasında, hazır oyunlardan, deterministik', () => {
    const g = G.index(require('../games/parti/maps/space.js'));
    const seen = {};
    for (let seed = 1; seed < 400; seed++) {
        const st = R.createGame({ seed, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats: [seat('h1', 0), seat('h2', 1), seat('b1', 2, true), seat('h3', 3)] }, { g: g });
        st.stage = 'mini';
        const copy = JSON.parse(JSON.stringify(st));      // Rng durumu ilerletir: karşılaştırma için kopya
        const spec = R.minigameSpec(st, { g: g });
        assert.deepEqual(spec, R.minigameSpec(copy, { g: g }), 'aynı durumdan aynı belirtim');
        if (spec.type === 'duel') {
            seen[spec.game] = true;
            assert.ok(C.DUEL_GAMES.includes(spec.game));
            assert.equal(spec.players.length, 2);
            assert.ok(!spec.players.includes('b1'), 'bot düelloya seçilmez');
            assert.notEqual(spec.players[0], spec.players[1]);
        } else {
            assert.equal(spec.game, undefined);
        }
    }
    assert.deepEqual(Object.keys(seen).sort(), ['catdog', 'connect4', 'xox'], 'üç oyun da seçilebiliyor');
});

test('minigameSpec: tek insan + botlar -> düello yok', () => {
    const g = G.index(require('../games/parti/maps/space.js'));
    for (let seed = 1; seed < 100; seed++) {
        const st = R.createGame({ seed, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats: [seat('h1', 0), seat('b1', 1, true), seat('b2', 2, true)] }, { g: g });
        assert.equal(R.minigameSpec(st, { g: g }).type, 'ffa');
    }
});
