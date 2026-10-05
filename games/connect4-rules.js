// Dörtlü Bağla kuralları: saf fonksiyonlar, DOM ve ağdan bağımsız.
// Tahta: 42 elemanlı dizi, satır sıralı (indeks = satır * 7 + sütun), satır 0 en üsttür.
// null = boş, 0/1 = oyuncu indeksi (0 ilk başlayan).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Connect4Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var COLS = 7;
    var ROWS = 6;

    // Tüm dörtlü çizgiler (yatay, dikey, iki çapraz yön).
    var LINES = (function () {
        var lines = [];
        var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]; // [satır adımı, sütun adımı]
        for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
                for (var d = 0; d < dirs.length; d++) {
                    var endR = r + 3 * dirs[d][0];
                    var endC = c + 3 * dirs[d][1];
                    if (endR < 0 || endR >= ROWS || endC < 0 || endC >= COLS) continue;
                    var line = [];
                    for (var k = 0; k < 4; k++) {
                        line.push((r + k * dirs[d][0]) * COLS + (c + k * dirs[d][1]));
                    }
                    lines.push(line);
                }
            }
        }
        return lines;
    })();

    function initial() {
        var board = [];
        for (var i = 0; i < COLS * ROWS; i++) board.push(null);
        return board;
    }

    // Taşın düşeceği satır; sütun doluysa -1.
    function landingRow(board, col) {
        for (var r = ROWS - 1; r >= 0; r--) {
            if (board[r * COLS + col] === null) return r;
        }
        return -1;
    }

    // Mesaj: { type:'c4_move', col: 0..6 }
    function parse(data) {
        return Number.isInteger(data.col) ? { col: data.col } : null;
    }

    function toMessage(move) {
        return { col: move.col };
    }

    function validate(board, move, index) {
        if (index !== 0 && index !== 1) return false;
        if (!move || !Number.isInteger(move.col)) return false;
        if (move.col < 0 || move.col >= COLS) return false;
        return landingRow(board, move.col) !== -1;
    }

    function apply(board, move, index) {
        var row = landingRow(board, move.col);
        var cell = row * COLS + move.col;
        var next = board.slice();
        next[cell] = index;
        return { board: next, cell: cell };
    }

    function result(board) {
        for (var i = 0; i < LINES.length; i++) {
            var l = LINES[i];
            var v = board[l[0]];
            if (v !== null && v === board[l[1]] && v === board[l[2]] && v === board[l[3]]) {
                return { status: 'win', winner: v, line: l.slice() };
            }
        }
        for (var c = 0; c < COLS; c++) {
            if (board[c] === null) return null; // üst satırda boş yer var
        }
        return { status: 'draw' };
    }

    return {
        COLS: COLS, ROWS: ROWS, LINES: LINES,
        initial: initial, landingRow: landingRow, parse: parse, toMessage: toMessage,
        validate: validate, apply: apply, result: result
    };
});
