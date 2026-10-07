// Bomberman çizim yumuşatması (saf, DOM'suz; Node'da test edilir). Oyun MANTIĞI değişmez: oyuncular hâlâ 32 px'lik ızgara
// adımlarıyla (mantıksal x, y) hareket eder ve ağa o konumlar gider. Bu modül yalnızca EKRANDA gösterilen konumu hesaplar:
// görsel konum, mantıksal hedefi kare süresinden bağımsız (üstel) yaklaşmayla izler, böylece ~7 adım/sn'lik zıplama yerine
// ekran hızında (60 FPS) akıcı kayma görünür. Yürüme karesi görsel kat edilen mesafeye bağlıdır.
//
//   Smooth.step(state, tx, ty, dtMs, opts?) -> { x, y, phase, moving }   (state: önceki dönüş değeri | null)
//   Smooth.approach(vis, target, dtMs, tauMs), Smooth.shouldSnap(dx, dy, limitPx), Smooth.walkFrame(phase)
//   Smooth.mapSignature(map, extra?) -> sayı (harita değişince değişir; çevrim dışı harita katmanını yenilemek için)
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BombermanSmooth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var TAU_MS = 50;             // yaklaşma zaman sabiti: bir 150 ms'lik adımı ~%95 tamamlar
    var SNAP_PX = 64;            // bundan uzak (2 hücre+) konum = yeniden doğma/ışınlanma: anında
    var PX_PER_FRAME = 16;       // yürüme karesi başına görsel mesafe (32 px'lik adım = 2 kare)
    var MOVING_EPS = 0.75;       // bundan yakınsa "duruyor"

    // vis'ten target'a dt süresince yaklaş; dt'den bağımsız: approach(approach(v,t,a),t,b) == approach(v,t,a+b)
    function approach(vis, target, dtMs, tauMs) {
        var k = 1 - Math.exp(-Math.max(0, dtMs) / (tauMs || TAU_MS));
        return vis + (target - vis) * k;
    }

    function shouldSnap(dx, dy, limitPx) {
        return Math.max(Math.abs(dx), Math.abs(dy)) > (limitPx === undefined ? SNAP_PX : limitPx);
    }

    // Yürüme animasyonu karesi (0, 1, 2). phase kare birimidir (≥ 0).
    function walkFrame(phase) {
        return Math.floor(Math.max(0, phase)) % 3;
    }

    function step(state, tx, ty, dtMs, opts) {
        opts = opts || {};
        if (!state || shouldSnap(tx - state.x, ty - state.y, opts.snapPx)) {
            return { x: tx, y: ty, phase: 0, moving: false };
        }
        var nx = approach(state.x, tx, dtMs, opts.tauMs);
        var ny = approach(state.y, ty, dtMs, opts.tauMs);
        var moved = Math.hypot(nx - state.x, ny - state.y);
        var remaining = Math.hypot(tx - nx, ty - ny);
        var moving = remaining > MOVING_EPS;
        if (!moving) { nx = tx; ny = ty; }              // son birkaç pikseli bitir: titreme/asimptot kalmasın
        return { x: nx, y: ny, phase: moving ? state.phase + moved / PX_PER_FRAME : 0, moving: moving };
    }

    // Harita (2B dizi) için ucuz imza: hücre değeri ve konumdan türeyen 32 bit karma; extra (ör. sprite hazır mı) eklenir.
    function mapSignature(map, extra) {
        var h = 2166136261 >>> 0;
        for (var y = 0; y < map.length; y++) {
            var row = map[y];
            for (var x = 0; x < row.length; x++) {
                h = Math.imul(h ^ ((row[x] + 1) & 0xff), 16777619) >>> 0;
            }
        }
        return (Math.imul(h ^ (extra | 0), 16777619) >>> 0);
    }

    return { step: step, approach: approach, shouldSnap: shouldSnap, walkFrame: walkFrame, mapSignature: mapSignature,
        TAU_MS: TAU_MS, SNAP_PX: SNAP_PX, PX_PER_FRAME: PX_PER_FRAME };
});
