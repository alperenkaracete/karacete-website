// Kafa Topu: katılan oyuncuda kendi karakterinin tahmini (client-side prediction) ve uzlaştırması.
// DOM'suz ve ağdan bağımsızdır; kurucunun kullandığı AYNI saf adım fonksiyonunu (rules.stepOwn) kullanır.
//
// Çalışma: yerel her sabit adımda (1/60 sn) kendi girdisiyle karakter hemen ilerletilir ve o adımın girdisi
// günlüğe yazılır. Kurucu her anlık görüntüde kendi uyguladığı son girdi sıra numarasını (`a`) ve o girdinin
// kaç adımdır uygulandığını (`c`) yollar. Uzlaştırma:
//   1. onaylı durum S (kurucunun bu karakter için hesapladığı konum/hız/vuruş) alınır,
//   2. S'nin karşılık geldiği yerel adım Lauth = başlangıç[a] + c bulunur,
//   3. Lauth..şimdi arasındaki kayıtlı girdilerle stepOwn yeniden oynatılır -> P',
//   4. fizik durumu P' olur; görsel sapma (eski görünen - P') her adımda %20 azalır,
//      40 px'ten büyük sapma doğrudan ışınlanır.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KafaTopuPredict = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var HISTORY_STEPS = 240;        // ~4 sn girdi günlüğü
    var DECAY = 0.8;                // her adımda sapmanın %20'si düzelir
    var TELEPORT_PX = 40;           // bundan büyük sapma doğrudan ışınlanır

    // options: { rules, index (0 = kurucu, 1 = katılan), dir (+1 sol taraf, -1 sağ taraf) }
    function create(options) {
        var rules = options.rules;
        var index = options.index;
        var dir = options.dir;
        var DT = rules.DT;

        var st = null;

        function reset(newDir) {
            if (newDir !== undefined) dir = newDir;
            st = {
                L: 0,                           // yerel adım sayacı (tur başından beri)
                log: {},                        // adım -> kullanılan girdi
                seqStart: { 0: 0 },             // girdi sıra no -> başladığı yerel adım
                seqInput: { 0: rules.emptyInput() },
                own: null,                      // fizik durumu (tahmin)
                opp: null,                      // rakip (son bilinen durum, girdisiz varsayım)
                ox: 0, oy: 0,                   // görsel sapma
                frozen: false,
                err: 0, errMax: 0,              // son uzlaştırmadaki sapma (px) ve yavaşça sönen maksimum
                replay: 0,                      // son uzlaştırmada yeniden oynatılan adım
                teleports: 0
            };
        }

        function fromWire(arr, d, kh) {
            return {
                x: arr[0], y: arr[1], vx: arr[3], vy: arr[4], dir: d,
                kick: arr[2] > 0 ? rules.KICK_TIME * (1 - arr[2] / 100) : 0,
                hit: false, kh: !!kh,
                grounded: arr[1] >= rules.HEAD_STAND_Y - 1e-6
            };
        }

        function setFrozen(phase) {
            st.frozen = phase === 0 || phase === 3;   // geri sayım / maç sonu
        }

        // Yeni bir girdi durumu (sıra numarası n) şu yerel adımdan itibaren geçerli.
        function pushInput(n, input) {
            st.seqStart[n] = st.L;
            st.seqInput[n] = input;
        }

        function nextStartAfter(a) {
            var next = Infinity;
            for (var key in st.seqStart) {
                if (Number(key) > a && st.seqStart[key] < next) next = st.seqStart[key];
            }
            return next;
        }

        function startOf(a) {
            if (st.seqStart[a] !== undefined) return st.seqStart[a];
            return 0;       // bilinmeyen (çok eski) numara: tur başı
        }

        // Bir yerel adım ilerlet.
        function step(input) {
            if (!st.own) { st.L++; return; }
            st.log[st.L] = input;
            delete st.log[st.L - HISTORY_STEPS];
            var r = rules.stepOwn(st.own, st.opp, index, input, DT, st.frozen);
            st.own = r.own;
            st.opp = r.opp;
            st.L++;
            st.ox *= DECAY;
            st.oy *= DECAY;
            if (Math.abs(st.ox) < 0.01) st.ox = 0;
            if (Math.abs(st.oy) < 0.01) st.oy = 0;
        }

        // Yeni anlık görüntüde uzlaştır. snap: validateState çıktısı.
        // Dönen: { error (px), teleported, replay (yeniden oynatılan adım) }
        function reconcile(snap) {
            setFrozen(snap.ph);
            var a = snap.a;
            var kh = st.seqInput[a] ? st.seqInput[a].kick : false;
            var S = fromWire(snap.p[index], dir, kh);
            var O = fromWire(snap.p[1 - index], -dir, false);
            if (st.frozen) {
                // dondurulmuş faz (geri sayım / maç sonu): doğrudan onaylı durum
                st.own = S;
                st.opp = O;
                st.ox = 0;
                st.oy = 0;
                st.err = 0;
                st.replay = 0;
                pruneUpTo(a);
                return { error: 0, teleported: false, replay: 0 };
            }

            // Onaylı durum S, a girdisi c adımdır uygulanmış kurucu durumudur. Yerelde a'dan sonraki girdi daha
            // önce başladıysa (kurucu yeni girdiyi henüz almamıştır), kurucunun fazladan uyguladığı adımlar yerel
            // zaman çizelgesinde karşılıksızdır: yeniden oynatma bir sonraki girdinin başladığı adımdan sürer.
            var Lauth = Math.min(startOf(a) + snap.c, nextStartAfter(a), st.L);
            var p = S;
            var o = O;
            var fallback = st.seqInput[a] || rules.emptyInput();
            var steps = 0;
            for (var l = Lauth; l < st.L; l++) {
                var inp = st.log[l] || fallback;
                var r = rules.stepOwn(p, o, index, inp, DT, st.frozen);
                p = r.own;
                o = r.opp;
                steps++;
            }

            if (!st.own) {
                // ilk görüntü: tahmin henüz yok, doğrudan yeniden oynatılmış durum
                st.own = p;
                st.opp = o;
                st.err = 0;
                st.replay = steps;
                pruneUpTo(a);
                return { error: 0, teleported: false, replay: steps };
            }

            var dx = p.x - st.own.x;
            var dy = p.y - st.own.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var teleported = false;
            if (dist > TELEPORT_PX) {
                st.ox = 0;
                st.oy = 0;
                teleported = true;
                st.teleports++;
            } else {
                // görünen konum süreklilik kazansın: yeni sapma = eski görünen - P'
                st.ox += st.own.x - p.x;
                st.oy += st.own.y - p.y;
            }
            st.own = p;
            st.opp = o;
            st.err = dist;
            st.errMax = Math.max(dist, st.errMax * 0.97);
            st.replay = steps;
            pruneUpTo(a);
            return { error: dist, teleported: teleported, replay: steps };
        }

        function pruneUpTo(a) {
            for (var key in st.seqStart) {
                if (Number(key) < a) {
                    delete st.seqStart[key];
                    delete st.seqInput[key];
                }
            }
        }

        // Çizilecek kendi karakter: [x, y, vuruş %, vx, vy]; hazır değilse null
        function view() {
            if (!st.own) return null;
            var kick = st.own.kick > 0 ? (1 - st.own.kick / rules.KICK_TIME) * 100 : 0;
            return [st.own.x + st.ox, st.own.y + st.oy, kick, st.own.vx, st.own.vy];
        }

        function stats() {
            return {
                error: st.err, errorMax: st.errMax, replay: st.replay, teleports: st.teleports,
                offset: Math.sqrt(st.ox * st.ox + st.oy * st.oy), pending: Object.keys(st.seqStart).length
            };
        }

        function state() { return st; }

        reset();
        return { reset: reset, pushInput: pushInput, step: step, reconcile: reconcile, view: view, stats: stats, setFrozen: setFrozen, _state: state };
    }

    return { create: create, DECAY: DECAY, TELEPORT_PX: TELEPORT_PX, HISTORY_STEPS: HISTORY_STEPS };
});
