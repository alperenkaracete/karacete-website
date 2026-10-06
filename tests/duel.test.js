const test = require('node:test');
const assert = require('node:assert/strict');
const Duel = require('../core/duel.js');
const X = require('../games/xox-rules.js');

// İki istemciyi bir "sunucu" ile bağlar: gönderilen mesaj, diğer tarafa aynen iletilir.
function room(options) {
    options = options || {};
    const queue = [];
    const views = { A: null, B: null };
    const sent = { A: [], B: [] };
    const clients = {};

    function make(id, name, players) {
        const other = id === 'A' ? 'B' : 'A';
        const ctx = {
            me: { id, name },
            room: 'ABC234',
            players,
            isHost: () => players.length > 0 && players[0].id === id,
            send: (msg) => { sent[id].push(msg); queue.push({ to: other, msg: JSON.parse(JSON.stringify(msg)) }); }
        };
        const duel = Duel.create({
            prefix: options.prefix || 'xox', rules: options.rules || X, ctx,
            random: options.random || (() => 0.1),   // 0.1 -> host başlar
            onChange: (v) => { views[id] = v; }
        });
        clients[id] = { ctx, duel };
        return clients[id];
    }

    const a = make('A', 'Ayse', [{ id: 'A', name: 'Ayse' }]);
    const b = make('B', 'Bora', []);

    const api = {
        a: a.duel, b: b.duel, views, sent, clients,
        flush() {
            while (queue.length) {
                const { to, msg } = queue.shift();
                clients[to].duel.onMessage(msg);
            }
        },
        // B odaya katılır (sunucu: B'ye room_joined, A'ya player_joined)
        join() {
            b.ctx.players.push({ id: 'A', name: 'Ayse' }, { id: 'B', name: 'Bora' });
            a.ctx.players.push({ id: 'B', name: 'Bora' });
            b.duel.start();
            a.duel.onMessage({ type: 'player_joined', id: 'B', name: 'Bora' });
            api.flush();
        },
        // B'nin yeni bir istemcisi (yeni sayfa) odaya girer.
        rejoin() {
            const nb = make('B', 'Bora', [{ id: 'A', name: 'Ayse' }, { id: 'B', name: 'Bora' }]);
            api.b = nb.duel;
            a.ctx.players.push({ id: 'B', name: 'Bora' });
            nb.duel.start();
            a.duel.onMessage({ type: 'player_joined', id: 'B', name: 'Bora' });
            api.flush();
        },
        // Bir taraf ayrılır; kalan tarafın oyuncu listesi güncellenip player_disconnect gelir.
        leave(id) {
            const other = id === 'A' ? 'B' : 'A';
            const list = clients[other].ctx.players;
            const i = list.findIndex((p) => p.id === id);
            list.splice(i, 1);
            clients[other].duel.onMessage({ type: 'player_disconnect', id });
            api.flush();
        },
        // Sırası gelen tarafın istemcisini döndürür.
        turnOwner() {
            return views.A.myTurn ? a.duel : b.duel;
        }
    };
    a.duel.start();
    return api;
}

function play(r, cells) {
    for (const cell of cells) {
        const duel = r.turnOwner();
        assert.equal(duel.move({ cell }), true, 'hamle ' + cell + ' geçerli olmalı');
        r.flush();
    }
}

test('rakip yokken oyun başlamaz, bekleme durumundadır', () => {
    const r = room();
    assert.equal(r.views.A.phase, 'waiting');
    assert.equal(r.views.A.opponent, null);
    assert.equal(r.views.A.room, 'ABC234');
    assert.equal(r.a.move({ cell: 0 }), false);
    assert.equal(r.sent.A.length, 0);
});

test('rakip katılınca host başlangıç oyuncusunu belirler ve iki taraf aynı durumda başlar', () => {
    const r = room();
    r.join();
    assert.equal(r.views.A.phase, 'playing');
    assert.equal(r.views.B.phase, 'playing');
    const start = r.sent.A.find((m) => m.type === 'xox_start');
    assert.ok(start);
    assert.equal(start.round, 1);
    assert.equal(start.first, 'A');   // random=0.1 -> host
    assert.equal(r.views.A.myTurn, true);
    assert.equal(r.views.B.myTurn, false);
    assert.equal(r.views.A.myIndex, 0);
    assert.equal(r.views.B.myIndex, 1);
});

test('rastgele değer 0.9 ise rakip başlar', () => {
    const r = room({ random: () => 0.9 });
    r.join();
    assert.equal(r.views.B.myTurn, true);
    assert.equal(r.views.A.myTurn, false);
});

test('sıra gelmeyen taraf hamle yapamaz, mesaj gitmez', () => {
    const r = room();
    r.join();
    const before = r.sent.B.length;
    assert.equal(r.b.move({ cell: 0 }), false);
    assert.equal(r.sent.B.length, before);
});

test('geçersiz yerel hamle (dolu hücre, aralık dışı) reddedilir ve gönderilmez', () => {
    const r = room();
    r.join();
    play(r, [4]);
    const before = r.sent.B.length;
    assert.equal(r.b.move({ cell: 4 }), false);   // dolu
    assert.equal(r.b.move({ cell: 9 }), false);   // aralık dışı
    assert.equal(r.b.move({ cell: 'x' }), false); // tip
    assert.equal(r.sent.B.length, before);
});

test('hamleler iki tarafta aynı tahtayı üretir ve sıra değişir', () => {
    const r = room();
    r.join();
    play(r, [4, 0]);
    assert.deepEqual(r.views.A.board, r.views.B.board);
    assert.equal(r.views.A.board[4], 0);
    assert.equal(r.views.A.board[0], 1);
    assert.equal(r.views.A.myTurn, true);
});

test('gelen hamle doğrulanır: sırası olmayan rakibin hamlesi yok sayılır', () => {
    const r = room();
    r.join();     // A'nın sırası
    const board = JSON.stringify(r.views.A.board);
    r.a.onMessage({ type: 'xox_move', round: 1, cell: 3 });  // B sırasız gönderiyor
    assert.equal(JSON.stringify(r.views.A.board), board);
    assert.equal(r.views.A.myTurn, true);
});

test('gelen hamle doğrulanır: dolu hücre, aralık dışı, bozuk alan ve bayat tur yok sayılır', () => {
    const r = room();
    r.join();
    play(r, [4]);      // şimdi B'nin sırası, A tarafı B'den hamle bekler
    const snapshot = JSON.stringify(r.views.A.board);
    for (const bad of [
        { type: 'xox_move', round: 1, cell: 4 },        // dolu
        { type: 'xox_move', round: 1, cell: 12 },       // aralık dışı
        { type: 'xox_move', round: 1, cell: '2' },      // tip
        { type: 'xox_move', round: 1 },                 // alan yok
        { type: 'xox_move', round: 0, cell: 2 },        // bayat tur
        { type: 'xox_move', cell: 2 }                   // tur yok
    ]) {
        r.a.onMessage(bad);
        assert.equal(JSON.stringify(r.views.A.board), snapshot, JSON.stringify(bad));
        assert.equal(r.views.A.myTurn, false);
    }
    r.a.onMessage({ type: 'xox_move', round: 1, cell: 2 });   // geçerli
    assert.equal(r.views.A.board[2], 1);
});

test('kazanma: sonuç, skor ve faz iki tarafta aynı', () => {
    const r = room();
    r.join();
    play(r, [0, 3, 1, 4, 2]);   // A: 0,1,2 üst satır
    for (const v of [r.views.A, r.views.B]) {
        assert.equal(v.phase, 'over');
        assert.equal(v.result.status, 'win');
        assert.deepEqual(v.result.line, [0, 1, 2]);
        assert.equal(v.scores.find((s) => s.id === 'A').wins, 1);
        assert.equal(v.scores.find((s) => s.id === 'B').wins, 0);
    }
    // oyun bitince hamle kabul edilmez
    assert.equal(r.a.move({ cell: 5 }), false);
    assert.equal(r.b.move({ cell: 5 }), false);
});

test('beraberlik sayılır', () => {
    const r = room();
    r.join();
    // X O X / X O O / O X X  (A=X ilk başlar)
    play(r, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    assert.equal(r.views.A.phase, 'over');
    assert.equal(r.views.A.result.status, 'draw');
    assert.equal(r.views.A.draws, 1);
    assert.equal(r.views.B.draws, 1);
});

test('rövanş: iki oy gerekir, başlayan taraf değişir, skor korunur', () => {
    const r = room();
    r.join();
    play(r, [0, 3, 1, 4, 2]);               // A kazandı
    r.b.rematch(); r.flush();
    assert.equal(r.views.A.phase, 'over');  // tek oy yetmez
    assert.equal(r.views.B.myVoted, true);
    assert.equal(r.views.A.opponentVoted, true);
    r.a.rematch(); r.flush();
    assert.equal(r.views.A.phase, 'playing');
    assert.equal(r.views.B.phase, 'playing');
    assert.equal(r.views.A.round, 2);
    assert.equal(r.views.B.round, 2);
    assert.equal(r.views.B.myTurn, true);   // bu sefer B başlar
    assert.equal(r.views.A.myIndex, 1);
    assert.ok(r.views.A.board.every((c) => c === null));
    assert.equal(r.views.A.scores.find((s) => s.id === 'A').wins, 1);
    // bir sonraki rövanşta tekrar A başlar
    play(r, [0, 3, 1, 4, 2]);               // B (ilk) kazandı
    assert.equal(r.views.A.scores.find((s) => s.id === 'B').wins, 1);
    r.a.rematch(); r.b.rematch(); r.flush();
    assert.equal(r.views.A.myTurn, true);
});

test('oyun sürerken rövanş oyu etkisizdir', () => {
    const r = room();
    r.join();
    r.b.rematch();
    r.a.onMessage({ type: 'xox_rematch', round: 1, id: 'B' });
    assert.equal(r.views.A.phase, 'playing');
    assert.equal(r.views.A.round, 1);
});

test('host olmayan taraf start yollayamaz: host sahte start kabul etmez', () => {
    const r = room();
    r.join();
    play(r, [0, 3, 1, 4, 2]);
    r.a.onMessage({ type: 'xox_start', first: 'B', round: 9 });
    assert.equal(r.views.A.phase, 'over');
    assert.equal(r.views.A.round, 1);
});

test('host olmayan taraf bayat/geçersiz start yok sayar', () => {
    const r = room();
    r.join();
    play(r, [0, 3, 1, 4, 2]);
    r.b.onMessage({ type: 'xox_start', first: 'A', round: 1 });     // bayat tur
    r.b.onMessage({ type: 'xox_start', first: 'Z', round: 2 });     // tanımsız oyuncu
    r.b.onMessage({ type: 'xox_start', first: 'A', round: '2' });   // tip
    assert.equal(r.views.B.phase, 'over');
    assert.equal(r.views.B.round, 1);
    r.b.onMessage({ type: 'xox_start', first: 'B', round: 2 });
    assert.equal(r.views.B.phase, 'playing');
});

test('oyun sürerken gelen start yok sayılır', () => {
    const r = room();
    r.join();
    play(r, [4]);
    r.b.onMessage({ type: 'xox_start', first: 'B', round: 5 });
    assert.equal(r.views.B.round, 1);
    assert.equal(r.views.B.board[4], 0);
});

test('rakip ayrılınca "abandoned" olur; hamle ve rövanş çalışmaz', () => {
    const r = room();
    r.join();
    play(r, [4]);
    r.leave('B');
    assert.equal(r.views.A.phase, 'abandoned');
    assert.equal(r.views.A.opponent, null);
    assert.equal(r.a.move({ cell: 0 }), false);
    r.a.rematch();
    assert.equal(r.views.A.phase, 'abandoned');
});

test('oyun bittikten sonra rakip ayrılırsa da abandoned olur ve skor görünür kalır', () => {
    const r = room();
    r.join();
    play(r, [0, 3, 1, 4, 2]);
    r.leave('A');   // host ayrıldı; B host olur
    assert.equal(r.views.B.phase, 'abandoned');
    assert.equal(r.views.B.scores.find((s) => s.id === 'A').wins, 1);
});

test('beklerken ayrılma bir şey değiştirmez (waiting kalır)', () => {
    const r = room();
    r.a.onMessage({ type: 'player_disconnect', id: 'X' });
    assert.equal(r.views.A.phase, 'waiting');
});

test('abandoned sonrası yeni rakip katılınca host yeni tur başlatır', () => {
    const r = room();
    r.join();
    play(r, [4]);
    const round = r.views.A.round;
    r.leave('B');
    r.rejoin();   // yeni bir tarayıcı sekmesi aynı odaya girer
    assert.equal(r.views.A.phase, 'playing');
    assert.equal(r.views.B.phase, 'playing');
    assert.equal(r.views.A.round, round + 1);
    assert.ok(r.views.B.board.every((c) => c === null));
});

test('bilinmeyen / bozuk mesajlar çökertmez', () => {
    const r = room();
    r.join();
    r.a.onMessage(null);
    r.a.onMessage({});
    r.a.onMessage({ type: 5 });
    r.a.onMessage({ type: 'baska_oyun_move', cell: 1 });
    assert.equal(r.views.A.phase, 'playing');
});

// ---- İsteğe bağlı kurallar kancaları: createStart / parseStart / initial(start) / messageTypes ----

const hookRules = {
    messageTypes: ['hk_add'],
    initial(start) { return { start: start || null, total: 0, mover: null }; },
    createStart(info) { return { seed: 4242, host: info.hostId }; },
    parseStart(data) { return Number.isInteger(data.seed) ? { seed: data.seed, host: data.host } : null; },
    parse(data) { return Number.isInteger(data.amount) ? { amount: data.amount } : null; },
    toMessage(move) { return { type: 'hk_add', amount: move.amount }; },
    validate(board, move) { return move.amount >= 1 && move.amount <= 3; },
    apply(board, move, index) { return { board: { start: board.start, total: board.total + move.amount, mover: index }, cell: null }; },
    result(board) { return board.total >= 5 ? { status: 'win', winner: board.mover } : null; }
};

test('createStart alanları start mesajına eklenir ve iki tarafın initial(start) çağrısına ulaşır', () => {
    const r = room({ prefix: 'hk', rules: hookRules });
    r.join();
    const start = r.sent.A.find((m) => m.type === 'hk_start');
    assert.equal(start.seed, 4242);
    assert.equal(start.host, 'A');
    assert.equal(start.type, 'hk_start');      // eklenen alanlar type/first/round'u ezemez
    assert.equal(start.round, 1);
    for (const v of [r.views.A, r.views.B]) {
        assert.equal(v.board.start.seed, 4242);
        assert.equal(v.board.start.host, 'A');
        assert.equal(v.board.start.round, 1);
        assert.deepEqual(v.board.start.order, ['A', 'B']);
    }
});

test('parseStart null dönerse start reddedilir', () => {
    const r = room({ prefix: 'hk', rules: hookRules });
    r.join();
    r.b.onMessage({ type: 'hk_start', first: 'B', round: 2 });          // seed yok -> reddedilir
    // zaten oynuyor; oyun bitince tekrar dene
    r.turnOwner().move({ amount: 3 }); r.flush();
    r.turnOwner().move({ amount: 3 }); r.flush();
    assert.equal(r.views.B.phase, 'over');
    r.b.onMessage({ type: 'hk_start', first: 'B', round: 2 });          // seed yok
    assert.equal(r.views.B.phase, 'over');
    assert.equal(r.views.B.round, 1);
    r.b.onMessage({ type: 'hk_start', first: 'B', round: 2, seed: 7 }); // geçerli
    assert.equal(r.views.B.phase, 'playing');
    assert.equal(r.views.B.board.start.seed, 7);
});

test('messageTypes: özel hamle türü kabul edilir, <prefix>_move kabul edilmez; toMessage kendi type\'ını kullanır', () => {
    const r = room({ prefix: 'hk', rules: hookRules });
    r.join();
    const mover = r.turnOwner();
    assert.equal(mover.move({ amount: 2 }), true);
    const sent = r.sent.A.concat(r.sent.B).filter((m) => m.type === 'hk_add');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].round, 1);
    r.flush();
    assert.equal(r.views.A.board.total, 2);
    assert.equal(r.views.B.board.total, 2);
    // eski varsayılan tür artık hamle sayılmaz
    const other = r.turnOwner();
    other.onMessage({ type: 'hk_move', round: 1, amount: 1 });
    assert.equal(r.views.A.board.total, 2);
    // geçersiz hamle (kural ihlali) reddedilir
    assert.equal(r.turnOwner().move({ amount: 9 }), false);
});

test('kancası olmayan kurallar eskisi gibi çalışır (initial argümansız da olur)', () => {
    const r = room();
    r.join();
    assert.equal(r.views.A.phase, 'playing');
    const start = r.sent.A.find((m) => m.type === 'xox_start');
    assert.deepEqual(Object.keys(start).sort(), ['first', 'round', 'type']);
});
