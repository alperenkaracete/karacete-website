// XOX: iki kişilik, sıra tabanlı. Kurallar games/xox-rules.js, ortak protokol core/duel.js,
// ortak arayüz core/duel-ui.js içindedir; bu dosya yalnızca tahtayı çizer.
(function () {
    var MARKS = ['X', 'O'];   // 0 = ilk başlayan

    var ui = null;
    var duel = null;
    var cells = [];

    function markText(index) {
        return MARKS[index] || '?';
    }

    function render(view) {
        var winLine = view.result && view.result.status === 'win' ? view.result.line : [];
        for (var i = 0; i < 9; i++) {
            var owner = view.board[i];
            var cell = cells[i];
            var cls = 'xox-cell';
            if (owner !== null) cls += owner === 0 ? ' mark-x' : ' mark-o';
            if (winLine.indexOf(i) !== -1) cls += ' win';
            if (view.lastCell === i) cls += ' last';
            cell.className = cls;
            cell.textContent = owner === null ? '' : MARKS[owner];
            cell.disabled = !(view.myTurn && owner === null);
            cell.setAttribute('aria-label', 'Hücre ' + (i + 1) + (owner === null ? ', boş' : ', ' + MARKS[owner]));
        }
        ui.update(view, markText);
    }

    function init(ctx) {
        ui = DuelUI.mount(ctx.root, {
            title: 'XOX',
            onRematch: function () { duel.rematch(); },
            onLeave: function () { ctx.leave(); }
        });
        ui.boardEl.classList.add('xox-board');
        cells = [];
        for (var i = 0; i < 9; i++) {
            (function (index) {
                var cell = document.createElement('button');
                cell.type = 'button';
                cell.addEventListener('click', function () { duel.move({ cell: index }); });
                ui.boardEl.appendChild(cell);
                cells.push(cell);
            })(i);
        }
        duel = Duel.create({ prefix: 'xox', rules: XoxRules, ctx: ctx, onChange: render });
        duel.start();
    }

    function onMessage(data) {
        if (duel) duel.onMessage(data);
    }

    function destroy() {
        if (ui) ui.destroy();
        ui = null;
        duel = null;
        cells = [];
    }

    Games.register({
        id: 'xox',
        name: 'XOX',
        icon: '⭕',
        tagline: '2 oyuncu · sıra tabanlı',
        maxPlayers: 2,
        init: init,
        onMessage: onMessage,
        destroy: destroy
    });
})();
