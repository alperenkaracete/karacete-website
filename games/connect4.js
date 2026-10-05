// Dörtlü Bağla: iki kişilik, sıra tabanlı. Kurallar games/connect4-rules.js, ortak protokol
// core/duel.js, ortak arayüz core/duel-ui.js içindedir; bu dosya yalnızca tahtayı çizer.
(function () {
    var NAMES = ['🔴 Kırmızı', '🟡 Sarı'];   // 0 = ilk başlayan
    var DISC_CLASS = ['red', 'yellow'];

    var ui = null;
    var duel = null;
    var columns = [];   // her sütun: { button, cells: [6 hücre, üstten alta] }

    function markText(index) {
        return NAMES[index] || '?';
    }

    function render(view) {
        var C = Connect4Rules;
        var winLine = view.result && view.result.status === 'win' ? view.result.line : [];
        for (var col = 0; col < C.COLS; col++) {
            var column = columns[col];
            var full = view.board[col] !== null;   // üst satır dolu
            column.button.disabled = !(view.myTurn && !full);
            column.button.setAttribute('aria-label', (col + 1) + '. sütun' + (full ? ', dolu' : ''));
            for (var row = 0; row < C.ROWS; row++) {
                var index = row * C.COLS + col;
                var owner = view.board[index];
                var cell = column.cells[row];
                var cls = 'c4-cell';
                if (owner !== null) cls += ' disc ' + DISC_CLASS[owner];
                if (view.lastCell === index) cls += ' drop';
                if (winLine.indexOf(index) !== -1) cls += ' win';
                cell.className = cls;
                // Düşme animasyonu: taşın kaç satır düştüğü
                cell.style.setProperty('--drop-rows', String(row + 1));
            }
        }
        ui.update(view, markText);
    }

    function init(ctx) {
        var C = Connect4Rules;
        ui = DuelUI.mount(ctx.root, {
            title: 'Dörtlü Bağla',
            onRematch: function () { duel.rematch(); },
            onLeave: function () { ctx.leave(); }
        });
        ui.boardEl.classList.add('c4-board');
        columns = [];
        for (var col = 0; col < C.COLS; col++) {
            (function (c) {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'c4-column';
                button.addEventListener('click', function () { duel.move({ col: c }); });
                var cells = [];
                for (var r = 0; r < C.ROWS; r++) {
                    var cell = document.createElement('span');
                    cell.className = 'c4-cell';
                    button.appendChild(cell);
                    cells.push(cell);
                }
                ui.boardEl.appendChild(button);
                columns.push({ button: button, cells: cells });
            })(col);
        }
        duel = Duel.create({ prefix: 'c4', rules: Connect4Rules, ctx: ctx, onChange: render });
        duel.start();
    }

    function onMessage(data) {
        if (duel) duel.onMessage(data);
    }

    function destroy() {
        if (ui) ui.destroy();
        ui = null;
        duel = null;
        columns = [];
    }

    Games.register({
        id: 'connect4',
        name: 'Dörtlü Bağla',
        icon: '🔴',
        tagline: '2 oyuncu · sıra tabanlı',
        maxPlayers: 2,
        init: init,
        onMessage: onMessage,
        destroy: destroy
    });
})();
