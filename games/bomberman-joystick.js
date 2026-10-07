// Bomberman mobil joystick: yön ve adım kararı (saf, DOM'suz; Node'da test edilir).
//
// Sorun: yön her değiştiğinde hemen adım atılıp zamanlayıcı sıfırlanınca, çapraz sınırda titreyen başparmak her yön
// değişiminde fazladan adım ekliyordu (karakter birden hızlanıyordu). Bu denetleyici:
//   - adımlar arasına EN AZ stepMs koyar (son adım zamanı; yön değişimi, bırakıp yeniden basma bu sınırı atlayamaz),
//   - çapraz sınırda histerezis uygular: mevcut yönün ekseninden diğer eksene geçmek için baskın/diğer oranı >= hysteresis,
//   - ölü bölgede (deadZone) yönü bırakır (son adım zamanı korunur).
//
//   create({ stepMs: 150, deadZone: 15, hysteresis: 1.3 })
//   update(dx, dy, now) -> { dir, step }   dir: 'up'|'down'|'left'|'right'|null; step: şimdi bir adım atılabilir (yeni yön/basış)
//   tick(now)           -> dir | null      yön basılıysa ve son adımdan stepMs geçtiyse adım yönü (zaman damgasını günceller)
//   release()  direction()
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BombermanJoystick = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function create(options) {
        options = options || {};
        var stepMs = options.stepMs > 0 ? options.stepMs : 150;
        var deadZone = options.deadZone >= 0 ? options.deadZone : 15;
        var hysteresis = options.hysteresis >= 1 ? options.hysteresis : 1.3;
        var dir = null;
        var lastStepAt = -Infinity;

        function horizontal(d) { return d === 'left' || d === 'right'; }

        function pick(dx, dy) {
            var ax = Math.abs(dx);
            var ay = Math.abs(dy);
            if (dir === null) {
                return ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
            }
            if (horizontal(dir)) {
                // yatay -> dikey: dikey en az hysteresis kat baskın olmalı
                if (ay > 0 && ay >= hysteresis * ax) return dy > 0 ? 'down' : 'up';
                return dx > 0 ? 'right' : (dx < 0 ? 'left' : dir);
            }
            if (ax > 0 && ax >= hysteresis * ay) return dx > 0 ? 'right' : 'left';
            return dy > 0 ? 'down' : (dy < 0 ? 'up' : dir);
        }

        // Saat geri giderse (sistem saati) adım kilitlenmesin
        function clock(now) {
            if (now < lastStepAt) lastStepAt = now;
            return now;
        }

        function ready(now) { return now - lastStepAt >= stepMs; }

        return {
            update: function (dx, dy, now) {
                clock(now);
                if (Math.sqrt(dx * dx + dy * dy) < deadZone) {
                    dir = null;
                    return { dir: null, step: false };
                }
                var next = pick(dx, dy);
                var changed = next !== dir;
                dir = next;
                var step = false;
                if (changed && ready(now)) {
                    lastStepAt = now;
                    step = true;
                }
                return { dir: dir, step: step };
            },
            tick: function (now) {
                clock(now);
                if (dir === null || !ready(now)) return null;
                lastStepAt = now;
                return dir;
            },
            release: function () { dir = null; },
            direction: function () { return dir; }
        };
    }

    return { create: create };
});
