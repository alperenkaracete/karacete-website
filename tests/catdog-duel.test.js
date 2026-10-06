// Duel altyapısı + Kedi-Köpek kuralları: iki istemci aynı sonuca varır, geçersiz mesajlar yok sayılır.
const test = require('node:test');
const assert = require('node:assert/strict');
const Duel = require('../core/duel.js');
const R = require('../games/catdog-rules.js');

function room(random) {
    const queue = [];
    const views = { A: null, B: null };
    const sent = { A: [], B: [] };
    const clients = {};
    function make(id, name, players) {
        const other = id === 'A' ? 'B' : 'A';
        const ctx = {
            me: { id, name }, room: 'KEDI23', players,
            isHost: () => players.length > 0 && players[0].id === id,
            send: (msg) => { sent[id].push(msg); queue.push({ to: other, msg: JSON.parse(JSON.stringify(msg)) }); }
        };
        const duel = Duel.create({ prefix: 'cd', rules: R, ctx, random: random || (() => 0.1), onChange: (v) => { views[id] = v; } });
        clients[id] = { ctx, duel };
        return clients[id];
    }
    const a = make('A', 'Ayse', [{ id: 'A', name: 'Ayse' }]);
    const b = make('B', 'Bora', []);
    const api = {
        a: a.duel, b: b.duel, views, sent, clients,
        flush() { while (queue.length) { const m = queue.shift(); clients[m.to].duel.onMessage(m.msg); } },
        join() {
            b.ctx.players.push({ id: 'A', name: 'Ayse' }, { id: 'B', name: 'Bora' });
            a.ctx.players.push({ id: 'B', name: 'Bora' });
            b.duel.start();
            a.duel.onMessage({ type: 'player_joined', id: 'B', name: 'Bora' });
            api.flush();
        },
        mover() { return views.A.myTurn ? a.duel : b.duel; },
        moverView() { return views.A.myTurn ? views.A : views.B; }
    };
    a.duel.start();
    return api;
}

// Sırası gelen oyuncu için rakibe hasar veren bir (açı, güç) bulur.
function damagingShot(board, shooter) {
    for (let angle = 10; angle <= 80; angle += 2) {
        for (let power = 40; power <= 100; power += 2) {
            const sim = R.simulateShot({
                seed: board.seed, turn: board.turn, shooter, angle, power, powerUp: null,
                positions: board.players.map((p) => ({ x: p.x, y: p.y })), hp: board.players.map((p) => p.hp)
            });
            if (sim.shots[0].damage > 0) return { angle, power };
        }
    }
    return null;
}

test('rakip yokken oyun başlamaz; katılınca host tohumu ve kediyi gönderir', () => {
    const r = room(() => 0.25);
    assert.equal(r.views.A.phase, 'waiting');
    r.join();
    const start = r.sent.A.find((m) => m.type === 'cd_start');
    assert.equal(start.seed, Math.floor(0.25 * 4294967296));
    assert.equal(start.cat, 'A');
    assert.equal(start.round, 1);
    assert.equal(r.views.A.phase, 'playing');
    assert.equal(r.views.B.phase, 'playing');
    assert.equal(r.views.A.board.seed, r.views.B.board.seed);
    assert.deepEqual(r.views.A.board.players.map((p) => p.char), r.views.B.board.players.map((p) => p.char));
    // kedi oda kurucusu (A)
    assert.equal(r.views.A.board.players[r.views.A.myIndex].char, 'cat');
    assert.equal(r.views.B.board.players[r.views.B.myIndex].char, 'dog');
});

test('geçersiz hamleler gönderilmez / yok sayılır', () => {
    const r = room();
    r.join();
    const mover = r.mover();
    const other = mover === r.a ? r.b : r.a;
    const turn = r.moverView().board.turn;
    // sırası olmayan taraf atamaz
    assert.equal(other.move({ kind: 'shot', turn, angle: 45, power: 50, powerUp: null }), false);
    // geçersiz alanlar
    for (const bad of [
        { kind: 'shot', turn, angle: 181, power: 50, powerUp: null },
        { kind: 'shot', turn, angle: 45, power: 101, powerUp: null },
        { kind: 'shot', turn, angle: 45.5, power: 50, powerUp: null },
        { kind: 'shot', turn: turn + 1, angle: 45, power: 50, powerUp: null },
        { kind: 'shot', turn, angle: 45, power: 50, powerUp: 'heal' }
    ]) assert.equal(mover.move(bad), false, JSON.stringify(bad));
    // gelen geçersiz mesajlar yok sayılır
    const boardBefore = JSON.stringify(r.views.A.board);
    mover.onMessage({ type: 'cd_shot', round: 1, turn, angle: 45, power: 50, powerUp: null });   // sırası olmayan gönderiyor
    assert.equal(JSON.stringify(r.views.A.board), boardBefore);
    // doğru sırada ama bozuk: rakip tarafın gördüğü
    const waiting = other;
    for (const bad of [
        { type: 'cd_shot', round: 1, turn, angle: 999, power: 50, powerUp: null },
        { type: 'cd_shot', round: 1, turn, angle: 45, power: 'x', powerUp: null },
        { type: 'cd_shot', round: 1, turn: turn + 5, angle: 45, power: 50, powerUp: null },
        { type: 'cd_shot', round: 0, turn, angle: 45, power: 50, powerUp: null },
        { type: 'cd_shot', turn, angle: 45, power: 50, powerUp: null },
        { type: 'cd_shot', round: 1, turn, angle: 45, power: 50, powerUp: 'laser' },
        { type: 'cd_heal', round: 1, turn: turn + 1 }
    ]) {
        const before = JSON.stringify(r.views[waiting === r.a ? 'A' : 'B'].board);
        waiting.onMessage(bad);
        assert.equal(JSON.stringify(r.views[waiting === r.a ? 'A' : 'B'].board), before, JSON.stringify(bad));
    }
});

test('iki istemci aynı atış sonucuna ve aynı tahtaya ulaşır; sıra değişir', () => {
    const r = room();
    r.join();
    let moves = 0;
    while (r.views.A.phase === 'playing' && moves < 40) {
        const v = r.moverView();
        const shot = damagingShot(v.board, v.myIndex) || { angle: 45, power: 50 };
        assert.equal(r.mover().move({ kind: 'shot', turn: v.board.turn, angle: shot.angle, power: shot.power, powerUp: null }), true);
        r.flush();
        moves++;
        assert.equal(JSON.stringify(r.views.A.board), JSON.stringify(r.views.B.board), 'tur ' + moves);
    }
    assert.equal(r.views.A.phase, 'over');
    assert.equal(r.views.B.phase, 'over');
    assert.equal(r.views.A.result.status, 'win');
    assert.equal(r.views.A.winnerId, r.views.B.winnerId);
    const loserIndex = 1 - r.views.A.result.winner;
    assert.equal(r.views.A.board.players[loserIndex].hp, 0);
    assert.equal(r.views.A.scores.find((s) => s.id === r.views.A.winnerId).wins, 1);
});

test('iksir sırayı otomatik geçirir, cd_heal iki tarafta uygulanır', () => {
    const r = room();
    r.join();
    const v = r.moverView();
    const moverIndex = v.myIndex;
    const mover = r.mover();
    const wasMine = r.views.A.myTurn;
    assert.equal(mover.move({ kind: 'heal', turn: v.board.turn }), true);
    r.flush();
    assert.equal(r.sent[wasMine ? 'A' : 'B'].filter((m) => m.type === 'cd_heal').length, 1);
    assert.equal(r.views.A.board.players[moverIndex].cd.heal, 3);
    assert.equal(JSON.stringify(r.views.A.board), JSON.stringify(r.views.B.board));
    // sıra rakibe geçti
    assert.equal(r.views.A.myTurn, !wasMine);
    assert.equal(r.views.A.board.last.kind, 'heal');
    // bekleme süresinde tekrar iksir geçersiz
    r.mover().move({ kind: 'shot', turn: r.moverView().board.turn, angle: 45, power: 50, powerUp: null });
    r.flush();
    assert.equal(r.mover().move({ kind: 'heal', turn: r.moverView().board.turn }), false);
});

test('rövanş: yeni tohum, başlayan taraf değişir, kedi hep oda kurucusu, skor korunur', () => {
    let calls = 0;
    const r = room(() => (++calls % 2 ? 0.1 : 0.7));
    r.join();
    const firstSeed = r.views.A.board.seed;
    const firstStarter = r.views.A.myTurn ? 'A' : 'B';
    let moves = 0;
    while (r.views.A.phase === 'playing' && moves < 40) {
        const v = r.moverView();
        const shot = damagingShot(v.board, v.myIndex) || { angle: 45, power: 50 };
        r.mover().move({ kind: 'shot', turn: v.board.turn, angle: shot.angle, power: shot.power, powerUp: null });
        r.flush();
        moves++;
    }
    assert.equal(r.views.A.phase, 'over');
    const winnerId = r.views.A.winnerId;
    r.a.rematch(); r.b.rematch(); r.flush();
    assert.equal(r.views.A.phase, 'playing');
    assert.equal(r.views.B.phase, 'playing');
    assert.notEqual(r.views.A.board.seed, firstSeed);
    assert.equal(r.views.A.board.seed, r.views.B.board.seed);
    assert.equal(r.views.A.round, 2);
    assert.notEqual(r.views.A.myTurn ? 'A' : 'B', firstStarter);
    assert.equal(r.views.A.board.players[r.views.A.myIndex].char, 'cat');
    assert.equal(r.views.A.board.turn, 0);
    assert.ok(r.views.A.board.players.every((p) => p.hp === 100));
    assert.equal(r.views.A.scores.find((s) => s.id === winnerId).wins, 1);
});

test('sahte start: host olmayan başlatamaz; kedi host değilse veya tohum bozuksa reddedilir', () => {
    const r = room();
    r.join();
    // host (A) başkasından start kabul etmez
    r.a.onMessage({ type: 'cd_start', first: 'B', round: 9, seed: 5, cat: 'B' });
    assert.equal(r.views.A.round, 1);
    // oyuncu B, host olmayan taraf: oyun sürerken start kabul etmez
    r.b.onMessage({ type: 'cd_start', first: 'B', round: 9, seed: 5, cat: 'A' });
    assert.equal(r.views.B.round, 1);
});

test('rakip ayrılınca abandoned olur', () => {
    const r = room();
    r.join();
    r.clients.A.ctx.players.pop();
    r.a.onMessage({ type: 'player_disconnect', id: 'B' });
    assert.equal(r.views.A.phase, 'abandoned');
    assert.equal(r.views.A.opponent, null);
    assert.equal(r.a.move({ kind: 'heal', turn: 0 }), false);
});
