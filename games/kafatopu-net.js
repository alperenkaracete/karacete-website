// Kafa Topu ağ/maç denetleyicisi: DOM'suz, saat ve gönderim enjekte edilir (Node'da test edilir).
//
// Mimari: oda kurucusu = otorite. Fizik (rules.step) yalnızca kurucuda, sabit 1/60 sn adımla çalışır;
// kurucu ~30 Hz `kt_state` anlık görüntüsü yollar. Katılan oyuncu yalnızca `kt_input` yollar (değişince)
// ve gelen görüntüleri ~100 ms gecikmeyle interpolasyonla çizer.
//
// Mesajlar:
//   kt_profile {id, face}     her iki yön; yüz (emoji ya da küçük JPEG data URL)
//   kt_ready                  her iki yön; "hazırım"
//   kt_start {round, swap}    kurucu -> katılan; maç (3-2-1 geri sayımı dahil) başladı
//   kt_input {left,right,jump,kick}   katılan -> kurucu; yalnızca değişince
//   kt_state {t,ph,cd,tm,g,sc,p,b}    kurucu -> katılan; ~30 Hz
//   kt_goal {scorer,score,golden}     kurucu -> katılan; güvenilir olay
//   kt_end {winner,score,reason}      kurucu -> katılan; güvenilir olay
//   kt_rematch                her yön; rövanş oyu (iki oy => kurucu yeni maçı başlatır, taraflar değişir)
//
// Sunucu gönderen kimliğini eklemediği için, oda 2 kişilik olduğundan gelen mesaj "diğer oyuncudan"
// sayılır; her taraf yalnızca kendi rolüne uygun mesajları kabul eder.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KafaTopuNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var INTERP_DELAY = 100;        // ms
    var SEND_EVERY_STEPS = 2;      // 60 Hz / 2 = 30 Hz
    var MAX_STEPS_PER_TICK = 5;
    var MAX_FRAME_MS = 100;
    var BUFFER_SIZE = 40;
    var STALE_MS = 1000;
    var OFFSET_WINDOW = 60;        // ~2 sn (30 Hz)
    var OFFSET_SLEW_MS = 1;
    var OFFSET_SNAP_MS = 100;

    // options: { ctx, rules, onChange(view)?, onEvent(ev)?, now()?, matchOptions? }
    function create(options) {
        var ctx = options.ctx;
        var rules = options.rules;
        var now = options.now || function () { return Date.now(); };
        var onChange = options.onChange || function () {};
        var onEvent = options.onEvent || function () {};
        var matchOptions = options.matchOptions || {};
        var amHost = ctx.isHost();     // başlangıçta bir kez: kurucu ayrılırsa kalan oyuncu otorite olmaz

        var st = {
            mode: 'setup',             // setup | wait | match | over | abandoned
            round: 0,
            swap: false,
            face: { me: null, opp: null },
            ready: { me: false, opp: false },
            votes: { me: false, opp: false },
            wins: {},
            result: null,              // { winner, score, reason } (oyuncu indeksi, 0 = kurucu)
            // kurucu
            sim: null,
            inputs: [rules.emptyInput(), rules.emptyInput()],
            acc: 0,
            lastTick: null,
            stepsSinceSend: 0,
            // katılan
            buffer: [],
            offset: null,
            ests: [],
            lastRecv: 0,
            lastSentInput: rules.emptyInput(),
            localInput: rules.emptyInput(),
            lastSnapshot: null
        };

        function opponent() {
            for (var i = 0; i < ctx.players.length; i++) {
                if (ctx.players[i].id !== ctx.me.id) return ctx.players[i];
            }
            return null;
        }

        function myIndex() { return amHost ? 0 : 1; }

        function send(msg) { ctx.send(msg); }

        // ---- Görünüm ----
        function frameNow(t) {
            if (amHost) return st.sim ? rules.frame(st.sim) : null;
            if (!st.buffer.length) return null;
            var renderT = st.offset === null ? st.buffer[st.buffer.length - 1].t : (t - st.offset - INTERP_DELAY);
            return rules.sample(st.buffer, renderT);
        }

        function sessionWins() {
            var opp = opponent();
            return [st.wins[ctx.me.id] || 0, opp ? (st.wins[opp.id] || 0) : 0];
        }

        function view() {
            var t = now();
            var opp = opponent();
            return {
                mode: st.mode,
                isHost: amHost,
                me: { id: ctx.me.id, name: ctx.me.name, face: st.face.me, ready: st.ready.me, index: myIndex() },
                opponent: opp ? { id: opp.id, name: opp.name, face: st.face.opp, ready: st.ready.opp } : null,
                room: ctx.room,
                round: st.round,
                swap: st.swap,
                frame: st.mode === 'match' || st.mode === 'over' ? (frameNow(t) || st.lastSnapshot) : null,
                result: st.result,
                wins: sessionWins(),                 // [ben, rakip]
                myVoted: st.votes.me,
                opponentVoted: st.votes.opp,
                stale: !amHost && st.mode === 'match' && st.buffer.length > 0 && (t - st.lastRecv) > STALE_MS
            };
        }

        function emit() { onChange(view()); }

        // ---- Yüz ve hazır ----
        function sendProfile() {
            if (st.face.me !== null) send({ type: 'kt_profile', id: ctx.me.id, face: st.face.me });
        }

        function setFace(face) {
            var ok = rules.validateFace(face);
            if (ok === null) return false;
            st.face.me = ok;
            if (opponent()) sendProfile();
            emit();
            return true;
        }

        function ready() {
            if (st.face.me === null) return false;
            if (st.mode !== 'setup') return false;
            st.ready.me = true;
            st.mode = 'wait';
            if (opponent()) {                    // rakip yokken gönderilecek kimse yok; katılınca yeniden yollanır
                sendProfile();
                send({ type: 'kt_ready' });
            }
            maybeStart();
            emit();
            return true;
        }

        // ---- Kurucu: maç başlatma ----
        function startMatch(round, swap) {
            var opp = opponent();
            if (!amHost || !opp) return;
            st.round = round;
            st.swap = swap;
            st.sim = rules.createState(Object.assign({}, matchOptions, { swap: swap }));
            st.inputs[1] = rules.emptyInput();      // önceki maçtan kalan tuş durumu taşınmasın
            st.mode = 'match';
            st.result = null;
            st.votes = { me: false, opp: false };
            st.acc = 0;
            st.lastTick = null;
            st.stepsSinceSend = 0;
            send({ type: 'kt_start', round: round, swap: swap });
            sendSnapshot();
        }

        function maybeStart() {
            if (!amHost || !opponent()) return;
            if ((st.mode === 'wait') && st.ready.me && st.ready.opp) startMatch(st.round + 1, false);
        }

        function maybeRematch() {
            if (!amHost || st.mode !== 'over' || !opponent()) return;
            if (st.votes.me && st.votes.opp) startMatch(st.round + 1, !st.swap);
        }

        function rematch() {
            if (st.mode !== 'over' || !opponent() || st.votes.me) return false;
            st.votes.me = true;
            send({ type: 'kt_rematch' });
            maybeRematch();
            emit();
            return true;
        }

        function sendSnapshot() {
            var snap = rules.snapshot(st.sim);
            snap.type = 'kt_state';
            send(snap);
            st.stepsSinceSend = 0;
        }

        // ---- Girdi ----
        function sameInput(a, b) {
            return a.left === b.left && a.right === b.right && a.jump === b.jump && a.kick === b.kick;
        }

        // partial: { left?, right?, jump?, kick? }
        function setInput(partial) {
            var next = Object.assign({}, st.localInput);
            ['left', 'right', 'jump', 'kick'].forEach(function (k) {
                if (typeof partial[k] === 'boolean') next[k] = partial[k];
            });
            st.localInput = next;
            if (amHost) {
                st.inputs[0] = next;
            } else if (st.mode === 'match' && !sameInput(next, st.lastSentInput)) {
                st.lastSentInput = next;
                send({ type: 'kt_input', left: next.left, right: next.right, jump: next.jump, kick: next.kick });
            }
        }

        function releaseAll() {
            setInput({ left: false, right: false, jump: false, kick: false });
        }

        // ---- Kare ----
        function handleEvents(events) {
            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                if (ev.type === 'goal') {
                    send({ type: 'kt_goal', scorer: ev.scorer, score: ev.score, golden: ev.golden });
                    onEvent({ type: 'goal', scorer: ev.scorer, score: ev.score, golden: ev.golden });
                } else if (ev.type === 'end') {
                    finish(ev.winner, ev.score, ev.reason);
                    send({ type: 'kt_end', winner: ev.winner, score: ev.score, reason: ev.reason });
                    onEvent({ type: 'end', winner: ev.winner, score: ev.score, reason: ev.reason });
                }
            }
        }

        function finish(winnerIndex, score, reason) {
            st.mode = 'over';
            st.result = { winner: winnerIndex, score: score.slice(), reason: reason };
            st.votes = { me: false, opp: false };
            var opp = opponent();
            var winnerId = winnerIndex === 0
                ? (amHost ? ctx.me.id : (opp ? opp.id : null))
                : (amHost ? (opp ? opp.id : null) : ctx.me.id);
            if (winnerId !== null) st.wins[winnerId] = (st.wins[winnerId] || 0) + 1;
        }

        // Her animasyon karesinde çağrılır. Kurucu: sabit adımlı simülasyon; katılan: yalnızca görünüm.
        function tick(t) {
            if (t === undefined) t = now();
            if (!amHost || st.mode !== 'match' || !st.sim) {
                st.lastTick = null;
                emit();
                return;
            }
            if (st.lastTick === null) { st.lastTick = t; emit(); return; }
            var frameMs = Math.min(Math.max(t - st.lastTick, 0), MAX_FRAME_MS);
            st.lastTick = t;
            st.acc += frameMs / 1000;
            var steps = 0;
            while (st.acc >= rules.DT && steps < MAX_STEPS_PER_TICK && st.sim.phase !== 'over') {
                st.sim = rules.step(st.sim, st.inputs, rules.DT);
                st.acc -= rules.DT;
                steps++;
                st.stepsSinceSend++;
                var events = st.sim.events;
                if (events.length) {
                    handleEvents(events);
                    sendSnapshot();
                } else if (st.stepsSinceSend >= SEND_EVERY_STEPS) {
                    sendSnapshot();
                }
            }
            if (steps >= MAX_STEPS_PER_TICK) st.acc = 0;       // geride kalındı: birikeni at
            if (st.sim.phase === 'over') {
                st.lastSnapshot = rules.frame(st.sim);
                st.acc = 0;
            }
            emit();
        }

        // Kurucu saati ile yerel saat arasındaki fark (alınış - t). Son ~2 sn'nin minimumu hedeftir (en az
        // gecikmeli paket gerçek farka en yakın); çizim saatinin sıçramaması için ofset hedefe anlık
        // görüntü başına en çok 1 ms yaklaşır (≈%3 hız farkı, gözle görülmez). Fark çok büyürse
        // (ağ koptu / sekme donuk) doğrudan hedefe atlanır.
        function trackOffset(est) {
            st.ests.push(est);
            if (st.ests.length > OFFSET_WINDOW) st.ests.shift();
            var target = Math.min.apply(null, st.ests);
            if (st.offset === null) { st.offset = target; return; }
            var diff = target - st.offset;
            if (Math.abs(diff) > OFFSET_SNAP_MS) st.offset = target;
            else st.offset += diff > OFFSET_SLEW_MS ? OFFSET_SLEW_MS : (diff < -OFFSET_SLEW_MS ? -OFFSET_SLEW_MS : diff);
        }

        // ---- Mesajlar ----
        function onMessage(data) {
            if (!data || typeof data.type !== 'string') return;
            var opp = opponent();

            if (data.type === 'player_joined') {
                if (st.mode === 'abandoned' && amHost) {
                    st.mode = st.ready.me ? 'wait' : 'setup';
                    st.ready.opp = false;
                    st.result = null;
                    st.sim = null;
                    st.buffer = [];
                }
                // Yeni gelen yüzümüzü ve hazır olduğumuzu görsün.
                if (st.face.me !== null) sendProfile();
                if (st.mode === 'wait' && st.ready.me) send({ type: 'kt_ready' });
                emit();
                return;
            }
            if (data.type === 'player_disconnect') {
                if (data.id === ctx.me.id) return;
                // Kurucu ayrılırsa katılan oyuncu otorite olmaz: oyun biter. Kurucu ise yeni rakip bekler.
                if (!amHost || st.mode === 'match' || st.mode === 'over') st.mode = 'abandoned';
                st.ready.opp = false;
                st.face.opp = null;
                st.votes = { me: false, opp: false };
                st.inputs[1] = rules.emptyInput();
                emit();
                return;
            }
            if (!opp) return;

            switch (data.type) {
                case 'kt_profile': {
                    if (data.id !== opp.id) return;
                    var face = rules.validateFace(data.face);
                    if (face === null) return;
                    st.face.opp = face;
                    emit();
                    return;
                }
                case 'kt_ready':
                    if (st.mode === 'abandoned') return;
                    st.ready.opp = true;
                    maybeStart();
                    emit();
                    return;
                case 'kt_rematch':
                    if (st.mode !== 'over') return;
                    st.votes.opp = true;
                    maybeRematch();
                    emit();
                    return;
                case 'kt_input': {
                    if (!amHost) return;
                    var input = rules.validateInput(data);
                    if (input === null) return;
                    st.inputs[1] = input;
                    return;
                }
                case 'kt_start': {
                    if (amHost) return;
                    var start = rules.validateStart(data);
                    if (start === null) return;
                    if (st.mode === 'match' || st.mode === 'abandoned') return;
                    if (start.round <= st.round) return;
                    st.round = start.round;
                    st.swap = start.swap;
                    st.mode = 'match';
                    st.result = null;
                    st.votes = { me: false, opp: false };
                    st.buffer = [];
                    st.offset = null;
                    st.ests = [];
                    st.lastRecv = now();
                    st.lastSnapshot = null;
                    st.lastSentInput = rules.emptyInput();
                    // tuş basılı başlıyorsa kurucuya bildir
                    var li = st.localInput;
                    if (li.left || li.right || li.jump || li.kick) {
                        st.lastSentInput = li;
                        send({ type: 'kt_input', left: li.left, right: li.right, jump: li.jump, kick: li.kick });
                    }
                    emit();
                    return;
                }
                case 'kt_state': {
                    if (amHost || st.mode !== 'match') return;
                    var snap = rules.validateState(data);
                    if (snap === null) return;
                    var last = st.buffer.length ? st.buffer[st.buffer.length - 1] : null;
                    if (last && snap.t <= last.t) return;          // eski / tekrarlı
                    var t = now();
                    trackOffset(t - snap.t);
                    st.lastRecv = t;
                    st.buffer.push(snap);
                    if (st.buffer.length > BUFFER_SIZE) st.buffer.shift();
                    st.lastSnapshot = snap;
                    return;
                }
                case 'kt_goal': {
                    if (amHost || st.mode !== 'match') return;
                    var goal = rules.validateGoal(data);
                    if (goal === null) return;
                    onEvent({ type: 'goal', scorer: goal.scorer, score: goal.score, golden: goal.golden });
                    return;
                }
                case 'kt_end': {
                    if (amHost || st.mode !== 'match') return;
                    var end = rules.validateEnd(data);
                    if (end === null) return;
                    finish(end.winner, end.score, end.reason);
                    onEvent({ type: 'end', winner: end.winner, score: end.score, reason: end.reason });
                    emit();
                    return;
                }
                default:
                    return;
            }
        }

        return {
            setFace: setFace, ready: ready, rematch: rematch,
            setInput: setInput, releaseAll: releaseAll,
            tick: tick, onMessage: onMessage, getView: view,
            // Yalnızca testler için: kurucunun simülasyon durumuna erişim
            _getSim: function () { return st.sim; },
            _setSim: function (sim) { st.sim = sim; }
        };
    }

    return { create: create, INTERP_DELAY: INTERP_DELAY };
});
