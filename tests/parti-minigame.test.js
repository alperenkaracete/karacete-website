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

test('parseMiniFlag: duel, duel:<oyun>, geçersiz/yok', () => {
    assert.deepEqual(R.parseMiniFlag('?mini=duel'), { game: null });
    assert.deepEqual(R.parseMiniFlag('?x=1&mini=duel:catdog'), { game: 'catdog' });
    assert.deepEqual(R.parseMiniFlag('?mini=duel%3Axox&debug=1'), { game: 'xox' });
    assert.deepEqual(R.parseMiniFlag('?mini=duel:connect4#a'), { game: 'connect4' });
    assert.equal(R.parseMiniFlag('?mini=duel:yok'), null);
    assert.equal(R.parseMiniFlag('?mini=ffa'), null);
    assert.equal(R.parseMiniFlag('?mini=%E0%A4%A'), null, 'bozuk kodlama');
    assert.equal(R.parseMiniFlag(''), null);
    assert.equal(R.parseMiniFlag(undefined), null);
    assert.equal(R.parseMiniFlag('?xmini=duel'), null);
});

test('minigameSpec bayrağı: ≥2 insanda her tur düello; <2 insanda yok; bayraksız %30 davranışı aynı', () => {
    const g = G.index(require('../games/parti/maps/space.js'));
    const mk = (seed, seats) => R.createGame({ seed, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats }, { g: g });
    const humans = [seat('h1', 0), seat('h2', 1), seat('b1', 2, true)];
    let plain = 0;
    for (let seed = 1; seed < 400; seed++) {
        const st = mk(seed, humans);
        st.stage = 'mini';
        const copy = () => JSON.parse(JSON.stringify(st));
        const none = R.minigameSpec(copy(), { g: g });
        assert.deepEqual(none, R.minigameSpec(copy(), { g: g, mini: null }), 'mini: null = bayrak yok');
        if (none.type === 'duel') plain++;
        const any = R.minigameSpec(copy(), { g: g, mini: { game: null } });
        assert.equal(any.type, 'duel');
        assert.ok(C.DUEL_GAMES.includes(any.game));
        const cd = R.minigameSpec(copy(), { g: g, mini: { game: 'catdog' } });
        assert.equal(cd.type, 'duel');
        assert.equal(cd.game, 'catdog');
        assert.deepEqual(cd.players.slice().sort(), ['h1', 'h2'], 'botlar seçilmez');
        assert.equal(cd.seed, none.seed, 'tohum aynı çekilişten');
        if (none.type === 'duel') assert.deepEqual(cd.players, none.players, 'bayrak çekiliş sırasını bozmaz');
    }
    assert.ok(plain > 400 * 0.2 && plain < 400 * 0.4, 'bayraksız oran ≈ %30: ' + plain);
    // tek insan: bayrak olsa da düello yok
    for (let seed = 1; seed < 50; seed++) {
        const st = mk(seed, [seat('h1', 0), seat('b1', 1, true), seat('b2', 2, true)]);
        assert.equal(R.minigameSpec(st, { g: g, mini: { game: 'xox' } }).type, 'ffa');
    }
});

test('minigameSpec: 2–7 insanla çiftler ve extra (tohumlu, deterministik, herkes tam bir yerde)', () => {
    const g = G.index(require('../games/parti/maps/space.js'));
    for (let n = 2; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => 'h' + i);
        const seats = ids.map((id, i) => seat(id, i)).concat([seat('bot', 7, true)]);       // bot hep var
        let duels = 0;
        const firstPairs = new Set();
        for (let seed = 1; seed < 300; seed++) {
            const st = R.createGame({ seed, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats }, { g: g });
            st.stage = 'mini';
            const copy = JSON.parse(JSON.stringify(st));
            const spec = R.minigameSpec(st, { g: g, mini: { game: null } });          // bayrak: her tur düello
            assert.deepEqual(spec, R.minigameSpec(copy, { g: g, mini: { game: null } }), 'deterministik');
            assert.equal(spec.type, 'duel');
            duels++;
            assert.equal(spec.pairs.length, Math.floor(n / 2));
            assert.equal(spec.extra === null, n % 2 === 0);
            const all = spec.pairs.flat().concat(spec.extra === null ? [] : [spec.extra]);
            assert.deepEqual(all.slice().sort(), ids.slice().sort(), n + ' insan: herkes tam bir kez, bot yok');
            assert.deepEqual(spec.players, spec.pairs[0]);
            assert.ok(C.DUEL_GAMES.includes(spec.game));
            firstPairs.add(spec.pairs[0].join('-'));
        }
        assert.equal(duels, 299);
        if (n >= 3) assert.ok(firstPairs.size > 1, 'çiftleme tohuma göre değişiyor');
    }
});

test('minigameSpec: 1 insan -> çark; bayraksız 3+ insanda da %30 civarı düello ve geçerli çiftler', () => {
    const g = G.index(require('../games/parti/maps/space.js'));
    const seats = [seat('h1', 0), seat('h2', 1), seat('h3', 2), seat('h4', 3), seat('h5', 4)];
    let duels = 0;
    for (let seed = 1; seed < 400; seed++) {
        const st = R.createGame({ seed, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats }, { g: g });
        st.stage = 'mini';
        const spec = R.minigameSpec(st, { g: g });
        if (spec.type === 'duel') {
            duels++;
            assert.equal(spec.pairs.length, 2);
            assert.ok(spec.extra);
        } else {
            assert.equal(spec.pairs, undefined);
        }
    }
    assert.ok(duels > 400 * 0.2 && duels < 400 * 0.4, 'oran ≈ %30: ' + duels);
    const one = R.createGame({ seed: 3, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats: [seat('h1', 0), seat('b1', 1, true), seat('b2', 2, true)] }, { g: g });
    assert.equal(R.minigameSpec(one, { g: g, mini: { game: null } }).type, 'ffa');
});
