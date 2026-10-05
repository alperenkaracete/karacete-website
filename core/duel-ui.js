// İki kişilik sıra tabanlı oyunların ortak arayüz kabuğu: skor, sıra göstergesi, durum metni,
// bekleme / "rakip ayrıldı" paneli ve rövanş düğmesi. Tahtayı oyun kendisi çizer.
// Oyun, Duel görünümünü (view) `update` ile verir; tüm metinler Türkçe ve textContent ile yazılır.
window.DuelUI = (function () {
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // opts: { title, onRematch(), onLeave() }
    function mount(root, opts) {
        root.textContent = '';
        var wrap = el('div', 'duel');

        var scores = el('div', 'duel-scores');
        var status = el('div', 'duel-status');
        status.setAttribute('role', 'status');
        var boardWrap = el('div', 'duel-board-wrap');
        var boardEl = el('div', 'duel-board');
        var overlay = el('div', 'duel-overlay');
        var actions = el('div', 'duel-actions');
        var rematchBtn = el('button', 'duel-btn primary', 'Rövanş');
        rematchBtn.type = 'button';
        var leaveBtn = el('button', 'duel-btn secondary', 'Lobiye Dön');
        leaveBtn.type = 'button';

        rematchBtn.addEventListener('click', function () { opts.onRematch(); });
        leaveBtn.addEventListener('click', function () { opts.onLeave(); });

        boardWrap.append(boardEl, overlay);
        actions.append(rematchBtn, leaveBtn);
        wrap.append(el('h2', 'duel-title', opts.title), scores, status, boardWrap, actions);
        root.appendChild(wrap);

        function renderScores(view) {
            scores.textContent = '';
            view.scores.forEach(function (s, i) {
                if (i === 1) {
                    var draws = el('div', 'duel-draws');
                    draws.append(el('small', '', 'Berabere'), el('strong', '', String(view.draws)));
                    scores.appendChild(draws);
                }
                var chip = el('div', 'duel-score' + (s.isMe ? ' me' : '') + (view.turnId === s.id ? ' active' : ''));
                chip.append(el('span', 'duel-score-name', s.isMe ? s.name + ' (sen)' : s.name),
                            el('strong', 'duel-score-wins', String(s.wins)));
                scores.appendChild(chip);
            });
            if (view.scores.length === 1) {
                var draws2 = el('div', 'duel-draws');
                draws2.append(el('small', '', 'Berabere'), el('strong', '', String(view.draws)));
                scores.appendChild(draws2);
                scores.appendChild(el('div', 'duel-score waiting', 'Rakip yok'));
            }
        }

        function renderOverlay(view) {
            overlay.textContent = '';
            if (view.phase === 'waiting' && !view.opponent) {
                overlay.className = 'duel-overlay show';
                overlay.append(
                    el('strong', 'duel-overlay-title', 'Rakip bekleniyor…'),
                    el('span', 'duel-overlay-hint', 'Arkadaşına bu oda kodunu ver:'),
                    el('span', 'duel-room-code', view.room),
                    el('span', 'duel-overlay-hint', 'Ya da yukarıdaki "Bağlantıyı Paylaş" ile davet gönder.')
                );
            } else if (view.phase === 'abandoned') {
                overlay.className = 'duel-overlay show';
                overlay.append(
                    el('strong', 'duel-overlay-title', 'Rakip ayrıldı'),
                    el('span', 'duel-overlay-hint', 'Aynı kodla yeni biri katılırsa oyun yeniden başlar:'),
                    el('span', 'duel-room-code', view.room)
                );
                var back = el('button', 'duel-btn primary', 'Lobiye Dön');
                back.type = 'button';
                back.addEventListener('click', function () { opts.onLeave(); });
                overlay.appendChild(back);
            } else {
                overlay.className = 'duel-overlay';
            }
        }

        function statusText(view, markText) {
            var opp = view.opponent ? view.opponent.name : 'Rakip';
            if (view.phase === 'waiting') {
                return view.opponent ? 'Oyun başlıyor…' : 'Rakip bekleniyor…';
            }
            if (view.phase === 'abandoned') return 'Rakip ayrıldı';
            if (view.phase === 'playing') {
                var mine = 'Sen: ' + markText(view.myIndex);
                return view.myTurn ? 'Sıra sende! (' + mine + ')' : 'Sıra ' + opp + ' oyuncusunda (' + mine + ')';
            }
            // over
            if (view.result.status === 'draw') return 'Berabere! 🤝';
            return view.winnerId === view.me.id ? 'Kazandın! 🎉' : opp + ' kazandı';
        }

        function update(view, markText) {
            renderScores(view);
            renderOverlay(view);

            status.textContent = statusText(view, markText);
            status.className = 'duel-status ' + (
                view.phase === 'playing' ? (view.myTurn ? 'my-turn' : 'their-turn') :
                view.phase === 'over' ? (view.result.status === 'draw' ? 'draw' : (view.winnerId === view.me.id ? 'won' : 'lost')) :
                'idle');

            var over = view.phase === 'over';
            actions.className = 'duel-actions' + (over ? ' show' : '');
            rematchBtn.disabled = view.myVoted;
            rematchBtn.textContent = view.myVoted ? 'Rakip bekleniyor…' :
                (view.opponentVoted ? 'Rövanş (rakip hazır!)' : 'Rövanş');
            boardWrap.classList.toggle('inactive', view.phase !== 'playing');
        }

        function destroy() {
            root.textContent = '';
        }

        return { boardEl: boardEl, update: update, destroy: destroy };
    }

    return { mount: mount };
})();
