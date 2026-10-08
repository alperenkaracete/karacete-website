// Parti / Düşen Zemin: saf kurallar ve fizik (DOM'suz, ağsız, tohumlu). 8 kişiye kadar aynı anda; zemin kareleri takvime göre yıkılır, son
// kalan kare/oyuncu kazanır. Takvim ve botlar tohumdan saf f(seed, ...) -> AĞDA GÖNDERİLMEZ.
//
// Birimler: uzunluk "birim" (kare 64 birim, arena 512x512), zaman ms (oyun saati; t=0 geri sayımdan sonra).
//   schedule(seed, n)              takvim: turlar, güvenli kümeler, kare başına yıkılış anı
//   tileOf / tileState / isSolid   kare sorguları (takvim + t)
//   startPositions(seed, n)        başlangıç: orta halkada çember
//   newState / step                oyuncu fiziği (sabit adım, saf)
//   pushTargets / pushVector / applyPush / bodyContact   it ve gövde teması
//   plausible / outCheck / staleOut   lider denetimi
//   botFall / botPosition          botlar
//   rank                           sıralama (aynı yıkılış turunda düşenler eşit)
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiDusenZeminRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---- Sabitler ----
    var N = 8;                       // 8x8 kare
    var TILE = 64;
    var SIZE = N * TILE;             // 512
    var R = 14;                      // oyuncu yarıçapı
    var STEP_MS = 1000 / 60;         // sabit fizik adımı
    var DT = 1 / 60;

    var MAXV = 240;                  // yürüme azami hızı (birim/sn)
    var ACC = 1500;                  // ivme (birim/sn²)
    var FRIC = 6;                    // sürtünme (1/sn)
    var PUSH_IMPULSE = 560;          // itilen oyuncuya hız darbesi
    var MAXV_ABS = 760;              // itme dahil mutlak hız üst sınırı (makullük)
    var JUMP_MS = 550;               // havada kalma
    var JUMP_CD_MS = 1400;           // zıplama bekleme (zıplama başından)
    var JUMP_H = 36;                 // görsel azami yükseklik
    var PUSH_RANGE = 40;             // it menzili (kenardan kenara)
    var PUSH_COS = 0.5;              // koni: ±60°
    var PUSH_CD_MS = 1200;
    var FALL_MS = 120;               // yerdeyken zemin yıkıldıktan sonra elenme gecikmesi
    var OUT_WINDOW_MS = FALL_MS + JUMP_MS + 600;      // out.t için kabul penceresi (yıkılıştan sonra): düşme + havada kalma + saat payı
    var STALE_MS = 5000;             // lider: bu kadar rapor yoksa donmuş sayılır (yalnız yıkık karedeyse elenir)

    // Takvim sabitleri
    var T0 = 3000;                   // ilk uyarı turu başı
    var W_FIRST = 2400;              // uyarı süresi (ilk tur)
    var W_LAST = 1100;               // uyarı süresi (son tur)
    var PAUSE = 700;                 // yıkılmadan sonra ara
    var FIRST_FALL_MAX = 14000;      // durağan oyuncunun ilk elenmesi için en geç yıkılış anı (ilk elenmeler 15 sn'den önce)
    var TARGET_END = 85000;          // tek kareye iniş hedefi (80-90 sn)
    var FIRST_SAFE = 45;             // ilk tur güvenli kare sayısı (%70)
    var FLOOR_UNTIL = 0.75;          // oyuncu sayısı tabanı zamanın bu oranına kadar
    var UYARI_MODU = 'guvenli-yanar';   // güvenli kareler yanıp söner, yanmayanlar yıkılır (ters çevirmek tek satır)
    var CORE = [];                   // başlangıç halkasının oturduğu orta 4x4
    var cx, cy;
    for (cy = 2; cy <= 5; cy++) for (cx = 2; cx <= 5; cx++) CORE.push(cy * N + cx);

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
    function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }

    // ---- Takvim ----
    // Tur zamanlaması (R tur sayısından türetilir): W_k doğrusal 2.4 -> 1.1 sn, +0.7 sn ara.
    function timing(rounds) {
        var out = [];
        var start = T0;
        for (var k = 0; k < rounds; k++) {
            var w = Math.round((W_FIRST + (W_LAST - W_FIRST) * (rounds > 1 ? k / (rounds - 1) : 1)) / 10) * 10;
            out.push({ startMs: start, warnMs: w, collapseMs: start + w });
            start += w + PAUSE;
        }
        return out;
    }

    // Tur sayısı hedef süreden türetilir (sabit değil): son yıkılış TARGET_END'e en yakın olan R
    var ROUNDS = (function () {
        var best = 12;
        var bestDiff = 1e9;
        for (var r = 12; r <= 80; r++) {
            var tm = timing(r);
            var diff = Math.abs(tm[r - 1].collapseMs - TARGET_END);
            if (diff < bestDiff) { bestDiff = diff; best = r; }
        }
        return best;
    })();
    var END_COLLAPSE = timing(ROUNDS)[ROUNDS - 1].collapseMs;

    function tileIndex(i, j) { return j * N + i; }
    function neighbors(idx) {
        var i = idx % N;
        var j = Math.floor(idx / N);
        var out = [];
        if (i > 0) out.push(idx - 1);
        if (i < N - 1) out.push(idx + 1);
        if (j > 0) out.push(idx - N);
        if (j < N - 1) out.push(idx + N);
        return out;
    }

    // Güvenli kare sayısı eğrisi (τ = ilk yıkılıştan son yıkılışa geçen süre oranı): ilk tur 45 (%70); zamanın %75'ine dek üstel olarak
    // tabana (oyuncu tabanı floor(n/2)+1, en az 4) iner; son %25'te tabandan sondan ikinci tura dek (2x2 = 4) doğrusal; son tur 1 kare.
    // Taban ağırlığı son %25'te 1'e düşer (4 ve 1 her zaman bunun altındadır).
    function sizeAt(tau, n, tauTail) {
        var floorN = Math.max(Math.floor(n / 2) + 1, TAIL_START);
        var s;
        if (tau <= FLOOR_UNTIL) s = floorN + (FIRST_SAFE - floorN) * Math.exp(-DECAY * tau / FLOOR_UNTIL);
        else s = floorN - (floorN - 4) * clamp((tau - FLOOR_UNTIL) / Math.max(1e-6, tauTail - FLOOR_UNTIL), 0, 1);
        return Math.max(1, Math.round(s));
    }

    var DECAY = 5.5;                 // üstel küçülme hızı: erken turlarda hızlı (ilk elenmeler ~15 sn'den önce)
    var TAIL_START = 4;              // son %25 aşamasının başladığı güvenli kare sayısı (taban bundan küçükse)

    function buildSets(seed, n, attempt) {
        var rng = mulberry(((seed >>> 0) ^ 0xD2E4 ^ Math.imul(attempt + 1, 0x9E3779B1)) >>> 0);
        var tm = timing(ROUNDS);
        var sizes = [];
        var c0 = tm[0].collapseMs;
        var span = END_COLLAPSE - c0;
        var tauTail = (tm[ROUNDS - 2].collapseMs - c0) / span;
        for (var k = 0; k < ROUNDS; k++) {
            var s = k === 0 ? FIRST_SAFE : sizeAt((tm[k].collapseMs - c0) / span, n, tauTail);
            if (k > 0 && s > sizes[k - 1]) s = sizes[k - 1];
            sizes.push(s);
        }
        sizes[ROUNDS - 1] = 1;
        sizes[ROUNDS - 2] = 4;                                   // sondan ikinci tur: 2x2 blok
        for (var q = ROUNDS - 3; q >= 0; q--) if (sizes[q] < sizes[q + 1]) sizes[q] = sizes[q + 1];     // azalmayan
        // Geriye doğru büyüt: son küme tek kare (orta 4x4'ten, tohumlu); her adımda bitişik, kompakt (≥2 komşulu) kare ekle -> kümeler hep bağlı
        var sets = new Array(ROUNDS);
        var cur = {};
        var finalTile = CORE[Math.floor(rng() * CORE.length)];
        cur[finalTile] = true;
        sets[ROUNDS - 1] = Object.keys(cur).map(Number).sort(function (a, b) { return a - b; });
        for (var kk = ROUNDS - 2; kk >= 0; kk--) {
            var need = sizes[kk] - Object.keys(cur).length;
            while (need > 0) {
                var best = -1;
                var bestScore = -1e9;
                // kompaktlık: bitişik komşu sayısı + kümenin ağırlık merkezine yakınlık (-> 2x2 bloklar, yuvarlak lekeler)
                var keys = Object.keys(cur);
                var mx = 0;
                var my = 0;
                keys.forEach(function (k5) { mx += k5 % N; my += Math.floor(k5 / N); });
                mx /= keys.length;
                my /= keys.length;
                for (var idx = 0; idx < N * N; idx++) {
                    if (cur[idx]) continue;
                    var nb = neighbors(idx);
                    var adj = 0;
                    for (var z = 0; z < nb.length; z++) if (cur[nb[z]]) adj++;
                    if (!adj) continue;
                    var dcen = Math.sqrt(((idx % N) - mx) * ((idx % N) - mx) + (Math.floor(idx / N) - my) * (Math.floor(idx / N) - my));
                    var score = adj * 10 - dcen * 6 + rng() * 2 + (kk === 0 && CORE.indexOf(idx) >= 0 ? 100 : 0);
                    if (score > bestScore) { bestScore = score; best = idx; }
                }
                cur[best] = true;
                need--;
            }
            sets[kk] = Object.keys(cur).map(Number).sort(function (a, b) { return a - b; });
        }
        return { sets: sets, sizes: sizes, finalTile: finalTile };
    }

    var schedCache = { key: null, sched: null };

    // schedule(seed, n): { rounds: [{ startMs, warnMs, collapseMs, safe: [tile], doomed: [tile] }], collapse: [ms|Infinity] x64, endMs, finalTile }
    function schedule(seed, n) {
        var key = (seed >>> 0) + ':' + n;
        if (schedCache.key === key) return schedCache.sched;
        var tm = timing(ROUNDS);
        var built = null;
        var ring = startPositions(seed, n).map(function (pp) { return tileOf(pp.x, pp.y); });
        for (var attempt = 0; attempt < 40; attempt++) {
            built = buildSets(seed, n, attempt);
            var s0 = {};
            built.sets[0].forEach(function (t) { s0[t] = true; });
            if (!CORE.every(function (t) { return s0[t]; })) continue;            // başlangıç halkası ilk güvenli kümede olmalı
            // durağan bir oyuncu da erken elensin: halkadaki bir kare FIRST_FALL_MAX'tan önce yıkılmalı (yoksa başka tohum varyantı denenir)
            var early = false;
            for (var rk = 0; rk < built.sets.length && tm[rk].collapseMs <= FIRST_FALL_MAX && !early; rk++) {
                var sk = {};
                built.sets[rk].forEach(function (t4) { sk[t4] = true; });
                if (ring.some(function (t5) { return !sk[t5]; })) early = true;
            }
            if (early) break;
        }
        var rounds = [];
        var collapse = [];
        for (var i = 0; i < N * N; i++) collapse.push(Infinity);
        var prev = {};
        for (var t = 0; t < N * N; t++) prev[t] = true;
        built.sets.forEach(function (set, k) {
            var cur = {};
            set.forEach(function (t2) { cur[t2] = true; });
            var doomed = [];
            Object.keys(prev).forEach(function (t3) { if (!cur[t3]) { doomed.push(Number(t3)); collapse[t3] = tm[k].collapseMs; } });
            rounds.push({ startMs: tm[k].startMs, warnMs: tm[k].warnMs, collapseMs: tm[k].collapseMs, safe: set, doomed: doomed.sort(function (a, b) { return a - b; }) });
            prev = cur;
        });
        var sched = { rounds: rounds, collapse: collapse, endMs: END_COLLAPSE, finalTile: built.finalTile, n: n };
        schedCache = { key: key, sched: sched };
        return sched;
    }

    function tileOf(x, y) {
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
        return Math.floor(y / TILE) * N + Math.floor(x / TILE);
    }

    function tileCenter(idx) { return { x: (idx % N) * TILE + TILE / 2, y: Math.floor(idx / N) * TILE + TILE / 2 }; }

    // Uyarı turu: t anında uyarı penceresinde olan tur (yoksa -1)
    function warnRound(sched, t) {
        for (var k = 0; k < sched.rounds.length; k++) {
            var r = sched.rounds[k];
            if (t >= r.startMs && t < r.collapseMs) return k;
            if (t < r.startMs) return -1;
        }
        return -1;
    }

    // 'gone' | 'doomed' (uyarıda yanmayan: yıkılacak) | 'warn' (uyarıda yanıp sönen güvenli) | 'safe'
    function tileState(sched, tile, t) {
        if (t >= sched.collapse[tile]) return 'gone';
        var k = warnRound(sched, t);
        if (k < 0) return 'safe';
        var round = sched.rounds[k];
        if (round.doomed.indexOf(tile) >= 0) return UYARI_MODU === 'guvenli-yanar' ? 'doomed' : 'warn';
        if (round.safe.indexOf(tile) >= 0 && round.doomed.length) return UYARI_MODU === 'guvenli-yanar' ? 'warn' : 'doomed';
        return 'safe';
    }

    function isSolid(sched, x, y, t) {
        var tile = tileOf(x, y);
        return tile >= 0 && t < sched.collapse[tile];
    }

    // ---- Başlangıç ----
    function startPositions(seed, n) {
        var rng = mulberry(((seed >>> 0) ^ 0x57A7) >>> 0);
        var off = rng() * Math.PI * 2;
        var out = [];
        for (var i = 0; i < n; i++) {
            var a = off + (Math.PI * 2 * i) / Math.max(1, n);
            out.push({ x: Math.round(SIZE / 2 + Math.cos(a) * 100), y: Math.round(SIZE / 2 + Math.sin(a) * 100) });
        }
        return out;
    }

    // ---- Fizik ----
    function newState(pos) {
        return { x: pos.x, y: pos.y, vx: 0, vy: 0, jt: -1, jcd: 0, pcd: 0, alive: true, fall: 0, outAt: -1, fx: 1, fy: 0 };
    }

    // Zıplama yüksekliği (görsel; 0 = yerde). jt = zıplama başından beri geçen ms
    function zOf(state) {
        if (state.jt < 0) return 0;
        var p = clamp(state.jt / JUMP_MS, 0, 1);
        return JUMP_H * 4 * p * (1 - p);
    }

    function airborne(state) { return state.jt >= 0 && state.jt < JUMP_MS; }

    // Bir sabit adım (STEP_MS). input: { mx, my, jump, push } (mx,my [-1,1]; jump/push bu adımda basıldı mı).
    // tMs: adımın bittiği oyun saati. Döner: { push: bool (bu adımda it tetiklendi), out: bool (bu adımda elendi) }
    function step(state, input, tMs, sched) {
        var ev = { push: false, out: false, jump: false };
        if (!state.alive) return ev;
        var mx = input.mx || 0;
        var my = input.my || 0;
        var len = Math.sqrt(mx * mx + my * my);
        if (len > 1) { mx /= len; my /= len; len = 1; }
        if (len > 0.05) { state.fx = mx / len; state.fy = my / len; }
        var prevSp = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        state.vx += mx * ACC * DT;
        state.vy += my * ACC * DT;
        var fr = Math.exp(-FRIC * DT);
        state.vx *= fr;
        state.vy *= fr;
        // hız sınırı: yürüme MAXV'de kesilir; itme darbesi MAXV'yi aşabilir, yalnız sürtünmeyle söner (direksiyon onu büyütmez ya da bir anda silmez)
        var sp = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        var limit = Math.min(MAXV_ABS, Math.max(MAXV, prevSp));
        if (sp > limit) { state.vx *= limit / sp; state.vy *= limit / sp; }
        state.jcd = Math.max(0, state.jcd - STEP_MS);
        state.pcd = Math.max(0, state.pcd - STEP_MS);
        if (state.jt >= 0) {
            state.jt += STEP_MS;
            if (state.jt >= JUMP_MS) state.jt = -1;
        }
        if (input.jump && state.jcd <= 0 && state.jt < 0) { state.jt = 0; state.jcd = JUMP_CD_MS; ev.jump = true; }
        if (input.push && state.pcd <= 0) { state.pcd = PUSH_CD_MS; ev.push = true; }
        state.x += state.vx * DT;
        state.y += state.vy * DT;
        // zemin: havada değilken zemin katı değilse düşme sayacı işler
        if (airborne(state)) {
            state.fall = 0;
        } else if (!isSolid(sched, state.x, state.y, tMs)) {
            state.fall += STEP_MS;
            if (state.fall >= FALL_MS) { state.alive = false; state.outAt = Math.round(tMs); ev.out = true; }
        } else {
            state.fall = 0;
        }
        return ev;
    }

    // ---- İt / gövde teması ----
    // Menzil: merkezler arası ≤ PUSH_RANGE + 2R (kenardan kenara PUSH_RANGE), koni ±60° (bakış yönü = son hareket yönü)
    function pushTargets(self, others) {
        var out = [];
        others.forEach(function (o) {
            if (!o || o.alive === false) return;
            var dx = o.x - self.x;
            var dy = o.y - self.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d > PUSH_RANGE + 2 * R || d < 1e-6) return;
            var cos = (dx * self.fx + dy * self.fy) / d;
            if (cos >= PUSH_COS) out.push({ id: o.id, d: d, dx: dx / d, dy: dy / d });
        });
        return out.sort(function (a, b) { return a.d - b.d; });
    }

    function pushVector(dx, dy) {
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        return { dx: Math.round(dx / d * PUSH_IMPULSE), dy: Math.round(dy / d * PUSH_IMPULSE) };
    }

    // Kurban kendi üzerine uygular (itici yetkisiz). Darbe sınırlanır.
    function applyPush(state, dx, dy) {
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > PUSH_IMPULSE) { dx *= PUSH_IMPULSE / d; dy *= PUSH_IMPULSE / d; }
        state.vx += dx;
        state.vy += dy;
        if (state.jt >= 0) { /* havada itilmek yönü değiştirir, iniş karesine bakılır */ }
    }

    // Gövde teması: iç içe giren iki oyuncudan self'in alacağı hız değişimi (karşı taraf da kendi yerelinde aynısını uygular)
    function bodyContact(self, other) {
        var dx = self.x - other.x;
        var dy = self.y - other.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        var min = 2 * R;
        if (d >= min || d < 1e-6) return { dvx: 0, dvy: 0, dx: 0, dy: 0 };
        var o = (min - d) / 2;
        return { dvx: dx / d * 40, dvy: dy / d * 40, dx: dx / d * o, dy: dy / d * o };
    }

    // ---- Lider denetimi ----
    // prev/next: { x, y, z, vx, vy }; dtMs: rapor arası. Bütçe: ⌊dt/150⌋+1 adım x 150 ms x en yüksek hız.
    function plausible(prev, next, dtMs) {
        if (!next || typeof next !== 'object') return false;
        if (!isInt(next.x, -120, SIZE + 120) || !isInt(next.y, -120, SIZE + 120)) return false;
        if (!isInt(next.z, 0, JUMP_H + 4) || !isInt(next.vx, -MAXV_ABS - 20, MAXV_ABS + 20) || !isInt(next.vy, -MAXV_ABS - 20, MAXV_ABS + 20)) return false;
        if (Math.sqrt(next.vx * next.vx + next.vy * next.vy) > MAXV_ABS + 30) return false;
        if (!prev) return true;
        var steps = Math.floor(Math.max(0, dtMs) / 150) + 1;
        var dx = next.x - prev.x;
        var dy = next.y - prev.y;
        return Math.sqrt(dx * dx + dy * dy) <= steps * 0.15 * (MAXV_ABS + 30) + 10;
    }

    // Çevre kareler: son bilinen konumun belirsizlik yarıçapı içindeki kareler
    function nearbyTiles(x, y, radius) {
        var out = [];
        for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
            var cx0 = i * TILE;
            var cy0 = j * TILE;
            var nx = clamp(x, cx0, cx0 + TILE);
            var ny = clamp(y, cy0, cy0 + TILE);
            var d = Math.sqrt((x - nx) * (x - nx) + (y - ny) * (y - ny));
            if (d <= radius) out.push(j * N + i);
        }
        return out;
    }

    function edgeDistance(x, y) {
        // arena dışındaysa 0; içindeyse en yakın kenara uzaklık
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 0;
        return Math.min(x, y, SIZE - x, SIZE - y);
    }

    // Oyuncu elendiğini bildirdi (out.t oyun saatinden ms). last = son kabul edilen { x, y, vx?, vy?, at (oyun ms) }.
    // Kare yıkımı: collapseAt ≤ t ≤ collapseAt + OUT_WINDOW (yakın karelerden biri); anahtar = yıkılış anı (aynı turda düşenler eşit derece).
    // Kenar düşmesi: son konum kenara ≤ mesafe + hız payı içinde; anahtar = oyuncunun bildirdiği t.
    // -> { ok, kind: 'tile' | 'edge', key }
    function outCheck(sched, last, tOut) {
        if (!isInt(tOut, 0, 1e7)) return { ok: false };
        var dt = Math.max(0, tOut - (last.at || 0));
        // belirsizlik: hareket eden oyuncu ≤125 ms'de bir raporlar (durana dek kalp atışı) -> bir gönderim aralığı kadar en yüksek hız + son hızla ölü hesap
        var lastSpeed = Math.sqrt((last.vx || 0) * (last.vx || 0) + (last.vy || 0) * (last.vy || 0));
        var reach = 0.125 * MAXV_ABS + lastSpeed * Math.min(dt, 1000) / 1000 + R + 6;
        var cand = nearbyTiles(last.x, last.y, reach);
        var bestC = -1;
        cand.forEach(function (tile) {
            var c = sched.collapse[tile];
            if (c !== Infinity && c <= tOut && tOut <= c + OUT_WINDOW_MS && c > bestC) bestC = c;
        });
        if (bestC >= 0) return { ok: true, kind: 'tile', key: bestC };
        if (edgeDistance(last.x, last.y) <= reach) return { ok: true, kind: 'edge', key: tOut };
        return { ok: false };
    }

    // Donan/kopan oyuncu: STALE_MS rapor yoksa ve son bilinen karenin yıkılış anı geçmişse elenmiş sayılır (anahtar = yıkılış anı).
    // Güvenli kareye basan sessiz oyuncu elenmez. -> key | null
    function staleOut(sched, rep, t) {
        if (rep.out >= 0) return null;
        if (t - rep.atMs < STALE_MS) return null;
        var tile = tileOf(rep.x, rep.y);
        if (tile < 0) return rep.atMs;                           // arena dışında bildirilmişti
        var c = sched.collapse[tile];
        return c !== Infinity && t >= c ? c : null;
    }

    // ---- Botlar ----
    var botCache = {};
    var botCacheSize = 0;

    function collapseEvents(sched) {
        return sched.rounds.filter(function (r) { return r.doomed.length; }).map(function (r) { return r.collapseMs; });
    }

    // Bot elenme anı: ham süre (14-109 sn, çoğu 70 sn'den önce) ilk yıkılış anına oturtulur; son yıkılışı geçmez. Aynı tur = eşit derece.
    function botFall(seed, id, sched) {
        var key = (seed >>> 0) + ':' + sched.n + ':' + id;
        if (botCache[key] !== undefined) return botCache[key];
        var rng = mulberry(((seed >>> 0) ^ hashStr(String(id)) ^ 0xB07F) >>> 0);
        var raw = 14000 + 95000 * Math.pow(rng(), 1.7);
        var ev = collapseEvents(sched);
        var f = ev[ev.length - 1];
        for (var i = 0; i < ev.length; i++) if (ev[i] >= raw) { f = ev[i]; break; }
        if (botCacheSize >= 256) { botCache = {}; botCacheSize = 0; }
        botCache[key] = f;
        botCacheSize++;
        return f;
    }

    // Botun görsel konumu (hayalet): elenmeden önce, yaklaşan yıkılıştan sağ çıkacak güvenli karelerde gezinti (bir turdan sonrakine yumuşak
    // geçiş + küçük salınım); { x, y, out }. Hiç itilmez/itmez.
    function botPosition(seed, id, t, sched) {
        var fall = botFall(seed, id, sched);
        var tt = Math.min(t, fall);
        var rng0 = (hashStr(String(id)) ^ (seed >>> 0)) >>> 0;
        var kk = sched.rounds.length - 1;
        for (var i = 0; i < sched.rounds.length; i++) if (tt < sched.rounds[i].collapseMs) { kk = i; break; }
        var pick = function (k) {
            var set = sched.rounds[k].safe;
            return tileCenter(set[Math.floor(mulberry((rng0 + Math.imul(k + 1, 0x85EBCA6B)) >>> 0)() * set.length)]);
        };
        var a = pick(kk > 0 ? kk - 1 : kk);
        var b = pick(kk);
        var segStart = kk > 0 ? sched.rounds[kk - 1].collapseMs : 0;
        var segEnd = sched.rounds[kk].collapseMs;
        var p = clamp((tt - segStart) / Math.max(1, segEnd - segStart), 0, 1);
        p = p * p * (3 - 2 * p);
        return {
            x: Math.round(a.x + (b.x - a.x) * p + Math.sin(tt / 700 + (rng0 % 7)) * 14),
            y: Math.round(a.y + (b.y - a.y) * p + Math.cos(tt / 900 + (rng0 % 5)) * 14),
            out: t >= fall
        };
    }

    // ---- Sıralama ----
    // opts: { players, bots, seed, sched, outs: { id: { key } }, endMs }. Geç elenen iyi; hayatta kalanlar (süre sonunda) eşit 1.;
    // aynı anahtar (aynı yıkılış turu ya da aynı ms) eşit derece. Botlar botFall ile girer.
    function rank(opts) {
        var outs = opts.outs || {};
        var list = [];
        (opts.players || []).forEach(function (id) {
            var key;
            if (opts.bots && opts.bots.indexOf(id) >= 0) key = botFall(opts.seed, id, opts.sched);
            else key = outs[id] && outs[id].key >= 0 ? outs[id].key : Infinity;
            if (key > opts.endMs) key = Infinity;                       // süre bitti: hayatta
            list.push({ id: id, key: key });
        });
        list.sort(function (a, b) { return b.key - a.key; });
        var groups = [];
        var lastKey = null;
        list.forEach(function (x) {
            if (lastKey !== null && lastKey === x.key) groups[groups.length - 1].push(x.id);
            else { groups.push([x.id]); lastKey = x.key; }
        });
        return groups;
    }

    return {
        N: N, TILE: TILE, SIZE: SIZE, R: R, STEP_MS: STEP_MS, DT: DT, MAXV: MAXV, MAXV_ABS: MAXV_ABS, JUMP_MS: JUMP_MS, JUMP_CD_MS: JUMP_CD_MS, JUMP_H: JUMP_H,
        PUSH_RANGE: PUSH_RANGE, PUSH_CD_MS: PUSH_CD_MS, PUSH_IMPULSE: PUSH_IMPULSE, FALL_MS: FALL_MS, OUT_WINDOW_MS: OUT_WINDOW_MS, STALE_MS: STALE_MS,
        ROUNDS: ROUNDS, END_COLLAPSE: END_COLLAPSE, UYARI_MODU: UYARI_MODU, CORE: CORE,
        schedule: schedule, tileOf: tileOf, tileCenter: tileCenter, tileIndex: tileIndex, tileState: tileState, warnRound: warnRound, isSolid: isSolid,
        startPositions: startPositions, newState: newState, step: step, zOf: zOf, airborne: airborne,
        pushTargets: pushTargets, pushVector: pushVector, applyPush: applyPush, bodyContact: bodyContact,
        plausible: plausible, outCheck: outCheck, staleOut: staleOut, nearbyTiles: nearbyTiles, edgeDistance: edgeDistance,
        botFall: botFall, botPosition: botPosition, rank: rank, mulberry: mulberry
    };
});
