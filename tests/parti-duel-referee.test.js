const test = require('node:test');
const assert = require('node:assert/strict');
const Duel = require('../core/duel.js');
const Referee = require('../games/parti/mini/duel-referee.js');
const X = require('../games/xox-rules.js');
const C4 = require('../games/connect4-rules.js');

const GAMES = { xox: { prefix: 'xox', rules: X }, c4: { prefix: 'c4', rules: C4 } };

// Gerçek Duel örnekleri + hakem: her gönderim hem diğer oyuncuya hem hakeme gider.
function match(kind, random) {
    const g = GAMES[kind];
    const referee = Referee.create({ prefix: g.prefix, rules: g.rules, players: ['A', 'B'] });
    const queue = [];
    const players = [{ id: 'A', name: 'Ayşe' }, { id: 'B', name: 'Bora' }];
    const duels = {};
    ['A', 'B'].forEach((id) => {
        const ctx = {
            me: players.find((p) => p.id === id), room: 'R', players,
            isHost: () => id === 'A',
            send: (msg) => {
                const copy = JSON.parse(JSON.stringify(msg));
                referee.feed(id, copy);
                queue.push({ to: id === 'A' ? 'B' : 'A', msg: copy });
            }
        };
        duels[id] = Duel.create({ prefix: g.prefix, rules: g.rules, ctx, random: random || (() => 0.1), onChange: () => {} });
    });
    const api = {
        referee, duels,
        flush() { while (queue.length) { const q = queue.shift(); duels[q.to].onMessage(q.msg); } },
        start() { duels.A.start(); duels.B.start(); api.flush(); },
        move(id, m) { const ok = duels[id].move(m); api.flush(); return ok; }
    };
    return api;
}

test('hakem: XOX kazananı [[kazanan],[kaybeden]] olur', () => {
    const t = match('xox');
    t.start();
    assert.equal(t.referee.phase(), 'playing');
    t.move('A', { cell: 0 }); t.move('B', { cell: 3 });
    t.move('A', { cell: 1 }); t.move('B', { cell: 4 });
    t.move('A', { cell: 2 });
    assert.deepEqual(t.referee.outcome(), { ranking: [['A'], ['B']], reason: 'win' });
});

test('hakem: XOX beraberliği [[a,b]] olur', () => {
    const t = match('xox');
    t.start();
    [['A', 0], ['B', 1], ['A', 2], ['B', 4], ['A', 3], ['B', 5], ['A', 7], ['B', 6], ['A', 8]].forEach(([id, cell]) => t.move(id, { cell }));
    assert.deepEqual(t.referee.outcome(), { ranking: [['A', 'B']], reason: 'draw' });
});

test('hakem: Dörtlü Bağla dikey dörtlü kazanır', () => {
    const t = match('c4');
    t.start();
    for (let i = 0; i < 3; i++) { t.move('A', { col: 0 }); t.move('B', { col: 1 }); }
    t.move('A', { col: 0 });
    assert.deepEqual(t.referee.outcome().ranking, [['A'], ['B']]);
});

test('hakem: ilk başlayan konuk olabilir (start.first)', () => {
    const t = match('xox', () => 0.9);       // 0.9 -> rakip başlar
    t.start();
    assert.equal(t.referee.log()[0].m.first, 'B');
    assert.equal(t.move('A', { cell: 0 }), false, 'A sırada değil');
    t.move('B', { cell: 4 });
    assert.equal(t.referee.log().length, 2);
});

test('hakem: bitmemiş oyun zaman aşımında beraberlik; forfeit kopanı sona yazar', () => {
    const t = match('xox');
    t.start();
    t.move('A', { cell: 0 });
    assert.equal(t.referee.outcome(), null);
    assert.deepEqual(t.referee.timeout(), [['A', 'B']]);
    assert.deepEqual(t.referee.forfeit('B'), [['A'], ['B']]);
    assert.deepEqual(t.referee.forfeit('A'), [['B'], ['A']]);
});

test('hakem: geçersiz/sırasız/yetkisiz mesajlar günlüğe girmez', () => {
    const r = Referee.create({ prefix: 'xox', rules: X, players: ['A', 'B'] });
    assert.equal(r.feed('A', { type: 'xox_move', round: 1, cell: 0 }), false, 'start yok');
    assert.equal(r.feed('B', { type: 'xox_start', round: 1, first: 'B' }), false, 'konuk start yollayamaz');
    assert.equal(r.feed('C', { type: 'xox_start', round: 1, first: 'A' }), false, 'oyuncu olmayan');
    assert.equal(r.feed('A', { type: 'xox_start', round: 1, first: 'Z' }), false, 'first oyuncu değil');
    assert.equal(r.feed('A', { type: 'xox_start', round: 2, first: 'A' }), false, 'yalnız tur 1');
    assert.equal(r.feed('A', { type: 'xox_start', round: 1, first: 'A' }), true);
    assert.equal(r.feed('A', { type: 'xox_start', round: 1, first: 'B' }), false, 'ikinci start yok sayılır');
    assert.equal(r.feed('B', { type: 'xox_move', round: 1, cell: 0 }), false, 'sıra A da');
    assert.equal(r.feed('A', { type: 'xox_move', round: 2, cell: 0 }), false, 'yanlış tur');
    assert.equal(r.feed('A', { type: 'xox_move', round: 1, cell: 9 }), false, 'geçersiz hücre');
    assert.equal(r.feed('A', { type: 'xox_move', round: 1, cell: 0 }), true);
    assert.equal(r.feed('B', { type: 'xox_move', round: 1, cell: 0 }), false, 'dolu hücre');
    assert.equal(r.log().length, 2);
    r.reset();
    assert.equal(r.log().length, 0);
});
