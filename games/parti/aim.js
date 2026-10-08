// Parti: beceri silahları nişan (aim) mantığı — saf, DOM'suz, tohumlu. Silah tanımındaki `skill` alanına (config WEAPONS) bağlıdır; yeni beceri
// silahı eklemek için config'e `skill` yazmak ve burada kind'ı tanımlamak yeter (şimdi: 'bar' = Yay; 'show' = Yumruk şovu aşamasız).
//
//   makeAim(w, seed, d)              -> belirtim { w, d, c, half, periodMs, phase, maxMs, tiers } (bar) | null (skill yok / bar değil)
//   indicatorAt(spec, ms)            -> [0,1] gösterge konumu (üçgen dalga; tohumlu periyot ve faz). Ağda gösterge akışı YOK: herkes bunu çizer
//   resolve(spec, q)                 -> { tier: 'merkez'|'bolge'|'kenar'|'iska', dmg, off }   (q ∈ [0,1]; q < 0 ya da sayı değil = ıska)
//   botQ(seed, id, spec)             -> tohumlu bırakma konumu: bölge merkezi + Normal(0, AIM_REF_SIGMA) (referans oyuncu modeli)
//   clampQ(spec, q, elapsedMs, slackMs) -> q, göstergenin [elapsed-slack, elapsed+slack] penceresinde süpürdüğü aralığa kenetlenir
//                                       (lider kenetlemesi: bozuk istemci/gecikme koruması, kesin hile savunması değil)
//   dmgExpected(w, d, sigma)         -> referans modelle analitik beklenen hasar (kalibrasyon testi için)
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
    else root.PartiAim = factory(root.PartiConfig);
})(typeof self !== 'undefined' ? self : this, function (C) {
    'use strict';

    function mulberry(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            var t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hashStr(str) {
        var h = 2166136261 >>> 0;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function barSkill(w) {
        var def = C.WEAPONS[w];
        return def && def.skill && def.skill.kind === 'bar' ? def : null;
    }

    // Bölge genişliği (çubuk birimi): d ≤ 1 → widthNear, d = menzil → widthFar, arası doğrusal (d=0 de d=1 sayılır)
    function widthFor(def, d) {
        var sk = def.skill;
        var dd = clamp(d, 1, def.range);
        var span = Math.max(1, def.range - 1);
        return sk.widthNear + (sk.widthFar - sk.widthNear) * (dd - 1) / span;
    }

    function makeAim(w, seed, d) {
        var def = barSkill(w);
        if (!def) return null;
        var sk = def.skill;
        var rng = mulberry(((seed >>> 0) ^ hashStr(w) ^ 0xA13B) >>> 0);
        var width = widthFor(def, d);
        var half = width / 2;
        var c = half + rng() * (1 - width);                      // bölge kenarlara taşmaz
        var periodMs = Math.round(sk.periodMs[0] + rng() * (sk.periodMs[1] - sk.periodMs[0]));
        var phase = rng();
        return { w: w, d: clamp(d, 1, def.range), c: c, half: half, periodMs: periodMs, phase: phase, maxMs: sk.maxMs, tiers: sk.tiers };
    }

    function indicatorAt(spec, ms) {
        var u = (Math.max(0, ms) / spec.periodMs + spec.phase) % 1;
        return u < 0.5 ? u * 2 : 2 - u * 2;
    }

    function resolve(spec, q) {
        if (typeof q !== 'number' || !isFinite(q) || q < 0) return { tier: 'iska', dmg: 0, off: null };
        var off = Math.abs(clamp(q, 0, 1) - spec.c) / spec.half;
        for (var i = 0; i < spec.tiers.length; i++) {
            if (off <= spec.tiers[i].r + 1e-12) return { tier: spec.tiers[i].tier, dmg: spec.tiers[i].dmg, off: off };
        }
        return { tier: 'iska', dmg: 0, off: off };
    }

    // Box-Muller: iki tohumlu düzgün sayıdan standart normal
    function normal(rng) {
        var u1 = Math.max(1e-12, rng());
        var u2 = rng();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    function botQ(seed, id, spec) {
        var rng = mulberry(((seed >>> 0) ^ hashStr(String(id)) ^ 0xB07A) >>> 0);
        return clamp(spec.c + normal(rng) * C.AIM_REF_SIGMA, 0, 1);
    }

    function clampQ(spec, q, elapsedMs, slackMs) {
        var lo = 1;
        var hi = 0;
        var from = Math.max(0, elapsedMs - slackMs);
        var to = Math.max(from, elapsedMs + slackMs);
        for (var t = from; t <= to + 1e-9; t += 10) {
            var p = indicatorAt(spec, t);
            if (p < lo) lo = p;
            if (p > hi) hi = p;
        }
        var pe = indicatorAt(spec, to);
        if (pe < lo) lo = pe;
        if (pe > hi) hi = pe;
        return clamp(q, lo, hi);
    }

    // Referans modelle (hata ~ Normal(0, sigma), merkez etrafında) analitik beklenen hasar: Σ dmg_i · P(r_{i-1} < |e|/half ≤ r_i)
    function erf(x) {
        var s = x < 0 ? -1 : 1;
        x = Math.abs(x);
        var t = 1 / (1 + 0.3275911 * x);
        var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return s * y;
    }

    function dmgExpected(w, d, sigma) {
        var def = barSkill(w);
        if (!def) return null;
        var half = widthFor(def, d) / 2;
        var e = 0;
        var prev = 0;
        def.skill.tiers.forEach(function (t) {
            var p = erf((t.r * half) / (sigma * Math.SQRT2));
            e += t.dmg * (p - prev);
            prev = p;
        });
        return e;
    }

    return { makeAim: makeAim, indicatorAt: indicatorAt, resolve: resolve, botQ: botQ, clampQ: clampQ, dmgExpected: dmgExpected, widthFor: widthFor, mulberry: mulberry };
});
