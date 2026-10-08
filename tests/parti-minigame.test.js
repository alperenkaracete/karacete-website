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

const SP = () => G.index(require('../games/parti/maps/space.js'));
const mkState = (seed, seats) => { const st = R.createGame({ seed, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats }, { g: SP() }); st.stage = 'mini'; return st; };
const clone = (x) => JSON.parse(JSON.stringify(x));

test('minigameSpec: düello yalnız insanlar arasında, hazır oyunlardan, deterministik; ffa oyunları da seçilir', () => {
    const g = SP();
    const seen = {};
    for (let seed = 1; seed < 400; seed++) {
        const st = mkState(seed, [seat('h1', 0), seat('h2', 1), seat('b1', 2, true), seat('h3', 3)]);
        const copy = clone(st);      // Rng durumu ilerletir: karşılaştırma için kopya
        const spec = R.minigameSpec(st, { g: g });
        assert.deepEqual(spec, R.minigameSpec(copy, { g: g }), 'aynı durumdan aynı belirtim');
        seen[spec.game] = true;
        if (spec.type === 'duel') {
            assert.ok(C.DUEL_GAMES.includes(spec.game));
            assert.equal(spec.players.length, 2);
            assert.ok(!spec.players.includes('b1'), 'bot düelloya seçilmez');
            assert.notEqual(spec.players[0], spec.players[1]);
        } else {
            assert.equal(spec.type, 'ffa');
            assert.ok(['kurbaga', 'dusenzemin'].includes(spec.game));
            assert.deepEqual(spec.players, st.order, 'ffa: botlar dahil herkes');
        }
    }
    assert.deepEqual(Object.keys(seen).sort(), ['catdog', 'connect4', 'dusenzemin', 'kurbaga', 'xox'], 'beş oyun da seçilebiliyor');
});

test('minigameSpec: tek insan + botlar -> düello yok, ffa oyunlarından biri (çark değil)', () => {
    const g = SP();
    for (let seed = 1; seed < 100; seed++) {
        const st = mkState(seed, [seat('h1', 0), seat('b1', 1, true), seat('b2', 2, true)]);
        const spec = R.minigameSpec(st, { g: g });
        assert.equal(spec.type, 'ffa');
        assert.ok(['kurbaga', 'dusenzemin'].includes(spec.game));
    }
});

test('parseMiniFlag: oyun kimliği, duel, duel:<oyun>, geçersiz/yok', () => {
    assert.deepEqual(R.parseMiniFlag('?mini=duel'), { game: null });
    assert.deepEqual(R.parseMiniFlag('?x=1&mini=duel:catdog'), { game: 'catdog' });
    assert.deepEqual(R.parseMiniFlag('?mini=duel%3Axox&debug=1'), { game: 'xox' });
    assert.deepEqual(R.parseMiniFlag('?mini=duel:connect4#a'), { game: 'connect4' });
    assert.deepEqual(R.parseMiniFlag('?mini=kurbaga'), { game: 'kurbaga' });
    assert.deepEqual(R.parseMiniFlag('?mini=dusenzemin'), { game: 'dusenzemin' });
    assert.deepEqual(R.parseMiniFlag('?mini=xox'), { game: 'xox' });
    assert.deepEqual(R.parseMiniFlag('?a=1&mini=catdog&b=2'), { game: 'catdog' });
    assert.deepEqual(R.parseMiniFlag('?mini=connect4'), { game: 'connect4' });
    assert.equal(R.parseMiniFlag('?mini=duel:yok'), null);
    assert.equal(R.parseMiniFlag('?mini=duel:kurbaga'), null, 'kurbağa düello değildir');
    assert.equal(R.parseMiniFlag('?mini=ffa'), null);
    assert.equal(R.parseMiniFlag('?mini=%E0%A4%A'), null, 'bozuk kodlama');
    assert.equal(R.parseMiniFlag(''), null);
    assert.equal(R.parseMiniFlag(undefined), null);
    assert.equal(R.parseMiniFlag('?xmini=duel'), null);
});

test('minigameSpec bayrağı: havuzu o oyuna indirir; uygun değilse yok sayılır; bayrak çekiliş sırasını bozmaz', () => {
    const g = SP();
    const humans = [seat('h1', 0), seat('h2', 1), seat('b1', 2, true)];
    for (let seed = 1; seed < 400; seed++) {
        const st = mkState(seed, humans);
        const none = R.minigameSpec(clone(st), { g: g });
        assert.deepEqual(none, R.minigameSpec(clone(st), { g: g, mini: null }), 'mini: null = bayrak yok');
        const any = R.minigameSpec(clone(st), { g: g, mini: { game: null } });
        assert.equal(any.type, 'duel', '?mini=duel: rastgele düello');
        assert.ok(C.DUEL_GAMES.includes(any.game));
        const cd = R.minigameSpec(clone(st), { g: g, mini: { game: 'catdog' } });
        assert.equal(cd.type, 'duel');
        assert.equal(cd.game, 'catdog');
        assert.deepEqual(cd.players.slice().sort(), ['h1', 'h2'], 'botlar seçilmez');
        assert.equal(cd.seed, none.seed, 'tohum aynı çekilişten');
        const kb = R.minigameSpec(clone(st), { g: g, mini: { game: 'kurbaga' } });
        assert.equal(kb.type, 'ffa');
        assert.equal(kb.game, 'kurbaga');
        assert.deepEqual(kb.players, st.order);
    }
    // tek insan: düello bayrağı uygun değil -> yok sayılır, normal havuz (ffa oyunları)
    for (let seed = 1; seed < 50; seed++) {
        const st = mkState(seed, [seat('h1', 0), seat('b1', 1, true), seat('b2', 2, true)]);
        const spec = R.minigameSpec(st, { g: g, mini: { game: 'xox' } });
        assert.equal(spec.type, 'ffa');
        assert.ok(['kurbaga', 'dusenzemin'].includes(spec.game));
        assert.ok(['kurbaga', 'dusenzemin'].includes(R.minigameSpec(mkState(seed, [seat('h1', 0), seat('b1', 1, true)]), { g: g, mini: { game: null } }).game));
    }
});

test('minigameSpec: 2–7 insanla çiftler ve extra (tohumlu, deterministik, herkes tam bir yerde)', () => {
    const g = SP();
    for (let n = 2; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => 'h' + i);
        const seats = ids.map((id, i) => seat(id, i)).concat([seat('bot', 7, true)]);       // bot hep var
        let duels = 0;
        const firstPairs = new Set();
        for (let seed = 1; seed < 300; seed++) {
            const st = mkState(seed, seats);
            const copy = clone(st);
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
