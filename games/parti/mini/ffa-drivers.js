// Parti: ffa (herkes aynı anda) minioyun SÜRÜCÜLERİ. machine.js oyuna özel kuralı bilmez; her ffa oyunu için bir sürücü çağırır:
//
//   driver = {
//     id, countdownMs, durationMs, publishMs,       // geri sayım payı, toplam süre, lider ilerleme yayını alt aralığı
//     newRep(id, ctx) -> rep                         // lider jetonu kurarken (ctx: { stAt, seed, players })
//     packRep(rep) -> dizi                           // pt_state.mn.ff.rp[id] (tamsayılar)
//     unpackRep(raw, ctx) -> rep | null              // doğrulamalı; null = tüm yayın reddedilir (ctx: { stAt })
//     accept(ff, from, m, t, ctx) -> { ok, changed, final }   // lider denetimi: rapor kabul/ret; ff.rep/ff.endAt güncellenir (ctx: { seed, n }).
//                                                    //   final: hemen yayınla (ilk rapor/varış/elenme); changed: sınırlı yayın
//     allDone(ff, liveIds, t, ctx) -> bool           // erken bitiş (ctx: { seed, players, bots })
//     watch(ff, t, ctx) -> bool                      // isteğe bağlı: her lider tick'inde (donan/kopan oyuncu denetimi); true = değişti, hemen yayınla
//     rank(ctx) -> ranking | null                    // ctx: { players, bots, seed, ff, endMs }; null = acil yedek çark
//     resume(rep) -> spec.resume | null              // oturum yeniden kurulurken (yenileme)
//     onTakeover(ff, t)                              // lider devrinde sıra no / zaman bütçesi sıfırlanır
//     summaryRow(ff, id, t, ctx) -> { id, bot, text, pct, done, ... }   // izleyici kartı satırı (ctx: { seed })
//   }
//
// rep ortak alanları: n (son kabul edilen sıra no), at (son kabul edilen rapor anı, lider saati), seen (rapor verdi mi).
// ff ortak alanları: stAt, endAt, sn (rapor veren insan sayısı), rep, pubAt, dirty.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../config.js'), require('./kurbaga-rules.js'), require('./dusenzemin-rules.js'));
    else root.PartiFfaDrivers = factory(root.PartiConfig, root.PartiKurbagaRules, root.PartiDusenZeminRules);
})(typeof self !== 'undefined' ? self : this, function (C, KRules, DRules) {
    'use strict';

    function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }

    // ---- Kurbağa ----
    function progressText(row, fin) {
        var n = Math.max(0, Math.min(9, row));
        return new Array(n + 1).join('█') + new Array(10 - n).join('░') + ' ' + (fin !== null && fin !== undefined ? '🏁 ' + (fin / 1000).toFixed(1) + ' sn' : n + '/9');
    }

    var kurbaga = {
        id: 'kurbaga',
        countdownMs: C.KURBAGA_COUNTDOWN_MS,
        durationMs: C.KURBAGA_MS,
        publishMs: C.KURBAGA_PUBLISH_MS,

        newRep: function (id, ctx) {
            return { r: 0, c: Math.floor(KRules.COLS / 2), d: 0, f: -1, n: -1, at: ctx.stAt, seen: 0 };
        },

        packRep: function (q) { return [q.r, q.c, q.d, q.f]; },

        // n/at: lider devrinde ilk rapor için cömert zaman bütçesi (oyun başlangıcından beri)
        unpackRep: function (a, ctx) {
            if (!Array.isArray(a) || a.length !== 4 || !isInt(a[0], 0, KRules.GOAL_ROW) || !isInt(a[1], 0, KRules.COLS - 1) || !isInt(a[2], 0, 100000) || !isInt(a[3], -1, 10000000)) return null;
            return { r: a[0], c: a[1], d: a[2], f: a[3], n: -1, at: ctx.stAt, seen: 1 };
        },

        // Rapor: { k:'pos', r, c, d, n, e? }. Makul değilse ya da eski sıra noktasıysa yok sayılır.
        accept: function (ff, from, m, t) {
            var no = { ok: false, changed: false, final: false };
            var q = ff.rep[from];
            if (!q || !m || m.k !== 'pos') return no;
            if (!isInt(m.n, 0, 1000000000) || m.n <= q.n) return no;
            if (!KRules.plausible({ r: q.r, c: q.c, d: q.d }, { r: m.r, c: m.c, d: m.d }, t - q.at)) return no;
            if (q.f >= 0) { q.n = m.n; return { ok: true, changed: false, final: false }; }              // varmış: sonuç donuk
            var fin = -1;
            if (m.r === KRules.GOAL_ROW) {
                if (!KRules.plausibleFinish(m.e, t - ff.stAt)) return no;
                fin = m.e;
            }
            var changed = q.r !== m.r || q.c !== m.c || q.d !== m.d;
            q.r = m.r; q.c = m.c; q.d = m.d; q.n = m.n; q.at = t;
            var final = false;
            if (!q.seen) { q.seen = 1; ff.sn = (ff.sn || 0) + 1; final = true; }
            if (fin >= 0) {
                q.f = fin;
                // ilk varıştan sonra kalan süre KURBAGA_LAST_CALL_MS'e düşer (min: sonraki varışlar uzatmaz)
                ff.endAt = Math.min(ff.endAt, t + C.KURBAGA_LAST_CALL_MS);
                final = true;
            }
            return { ok: true, changed: changed, final: final };
        },

        allDone: function (ff, liveIds) {
            return liveIds.length > 0 && liveIds.every(function (id) { return ff.rep[id].f >= 0; });
        },

        rank: function (ctx) {
            var ff = ctx.ff;
            if (!(ff.sn > 0)) return null;                                           // hiç rapor yok: acil yedek çark
            var reports = {};
            Object.keys(ff.rep).forEach(function (id) { reports[id] = { r: ff.rep[id].r, f: ff.rep[id].f, d: ff.rep[id].d }; });
            return KRules.rank({ players: ctx.players, bots: ctx.bots, seed: ctx.seed, reports: reports, endMs: ctx.endMs });
        },

        resume: function (q) {
            return q && (q.seen || q.f >= 0 || q.r > 0 || q.d > 0) ? { r: q.r, c: q.c, d: q.d, f: q.f } : null;
        },

        onTakeover: function (ff) {
            Object.keys(ff.rep).forEach(function (id) { ff.rep[id].n = -1; ff.rep[id].at = ff.stAt; });
        },

        summaryRow: function (ff, id, t, ctx) {
            var el = t - ff.stAt;
            var q = ff.rep[id];
            if (q) {
                var fin = q.f >= 0 ? q.f : null;
                return { id: id, bot: false, row: q.r, fin: fin, d: q.d, text: progressText(q.r, fin), pct: q.r / KRules.GOAL_ROW, done: fin !== null };
            }
            var bf = KRules.botFinish(ctx.seed, id);
            var row = el >= 0 ? KRules.botProgress(ctx.seed, id, el) : 0;
            var bfin = bf !== null && bf <= el ? bf : null;
            return { id: id, bot: true, row: row, fin: bfin, d: 0, text: progressText(row, bfin), pct: row / KRules.GOAL_ROW, done: bfin !== null };
        }
    };

    // ---- Düşen Zemin ----
    // rep: { x, y, z, vx, vy (son kabul edilen rapor), out (elenme anahtarı ms | -1), atMs (son rapor, oyun saati ms), n, at (lider saati), seen }
    // out anahtarı: kare yıkımında yıkılış anı (aynı turda düşenler eşit derece), kenar düşmesinde oyuncunun kendi ms'si.
    function dzOuts(ff) {
        var outs = {};
        Object.keys(ff.rep).forEach(function (id) { if (ff.rep[id].out >= 0) outs[id] = { key: ff.rep[id].out }; });
        return outs;
    }

    var dusenzemin = {
        id: 'dusenzemin',
        countdownMs: C.DUSENZEMIN_COUNTDOWN_MS,
        durationMs: C.DUSENZEMIN_MS,
        publishMs: C.DUSENZEMIN_PUBLISH_MS,

        newRep: function (id, ctx) {
            var pos = DRules.startPositions(ctx.seed, ctx.players.length)[Math.max(0, ctx.players.indexOf(id))] || { x: DRules.SIZE / 2, y: DRules.SIZE / 2 };
            return { x: pos.x, y: pos.y, z: 0, vx: 0, vy: 0, out: -1, atMs: 0, n: -1, at: ctx.stAt, seen: 0 };
        },

        packRep: function (q) { return [q.x, q.y, q.z, q.vx, q.vy, q.out, q.atMs]; },

        unpackRep: function (a, ctx) {
            if (!Array.isArray(a) || a.length !== 7) return null;
            if (!isInt(a[0], -120, DRules.SIZE + 120) || !isInt(a[1], -120, DRules.SIZE + 120) || !isInt(a[2], 0, DRules.JUMP_H + 4) ||
                !isInt(a[3], -800, 800) || !isInt(a[4], -800, 800) || !isInt(a[5], -1, 10000000) || !isInt(a[6], 0, 10000000)) return null;
            return { x: a[0], y: a[1], z: a[2], vx: a[3], vy: a[4], out: a[5], atMs: a[6], n: -1, at: ctx.stAt, seen: 1 };
        },

        // Raporlar: { k:'pos', n, x, y, z, vx, vy, a } ve { k:'out', t, n }. 'push' yalnız kurbanı ilgilendirir (liderde yok sayılır).
        accept: function (ff, from, m, t, ctx) {
            var no = { ok: false, changed: false, final: false };
            var q = ff.rep[from];
            if (!q || !m || (m.k !== 'pos' && m.k !== 'out')) return no;
            if (!isInt(m.n, 0, 1000000000) || m.n <= q.n) return no;
            var el = t - ff.stAt;
            if (m.k === 'pos') {
                if (q.out >= 0) { q.n = m.n; return { ok: true, changed: false, final: false }; }                       // elenmiş: sonuç donuk
                if (!DRules.plausible({ x: q.x, y: q.y }, { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy }, t - q.at)) return no;
                var changed = q.x !== m.x || q.y !== m.y || q.z !== m.z;
                q.x = m.x; q.y = m.y; q.z = m.z; q.vx = m.vx; q.vy = m.vy; q.n = m.n; q.at = t; q.atMs = Math.max(0, Math.round(el));
                var final = false;
                if (!q.seen) { q.seen = 1; ff.sn = (ff.sn || 0) + 1; final = true; }
                return { ok: true, changed: changed, final: final };
            }
            // out
            if (q.out >= 0) { q.n = m.n; return { ok: true, changed: false, final: false }; }                          // ikinci out yok sayılır
            if (!isInt(m.t, 0, 10000000) || m.t > el + 1500) return no;
            var sched = DRules.schedule(ctx.seed, ctx.n);
            var chk = DRules.outCheck(sched, { x: q.x, y: q.y, vx: q.vx, vy: q.vy, at: q.atMs }, m.t);
            if (!chk.ok) return no;
            q.out = chk.key;
            q.n = m.n;
            if (!q.seen) { q.seen = 1; ff.sn = (ff.sn || 0) + 1; }
            return { ok: true, changed: true, final: true };
        },

        // Donan/kopan telefon: 5 sn rapor yoksa ve son bilinen karenin yıkılış anı geçmişse elenmiş sayılır (güvenli karede sessiz oyuncu elenmez)
        watch: function (ff, t, ctx) {
            var sched = DRules.schedule(ctx.seed, ctx.n);
            var changed = false;
            Object.keys(ff.rep).forEach(function (id) {
                var q = ff.rep[id];
                if (q.out >= 0) return;
                var key = DRules.staleOut(sched, { x: q.x, y: q.y, atMs: q.atMs, out: q.out }, t - ff.stAt);
                if (key !== null) { q.out = key; if (!q.seen) { q.seen = 1; ff.sn = (ff.sn || 0) + 1; } changed = true; }
            });
            return changed;
        },

        // Erken bitiş: bağlı hayatta insan kalmadı ya da hayatta (insan + bot) ≤ 1
        allDone: function (ff, liveIds, t, ctx) {
            if (liveIds.length > 0 && liveIds.every(function (id) { return ff.rep[id].out >= 0; })) return true;
            var el = t - ff.stAt;
            var sched = DRules.schedule(ctx.seed, ctx.players.length);
            var alive = Object.keys(ff.rep).filter(function (id) { return ff.rep[id].out < 0; }).length;
            ctx.bots.forEach(function (id) { if (DRules.botFall(ctx.seed, id, sched) > el) alive++; });
            return alive <= 1;
        },

        rank: function (ctx) {
            if (!(ctx.ff.sn > 0)) return null;
            return DRules.rank({ players: ctx.players, bots: ctx.bots, seed: ctx.seed, sched: DRules.schedule(ctx.seed, ctx.players.length), outs: dzOuts(ctx.ff), endMs: ctx.endMs });
        },

        resume: function (q) {
            if (!q || !(q.seen || q.out >= 0)) return null;
            return { x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, out: q.out };
        },

        onTakeover: function (ff, t) {
            var el = Math.max(0, Math.round(t - ff.stAt));
            Object.keys(ff.rep).forEach(function (id) {
                var q = ff.rep[id];
                q.n = -1;
                q.at = ff.stAt;                              // ilk rapor için cömert zaman bütçesi
                if (q.out < 0) q.atMs = el;                  // sessizlik sayacı yeni liderde sıfırdan (gecikmiş heartbeat yüzünden haksız elenme olmasın)
            });
        },

        summaryRow: function (ff, id, t, ctx) {
            var el = t - ff.stAt;
            var q = ff.rep[id];
            var out;
            if (q) out = q.out;
            else {
                var bf = DRules.botFall(ctx.seed, id, DRules.schedule(ctx.seed, ctx.players.length));
                out = bf <= el ? bf : -1;
            }
            var alive = out < 0;
            return { id: id, bot: !q, alive: alive, out: out, text: alive ? '🟢 Hayatta' : '💀 ' + (out / 1000).toFixed(1) + ' sn', pct: alive ? 1 : 0, done: !alive };
        }
    };

    return { kurbaga: kurbaga, dusenzemin: dusenzemin };
});
