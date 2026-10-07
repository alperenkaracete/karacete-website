// Parti düello hakemi: DOM'suz, saf. Düellodaki iki oyuncunun ağ mesajlarını (core/duel.js protokolü) `*-rules.js`
// kurallarıyla yeniden oynatıp sonucu bulur. Böylece Duel/oyun dosyalarına dokunulmadan, düelloda olmayan lider de
// sonucu hesaplayabilir.
//
//   create({ prefix, rules, players:[ev sahibi, konuk] })
//   feed(from, msg)  -> true: mesaj kabul edildi (günlüğe yazıldı)
//   outcome()        -> null | { ranking, reason:'win'|'draw' }
//   timeout()        -> ranking (bitmemiş oyun: rules.partial varsa o, yoksa beraberlik)
//   forfeit(id)      -> ranking ([[kalan],[id]])
//   log() / reset()
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
        var st;

        function reset() {
            st = { phase: 'waiting', round: 0, order: [null, null], turn: 0, board: null, result: null, log: [] };
        }
        reset();

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
            }
            return true;
        }

        function outcome() { return st.result; }

        function timeout() {
            if (st.result) return st.result.ranking;
            if (st.phase === 'playing' && rules.partial) {
                var p = rules.partial(st.board, st.order);
                if (p) return p;
            }
            return draw();
        }

        function forfeit(id) {
            if (st.result) return st.result.ranking;
            return [[other(id)], [id]];
        }

        return {
            feed: feed, outcome: outcome, timeout: timeout, forfeit: forfeit, reset: reset,
            log: function () { return st.log.slice(); },
            phase: function () { return st.phase; }
        };
    }

    return { create: create };
});
