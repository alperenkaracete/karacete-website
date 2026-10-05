// XOX (tic-tac-toe) kuralları: saf fonksiyonlar, DOM ve ağdan bağımsız.
// Tahta: 9 elemanlı dizi; null = boş, 0/1 = oyuncu indeksi (0 ilk başlayan).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.XoxRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var LINES = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],   // satırlar
        [0, 3, 6], [1, 4, 7], [2, 5, 8],   // sütunlar
        [0, 4, 8], [2, 4, 6]               // çaprazlar
    ];

    function initial() {
        return [null, null, null, null, null, null, null, null, null];
    }

    // Mesaj: { type:'xox_move', cell: 0..8 }
    function parse(data) {
        return Number.isInteger(data.cell) ? { cell: data.cell } : null;
    }

    function toMessage(move) {
        return { cell: move.cell };
    }

    function validate(board, move, index) {
        if (index !== 0 && index !== 1) return false;
        if (!move || !Number.isInteger(move.cell)) return false;
        if (move.cell < 0 || move.cell > 8) return false;
        return board[move.cell] === null;
    }

    function apply(board, move, index) {
        var next = board.slice();
        next[move.cell] = index;
        return { board: next, cell: move.cell };
    }

    function result(board) {
        for (var i = 0; i < LINES.length; i++) {
            var l = LINES[i];
            var v = board[l[0]];
            if (v !== null && v === board[l[1]] && v === board[l[2]]) {
                return { status: 'win', winner: v, line: l.slice() };
            }
        }
        for (var c = 0; c < 9; c++) {
            if (board[c] === null) return null;
        }
        return { status: 'draw' };
    }

    return { LINES: LINES, initial: initial, parse: parse, toMessage: toMessage, validate: validate, apply: apply, result: result };
});
