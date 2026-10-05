const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../games/xox-rules.js');

function boardWith(cells, player) {
    const b = X.initial();
    cells.forEach((c) => { b[c] = player; });
    return b;
}

test('başlangıç tahtası boş ve sonuç yok', () => {
    const b = X.initial();
    assert.equal(b.length, 9);
    assert.ok(b.every((c) => c === null));
    assert.equal(X.result(b), null);
});

test('8 kazanma çizgisinin hepsi, iki oyuncu için de kazanç sayılır', () => {
    assert.equal(X.LINES.length, 8);
    for (const line of X.LINES) {
        for (const player of [0, 1]) {
            const r = X.result(boardWith(line, player));
            assert.deepEqual(r, { status: 'win', winner: player, line });
        }
    }
});

test('iki taş yetmez, farklı oyuncuların taşları kazanç değildir', () => {
    assert.equal(X.result(boardWith([0, 1], 0)), null);
    const b = X.initial();
    b[0] = 0; b[1] = 1; b[2] = 0;
    assert.equal(X.result(b), null);
});

test('beraberlik: dolu tahta ve çizgi yok', () => {
    // X O X
    // X O O
    // O X X
    const marks = [0, 1, 0, 0, 1, 1, 1, 0, 0];
    assert.deepEqual(X.result(marks), { status: 'draw' });
});

test('son hamlede kazanılan dolu tahta beraberlik değil, kazançtır', () => {
    // X O X
    // O X O
    // O X X   -> 0,4,8 çaprazı X'in
    const marks = [0, 1, 0, 1, 0, 1, 1, 0, 0];
    const r = X.result(marks);
    assert.equal(r.status, 'win');
    assert.equal(r.winner, 0);
});

test('hamle doğrulama: boş hücre geçerli', () => {
    const b = X.initial();
    assert.equal(X.validate(b, { cell: 4 }, 0), true);
    assert.equal(X.validate(b, { cell: 0 }, 1), true);
    assert.equal(X.validate(b, { cell: 8 }, 0), true);
});

test('hamle doğrulama: dolu hücre, aralık dışı ve tip hataları geçersiz', () => {
    const b = X.initial();
    b[4] = 0;
    assert.equal(X.validate(b, { cell: 4 }, 1), false);
    assert.equal(X.validate(b, { cell: -1 }, 0), false);
    assert.equal(X.validate(b, { cell: 9 }, 0), false);
    assert.equal(X.validate(b, { cell: 1.5 }, 0), false);
    assert.equal(X.validate(b, { cell: '3' }, 0), false);
    assert.equal(X.validate(b, { cell: null }, 0), false);
    assert.equal(X.validate(b, null, 0), false);
    assert.equal(X.validate(b, { cell: 3 }, 2), false);
});

test('parse: yalnızca tam sayı hücreyi kabul eder', () => {
    assert.deepEqual(X.parse({ type: 'xox_move', cell: 4 }), { cell: 4 });
    assert.equal(X.parse({ type: 'xox_move' }), null);
    assert.equal(X.parse({ type: 'xox_move', cell: '4' }), null);
    assert.equal(X.parse({ type: 'xox_move', cell: 4.2 }), null);
});

test('apply: yeni tahta döndürür, eskisini değiştirmez', () => {
    const b = X.initial();
    const { board, cell } = X.apply(b, { cell: 5 }, 1);
    assert.equal(cell, 5);
    assert.equal(board[5], 1);
    assert.equal(b[5], null);
});
