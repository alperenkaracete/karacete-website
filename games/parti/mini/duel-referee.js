// Parti düello hakemi: DOM'suz, saf. Düellodaki iki oyuncunun ağ mesajlarını (core/duel.js protokolü) `*-rules.js`
// kurallarıyla yeniden oynatıp sonucu bulur. Böylece Duel/oyun dosyalarına dokunulmadan, düelloda olmayan lider de
// sonucu hesaplayabilir.
//
//   create({ prefix, rules, players:[ev sahibi, konuk], limit?, onLimit?, onUpdate? })
//     onUpdate(): kabul edilen her mesajdan ve sıfırlamadan sonra bir kez (Parti izleme anlık görüntüsü için)
//     limit = { shots: n, counts(move) -> bool }: SAYILAN hamlelerden her oyuncu n tane yapınca (ve oyun kendi kendine bitmediyse)
//     oyun biter; sıralamayı rules.partial verir (yoksa beraberlik). onLimit(ranking) bir kez çağrılır.
//   feed(from, msg)  -> true: mesaj kabul edildi (günlüğe yazıldı)
//   outcome()        -> null | { ranking, reason:'win'|'draw' }
//   timeout()        -> ranking (bitmemiş oyun: rules.partial(board, order) varsa o, null/yoksa beraberlik)
//   forfeit(id)      -> ranking ([[kalan],[id]])
//   log() / reset() / board() (son tahta; Parti son hamlenin animasyon süresini buradan okur)
//   state()          -> { phase, order, turn, board, result, shots } (salt okunur kopya alanları; izleme anlık görüntüsü)
//
// ranking: [[kazanan],[kaybeden]] ya da beraberlikte [[a,b]]. Oyuncu 0 = `players[0]` = oyunun isHost() tarafı.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiDuelReferee = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function create(options) {
        var rules = options.rules;
        var prefix = options.prefix;
        var players = options.players.slice(0, 2);
        var T_START = prefix + '_start';
        var MOVE_TYPES = rules.messageTypes || [prefix + '_move'];
        var limit = options.limit || null;
        var st;
        var ready = false;

        function updated() { if (ready && options.onUpdate) options.onUpdate(); }

        function reset() {
            st = { phase: 'waiting', round: 0, order: [null, null], turn: 0, board: null, result: null, log: [], shots: [0, 0] };
            updated();
        }
        reset();
        ready = true;

        function other(id) { return players[0] === id ? players[1] : players[0]; }
        function draw() { return [players.slice()]; }

        function feed(from, m) {
            if (!m || typeof m.type !== 'string' || players.indexOf(from) < 0) return false;
            if (m.type === T_START) {
                // Tek tur: yalnızca ev sahibinin ilk start'ı geçer (rövanş kapalı, tekrarlar yok sayılır)
                if (from !== players[0] || st.phase !== 'waiting' || m.round !== 1) return false;
                if (players.indexOf(m.first) < 0) return false;
                var order = [m.first, other(m.first)];
                var extras = {};
                if (rules.parseStart) {
                    extras = rules.parseStart(m, { order: order, hostId: players[0], guestId: players[1] });
                    if (extras === null || typeof extras !== 'object') return false;
                }
                st.order = order;
                st.round = 1;
                st.turn = 0;
                st.board = rules.initial(Object.assign({}, extras, { order: order.slice(), round: 1 }));
                st.phase = 'playing';
                st.log.push({ f: from, m: m });
                updated();
                return true;
            }
            if (MOVE_TYPES.indexOf(m.type) < 0) return false;
            if (st.phase !== 'playing' || m.round !== st.round) return false;
            var index = st.order.indexOf(from);
            if (index !== st.turn) return false;
            var move = rules.parse(m);
            if (move === null || !rules.validate(st.board, move, index)) return false;
            st.board = rules.apply(st.board, move, index).board;
            st.log.push({ f: from, m: m });
            var res = rules.result(st.board);
            if (res) {
                st.phase = 'over';
                st.result = res.status === 'win'
                    ? { ranking: [[st.order[res.winner]], [st.order[1 - res.winner]]], reason: 'win' }
                    : { ranking: draw(), reason: 'draw' };
            } else {
                st.turn = 1 - st.turn;
                if (limit && limit.counts(move)) {
                    st.shots[players.indexOf(from)]++;
                    if (st.shots[0] >= limit.shots && st.shots[1] >= limit.shots) {
                        st.phase = 'over';
                        st.result = { ranking: partialRanking(), reason: 'limit' };
                        if (options.onLimit) options.onLimit(st.result.ranking);
                    }
                }
            }
            updated();
            return true;
        }

        function partialRanking() {
            var p = rules.partial && st.board ? rules.partial(st.board, st.order) : null;
            return p || draw();
        }

        function outcome() { return st.result; }

        function timeout() {
            if (st.result) return st.result.ranking;
            return st.phase === 'playing' ? partialRanking() : draw();
        }

        function forfeit(id) {
            if (st.result) return st.result.ranking;
            return [[other(id)], [id]];
        }

        return {
            feed: feed, outcome: outcome, timeout: timeout, forfeit: forfeit, reset: reset,
            log: function () { return st.log.slice(); },
            shots: function () { return st.shots.slice(); },
            board: function () { return st.board; },
            state: function () { return { phase: st.phase, order: st.order.slice(), turn: st.turn, board: st.board, result: st.result, shots: st.shots.slice() }; },
            phase: function () { return st.phase; }
        };
    }

    return { create: create };
});
