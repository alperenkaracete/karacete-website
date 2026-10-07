// Kedi - Köpek hakemi: atış sınırı (kural modülü değişmez; sınır ve kalan can sıralaması adaptör tablosunda).
const test = require('node:test');
const assert = require('node:assert/strict');
const Duel = require('../core/duel.js');
const Referee = require('../games/parti/mini/duel-referee.js');
const Adapter = require('../games/parti/mini/duel-adapter.js');

const CD = Adapter.GAMES.catdog;
const CDR = CD.rules();

function cdMatch(options) {
    options = options || {};
    const referee = Referee.create({ prefix: CD.prefix, rules: CDR, players: ['A', 'B'], limit: CD.limit, onLimit: options.onLimit });
    const queue = [];
    const players = [{ id: 'A', name: 'Ayşe' }, { id: 'B', name: 'Bora' }];
    const duels = {};
    ['A', 'B'].forEach((id) => {
        const ctx = {
            me: players.find((p) => p.id === id), room: 'R', players, isHost: () => id === 'A',
            send: (msg) => { const copy = JSON.parse(JSON.stringify(msg)); referee.feed(id, copy); queue.push({ to: id === 'A' ? 'B' : 'A', msg: copy }); }
        };
        duels[id] = Duel.create({ prefix: 'cd', rules: CDR, ctx, random: () => 0.1, onChange: (v) => { duels[id].view = v; } });
    });
    const api = {
        referee, duels,
        flush() { while (queue.length) { const q = queue.shift(); duels[q.to].onMessage(q.msg); } },
        start() { duels.A.start(); duels.B.start(); api.flush(); },
        // sıradaki oyuncu için istenen sonuçta (isabet / iki taraf da hasarsız) bir atış bulur
        findShot(wantHit) {
            const v = duels.A.view;
            const turnIndex = v.turnIndex;
            for (let a = 0; a <= 180; a += 3) {
                for (let p = 0; p <= 100; p += 3) {
                    const mv = { kind: 'shot', turn: v.board.turn, angle: a, power: p, powerUp: null };
                    const n = CDR.apply(v.board, mv, turnIndex).board;
                    const dmg = [v.board.players[0].hp - n.players[0].hp, v.board.players[1].hp - n.players[1].hp];
                    if (wantHit ? dmg[1 - turnIndex] > 0 && dmg[turnIndex] === 0 : dmg[0] === 0 && dmg[1] === 0) return mv;
                }
            }
            throw new Error('atış bulunamadı');
        },
        move(mv) {
            const id = duels.A.view.myTurn ? 'A' : 'B';
            const ok = duels[id].move(mv);
            api.flush();
            return ok;
        },
        shoot(wantHit) { return api.move(api.findShot(wantHit)); }
    };
    return api;
}

test('Kedi-Köpek hakemi: her oyuncunun 3 atışı bitince oyun biter; kalan cana göre sıralanır', () => {
    let limitRanking = null;
    const t = cdMatch({ onLimit: (r) => { limitRanking = r; } });
    t.start();
    assert.equal(t.referee.phase(), 'playing');
    t.shoot(true);                                   // A (ilk başlayan) isabet ettirir, kalanı ıskalar
    for (let i = 0; i < 4; i++) { t.shoot(false); assert.equal(t.referee.outcome(), null, 'henüz bitmedi'); }
    assert.deepEqual(t.referee.shots(), [3, 2]);
    t.shoot(false);
    assert.deepEqual(t.referee.outcome(), { ranking: [['A'], ['B']], reason: 'limit' });
    assert.deepEqual(limitRanking, [['A'], ['B']]);
});

test('Kedi-Köpek hakemi: iki taraf da ıskalarsa eşit can -> beraberlik [[a,b]]', () => {
    const t = cdMatch();
    t.start();
    for (let i = 0; i < 6; i++) t.shoot(false);
    assert.deepEqual(t.referee.outcome(), { ranking: [['A', 'B']], reason: 'limit' });
});

test('Kedi-Köpek hakemi: heal atış sayılmaz (sınırı ilerletmez)', () => {
    const t = cdMatch();
    t.start();
    assert.equal(t.move({ kind: 'heal', turn: 0 }), true);       // A iyileşir
    assert.deepEqual(t.referee.shots(), [0, 0]);
    t.shoot(false);                                               // B
    t.shoot(false);                                               // A (1)
    assert.deepEqual(t.referee.shots(), [1, 1]);
    for (let i = 0; i < 3; i++) t.shoot(false);
    assert.deepEqual(t.referee.shots(), [2, 3]);
    assert.equal(t.referee.outcome(), null);
    t.shoot(false);
    assert.equal(t.referee.outcome().reason, 'limit');
    assert.deepEqual(t.referee.shots(), [3, 3]);
});

test('Kedi-Köpek hakemi: canı biten kaybeder (normal bitiş), sınır beklenmez', () => {
    const stub = {
        initial: () => ({ hp: [2, 2] }), parse: (m) => ({ kind: 'shot', hit: m.hit }), validate: () => true,
        apply: (b, mv, i) => ({ board: { hp: i === 0 ? [b.hp[0], b.hp[1] - (mv.hit ? 2 : 0)] : [b.hp[0] - (mv.hit ? 2 : 0), b.hp[1]] } }),
        result: (b) => (b.hp[1] <= 0 ? { status: 'win', winner: 0 } : (b.hp[0] <= 0 ? { status: 'win', winner: 1 } : null)),
        messageTypes: ['s_shot']
    };
    const r = Referee.create({ prefix: 's', rules: stub, players: ['A', 'B'], limit: { shots: 3, counts: (m) => m.kind === 'shot' } });
    r.feed('A', { type: 's_start', round: 1, first: 'A' });
    r.feed('A', { type: 's_shot', round: 1, hit: false });
    r.feed('B', { type: 's_shot', round: 1, hit: false });
    r.feed('A', { type: 's_shot', round: 1, hit: true });
    assert.deepEqual(r.outcome(), { ranking: [['A'], ['B']], reason: 'win' });
    assert.equal(r.feed('B', { type: 's_shot', round: 1, hit: false }), false, 'bitmiş oyuna hamle girmez');
});

test('Kedi-Köpek hakemi: süre aşımı kalan cana göre; eşitse beraberlik; başlamamışsa beraberlik', () => {
    const t = cdMatch();
    assert.deepEqual(t.referee.timeout(), [['A', 'B']], 'start yok');
    t.start();
    t.shoot(true);                                                // A isabet: B 70
    t.shoot(false);
    assert.equal(t.referee.outcome(), null);
    assert.deepEqual(t.referee.timeout(), [['A'], ['B']]);
    const t2 = cdMatch();
    t2.start();
    t2.shoot(false);
    assert.deepEqual(t2.referee.timeout(), [['A', 'B']]);
    const t3 = cdMatch();
    t3.start();
    t3.shoot(false);                                              // A ıskalar
    t3.shoot(true);                                               // B isabet
    assert.deepEqual(t3.referee.timeout(), [['B'], ['A']]);
});

test('Kedi-Köpek hakemi: geçersiz/yetkisiz/sırasız mesajlar sayılmaz; reset sayaçları sıfırlar', () => {
    const t = cdMatch();
    t.start();
    const before = t.referee.log().length;
    const shot = (extra) => Object.assign({ type: 'cd_shot', round: 1, turn: 0, angle: 45, power: 50, powerUp: null }, extra);
    assert.equal(t.referee.feed('C', shot()), false, 'oyuncu değil');
    assert.equal(t.referee.feed('B', shot()), false, 'sıra A da');
    assert.equal(t.referee.feed('A', shot({ turn: 5 })), false, 'yanlış turn');
    assert.equal(t.referee.feed('A', shot({ angle: 999 })), false, 'geçersiz açı');
    assert.equal(t.referee.feed('A', shot({ powerUp: 'yok' })), false, 'bilinmeyen güç');
    assert.equal(t.referee.feed('A', { type: 'cd_heal', round: 1, turn: 0 }), true, 'heal geçerli ama sayılmaz');
    assert.deepEqual(t.referee.shots(), [0, 0]);
    assert.equal(t.referee.log().length, before + 1);
    t.referee.reset();
    assert.deepEqual(t.referee.shots(), [0, 0]);
    assert.equal(t.referee.log().length, 0);
});
