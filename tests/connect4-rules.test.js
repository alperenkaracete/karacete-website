const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/connect4-rules.js');

function boardWith(cells, player) {
    const b = C.initial();
    cells.forEach((c) => { b[c] = player; });
    return b;
}

test('başlangıç tahtası 7x6 boş, sonuç yok', () => {
    const b = C.initial();
    assert.equal(b.length, 42);
    assert.ok(b.every((c) => c === null));
    assert.equal(C.result(b), null);
});

test('toplam 69 kazanma çizgisi: 24 yatay + 21 dikey + 12 + 12 çapraz', () => {
    assert.equal(C.LINES.length, 69);
});

test('tüm çizgiler kazanç sayılır (iki oyuncu için de)', () => {
    for (const line of C.LINES) {
        for (const player of [0, 1]) {
            assert.deepEqual(C.result(boardWith(line, player)), { status: 'win', winner: player, line });
        }
    }
});

test('üç taş kazanç değildir; kesintili dörtlü kazanç değildir', () => {
    assert.equal(C.result(boardWith([35, 36, 37], 0)), null);
    assert.equal(C.result(boardWith([35, 36, 38, 39], 0)), null);
});

test('satır sonundan taşan yatay dizi kazanç değildir', () => {
    // alt satır: 5,6 sütunları ve bir alttaki satırın 0,1 sütunları arka arkaya görünür
    const b = boardWith([4, 5, 6, 7], 0); // 4,5,6 satır 0'ın sonu; 7 satır 1'in başı
    assert.equal(C.result(b), null);
});

test('yerçekimi: taş en alt boş satıra düşer ve yığılır', () => {
    let b = C.initial();
    let r = C.apply(b, { col: 3 }, 0);
    assert.equal(r.cell, 5 * 7 + 3);
    b = r.board;
    r = C.apply(b, { col: 3 }, 1);
    assert.equal(r.cell, 4 * 7 + 3);
    assert.equal(r.board[5 * 7 + 3], 0);
    assert.equal(r.board[4 * 7 + 3], 1);
});

test('apply: yeni tahta döndürür, eskisini değiştirmez', () => {
    const b = C.initial();
    C.apply(b, { col: 0 }, 0);
    assert.ok(b.every((c) => c === null));
});

test('dolu sütun geçersiz, diğer sütunlar geçerli', () => {
    let b = C.initial();
    for (let i = 0; i < 6; i++) b = C.apply(b, { col: 2 }, i % 2).board;
    assert.equal(C.validate(b, { col: 2 }, 0), false);
    assert.equal(C.validate(b, { col: 1 }, 0), true);
    assert.equal(C.landingRow(b, 2), -1);
});

test('geçersiz hamleler: aralık dışı, tip hataları, bilinmeyen oyuncu', () => {
    const b = C.initial();
    assert.equal(C.validate(b, { col: -1 }, 0), false);
    assert.equal(C.validate(b, { col: 7 }, 0), false);
    assert.equal(C.validate(b, { col: 2.5 }, 0), false);
    assert.equal(C.validate(b, { col: '2' }, 0), false);
    assert.equal(C.validate(b, null, 0), false);
    assert.equal(C.validate(b, { col: 2 }, 2), false);
});

test('parse: yalnızca tam sayı sütunu kabul eder', () => {
    assert.deepEqual(C.parse({ type: 'c4_move', col: 3 }), { col: 3 });
    assert.equal(C.parse({ type: 'c4_move' }), null);
    assert.equal(C.parse({ type: 'c4_move', col: '3' }), null);
});

test('dikey kazanç oynayarak elde edilir', () => {
    let b = C.initial();
    // oyuncu 0 sütun 0'a, oyuncu 1 sütun 1'e oynar
    for (let i = 0; i < 3; i++) {
        b = C.apply(b, { col: 0 }, 0).board;
        b = C.apply(b, { col: 1 }, 1).board;
        assert.equal(C.result(b), null);
    }
    b = C.apply(b, { col: 0 }, 0).board;
    const r = C.result(b);
    assert.equal(r.status, 'win');
    assert.equal(r.winner, 0);
    assert.deepEqual(r.line, [14, 21, 28, 35]);
});

test('beraberlik: dolu tahta ve kazanç yok', () => {
    // Sütun başına bloklar halinde değişen desen: hiçbir yönde dörtlü oluşmaz.
    const pattern = [
        [0, 0, 1, 1, 0, 0, 1],
        [1, 1, 0, 0, 1, 1, 0],
        [0, 0, 1, 1, 0, 0, 1],
        [1, 1, 0, 0, 1, 1, 0],
        [0, 0, 1, 1, 0, 0, 1],
        [1, 1, 0, 0, 1, 1, 0]
    ];
    const b = [].concat(...pattern);
    assert.deepEqual(C.result(b), { status: 'draw' });
});

test('dolu tahtada dörtlü varsa sonuç beraberlik değil kazançtır', () => {
    const b = boardWith([35, 36, 37, 38], 1);
    for (let i = 0; i < 42; i++) if (b[i] === null) b[i] = 0;
    assert.equal(C.result(b).status, 'win');
});
