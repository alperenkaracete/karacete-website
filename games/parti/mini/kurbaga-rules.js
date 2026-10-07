// Parti / Kurbağa: saf kurallar (DOM'suz, ağsız). Araçlar tohumdan: konum = saf f(t) -> araçlar AĞDA gönderilmez.
//
// Izgara COLS x ROWS: satır 0 = başlangıç (güvenli), 1..8 = araç şeritleri, 9 = hedef. Oyuncular birbirine çarpmaz.
// Zaman: oyun saatinden ms (t=0 geri sayımdan sonra). Hareket: tek dokunuş = tek sıçrama (HOP_MS bekleme).
//
//   lanes(seed)                      8 şerit: { dir, speed, len, spacing, n, L, phase }
//   cars(lane, t)                    görünen araçlar [{ x, len }] (x hücre cinsinden, kısmen dışarıda olabilir)
//   hit(lanes, r, c, t)              kurbağa (r,c) hücresinde t anında bir araca çarpıyor mu
//   hop(pos, dir)                    sıçrama sonrası konum (sınır içinde)
//   plausible(prev, next, dtMs)      lider denetimi: iki rapor arası makul mu
//   plausibleFinish(e, elapsedMs)    varış süresi makul mu
//   botProgress(seed, id, t)         bot kurbağasının satırı (saf, tohumlu); botFinish(seed, id) varış ms ya da null
//   rank(opts)                       sıralama (eşit derece grupları)
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiKurbagaRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var COLS = 9;
    var ROWS = 10;
    var GOAL_ROW = ROWS - 1;
    var HOP_MS = 150;
    var FINISH_TOL_MS = 1500;      // varış süresi: lider saatine göre izin verilen ileri sapma
    var HIT_INSET = 0.18;          // kurbağa hücresinin kenarlarından pay: hafif bağışlayıcı çarpışma

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

    function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }

    // ---- Araçlar ----
    var laneCache = { seed: null, lanes: null };

    function lanes(seed) {
        seed = seed >>> 0;
        if (laneCache.seed === seed) return laneCache.lanes;
        var rand = mulberry((seed ^ 0x4B55) >>> 0);
        var out = [];
        var prevDir = 0;
        for (var i = 0; i < 8; i++) {
            // yön: çoğunlukla bir öncekinin tersi, ara sıra aynı
            var dir = prevDir === 0 ? (rand() < 0.5 ? 1 : -1) : (rand() < 0.75 ? -prevDir : prevDir);
            prevDir = dir;
            var len = rand() < 0.55 ? 1 : 2;
            var speed = Math.round((1.4 + rand() * 2.0) * 20) / 20;           // 1.4 - 3.4 hücre/sn
            var gap = 2.6 + rand() * 2.4;                                       // araçlar arası boşluk >= 2.6 hücre
            var spacing = Math.round((len + gap) * 20) / 20;
            var n = Math.max(2, Math.ceil((COLS + 4) / spacing));
            out.push({ dir: dir, speed: speed, len: len, spacing: spacing, n: n, L: n * spacing, phase: rand() * n * spacing });
        }
        laneCache = { seed: seed, lanes: out };
        return out;
    }

    function mod(a, m) { return ((a % m) + m) % m; }

    // Görünen araçlar: ızgara penceresi [0, COLS) ile kesişenler (kısmen dışarıda olabilir)
    function cars(lane, t) {
        var out = [];
        var base = lane.phase + lane.dir * lane.speed * (t / 1000);
        for (var k = 0; k < lane.n; k++) {
            var x = mod(base + k * lane.spacing, lane.L);
            if (x < COLS) out.push({ x: x, len: lane.len });
            if (x - lane.L + lane.len > 0 && x - lane.L < COLS) out.push({ x: x - lane.L, len: lane.len });
        }
        return out;
    }

    function hit(laneList, r, c, t) {
        if (r < 1 || r > 8) return false;
        var list = cars(laneList[r - 1], t);
        var a = c + HIT_INSET;
        var b = c + 1 - HIT_INSET;
        for (var i = 0; i < list.length; i++) {
            if (list[i].x < b && list[i].x + list[i].len > a) return true;
        }
        return false;
    }

    // ---- Hareket ----
    function hop(pos, dir) {
        var r = pos.r;
        var c = pos.c;
        if (dir === 'up') r = Math.min(GOAL_ROW, r + 1);
        else if (dir === 'down') r = Math.max(0, r - 1);
        else if (dir === 'left') c = Math.max(0, c - 1);
        else if (dir === 'right') c = Math.min(COLS - 1, c + 1);
        return { r: r, c: c };
    }

    // Lider denetimi: prev/next = { r, c, d }; dtMs = rapor arası süre (lider saati). Sıçrama bütçesi HOP_MS'e göre; birleştirilmiş
    // ya da kayıp mesajlar için bütçe zamanla büyür. Ölümde (d artar) kurbağa 0. satıra döner (sütun korunur).
    function plausible(prev, next, dtMs) {
        if (!prev || !next) return false;
        if (!isInt(next.r, 0, GOAL_ROW) || !isInt(next.c, 0, COLS - 1) || !isInt(next.d, 0, 100000)) return false;
        if (next.d < prev.d) return false;
        var hops = Math.max(1, Math.floor(Math.max(0, dtMs) / HOP_MS) + 1);
        var dd = next.d - prev.d;
        if (dd > hops) return false;
        var br = dd > 0 ? 0 : prev.r;
        var dist = Math.abs(next.r - br) + Math.abs(next.c - prev.c);
        return dist <= hops;
    }

    function plausibleFinish(e, elapsedMs) {
        return isInt(e, 0, 1e7) && e >= GOAL_ROW * HOP_MS && e <= elapsedMs + FINISH_TOL_MS;
    }

    // ---- Botlar ----
    // Her bot: başlangıç gecikmesi, adım aralığı, "kazaya düşme" olasılığı (başa dönüş) tohum + kimlikten. Zayıf-orta oyuncu
    // gibi ayarlı: çoğu bot 120 sn dolmadan hedefe varamaz (tests/parti-kurbaga-rules.test.js dağılımı sabitler).
    var BOT_HORIZON_MS = 130000;
    var botCache = { key: null, tl: null };

    function botTimeline(seed, id) {
        var key = (seed >>> 0) + ':' + id;
        if (botCache.key === key) return botCache.tl;
        var rand = mulberry(((seed >>> 0) ^ hashStr(String(id)) ^ 0xB07) >>> 0);
        var step = 1.5 + rand() * 1.2;               // sn: adım başına ortalama süre
        var p = 0.28 + rand() * 0.14;                // her adımda kazaya düşme (başa dönüş) olasılığı
        var t = 1500 + rand() * 4500;                // başlangıç gecikmesi
        var row = 0;
        var ev = [[0, 0]];                           // [ms, satır]
        var fin = null;
        while (t < BOT_HORIZON_MS) {
            row = rand() < p ? 0 : row + 1;
            ev.push([Math.round(t), row]);
            if (row >= GOAL_ROW) { fin = Math.round(t); break; }
            t += step * (0.55 + rand() * 1.1) * 1000;
        }
        var tl = { ev: ev, fin: fin };
        botCache = { key: key, tl: tl };
        return tl;
    }

    function botProgress(seed, id, t) {
        var ev = botTimeline(seed, id).ev;
        var row = 0;
        for (var i = 0; i < ev.length && ev[i][0] <= t; i++) row = ev[i][1];
        return row;
    }

    function botFinish(seed, id) { return botTimeline(seed, id).fin; }

    // ---- Sıralama ----
    // opts: { players: [id], bots: [id], seed, reports: { id: { r, f (varış ms | null), d } }, endMs }
    // Varanlar varış süresine göre (eşit ms eşit derece); kalanlar ANLIK satıra göre azalan (eşit satır eşit derece).
    // Botlar aynı fonksiyonlarla (botFinish/botProgress) girer. Rapor vermeyen insan 0. satırda sayılır.
    function rank(opts) {
        var bots = opts.bots || [];
        var reports = opts.reports || {};
        var fin = [];
        var rest = [];
        opts.players.forEach(function (id) {
            if (bots.indexOf(id) >= 0) {
                var bf = botFinish(opts.seed, id);
                if (bf !== null && bf <= opts.endMs) fin.push({ id: id, k: bf });
                else rest.push({ id: id, k: botProgress(opts.seed, id, opts.endMs) });
            } else {
                var rep = reports[id];
                if (rep && typeof rep.f === 'number' && rep.f >= 0) fin.push({ id: id, k: rep.f });
                else rest.push({ id: id, k: rep && isInt(rep.r, 0, GOAL_ROW) ? rep.r : 0 });
            }
        });
        fin.sort(function (a, b) { return a.k - b.k; });
        rest.sort(function (a, b) { return b.k - a.k; });
        var groups = [];
        function push(list) {
            var last = null;
            list.forEach(function (x) {
                if (last !== null && last.k === x.k) last.ids.push(x.id);
                else { last = { k: x.k, ids: [x.id] }; groups.push(last); }
            });
        }
        push(fin);
        push(rest);
        return groups.map(function (g) { return g.ids; });
    }

    return {
        COLS: COLS, ROWS: ROWS, GOAL_ROW: GOAL_ROW, HOP_MS: HOP_MS, FINISH_TOL_MS: FINISH_TOL_MS,
        lanes: lanes, cars: cars, hit: hit, hop: hop, plausible: plausible, plausibleFinish: plausibleFinish,
        botProgress: botProgress, botFinish: botFinish, rank: rank, mulberry: mulberry
    };
});
