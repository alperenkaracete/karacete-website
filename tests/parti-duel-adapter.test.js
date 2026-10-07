const test = require('node:test');
const assert = require('node:assert/strict');
const Adapter = require('../games/parti/mini/duel-adapter.js');
const X = require('../games/xox-rules.js');
const C4 = require('../games/connect4-rules.js');

const { fakeRoot, makeDefs, clock } = require('./duel-fakes.js');

// Oda: gönderilen mesaj, gönderen HARİÇ herkese gider (backend gibi). `from` makine gibi gönderenden eklenir.
function room(game, options) {
    options = options || {};
    const prefix = game === 'xox' ? 'xox' : 'c4';
    const rules = game === 'xox' ? X : C4;
    const clk = clock();
    const players = ['A', 'B'];
    const names = { A: 'Ayşe', B: 'Bora', C: 'Cem' };
    const members = {};
    const queue = [];
    const api = { clk, members, results: {}, raw: [] };

    function join(id, joinOptions) {
        joinOptions = joinOptions || {};
        const ac = new AbortController();
        const root = fakeRoot();
        const defs = makeDefs(prefix, rules, joinOptions.recv);
        const handler = { fn: null };
        const net = {
            send: (m) => {
                const copy = JSON.parse(JSON.stringify(m));
                api.raw.push({ from: id, m: copy });
                Object.keys(members).forEach((o) => { if (o !== id && members[o].online) queue.push({ to: o, from: id, m: copy }); });
                if (options.autoflush !== false && !api.flushing) api.flush();
            },
            on: (fn) => { handler.fn = fn; return () => { handler.fn = null; }; }
        };
        const member = { id, root, defs, ac, handler, online: true };
        members[id] = member;
        member.promise = Adapter.run({
            type: 'duel', game, players, seed: 7, me: { id, name: names[id] }, isLeader: id === (options.leader || 'A'), leader: options.leader || 'A',
            root, net, deadlineMs: options.deadlineMs === undefined ? 90000 : options.deadlineMs, signal: ac.signal,
            defs, names, timers: clk.timers, now: clk.now
        });
        member.promise.then((r) => { api.results[id] = r; });
        return member;
    }

    api.flushing = false;
    api.flush = () => {
        api.flushing = true;
        while (queue.length) {
            const q = queue.shift();
            const m = members[q.to];
            if (m && m.online && m.handler.fn) m.handler.fn(q.from, q.m);
        }
        api.flushing = false;
    };
    api.join = join;
    api.move = (id, mv) => { const ok = members[id].defs.duel.move(mv); api.flush(); return ok; };
    api.tick = () => new Promise((r) => setImmediate(r));
    return api;
}

test('adaptör: XOX tam akış — lider A, B oyuncu, C izleyici; sonuç [[A],[B]]', async () => {
    const r = room('xox');
    r.join('A'); r.join('B'); r.join('C');
    assert.equal(r.members.A.defs.view.phase, 'playing');
    assert.equal(r.members.B.defs.view.phase, 'playing');
    r.move('A', { cell: 0 }); r.move('B', { cell: 3 });
    r.move('A', { cell: 1 }); r.move('B', { cell: 4 });
    r.move('A', { cell: 2 });
    await r.tick();
    assert.deepEqual(r.results.A, { ranking: [['A'], ['B']], reason: 'win' });
    assert.equal(r.results.B, undefined, 'lider olmayan oyuncu sonuç vermez');
    assert.equal(r.results.C, undefined);
    assert.ok(r.members.C.root.textContent.includes('Ayşe ve Bora XOX oynuyor'));
    assert.ok(r.members.C.root.textContent.includes('Kalan süre 1:30'));
    assert.equal(r.members.C.defs.inits, 0, 'izleyici oyun kurmaz');
    assert.ok(r.members.A.root.classList.set.has('pt-duel'));
});

test('adaptör: lider izleyici (C) de sonucu hesaplar; Dörtlü Bağla', async () => {
    const r = room('connect4', { leader: 'C' });
    r.join('C'); r.join('A'); r.join('B');      // lider oturumu hep ilk kurulur (makine: lider kendi anlık görüntüsünü yayınlar)
    for (let i = 0; i < 3; i++) { r.move('A', { col: 0 }); r.move('B', { col: 1 }); }
    r.move('A', { col: 0 });
    await r.tick();
    assert.deepEqual(r.results.C.ranking, [['A'], ['B']]);
});

test('adaptör: beraberlik [[a,b]]', async () => {
    const r = room('xox');
    r.join('A'); r.join('B');
    [['A', 0], ['B', 1], ['A', 2], ['B', 4], ['A', 3], ['B', 5], ['A', 7], ['B', 6], ['A', 8]].forEach(([id, cell]) => r.move(id, { cell }));
    await r.tick();
    assert.deepEqual(r.results.A.ranking, [['A', 'B']]);
    assert.equal(r.results.A.reason, 'draw');
});

test('adaptör: süre dolunca bitmemiş oyun beraberlik; yalnız lider çözer', async () => {
    const r = room('xox');
    r.join('A'); r.join('B'); r.join('C');
    r.move('A', { cell: 4 });
    r.clk.advance(89999);
    await r.tick();
    assert.equal(r.results.A, undefined);
    r.clk.advance(1);
    await r.tick();
    assert.deepEqual(r.results.A, { ranking: [['A', 'B']], reason: 'timeout' });
    assert.equal(r.results.B, undefined);
    assert.equal(r.clk.pending(), 0, 'sayaç temizlendi');
});

test('adaptör: geç katılan oyuncu (start kaçtı) hello ile yetişir', async () => {
    const r = room('xox');
    r.join('A');                       // A start'ı yollar, kimse dinlemiyor
    r.join('B');
    assert.equal(r.members.B.defs.view.phase, 'playing', 'catchup ile start geldi');
    assert.ok(r.members.A.defs.view.myTurn || r.members.B.defs.view.myTurn);
    r.move('A', { cell: 0 });
    assert.equal(r.members.B.defs.view.board[0], 0);
});

test('adaptör: yeniden bağlanma — kaçan hamleler lider tarafından tamamlanır', async () => {
    const r = room('xox');
    r.join('A'); r.join('B'); r.join('C');
    r.move('A', { cell: 0 });
    r.move('B', { cell: 4 });
    r.members.B.online = false;                     // B kopar: A'nın sonraki hamlesini kaçırır
    r.move('A', { cell: 8 });
    r.members.B.online = true;
    assert.equal(r.members.B.defs.view.board[8], null, 'B hamleyi kaçırdı');
    r.members.B.handler.fn(null, { k: '_reconnected' });   // makine: bağlantı döndü
    r.flush();
    assert.equal(r.members.B.defs.view.board[8], 0, 'catchup ile yetişti');
    assert.equal(r.members.B.defs.inits, 1, 'oyun yeniden kurulmadı');
});

test('adaptör: oyuncunun sayfası yenilenirse (yeni örnek) düello iki tarafta sıfırlanır', async () => {
    const r = room('xox');
    r.join('A'); r.join('B');
    r.move('A', { cell: 0 }); r.move('B', { cell: 4 });
    r.members.B.ac.abort();                         // eski sayfa kapandı
    r.join('B');                                    // yeni sayfa
    assert.equal(r.members.A.defs.inits, 2, 'lider örneği yeniden kurdu');
    assert.equal(r.members.B.defs.inits, 2, 'B de reset ile bir kez daha kurdu (ilk kurulum + reset)');
    assert.deepEqual(r.members.A.defs.view.board, [null, null, null, null, null, null, null, null, null]);
    assert.equal(r.members.A.defs.view.phase, 'playing');
    assert.equal(r.members.B.defs.view.phase, 'playing');
    const mover = r.members.A.defs.view.myTurn ? 'A' : 'B';
    assert.equal(r.move(mover, { cell: 2 }), true);
    assert.equal(r.members.A.defs.view.board[2] !== null && r.members.B.defs.view.board[2] !== null, true, 'yeni oyun akıyor');
});

test('adaptör: yetkisiz gönderenler yok sayılır (oyuncu olmayan hamle, lider olmayan reset/catchup)', async () => {
    const r = room('xox');
    r.join('A'); r.join('B'); r.join('C');
    const b = r.members.B;
    const before = JSON.stringify(b.defs.view.board);
    // C (izleyici) oyuncu gibi hamle yollar
    b.handler.fn('C', { type: 'xox_move', round: 1, cell: 5 });
    assert.equal(JSON.stringify(b.defs.view.board), before);
    // lider (A) olmayan reset
    b.handler.fn('C', { k: 'reset', r: 5 });
    assert.equal(b.defs.inits, 1);
    // lider olmayan catchup (B hedef)
    b.handler.fn('C', { k: 'catchup', to: 'B', msgs: [{ f: 'A', m: { type: 'xox_move', round: 1, cell: 7 } }] });
    assert.equal(b.defs.view.board[7], null);
    // lider (A) olmayan birinden hakeme hamle
    r.members.A.handler.fn('C', { type: 'xox_move', round: 1, cell: 5 });
    r.move('A', { cell: 0 });
    assert.equal(r.members.B.defs.view.board[5], null);
});

test('adaptör: rövanş mesajları gönderilmez ve iletilmez', async () => {
    const r = room('xox');
    r.join('A'); r.join('B');
    const before = r.raw.length;
    r.members.A.defs.ctx.send({ type: 'xox_rematch', round: 1, id: 'A' });
    assert.equal(r.raw.length, before);
    const b = r.members.B;
    const recv = [];
    const orig = b.defs.onMessage;
    b.defs.onMessage = (m) => { recv.push(m); orig(m); };
    b.handler.fn('A', { type: 'xox_rematch', round: 1, id: 'A' });
    assert.equal(recv.length, 0);
});

test('adaptör: signal ile iptal oyunu yıkar, kökü temizler, sonuç aborted', async () => {
    const r = room('xox');
    const a = r.join('A'); r.join('B'); r.join('C');
    r.members.C.ac.abort();
    r.members.A.ac.abort();
    await r.tick();
    assert.equal(a.defs.destroys, 1);
    assert.equal(a.root.textContent, '');
    assert.deepEqual(r.results.A, { ranking: null, aborted: true });
    assert.equal(r.members.C.root.textContent, '');
    assert.equal(r.clk.pending(), 0);
});

test('adaptör: önceden iptal edilmiş signal hiçbir şey kurmaz', async () => {
    const ac = new AbortController();
    ac.abort();
    const defs = makeDefs('xox', X);
    const res = await Adapter.run({
        game: 'xox', players: ['A', 'B'], me: { id: 'A', name: 'A' }, isLeader: true, leader: 'A', root: fakeRoot(),
        net: { send() {}, on: () => () => {} }, signal: ac.signal, defs, deadlineMs: 1000
    });
    assert.equal(res.aborted, true);
    assert.equal(defs.inits, 0);
});

test('adaptör: izleyici kartı verisi (saf)', () => {
    const info = Adapter.spectatorInfo({ game: 'connect4', players: ['A', 'B'], names: { A: 'Ayşe', B: 'Bora' } }, 42000);
    assert.equal(info.text, 'Ayşe ve Bora Dörtlü Bağla oynuyor');
    assert.equal(info.leftText, 'Kalan süre 0:42');
    assert.equal(Adapter.spectatorInfo({ game: 'xox', players: ['A', 'B'] }, 0).leftText, 'Kalan süre 0:00');
    assert.equal(Adapter.supports('xox'), true);
    assert.equal(Adapter.supports('catdog'), true);
    assert.equal(Adapter.supports('yok'), false);
});
