// Sıra tabanlı iki kişilik oyunlar için ortak protokol ve durum makinesi.
// DOM'a ve WebSocket'e bağlı değildir (Node'da test edilir); oyun, kurallarını (`rules`) ve
// çizimini kendisi verir.
//
// Mesajlar (prefix: oyuna özgü ön ek, örn. 'xox' / 'c4'):
//   <prefix>_start    { first, round }       host gönderir; ilk hamleyi `first` yapar
//   <prefix>_move     { round, ...hamle }    sırası gelen oyuncu gönderir
//   <prefix>_rematch  { round, id }          rövanş oyu
//
// Sunucu mesajı gönderenin kimliğini eklemediği için, odada yalnızca iki oyuncu olduğundan
// gelen her oyun mesajı "diğer oyuncudan" kabul edilir. Gelen her hamle yine de doğrulanır:
// tur numarası, sıra, ve kuralların geçerlilik kontrolü.
//
// rules arayüzü (saf fonksiyonlar):
//   initial(start)                  -> başlangıç tahtası; start = { order, round, ...createStart alanları }
//   parse(data)                     -> mesajdan hamle ya da null
//   toMessage(move)                 -> mesaja eklenecek alanlar
//   validate(board, move, index)    -> bool
//   apply(board, move, index)       -> { board, cell }   (board yeni nesne)
//   result(board)                   -> null | { status:'win', winner:index, line:[...] } | { status:'draw' }
// İsteğe bağlı kancalar (yoksa eski davranış):
//   createStart(info)               -> start mesajına eklenecek alanlar (yalnızca host çağırır).
//                                      info = { random, round, order, hostId, guestId }
//   parseStart(data, info)          -> alınan start mesajından alanları doğrulayıp döndürür; null = reddet
//   messageTypes                    -> hamle mesaj türleri dizisi (varsayılan: [<prefix>_move]);
//                                      toMessage() kendi `type` alanını verebilir
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Duel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // options: { prefix, rules, ctx, onChange(view), random? }
    function create(options) {
        var ctx = options.ctx;
        var rules = options.rules;
        var random = options.random || Math.random;
        var onChange = options.onChange || function () {};
        var T_START = options.prefix + '_start';
        var T_MOVE = options.prefix + '_move';
        var T_REMATCH = options.prefix + '_rematch';
        var MOVE_TYPES = rules.messageTypes || [T_MOVE];

        var state = {
            phase: 'waiting',   // waiting | playing | over | abandoned
            round: 0,
            order: [null, null], // order[0] ilk başlayan, order[1] diğeri (oyuncu id'leri)
            turn: 0,
            board: rules.initial({ order: [null, null], round: 0 }),
            result: null,
            lastCell: null,
            votes: {},
            wins: {},
            names: {},
            draws: 0
        };

        function opponent() {
            for (var i = 0; i < ctx.players.length; i++) {
                if (ctx.players[i].id !== ctx.me.id) return ctx.players[i];
            }
            return null;
        }

        function indexOf(id) {
            return state.order[0] === id ? 0 : (state.order[1] === id ? 1 : -1);
        }

        function remember(player) {
            if (player) state.names[player.id] = player.name;
        }

        function view() {
            var opp = opponent();
            remember(ctx.me);
            remember(opp);
            var myIndex = indexOf(ctx.me.id);
            var ids = [ctx.me.id];
            if (opp) ids.push(opp.id);
            else if (state.order[0] && state.order[0] !== ctx.me.id) ids.push(state.order[0]);
            else if (state.order[1] && state.order[1] !== ctx.me.id) ids.push(state.order[1]);
            return {
                phase: state.phase,
                round: state.round,
                board: state.board,
                result: state.result,
                winnerId: state.result && state.result.status === 'win' ? state.order[state.result.winner] : null,
                turnId: state.phase === 'playing' ? state.order[state.turn] : null,
                lastCell: state.lastCell,
                room: ctx.room,
                me: { id: ctx.me.id, name: ctx.me.name },
                opponent: opp ? { id: opp.id, name: opp.name } : null,
                myIndex: myIndex,
                turnIndex: state.turn,
                myTurn: state.phase === 'playing' && myIndex === state.turn,
                myVoted: !!state.votes[ctx.me.id],
                opponentVoted: !!(opp && state.votes[opp.id]),
                scores: ids.map(function (id) {
                    return { id: id, name: state.names[id] || '?', wins: state.wins[id] || 0, isMe: id === ctx.me.id };
                }),
                draws: state.draws
            };
        }

        function emit() { onChange(view()); }

        function startRound(first, round, extras) {
            var opp = opponent();
            var order = [first, first === ctx.me.id ? opp.id : ctx.me.id];
            state.round = round;
            state.order = order;
            state.turn = 0;
            state.board = rules.initial(Object.assign({}, extras, { order: order.slice(), round: round }));
            state.result = null;
            state.lastCell = null;
            state.votes = {};
            state.phase = 'playing';
        }

        // Yalnızca host çağırır: yeni turu başlatır ve rakibe bildirir.
        function hostStart() {
            var opp = opponent();
            if (!ctx.isHost() || !opp) return;
            var previous = state.order[0];
            var first;
            if (previous === ctx.me.id) first = opp.id;           // rövanşta başlayan değişir
            else if (previous === opp.id) first = ctx.me.id;
            else first = random() < 0.5 ? ctx.me.id : opp.id;     // ilk tur / yeni rakip
            var round = state.round + 1;
            var order = [first, first === ctx.me.id ? opp.id : ctx.me.id];
            var extras = rules.createStart
                ? rules.createStart({ random: random, round: round, order: order, hostId: ctx.me.id, guestId: opp.id })
                : {};
            startRound(first, round, extras);
            ctx.send(Object.assign({}, extras, { type: T_START, first: first, round: round }));
            emit();
        }

        function applyMove(index, move) {
            var applied = rules.apply(state.board, move, index);
            state.board = applied.board;
            state.lastCell = applied.cell;
            var result = rules.result(state.board);
            if (result) {
                state.result = result;
                state.phase = 'over';
                state.votes = {};
                if (result.status === 'win') {
                    var winnerId = state.order[result.winner];
                    state.wins[winnerId] = (state.wins[winnerId] || 0) + 1;
                } else {
                    state.draws++;
                }
            } else {
                state.turn = 1 - state.turn;
            }
        }

        function maybeRematch() {
            var opp = opponent();
            if (state.phase === 'over' && opp && ctx.isHost() && state.votes[ctx.me.id] && state.votes[opp.id]) {
                hostStart();
            }
        }

        function onMessage(data) {
            if (!data || typeof data.type !== 'string') return;
            var opp = opponent();

            if (data.type === 'player_joined') {
                if (state.phase === 'waiting' || state.phase === 'abandoned') hostStart();
                emit();
            } else if (data.type === 'player_disconnect') {
                if (data.id !== ctx.me.id && (state.phase === 'playing' || state.phase === 'over')) {
                    state.phase = 'abandoned';
                    state.votes = {};
                }
                emit();
            } else if (data.type === T_START) {
                // Yalnızca host başlatabilir; host olan taraf başkasından start kabul etmez.
                if (ctx.isHost() || !opp) return;
                if (state.phase === 'playing') return;
                if (!Number.isInteger(data.round) || data.round <= state.round) return;
                if (data.first !== ctx.me.id && data.first !== opp.id) return;
                var extras = {};
                if (rules.parseStart) {
                    var order = [data.first, data.first === ctx.me.id ? opp.id : ctx.me.id];
                    extras = rules.parseStart(data, { order: order, hostId: opp.id, guestId: ctx.me.id });
                    if (extras === null || typeof extras !== 'object') return;
                }
                startRound(data.first, data.round, extras);
                emit();
            } else if (MOVE_TYPES.indexOf(data.type) !== -1) {
                if (state.phase !== 'playing' || !opp) return;
                if (data.round !== state.round) return;
                var oppIndex = indexOf(opp.id);
                if (oppIndex !== state.turn) return;
                var move = rules.parse(data);
                if (move === null || !rules.validate(state.board, move, oppIndex)) return;
                applyMove(oppIndex, move);
                emit();
            } else if (data.type === T_REMATCH) {
                if (state.phase !== 'over' || !opp || data.round !== state.round) return;
                state.votes[opp.id] = true;
                maybeRematch();
                emit();
            }
        }

        // Yerel oyuncunun hamlesi. Geçerliyse uygulanır ve rakibe gönderilir; true döner.
        function move(m) {
            if (state.phase !== 'playing') return false;
            var myIndex = indexOf(ctx.me.id);
            if (myIndex !== state.turn) return false;
            if (!rules.validate(state.board, m, myIndex)) return false;
            applyMove(myIndex, m);
            var msg = rules.toMessage(m);
            if (!msg.type) msg.type = T_MOVE;
            msg.round = state.round;
            ctx.send(msg);
            emit();
            return true;
        }

        function rematch() {
            if (state.phase !== 'over' || !opponent() || state.votes[ctx.me.id]) return;
            state.votes[ctx.me.id] = true;
            ctx.send({ type: T_REMATCH, round: state.round, id: ctx.me.id });
            maybeRematch();
            emit();
        }

        function start() {
            if (opponent()) hostStart();
            emit();
        }

        return { start: start, onMessage: onMessage, move: move, rematch: rematch, getView: view };
    }

    return { create: create };
});
