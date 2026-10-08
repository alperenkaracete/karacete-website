// Parti: ağ/oda durum makinesi (DOM'suz; saat ve gönderim enjekte edilir, Node'da test edilir).
//
// Lider (otorite) durumu hesaplar, her kabul edilen eylemden sonra TAM `pt_state` anlık görüntüsünü yayınlar.
// Diğerleri `pt_action` yollar ve son görüntüyü saklar. Lider `players[0]`'dan DEĞİL, durumdan türetilir (`ld`):
// backend yeniden katılanı listenin sonuna ekler. Lider düşerse bağlı insan koltuklar arasında koltuk sırasına göre
// ilk kişi lider olur (herkes aynı kuralı yerelde uygular), `ep` (devir sayısı) artar ve saklı durumdan sürer.
//
// Mesajlar: pt_state {ep, rv, ld, ph, cf, S, g, dl, pz, mn, lg, fx, fq, kk}, pt_action {id, a}, pt_sync {id},
//           pt_mg {mg, from, m} (minioyun yükü; durum DEĞİL: yalnızca eşleşen oturuma, düellodaki ikiliden ya da liderden kabul edilir)
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./config.js'), require('./graph.js'), require('./rules.js'), require('./minigame.js'), require('./mini/duel-watch.js'), require('./mini/kurbaga-rules.js'));
    } else {
        root.PartiMachine = factory(root.PartiConfig, root.PartiGraph, root.PartiRules, root.PartiMinigame, root.PartiDuelWatch, root.PartiKurbagaRules);
    }
})(typeof self !== 'undefined' ? self : this, function (C, G, R, Mini, Watch, KRules) {
    'use strict';

    var PHASES = ['lobby', 'play', 'over'];
    var SYNC_RETRY_MS = 1500;
    var REPUBLISH_MIN_MS = 400;

    // opts: { me:{id,name}, players: ctx.players (yerinde güncellenen dizi), send, now, maps:{id:harita}, onChange?, onEvent?,
    //         startMinigame?, rand?, creator: bool }
    function create(opts) {
        var me = opts.me;
        var now = opts.now || function () { return Date.now(); };
        var rand = opts.rand || Math.random;
        var startMinigame = opts.startMinigame || Mini.startMinigame;
        var sessions = [];            // yerel minioyun oturumları { mg, pair, observer, ac, handlers } (oyuncu: kendi maçı; lider: ayrıca başsız hakemler)
        var onChange = opts.onChange || function () {};
        var onEmote = opts.onEmote || function () {};
        var lastEmote = {};           // gönderen -> son emote zamanı (hız sınırı; durumda tutulmaz)
        var graphs = {};

        var M = null;                 // en son durum (lider: otoriter; diğerleri: son anlık görüntü)
        var gone = {};                // yerelde "koptu" bilinen kimlikler (lider seçimi için)
        var lastSyncAt = -1e9;
        var lastRepublish = -1e9;
        var offline = false;
        var botAt = 0;
        var botSeq = 0;
        var turnMark = null;          // { key, id, acted, counted } bu turda insanın eylem yapıp yapmadığı (AFK sayacı)
        var resyncOk = false;         // _reconnected sonrası ilk pt_state ep sınırından muaf

        function send(msg) { opts.send(msg); }
        function isLeader() { return !!M && M.ld === me.id; }

        function graphFor(mapId) {
            if (!graphs[mapId]) graphs[mapId] = G.index(opts.maps[mapId]);
            return graphs[mapId];
        }
        function rctx() { return { g: graphFor(M.cf.mp), mini: opts.forceMini || null }; }

        function seatOf(id) {
            for (var i = 0; i < M.S.length; i++) if (M.S[i].i === id) return M.S[i];
            return null;
        }

        function rnd(n) { return Math.floor(rand() * n); }

        // ---- Oluşturma ----
        function freshSeat(id, name, bot) {
            var used = {};
            M.S.forEach(function (s) { used[s.a] = true; });
            var av = C.AVATARS.filter(function (a) { return !used[a]; })[0] || C.AVATARS[0];
            var counts = {};
            M.S.forEach(function (s) { counts[s.t] = (counts[s.t] || 0) + 1; });
            var team = 0;
            while ((counts[team] || 0) >= 2 && team < 3) team++;
            return { i: id, n: String(name || 'Oyuncu').slice(0, 20), a: av, t: team, b: bot ? 1 : 0, c: 1, d: 0 };
        }

        function initLeader() {
            M = {
                ep: 1, rv: 0, ld: me.id, ph: 'lobby',
                cf: { m: 'solo', mp: Object.keys(opts.maps)[0], gl: C.DEFAULT_GOAL },
                S: [], g: null, dlAt: 0, dlLeft: 0, pz: false, bt: null, mn: null, lg: [], fx: [], fq: 0, kk: []
            };
            M.S.push(freshSeat(me.id, me.name, false));
            // odaya zaten girmiş başkaları varsa (ender) onları da ekle
            (opts.players || []).forEach(function (p) {
                if (p.id !== me.id && !seatOf(p.id)) M.S.push(freshSeat(p.id, p.name, false));
            });
            publish();
        }

        // ---- Yayın ----
        function pack() {
            var t = now();
            return {
                type: 'pt_state', ep: M.ep, rv: M.rv, ld: M.ld, ph: M.ph, cf: M.cf,
                S: M.S.map(function (s) { return { i: s.i, n: s.n, a: s.a, t: s.t, b: s.b, c: s.c, d: s.c ? 0 : Math.max(0, Math.round(s.dAt - t)) }; }),
                g: M.g,
                dl: M.pz ? Math.round(M.dlLeft) : Math.max(0, Math.round(M.dlAt - t)), pz: M.pz ? 1 : 0, bt: M.bt,
                                mn: M.mn ? packMn(t) : null,
                lg: M.lg, fx: M.fx, fq: M.fq, kk: M.kk
            };
        }

        // Kurbağa (ffa): st/ea oyunun başlangıcı ve sonu (yayın anına göre işaretli ms), sn rapor veren insan sayısı,
        // rp: { id: [satır, sütun, ölüm, varış ms | -1] }. Araçlar ve botlar tohumdan, ağda yok.
        function packFf(ff, t) {
            var rp = {};
            Object.keys(ff.rep).forEach(function (id) {
                var q = ff.rep[id];
                rp[id] = [q.r, q.c, q.d, q.f];
            });
            return { st: Math.round(ff.stAt - t), ea: Math.round(ff.endAt - t), sn: ff.sn || 0, rp: rp };
        }

        // Düello çiftleri: pm = [{ p:[a,b], st (başlama), dl (süre sonu), hd (sonuç tutma sonu), o: null | {w,l,d,r} }]
        function packMn(t) {
            var m = M.mn;
            function ms(at) { return at ? Math.max(0, Math.round(at - t)) : -1; }
            return {
                ty: m.ty, pl: m.pl, sd: m.sd, rk: m.rk, ms: m.applyAt ? Math.max(0, Math.round(m.applyAt - t)) : -1, gm: m.gm || null,
                pm: (m.pm || []).map(function (x) {
                    return { p: x.p, st: x.stAt ? Math.max(0, Math.round(x.stAt - t)) : 0, dl: ms(x.dlAt), hd: ms(x.hAt), bd: ms(x.bAt), wb: x.wb || null,
                        o: x.out ? { w: x.out.w || '', l: x.out.l || '', d: x.out.d ? 1 : 0, r: x.out.r || '' } : null };
                }),
                ex: m.ex || null, nf: m.nFirst || 0, oc: m.oc || null,
                ff: m.ff ? packFf(m.ff, t) : null
            };
        }

        function publish() {
            M.rv++;
            send(pack());
            lastRepublish = now();
            emit();
        }

        // ---- Doğrulama (gelen anlık görüntü) ----
        function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }

        // Oyun durumu doğrulaması: sonlu can/yıldız/konum (NaN/undefined arayüze ve kurallara hiç girmesin).
        function validGame(g) {
            if (!g || typeof g !== 'object' || !g.P || typeof g.P !== 'object' || !Array.isArray(g.order)) return false;
            if (g.order.length > C.MAX_PLAYERS) return false;
            if (!isInt(g.rd, 1, 1e6) || !isInt(g.turn, -1, 64) || !isInt(g.goal, 1, 100)) return false;
            for (var i = 0; i < g.order.length; i++) {
                var id = g.order[i];
                if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(g.P, id)) return false;
                var p = g.P[id];
                if (!p || typeof p !== 'object') return false;
                if (typeof p.hp !== 'number' || !isFinite(p.hp) || p.hp < 0 || p.hp > C.MAX_HP) return false;
                if (!isInt(p.s, 0, 999) || !isInt(p.pos, 0, 999) || !isInt(p.home, 0, 999)) return false;
                if (p.shl !== undefined && !isInt(p.shl, 0, 9)) return false;
                if (p.scd !== undefined && !isInt(p.scd, 0, 9)) return false;
                if (!Array.isArray(p.w) && (!p.w || typeof p.w !== 'object')) return false;
                if (!Array.isArray(p.w)) {
                    var wk = Object.keys(p.w);
                    for (var k = 0; k < wk.length; k++) if (!C.WEAPONS[wk[k]] || !isInt(p.w[wk[k]], 1, 9)) return false;
                }
            }
            return true;
        }

        // Eski anlık görüntüler: haritada olmayan konumlar (eski 8 başlangıç düğümü) ortak başlangıca taşınır;
        // üst düzey `home` (ortak başlangıç) yoksa eklenir ve oyuncuların `home` alanı buna eşitlenir.
        function migrateGame(g, mapId) {
            var gr = graphFor(mapId);
            var start = gr.start;
            if (g.home === undefined) {
                g.home = start;
                g.order.forEach(function (id) { g.P[id].home = start; });
            }
            // eski aşamalar: 'act' (yürüyüş sonrası) ve 'swap' (envanter seçimi) kalktı -> 'roll'
            if (g.stage === 'act' || g.stage === 'swap') g.stage = 'roll';
            if (g.atk === undefined) g.atk = 0;
            g.order.forEach(function (id) {
                var p = g.P[id];
                // eski biçim: silah dizisi ['fist','bow'] -> sayaç nesnesi {fist:1, bow:1}; seçim bekleyen öğeler atılır
                if (Array.isArray(p.w)) {
                    var counts = {};
                    p.w.forEach(function (w) { if (C.WEAPONS[w]) counts[w] = (counts[w] || 0) + 1; });
                    p.w = counts;
                }
                delete p.offers;
                // kalkan sayaçları: eski görüntülerde yok -> kurulu kalkan 3 tur, bekleme 0
                if (p.shield && !Number.isFinite(p.shl)) p.shl = C.SHIELD_TURNS;
                if (!Number.isFinite(p.shl)) p.shl = 0;
                if (!Number.isFinite(p.scd)) p.scd = 0;
                if (!Object.prototype.hasOwnProperty.call(gr.byId, p.pos)) p.pos = start;
                if (!Object.prototype.hasOwnProperty.call(gr.byId, p.home)) p.home = start;
            });
        }

        function unpack(msg) {
            if (!msg || !isInt(msg.ep, 0, 1e6) || !isInt(msg.rv, 0, 1e9)) return null;
            if (typeof msg.ld !== 'string' || PHASES.indexOf(msg.ph) < 0) return null;
            // Devir en çok bir adım ilerler (takeOver ep'yi tam 1 artırır). Yeniden bağlanma sonrası ilk görüntü muaf:
            // uzun kopan oyuncu birden çok devri kaçırmış olabilir.
            if (M && !resyncOk && msg.ep > M.ep + 1) return null;
            if (!msg.cf || (msg.cf.m !== 'solo' && msg.cf.m !== 'team') || !opts.maps[msg.cf.mp] || (msg.cf.gl !== C.GOAL_AUTO && C.GOALS.indexOf(msg.cf.gl) < 0)) return null;
            if (!Array.isArray(msg.S) || msg.S.length > C.MAX_PLAYERS) return null;
            var t = now();
            var seats = [];
            for (var i = 0; i < msg.S.length; i++) {
                var s = msg.S[i];
                if (!s || typeof s.i !== 'string' || typeof s.n !== 'string' || typeof s.a !== 'string') return null;
                if (!isInt(s.t, 0, 3) || !isInt(s.d, 0, C.DISCONNECT_MS)) return null;
                seats.push({ i: s.i, n: s.n.slice(0, 20), a: s.a.slice(0, 8), t: s.t, b: s.b ? 1 : 0, c: s.c ? 1 : 0, dAt: t + s.d });
            }
            // Lider, görüntüdeki koltuklarda oturan bir İNSAN olmalı. Bağlı olup olmadığına bakılmaz: alıcı
            // player_disconnect/player_joined'u henüz işlememiş olabilir ve yeni liderin ilk yayını reddedilirdi.
            if (!seats.some(function (x) { return x.i === msg.ld && !x.b; })) return null;
            if (msg.g !== null && !validGame(msg.g)) return null;
            if (msg.g !== null) migrateGame(msg.g, msg.cf.mp);
            if (!isInt(msg.dl, 0, 3600000)) return null;
            var mn = null;
            if (msg.mn) {
                if (!Array.isArray(msg.mn.pl) || !Array.isArray(msg.mn.rk) || !isInt(msg.mn.ms, -1, 600000)) return null;
                var gm = typeof msg.mn.gm === 'string' && msg.mn.gm.length <= 20 ? msg.mn.gm : null;
                var mpm = [];
                if (Array.isArray(msg.mn.pm)) {
                    if (msg.mn.pm.length > 8) return null;
                    for (var pi = 0; pi < msg.mn.pm.length; pi++) {
                        var xm = msg.mn.pm[pi];
                        if (!xm || !Array.isArray(xm.p) || xm.p.length !== 2 || typeof xm.p[0] !== 'string' || typeof xm.p[1] !== 'string') return null;
                        if (!isInt(xm.st, 0, 600000) || !isInt(xm.dl, -1, 600000) || !isInt(xm.hd, -1, 600000)) return null;
                        var xbd = xm.bd === undefined ? -1 : xm.bd;   // eski görüntüde yok: banner gecikmesiz
                        if (!isInt(xbd, -1, 600000)) return null;
                        var om = null;
                        if (xm.o) {
                            if (typeof xm.o !== 'object') return null;
                            om = { w: typeof xm.o.w === 'string' ? xm.o.w : '', l: typeof xm.o.l === 'string' ? xm.o.l : '', d: xm.o.d ? 1 : 0, r: typeof xm.o.r === 'string' ? xm.o.r.slice(0, 12) : '' };
                        }
                        mpm.push({ p: xm.p.slice(), stAt: xm.st ? t + xm.st : 0, dlAt: xm.dl >= 0 ? t + xm.dl : 0, hAt: xm.hd >= 0 ? t + xm.hd : 0, bAt: xbd >= 0 ? t + xbd : 0, wb: Watch.sanitize(xm.wb), out: om, off: {} });
                    }
                } else if (gm && msg.mn.ty === 'duel' && msg.mn.pl.length === 2) {
                    // Eski tek çiftli görüntü (pm yok): tek maç olarak oku
                    var lo = null;
                    if (msg.mn.ms >= 0 && msg.mn.rk.length === 1) lo = { w: '', l: '', d: 1, r: '' };
                    else if (msg.mn.ms >= 0 && msg.mn.rk.length >= 2 && msg.mn.rk[0] && msg.mn.rk[1]) lo = { w: String(msg.mn.rk[0][0]), l: String(msg.mn.rk[1][0]), d: 0, r: '' };
                    var ldl = isInt(msg.mn.dl, -1, 600000) ? msg.mn.dl : -1;
                    var lhd = isInt(msg.mn.hd, -1, 600000) ? msg.mn.hd : -1;
                    mpm.push({ p: msg.mn.pl.slice(), stAt: 0, dlAt: ldl >= 0 ? t + ldl : 0, hAt: lhd >= 0 ? t + lhd : 0, bAt: 0, wb: null, out: lo, off: {} });
                }
                var moc = null;
                if (msg.mn.oc && typeof msg.mn.oc === 'object' && Array.isArray(msg.mn.oc.win) && Array.isArray(msg.mn.oc.lose) && Array.isArray(msg.mn.oc.draw)) {
                    moc = { win: msg.mn.oc.win.map(String), lose: msg.mn.oc.lose.map(String), draw: msg.mn.oc.draw.map(String) };
                }
                var mff = null;
                if (msg.mn.ff) {
                    var fx = msg.mn.ff;
                    if (typeof fx !== 'object' || !isInt(fx.st, -1000000, 1000000) || !isInt(fx.ea, -1000000, 1000000) || !isInt(fx.sn, 0, 8) || !fx.rp || typeof fx.rp !== 'object') return null;
                    var fks = Object.keys(fx.rp);
                    if (fks.length > C.MAX_PLAYERS) return null;
                    var frep = {};
                    for (var fi = 0; fi < fks.length; fi++) {
                        var fa = fx.rp[fks[fi]];
                        if (!Array.isArray(fa) || fa.length !== 4 || !isInt(fa[0], 0, KRules.GOAL_ROW) || !isInt(fa[1], 0, KRules.COLS - 1) || !isInt(fa[2], 0, 100000) || !isInt(fa[3], -1, 10000000)) return null;
                        // n/at: lider devrinde ilk rapor için cömert zaman bütçesi (oyun başlangıcından beri)
                        frep[fks[fi]] = { r: fa[0], c: fa[1], d: fa[2], f: fa[3], n: -1, at: t + fx.st, seen: 1 };
                    }
                    mff = { stAt: t + fx.st, endAt: t + fx.ea, sn: fx.sn, rep: frep };
                }
                mn = { ty: msg.mn.ty === 'duel' ? 'duel' : 'ffa', pl: msg.mn.pl, sd: msg.mn.sd >>> 0, rk: msg.mn.rk, applyAt: msg.mn.ms >= 0 ? t + msg.mn.ms : 0, got: t, gm: gm,
                    pm: mpm, ex: typeof msg.mn.ex === 'string' ? msg.mn.ex : null, nFirst: isInt(msg.mn.nf, 0, 8) ? msg.mn.nf : mpm.length, oc: moc, ff: mff };
            }
            if (!Array.isArray(msg.lg) || msg.lg.length > 60 || !Array.isArray(msg.fx) || !isInt(msg.fq, 0, 1e9)) return null;
            return {
                ep: msg.ep, rv: msg.rv, ld: msg.ld, ph: msg.ph, cf: { m: msg.cf.m, mp: msg.cf.mp, gl: msg.cf.gl },
                S: seats, g: msg.g, dlAt: t + msg.dl, dlLeft: msg.dl, pz: !!msg.pz, bt: typeof msg.bt === 'string' ? msg.bt : null, mn: mn,
                lg: msg.lg.map(String).slice(-C.LOG_MAX), fx: msg.fx.slice(0, 40), fq: msg.fq, kk: Array.isArray(msg.kk) ? msg.kk.map(String) : []
            };
        }

        // ---- Log ----
        function nm(id) {
            var s = M && seatOf(id);
            return s ? s.n : (M && M.g && M.g.P[id] ? M.g.P[id].n : '?');
        }
        function wn(w) { return C.WEAPONS[w] ? C.WEAPONS[w].emoji + ' ' + C.WEAPONS[w].name : String(w); }

        function describe(e) {
            switch (e.t) {
                case 'roll': return nm(e.id) + ' zar attı: ' + e.v;
                case 'chest': return nm(e.id) + (e.k === 'star' ? ' sandıktan ' + e.n + ' yıldız buldu' : ' silah sandığı açtı: ' + wn(e.w));
                case 'star': return e.why === 'chest' || e.why === 'mini' ? null : nm(e.id) + (e.n >= 0 ? ' +' : ' ') + e.n + ' ⭐' + (e.why === 'kill' ? ' (düşürdü)' : e.why === 'mini' ? ' (minioyun)' : '');
                case 'item': return nm(e.id) + ' aldı: ' + wn(e.w);
                case 'zone': return nm(e.id) + ' silah bölgesinde ' + wn(e.w) + ' buldu';
                case 'attack': return nm(e.id) + ' ' + wn(e.w) + ' kullandı' + (e.target ? ' → ' + nm(e.target) : '');
                case 'dmg': return nm(e.id) + ' ' + e.n + ' hasar aldı';
                case 'block': return nm(e.id) + ' kalkanla korundu (kalkan kırıldı)';
                case 'shieldend': return nm(e.id) + ' kalkanının süresi doldu';
                case 'shield': return nm(e.id) + ' 🛡️ kalkanını kurdu';
                case 'frenzy': return '🔥 SON ÇILGINLIK! Sandıklar ×2';
                case 'heal': return e.n > 0 ? nm(e.id) + ' +' + e.n + ' ❤️ iyileşti' : null;
                case 'death': return nm(e.id) + ' düştü' + (e.lost ? ' (' + e.lost + ' ⭐ kaybetti)' : '');
                case 'skip': return nm(e.id) + ' turunu atladı';
                case 'lost': return nm(e.id) + ' envanteri doldu: ' + wn(e.w) + ' kaçtı';
                case 'event': {
                    var found = null;
                    C.EVENTS.forEach(function (ev) { if (ev.id === e.e) found = ev; });
                    return (found ? found.icon : '❓') + ' ' + nm(e.id) + ' ' + (found ? found.text : 'olay');
                }
                case 'reward': return null;          // minioyun sonucu tek satırda yazılır (resultLine)
                default: return null;
            }
        }

        function addLog(text) {
            if (!text) return;
            M.lg.push(text);
            while (M.lg.length > C.LOG_MAX) M.lg.shift();
        }

        // Minioyun sonucu günlükte tek satır: "🥇Ali 🥈Ayşe 🥉Cem"
        // medals: grup başına madalya sırası (0 = 🥇); verilmezse sıralamadan türer. Düelloda beraberlik/kaybeden 2. ödüldür,
        // bu yüzden "kazananı olmayan" tek grup 🥇 değil 🥈 gösterilir (ödül mantığı ile aynı).
        function medalsOf(mn) {
            if (!mn || !mn.oc) return null;
            var out = [];
            if (mn.oc.win.length) out.push(0);
            if (mn.oc.draw.length || mn.oc.lose.length) out.push(1);
            return out;
        }

        function resultLine(ranking, medals) {
            var rank = 1;
            var parts = [];
            ranking.forEach(function (group, gi) {
                var pos = medals && medals[gi] !== undefined ? medals[gi] + 1 : rank;
                var medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : '▫️';
                group.forEach(function (id) { parts.push(medal + nm(id)); });
                rank += group.length;
            });
            return '🎡 ' + parts.join(' ');
        }

        // ---- Kurallar köprüsü (lider) ----
        // Sıradaki oyuncunun süre sınırı: aşamaya göre; kopmuş oyuncu için botun devralmasına kadar 30 sn; AFK için 3 sn.
        // Bot devraldıysa (M.bt === oyuncu) eylemler BOT_DELAY_MS aralıkla ilerler.
        function setDeadline() {
            M.pz = false;
            var g = M.g;
            var t = now();
            if (!g || g.stage === 'mini' || g.stage === 'over') { M.dlAt = t + C.STAGE_MS.roll; return; }
            var cur = R.current(g);
            var seat = seatOf(cur);
            var P = g.P[cur];
            if (M.bt !== cur) M.bt = null;
            if (seat && !seat.b && !seat.c) M.dlAt = t + (M.bt === cur ? C.BOT_DELAY_MS : C.DISCONNECT_BOT_MS);
            else if (seat && !seat.b && P && P.afk) M.dlAt = t + (M.bt === cur ? C.BOT_DELAY_MS : C.AFK_BOT_DELAY_MS);
            else { M.bt = null; M.dlAt = t + (C.STAGE_MS[g.stage] || C.STAGE_MS.roll); }
        }

        function afterRules(r, quiet) {
            M.g = r.state;
            M.fx = r.events.slice(-40);
            M.fq++;
            r.events.forEach(function (e) { addLog(describe(e)); });
            if (M.g.stage === 'over') {
                M.ph = 'over';
                M.mn = null;
            } else if (M.g.stage === 'mini') {
                beginMini();
            } else {
                setDeadline();
            }
            botAt = now() + C.BOT_DELAY_MS;
            if (!quiet) publish();
        }

        function runAction(a) {
            var r = R.reduce(M.g, a, rctx());
            if (!r.ok) return false;
            afterRules(r);
            return true;
        }

        function newPair(gm, p, stAt) {
            return { p: p.slice(), stAt: stAt || 0, dlAt: 0, actAt: 0, hAt: 0, bAt: 0, wb: null, out: null, off: {} };
        }

        function beginMini() {
            var spec = R.minigameSpec(M.g, rctx());
            var token = { ty: spec.type, pl: spec.players, sd: spec.seed, gm: spec.type === 'duel' && spec.game ? spec.game : null, rk: [], applyAt: 0, pm: [], ex: null, nFirst: 0, oc: null };
            M.mn = token;
            M.pz = true;
            M.dlLeft = 0;
            if (token.gm) {
                // Düello: çiftler aynı anda oynar. Tüm istemcilerde kendi çiftinin oturumu (syncMini), lider ayrıca başsız
                // hakemler açar; sonuçlar recordPair ile birleşir.
                var prs = spec.pairs || [spec.players];
                token.pl = prs[0].slice();
                token.pm = prs.map(function (pr) { return newPair(token.gm, pr, 0); });
                token.nFirst = token.pm.length;
                token.ex = spec.extra || null;
                return;
            }
            var ent = spec.type === 'ffa' && spec.game ? C.MINI.get(spec.game) : null;
            if (ent && ent.kind === 'ffa') {
                // Kurbağa (ffa): tüm insan istemcilerde yerel oturum (syncMini), lider raporlardan sonucu hesaplar (ffaWatch)
                var t0 = now();
                var rep = {};
                spec.players.forEach(function (id) {
                    var st = seatOf(id);
                    if (st && !st.b) rep[id] = { r: 0, c: Math.floor(KRules.COLS / 2), d: 0, f: -1, n: -1, at: t0 + C.KURBAGA_COUNTDOWN_MS, seen: 0 };
                });
                token.gm = spec.game;
                token.pl = spec.players.slice();
                token.ff = { stAt: t0 + C.KURBAGA_COUNTDOWN_MS, endAt: t0 + C.KURBAGA_COUNTDOWN_MS + C.KURBAGA_MS, sn: 0, rep: rep, pubAt: 0, dirty: false };
                return;
            }
            var p = startMinigame({ type: spec.type, players: spec.players.slice(), seed: spec.seed });
            Promise.resolve(p).then(function (res) {
                if (M.mn !== token) return;
                applyMiniResult(token, res && res.ranking, spec.players);
            }, function () {
                if (M.mn !== token) return;
                applyMiniResult(token, [spec.players.slice()], spec.players);
            });
        }

        // Lider (ffa/çark): minioyun sonucunu kaydeder; MINI_HOLD_MS sonra finishMini ödülleri uygular.
        function applyMiniResult(token, ranking, players) {
            if (M.mn !== token || token.applyAt) return;
            token.rk = normalizeRanking(ranking, players || token.pl);
            token.applyAt = now() + C.MINI_HOLD_MS;
            publish();
        }

        // Lider (düello): bir çiftin sonucu { w, l, d, r }. Hemen kaydedilir (devir/zaman aşımı kaybettirmez); oyun ekranı çiftin
        // sonuç tutma süresi (hAt) kadar açık kalır. İlk biten ilk tur maçı extra için ikinci şans maçını başlatır.
        function recordPair(token, i, o) {
            if (M.mn !== token || token.applyAt) return;
            var x = token.pm[i];
            if (!x || x.out) return;
            x.out = { w: o.w || '', l: o.l || '', d: o.d ? 1 : 0, r: o.r || '' };
            // Sonuç ve ödül hemen yazılır; yalnız banner (bAt) ve oyun alanının kapanışı (hAt) son atışın animasyonu kadar gecikir.
            var hold = C.duelHold(token.gm, o.r);
            var bm = o.bm > 0 ? Math.min(Math.round(o.bm), 15000) : 0;
            x.bAt = bm ? now() + bm : 0;
            x.hAt = hold ? now() + bm + hold : 0;
            if (token.ex && token.pm.length === token.nFirst && i < token.nFirst) spawnSecondChance(token, x);
            finalizeDuel(token);
            publish();
        }

        // Extra ile ilk biten maçın kaybedeni (beraberlikte tohumlu biri) yeni bir çiftte oynar; loser sonuç tutmasını bitirince başlar.
        function spawnSecondChance(token, first) {
            var L = first.out.d ? first.p[(token.sd >>> 3) & 1] : first.out.l;
            var E = token.ex;
            token.ex = null;
            var np = newPair(token.gm, [E, L], Math.max(now(), first.hAt || 0));
            var sl = seatOf(L);
            var se = seatOf(E);
            var lOff = !sl || sl.b || !sl.c;
            var eOff = !se || se.b || !se.c;
            // Rakip bağlantısızsa maç hükmen: bağlı olan kazanır (ikisi de yoksa beraberlik)
            if (lOff && eOff) np.out = { w: '', l: '', d: 1, r: 'forfeit' };
            else if (lOff) np.out = { w: E, l: L, d: 0, r: 'forfeit' };
            else if (eOff) np.out = { w: L, l: E, d: 0, r: 'forfeit' };
            token.pm.push(np);
        }

        // Tüm maçlar bitince sonucu bağlar. Tek çift (ve extra yok): eski sıralama yolu. Çoklu: duelOutcome (oyuncunun SON maçı).
        function finalizeDuel(token) {
            if (token.ex || token.pm.some(function (x) { return !x.out; })) return;
            var maxHold = 0;
            token.pm.forEach(function (x) { if (x.hAt > maxHold) maxHold = x.hAt; });
            if (token.pm.length === 1) {
                var o = token.pm[0].out;
                token.rk = normalizeRanking(o.d ? [token.pl.slice()] : [[o.w], [o.l]], token.pl);
                // Beraberlik: ikisi de 2. ödül (derece sıralaması beraberliği 1. sayardı) -> duelOutcome yolu
                if (o.d) token.oc = { win: [], lose: [], draw: token.pl.slice() };
            } else {
                var last = {};
                token.pm.forEach(function (x) {
                    if (x.out.d) { last[x.p[0]] = 'd'; last[x.p[1]] = 'd'; } else { last[x.out.w] = 'w'; last[x.out.l] = 'l'; }
                });
                var oc = { win: [], lose: [], draw: [] };
                Object.keys(last).forEach(function (id) { (last[id] === 'w' ? oc.win : last[id] === 'l' ? oc.lose : oc.draw).push(id); });
                token.oc = oc;
                token.rk = [oc.win, oc.draw.concat(oc.lose)].filter(function (g) { return g.length; });
            }
            token.applyAt = Math.max(now(), maxHold) + C.MINI_HOLD_MS;
        }

        // Adaptör sonucu { ranking, reason } -> { w, l, d, r }
        function toOutcome(res, pair) {
            var rk = res && res.ranking;
            var r = res && res.reason || '';
            var bm = res && res.bm > 0 ? res.bm : 0;
            if (rk && rk.length >= 2 && rk[0].length === 1 && rk[1].length === 1) return { w: rk[0][0], l: rk[1][0], d: 0, r: r, bm: bm };
            return { w: '', l: '', d: 1, r: r || 'fuse', p: pair, bm: bm };
        }

        function normalizeRanking(ranking, players) {
            var out = [];
            var seen = {};
            (ranking || []).forEach(function (group) {
                var g2 = [];
                (group || []).forEach(function (id) { if (players.indexOf(id) >= 0 && !seen[id]) { seen[id] = true; g2.push(id); } });
                if (g2.length) out.push(g2);
            });
            var rest = players.filter(function (id) { return !seen[id]; });
            if (rest.length) out.push(rest);
            return out;
        }

        // Kopmuş insanlar o minioyunda en sona yazılır; oyun beklemez.
        function finishMini() {
            var mn = M.mn;
            if (mn.oc) {
                // Çoklu düello: kopan/ayrılan insanlar sonuçtan düşer (teselli); kalanlar duelOutcome ile ödüllenir
                var ok = function (id) { var st = seatOf(id); return !!st && (st.b || st.c); };
                var outcome = { win: mn.oc.win.filter(ok), lose: mn.oc.lose.filter(ok), draw: mn.oc.draw.filter(ok) };
                M.mn = null;
                var rr = R.applyMinigame(M.g, { duelOutcome: outcome, game: mn.gm }, rctx());
                if (rr.ok) {
                    addLog(resultLine(mn.rk, medalsOf(mn)));
                    afterRules(rr);
                }
                return;
            }
            var ranking = [];
            var last = [];
            mn.rk.forEach(function (group) {
                var ok = [];
                group.forEach(function (id) {
                    var s = seatOf(id);
                    if (s && !s.b && !s.c) last.push(id); else ok.push(id);
                });
                if (ok.length) ranking.push(ok);
            });
            if (last.length) ranking.push(last);
            M.mn = null;
            var r = R.applyMinigame(M.g, { ranking: ranking, game: mn.gm }, rctx());
            if (r.ok) {
                addLog(resultLine(ranking));
                afterRules(r);
            }
        }

        // ---- Lobi işlemleri (lider) ----
        function startBlock() {
            if (!M || M.ph !== 'lobby') return 'Oyun zaten başladı.';
            var n = M.S.length;
            if (n < C.MIN_PLAYERS) return 'En az 2 oyuncu gerekir (bot dahil).';
            if (M.S.some(function (s) { return !s.b && !s.c; })) return 'Bağlantısı kopan oyuncu var.';
            if (M.cf.m === 'team') {
                if (n % 2) return 'Takım modunda oyuncu sayısı çift olmalı.';
                var counts = {};
                M.S.forEach(function (s) { counts[s.t] = (counts[s.t] || 0) + 1; });
                for (var k in counts) if (counts[k] !== 2) return 'Her takımda tam 2 oyuncu olmalı.';
            }
            return null;
        }

        function randomTeams() {
            var order = M.S.slice();
            for (var i = order.length - 1; i > 0; i--) {
                var j = rnd(i + 1);
                var t = order[i]; order[i] = order[j]; order[j] = t;
            }
            order.forEach(function (s, k) { s.t = Math.min(3, Math.floor(k / 2)); });
        }

        function startGame() {
            var block = startBlock();
            if (block) return false;
            var seats = M.S.map(function (s) { return { id: s.i, name: s.n, av: s.a, t: s.t, bot: !!s.b }; });
            var cfg = { mode: M.cf.m, goal: M.cf.gl, map: M.cf.mp };
            M.g = R.createGame({ seed: Math.floor(rand() * 4294967295) + 1, cfg: cfg, seats: seats }, rctx());
            M.ph = 'play';
            M.mn = null;
            M.lg = [];
            M.kk = [];
            M.fx = [];
            addLog('Oyun başladı! Hedef: ' + M.g.goal + ' ⭐');
            M.fq++;
            setDeadline();
            botAt = now() + C.BOT_DELAY_MS;
            publish();
            return true;
        }

        function handleLobby(a, by) {
            var leader = by === me.id;
            var seat = seatOf(by);
            if (M.ph !== 'lobby') return false;
            switch (a.type) {
                case 'av': {
                    if (!seat || C.AVATARS.indexOf(a.av) < 0) return false;
                    if (M.S.some(function (s) { return s !== seat && s.a === a.av; })) return false;
                    seat.a = a.av;
                    return true;
                }
                case 'cfg': {
                    if (!leader) return false;
                    if (a.mode === 'solo' || a.mode === 'team') {
                        if (a.mode !== M.cf.m && a.mode === 'team') randomTeams();
                        M.cf.m = a.mode;
                    }
                    if (typeof a.map === 'string' && opts.maps[a.map]) M.cf.mp = a.map;
                    if (a.goal === C.GOAL_AUTO || C.GOALS.indexOf(a.goal) >= 0) M.cf.gl = a.goal;
                    return true;
                }
                case 'team': {
                    if (!leader || !seatOf(a.id) || !isInt(a.t, 0, 3)) return false;
                    var inTeam = M.S.filter(function (s) { return s.t === a.t && s.i !== a.id; }).length;
                    if (inTeam >= 2) return false;
                    seatOf(a.id).t = a.t;
                    return true;
                }
                case 'teams_random': {
                    if (!leader) return false;
                    randomTeams();
                    return true;
                }
                case 'bot_add': {
                    if (!leader || M.S.length >= C.MAX_PLAYERS) return false;
                    var botId = 'bot' + (++botSeq) + '_' + rnd(1e6).toString(36);
                    while (seatOf(botId)) botId += 'x';
                    M.S.push(freshSeat(botId, 'Bot ' + (M.S.filter(function (x) { return x.b; }).length + 1), true));
                    return true;
                }
                case 'bot_del': {
                    if (!leader) return false;
                    var bots = M.S.filter(function (s) { return s.b && (!a.id || s.i === a.id); });
                    if (!bots.length) return false;
                    var victim = bots[bots.length - 1];
                    M.S.splice(M.S.indexOf(victim), 1);
                    return true;
                }
                case 'kick': {
                    if (!leader || a.id === me.id || !seatOf(a.id) || seatOf(a.id).b) return false;
                    M.S.splice(M.S.indexOf(seatOf(a.id)), 1);
                    M.kk.push(a.id);
                    if (M.kk.length > 16) M.kk.shift();
                    return true;
                }
                case 'start': return leader && startGame();
                default: return false;
            }
        }

        function dropSeat(id, why) {
            var s = seatOf(id);
            if (!s) return;
            M.S.splice(M.S.indexOf(s), 1);
            if (M.g && M.g.P[id]) {
                var r = R.removePlayer(M.g, id, rctx());
                if (r.ok) {
                    addLog(nm(id) + ' ' + why);
                    afterRules(r, true);
                }
            }
        }

        function handlePlay(a, by) {
            var leader = by === me.id;
            if (M.ph === 'over') {
                if (a.type === 'again' && leader) {
                    M.ph = 'lobby';
                    M.g = null;
                    M.mn = null;
                    M.fx = [];
                    M.S = M.S.filter(function (s) { return s.b || s.c; });
                    // oyun sırasında gelip izleyici kalan (bağlı, koltuksuz, atılmamış) oyunculara 8 sınırına kadar koltuk ver
                    (opts.players || []).forEach(function (p) {
                        if (M.S.length >= C.MAX_PLAYERS || seatOf(p.id) || M.kk.indexOf(p.id) >= 0 || gone[p.id]) return;
                        M.S.push(freshSeat(p.id, p.name, false));
                    });
                    return true;
                }
                return false;
            }
            if (M.ph !== 'play') return false;
            if (a.type === 'skipturn') {
                if (!leader || !M.g || M.g.stage === 'mini' || M.g.stage === 'over') return false;
                var r0 = R.reduce(M.g, { type: 'forceskip' }, rctx());
                if (r0.ok) { addLog(nm(R.current(M.g)) + ' turu geçildi'); afterRules(r0, true); }
                return true;
            }
            if (a.type === 'drop') {
                if (!leader || a.id === me.id || !seatOf(a.id) || seatOf(a.id).b) return false;
                M.kk.push(a.id);
                if (M.kk.length > 16) M.kk.shift();
                dropSeat(a.id, 'oyundan çıkarıldı');
                return true;
            }
            if (!M.g || !seatOf(by) || !M.g.P[by]) return false;
            if (a.type === 'back') {
                // "Ben buradayım": AFK bayrağını ve sayacı temizler, botun elinden turu alır
                var bp = M.g.P[by];
                if (!bp.afk && !bp.afkc) return false;
                bp.afk = false; bp.afkc = 0;
                if (M.bt === by) M.bt = null;
                if (M.g.stage !== 'mini' && M.g.stage !== 'over' && R.current(M.g) === by) setDeadline();
                return true;
            }
            var allowed = { roll: 1, dir: 1, use: 1 };
            if (!allowed[a.type]) return false;
            var act = { type: a.type, by: by };
            if (a.type === 'dir') act.to = a.to;
            if (a.type === 'use') { act.w = a.w; act.target = a.target; act.node = a.node; }
            // çift dokunuş koruması: eylem, istemcinin gördüğü oyun revizyonunu (rv) taşır; eşleşmezse reddedilir (rv yoksa eski davranış)
            if (a.rv !== undefined && a.rv !== M.g.rev) return false;
            // duraklatılmış (kopan oyuncu bekleniyor) turda yalnızca o oyuncu dışındakiler işlem yapamaz zaten
            var r = R.reduce(M.g, act, rctx());
            if (!r.ok) return false;
            // insanın kendi eylemi: AFK sayacı/bayrağı temizlenir, bot devri biter
            var hp = r.state.P[by];
            if (hp && (hp.afk || hp.afkc)) { hp.afk = false; hp.afkc = 0; }
            if (M.bt === by) M.bt = null;
            var mark = M.g.rd + ':' + M.g.turn;
            if (!(turnMark && turnMark.key === mark)) turnMark = { key: mark, id: by, acted: false, counted: false };
            turnMark.acted = true;
            afterRules(r, true);
            return true;
        }

        // Lider eylemi işler; durum değiştiyse yayınlar.
        function handle(a, by) {
            if (!M || !isLeader() || !a || typeof a.type !== 'string') return false;
            var changed = false;
            if (M.ph === 'lobby') changed = handleLobby(a, by);
            else changed = handlePlay(a, by);
            if (changed) publish();
            return changed;
        }

        // Emoji tepkisi: oyun durumuna yazılmaz, yalnızca iletilir (saniyede en çok 1)
        function emote(e) {
            if (!M || C.EMOTES.indexOf(e) < 0) return false;
            var s = seatOf(me.id);
            if (!s || s.b) return false;
            var tn = now();
            if (lastEmote[me.id] !== undefined && tn - lastEmote[me.id] < C.EMOTE_GAP_MS) return false;
            lastEmote[me.id] = tn;
            send({ type: 'pt_emote', id: me.id, e: e });
            onEmote({ id: me.id, e: e });
            return true;
        }

        // ---- Kullanıcı eylemi ----
        function dispatch(a) {
            if (!M) return false;
            if (isLeader()) return handle(a, me.id);
            // oyun eylemleri istemcinin gördüğü oyun revizyonunu taşır (lider eski görünümden gelen çift dokunuşu reddeder)
            if (M.g && M.ph === 'play' && (a.type === 'roll' || a.type === 'dir' || a.type === 'use')) a = Object.assign({}, a, { rv: M.g.rev });
            send({ type: 'pt_action', id: me.id, a: a });
            return true;
        }

        // ---- Lider seçimi ----
        function candidates() {
            return M.S.filter(function (s) { return !s.b && s.c && !gone[s.i] && s.i !== M.ld; });
        }

        // rejoined: bu kimlik yeni geri döndü (kopmuş sayılmaz)
        function takeOver(rejoined) {
            M.ep++;
            M.ld = me.id;
            M.S.forEach(function (x) {
                if (x.i === me.id) { x.c = 1; x.dAt = 0; }
                else if (gone[x.i] && !x.b && x.i !== rejoined) markDisconnected(x);      // kopanlar
            });
            if (M.mn && !M.mn.applyAt && M.mn.gm && M.mn.ty === 'duel') {
                // düello: ep değişti -> herkes oturumu AYNI tohumla yeniden başlatır (yeni lider sonucu o oturumdan alır)
                // biten çiftlerin sonucu mn.pm içinde kalır; bitmeyenler yeni süreyle başlar
                M.mn.pm.forEach(function (x) {
                    x.off = {};
                    if (!x.out) x.actAt = now();          // yeni lider boşta sayacını sıfırdan başlatır
                });
            } else if (M.mn && M.mn.ff && !M.mn.applyAt) {
                // Kurbağa: rapor durumu pt_state ile geldi; istemciler son durumu kalp atışıyla yeniden gönderir
                Object.keys(M.mn.ff.rep).forEach(function (id) { M.mn.ff.rep[id].n = -1; M.mn.ff.rep[id].at = M.mn.ff.stAt; });
            } else if (M.mn && !M.mn.applyAt) {
                // eski liderin minioyun sözü kayboldu: yer tutucu sonucu tohumdan yeniden üretilir
                if (!M.mn.rk.length) M.mn.rk = normalizeRanking(Mini.wheelRanking({ players: M.mn.pl, seed: M.mn.sd }), M.mn.pl);
                M.mn.applyAt = now() + C.MINI_HOLD_MS;
            }
            M.dlAt = now() + Math.max(M.dlLeft || 0, 1000);
            addLog('👑 ' + nm(me.id) + ' lider oldu');
            publish();
        }

        function markDisconnected(seat) {
            if (!seat.c && seat.dAt) return;
            seat.c = 0;
            seat.dAt = now() + C.DISCONNECT_MS;
        }

        // ---- Mesajlar ----
        function onMessage(data) {
            if (!data || typeof data.type !== 'string') return;
            switch (data.type) {
                case 'pt_state': {
                    var snap = unpack(data);
                    if (!snap) return;
                    var newer = !M || snap.ep > M.ep || (snap.ep === M.ep && snap.rv > M.rv);
                    if (!newer) {
                        // eski epoch'tan bir lider (kopup dönen) yayın yapıyorsa güncel lider düzeltir
                        if (M && isLeader() && snap.ep < M.ep && now() - lastRepublish > REPUBLISH_MIN_MS) publish();
                        return;
                    }
                    M = snap;
                    resyncOk = false;
                    Object.keys(gone).forEach(function (id) { if (M.S.some(function (s) { return s.i === id && s.c; })) delete gone[id]; });
                    emit();
                    return;
                }
                case 'pt_mg': {
                    // Yalnızca eşleşen oturumun jetonuyla; gönderen o maçın oyuncusu ya da lider (reset/catchup/result)
                    if (!M || !M.mn || !M.mn.pm || typeof data.mg !== 'string' || typeof data.from !== 'string' || data.from === me.id) return;
                    if (!data.m || typeof data.m !== 'object') return;
                    if (M.mn.ff) {
                        // Kurbağa: herkes görüntü için oturumuna besler; güven ve sonuç yalnız liderde
                        sessions.slice().forEach(function (s) {
                            if (!s.ffa || s.mg !== data.mg) return;
                            s.handlers.slice().forEach(function (fn) { fn(data.from, data.m); });
                        });
                        if (isLeader() && data.mg === ffaKey(M.mn)) leaderFfaReport(data.from, data.m);
                        return;
                    }
                    sessions.slice().forEach(function (s) {
                        if (s.mg !== data.mg) return;
                        var x = M.mn.pm[s.pair];
                        if (!x || (x.p.indexOf(data.from) < 0 && data.from !== M.ld)) return;
                        s.handlers.slice().forEach(function (fn) { fn(data.from, data.m); });
                    });
                    return;
                }
                case 'pt_emote': {
                    // Yalnızca koltuktaki insanlardan, beyaz listedeki emojiler, gönderen başına en çok saniyede 1; durum değişmez.
                    if (!M || typeof data.id !== 'string' || data.id === me.id) return;
                    if (data.from !== undefined && data.from !== data.id) return;
                    var es = seatOf(data.id);
                    if (!es || es.b || C.EMOTES.indexOf(data.e) < 0) return;
                    var tn = now();
                    if (lastEmote[data.id] !== undefined && tn - lastEmote[data.id] < C.EMOTE_GAP_MS) return;
                    lastEmote[data.id] = tn;
                    onEmote({ id: data.id, e: data.e });
                    return;
                }
                case 'pt_sync': {
                    if (!M || !isLeader() || typeof data.id !== 'string') return;
                    publish();
                    return;
                }
                case 'pt_action': {
                    if (!M || !isLeader() || typeof data.id !== 'string') return;
                    if (!data.a || typeof data.a !== 'object') return;
                    // Backend gönderen kimliği eklemez; ileride `from` eklenirse (sunucunun doğruladığı gönderen) data.id ile
                    // uyuşmak zorundadır, yoksa eski davranış.
                    if (data.from !== undefined && data.from !== data.id) return;
                    handle(data.a, data.id);
                    return;
                }
                case 'player_joined': {
                    delete gone[data.id];
                    // Backend aynı kimlikle gelen yeni oturumu eskisinin yerine koyar ve player_disconnect YAYINLAMAZ.
                    // Lider yeniden katıldıysa (yenileme/kopma) durumu kaybolmuş olabilir: lider düşmüş gibi devret.
                    if (M && !isLeader() && data.id === M.ld && data.id !== me.id) {
                        gone[data.id] = true;
                        var cands = candidates();
                        delete gone[data.id];
                        if (cands.length && cands[0].i === me.id) takeOver(data.id);
                        else emit();
                        return;
                    }
                    if (!M || !isLeader()) return;
                    var s = seatOf(data.id);
                    if (s) {
                        s.c = 1; s.dAt = 0;
                        if (M.g && M.ph === 'play' && M.g.stage !== 'mini' && M.g.stage !== 'over' && R.current(M.g) === data.id) { M.bt = null; setDeadline(); }
                        if (typeof data.name === 'string' && M.ph === 'lobby') s.n = data.name.slice(0, 20);
                    } else if (M.ph === 'lobby') {
                        if (M.S.length >= C.MAX_PLAYERS) {
                            var bots = M.S.filter(function (x) { return x.b; });
                            if (bots.length) M.S.splice(M.S.indexOf(bots[bots.length - 1]), 1);
                        }
                        if (M.S.length < C.MAX_PLAYERS) M.S.push(freshSeat(data.id, data.name, false));
                    }
                    publish();
                    return;
                }
                case 'player_disconnect': {
                    if (data.id === me.id) return;
                    gone[data.id] = true;
                    if (!M) return;
                    if (M.ld === data.id) {
                        var cand = candidates();
                        if (cand.length && cand[0].i === me.id) takeOver();
                        else emit();
                        return;
                    }
                    if (!isLeader()) { emit(); return; }
                    var seat = seatOf(data.id);
                    if (!seat) { emit(); return; }
                    if (M.ph === 'lobby') {
                        M.S.splice(M.S.indexOf(seat), 1);
                    } else {
                        markDisconnected(seat);
                        addLog(seat.n + ' bağlantısı koptu');
                        if (M.g && M.g.stage !== 'mini' && M.g.stage !== 'over' && R.current(M.g) === data.id) { M.bt = null; setDeadline(); }
                    }
                    publish();
                    return;
                }
                case '_reconnected': {
                    offline = false;
                    resyncOk = true;
                    gone = {};
                    lastSyncAt = -1e9;
                    if (M) { send({ type: 'pt_sync', id: me.id }); lastSyncAt = now(); }
                    sessions.slice().forEach(function (s) { s.handlers.slice().forEach(function (fn) { fn(null, { k: '_reconnected' }); }); });
                    emit();
                    return;
                }
                case '_connection': {
                    offline = data.state === 'lost';
                    emit();
                    return;
                }
                default:
                    return;
            }
        }

        // ---- Zaman ----
        function tick(t) {
            if (t === undefined) t = now();
            if (!M) {
                if (!opts.creator && t - lastSyncAt >= SYNC_RETRY_MS) {
                    lastSyncAt = t;
                    send({ type: 'pt_sync', id: me.id });
                }
                return;
            }
            sessions.forEach(function (s) { if (s.api) s.api.tick(t); });       // Kurbağa oturumları: ağ raporu / kalp atışı
            if (!isLeader()) {
                if (t - lastSyncAt >= SYNC_RETRY_MS * 4 && !M.S.some(function (s) { return s.i === me.id; })) {
                    lastSyncAt = t;
                    send({ type: 'pt_sync', id: me.id });
                }
                emit();
                return;
            }
            if (M.ph === 'play' && M.g) leaderPlayTick(t);
            emit();
        }

        function leaderPlayTick(t) {
            // koltuk süresi dolan kopmuş oyuncular çıkarılır
            M.S.slice().forEach(function (s) {
                if (!s.b && !s.c && s.dAt && t >= s.dAt) {
                    dropSeat(s.i, 'süre dolduğu için oyundan çıktı');
                    publish();
                }
            });
            if (M.ph !== 'play' || !M.g) return;
            var stage = M.g.stage;
            if (stage === 'mini') {
                if (M.mn && M.mn.applyAt && t >= M.mn.applyAt) { finishMini(); publish(); }
                else if (M.mn && M.mn.ff) ffaWatch(t);
                else if (M.mn && M.mn.gm) duelWatch(t);
                return;
            }
            if (stage === 'over') return;
            var cur = R.current(M.g);
            var seat = seatOf(cur);
            var P = M.g.P[cur];
            var human = !!seat && !seat.b;
            var away = human && !seat.c;
            var afk = human && !!P && !!P.afk;
            if (seat && seat.b) {
                if (t >= botAt) {
                    var ba = R.botAction(M.g, rctx());
                    if (ba) runAction(ba);
                }
                return;
            }
            if (away || afk) {
                // kopmuş ya da AFK oyuncunun turunu, bekleme bitince bot oynar (koltuk 3 dk korunur; insan dönünce devralır)
                if (t >= M.dlAt) {
                    M.bt = cur;
                    var ab = R.botAction(M.g, rctx());
                    if (ab) runAction(ab);
                }
                return;
            }
            if (t >= M.dlAt) {
                var aa = R.autoAction(M.g, rctx());
                if (!aa) return;
                var r = R.reduce(M.g, aa, rctx());
                if (!r.ok) return;
                // üst üste AFK turlar: oyuncu bu turda hiç eylem yapmadan süreler dolduysa sayılır (tur başına bir kez)
                var key = M.g.rd + ':' + M.g.turn;
                if (!(turnMark && turnMark.key === key)) turnMark = { key: key, id: cur, acted: false, counted: false };
                if (human && !turnMark.acted && !turnMark.counted && r.state.P[cur]) {
                    turnMark.counted = true;
                    var pp = r.state.P[cur];
                    pp.afkc = (pp.afkc || 0) + 1;
                    if (pp.afkc >= C.AFK_TURNS && !pp.afk) {
                        pp.afk = true;
                        addLog('💤 ' + nm(cur) + ' uzun süredir yok: bot devraldı');
                    }
                }
                afterRules(r);
            }
        }

        // ---- Görünüm ----
        function emit() { syncMini(); onChange(getView()); }

        // ---- Minioyun oturumları (düello) ----
        // Her istemci yalnızca KENDİ maçını oynar (kök/oyun modülü tek örnek); lider ayrıca diğer maçlar için başsız hakem
        // oturumları açar (kendi maçı dahil sonuçları o birleştirir). Anahtar: ep:tohum:oyun:çiftNo (+ :o gözlemci).
        function ffaKey(mn) { return 'f:' + mn.sd + ':' + mn.gm; }

        function wantedSessions() {
            var want = [];
            var mn = M && M.ph === 'play' && M.mn;
            if (mn && mn.ty === 'ffa' && mn.ff && mn.gm) {
                // Kurbağa: bağlı her insan koltuğu kendi yerel oturumunu açar. Anahtar ep'siz -> lider devrinde ilerleme sıfırlanmaz.
                var mine = seatOf(me.id);
                if (!mn.applyAt && mine && !mine.b && mn.pl.indexOf(me.id) >= 0) want.push({ key: ffaKey(mn) + ':p', mg: ffaKey(mn), ffa: true });
                return want;
            }
            if (!mn || mn.ty !== 'duel' || !mn.gm || !mn.pm || !mn.pm.length) return want;
            var t = now();
            var holdAlive = false;
            // karar verilmiş maçın oyuncu oturumu sonuç tutma süresince yaşar (devirde ep değişse de yeniden açılmaz)
            sessions.forEach(function (s) {
                var x = mn.pm[s.pair];
                if (!s.observer && x && x.out && x.hAt && t < x.hAt && s.sd === mn.sd) { want.push({ keep: s }); holdAlive = true; }
            });
            mn.pm.forEach(function (x, i) {
                if (x.out) return;
                var mg = M.ep + ':' + mn.sd + ':' + mn.gm + ':' + i;
                var mine = x.p.indexOf(me.id) >= 0;
                var playNow = mine && t >= x.stAt && !holdAlive;
                if (playNow) want.push({ key: mg + ':p', mg: mg, pair: i, observer: false });
                else if (isLeader()) want.push({ key: mg + ':o', mg: mg, pair: i, observer: true });
            });
            return want;
        }

        function syncMini() {
            var want = wantedSessions();
            var keepSet = [];
            want.forEach(function (w) { if (w.keep) keepSet.push(w.keep); });
            sessions.slice().forEach(function (s) {
                var wanted = keepSet.indexOf(s) >= 0 || want.some(function (w) { return w.key === s.key; });
                if (!wanted) endSession(s);
            });
            want.forEach(function (w) {
                if (w.keep) return;
                if (!sessions.some(function (s) { return s.key === w.key; })) startSession(w);
            });
        }

        function endSession(s) {
            var i = sessions.indexOf(s);
            if (i >= 0) sessions.splice(i, 1);
            s.ac.abort();
        }

        function endAllSessions() { sessions.slice().forEach(endSession); }

        // Kurbağa oturumu: sonuç döndürmez; ilerleme raporu pt_mg ile, lider kendi raporunu yerelde verir
        function startFfaSession(w) {
            var token = M.mn;
            var ff = token.ff;
            var s = { key: w.key, mg: w.mg, pair: -1, observer: false, ffa: true, sd: token.sd, ac: new AbortController(), handlers: [], api: null };
            sessions.push(s);
            var names = {};
            var avatars = {};
            M.S.forEach(function (st) { names[st.i] = st.n; avatars[st.i] = st.a; });
            var net = {
                send: function (m) { send({ type: 'pt_mg', mg: w.mg, from: me.id, m: m }); },
                on: function (fn) {
                    s.handlers.push(fn);
                    return function () { var i = s.handlers.indexOf(fn); if (i >= 0) s.handlers.splice(i, 1); };
                }
            };
            var q = ff.rep[me.id];
            var resume = q && (q.seen || q.f >= 0 || q.r > 0 || q.d > 0) ? { r: q.r, c: q.c, d: q.d, f: q.f } : null;
            startMinigame({
                type: 'ffa', game: token.gm, players: token.pl.slice(), bots: token.pl.filter(function (id) { return !ff.rep[id]; }), seed: token.sd,
                me: { id: me.id, name: me.name }, isLeader: isLeader(), leader: M.ld, root: opts.miniRoot ? opts.miniRoot() : null, observer: false,
                net: net, names: names, avatars: avatars, deadlineMs: 0, signal: s.ac.signal, timers: opts.timers, now: now, startAt: ff.stAt, resume: resume,
                getEndAt: function () { return M && M.mn && M.mn.ff ? M.mn.ff.endAt : 0; },
                onReport: function (m) { if (isLeader()) leaderFfaReport(me.id, m); },
                register: function (api) { s.api = api; }
            });
        }

        // Lider (Kurbağa): bir insanın raporunu denetleyip kaydeder. Makul değilse ya da eski sıra noktasıysa yok sayılır.
        function leaderFfaReport(from, m) {
            var mn = M.mn;
            if (!mn || !mn.ff || mn.applyAt || !m || m.k !== 'pos') return;
            var ff = mn.ff;
            var q = ff.rep[from];
            var seat = seatOf(from);
            if (!q || !seat || seat.b) return;
            if (!isInt(m.n, 0, 1000000000) || m.n <= q.n) return;
            var t = now();
            if (!KRules.plausible({ r: q.r, c: q.c, d: q.d }, { r: m.r, c: m.c, d: m.d }, t - q.at)) return;
            if (q.f >= 0) { q.n = m.n; return; }              // varmış: sonuç donuk
            var fin = -1;
            if (m.r === KRules.GOAL_ROW) {
                if (!KRules.plausibleFinish(m.e, t - ff.stAt)) return;
                fin = m.e;
            }
            var changed = q.r !== m.r || q.c !== m.c || q.d !== m.d;
            q.r = m.r; q.c = m.c; q.d = m.d; q.n = m.n; q.at = t;
            var now1 = false;
            if (!q.seen) { q.seen = 1; ff.sn = (ff.sn || 0) + 1; now1 = true; }
            if (fin >= 0) {
                q.f = fin;
                // ilk varıştan sonra kalan süre KURBAGA_LAST_CALL_MS'e düşer (min: sonraki varışlar uzatmaz)
                ff.endAt = Math.min(ff.endAt, t + C.KURBAGA_LAST_CALL_MS);
                now1 = true;
            }
            if (now1) { ff.pubAt = t; ff.dirty = false; publish(); }
            else if (changed) ff.dirty = true;
        }

        // Lider (Kurbağa): ilerleme yayınını sınırlar; tüm bağlı insanlar vardı ya da süre dolduysa sonucu hesaplar
        function ffaWatch(t) {
            var mn = M.mn;
            if (!mn || !mn.ff || mn.applyAt) return;
            var ff = mn.ff;
            if (ff.dirty && t - (ff.pubAt || 0) >= C.KURBAGA_PUBLISH_MS) { ff.dirty = false; ff.pubAt = t; publish(); }
            if (t < ff.stAt) return;
            var live = mn.pl.filter(function (id) { var st = seatOf(id); return !!st && !st.b && st.c && ff.rep[id]; });
            var allIn = live.length > 0 && live.every(function (id) { return ff.rep[id].f >= 0; });
            if (!allIn && t < ff.endAt) return;
            var endMs = Math.max(0, Math.min(t, ff.endAt) - ff.stAt);
            var ranking;
            if (!(ff.sn > 0)) {
                ranking = Mini.wheelRanking({ players: mn.pl, seed: mn.sd });          // hiç rapor yok: acil yedek çark
            } else {
                var reports = {};
                Object.keys(ff.rep).forEach(function (id) { reports[id] = { r: ff.rep[id].r, f: ff.rep[id].f, d: ff.rep[id].d }; });
                ranking = KRules.rank({ players: mn.pl, bots: mn.pl.filter(function (id) { return !ff.rep[id]; }), seed: mn.sd, reports: reports, endMs: endMs });
            }
            applyMiniResult(mn, ranking, mn.pl);
        }

        function startSession(w) {
            if (w.ffa) { startFfaSession(w); return; }
            var token = M.mn;
            var x = token.pm[w.pair];
            var s = { key: w.key, mg: w.mg, pair: w.pair, observer: w.observer, sd: token.sd, ac: new AbortController(), handlers: [] };
            sessions.push(s);
            var leader = isLeader();
            var names = {};
            M.S.forEach(function (st) { names[st.i] = st.n; });
            var net = {
                send: function (m) { send({ type: 'pt_mg', mg: w.mg, from: me.id, m: m }); },
                on: function (fn) {
                    s.handlers.push(fn);
                    return function () { var i = s.handlers.indexOf(fn); if (i >= 0) s.handlers.splice(i, 1); };
                }
            };
            var p = startMinigame({
                type: 'duel', game: token.gm, players: x.p.slice(), seed: (token.sd + w.pair) >>> 0, me: { id: me.id, name: me.name },
                isLeader: leader, leader: M.ld, root: w.observer ? null : (opts.miniRoot ? opts.miniRoot() : null), observer: w.observer, net: net, names: names,
                deadlineMs: 0, signal: s.ac.signal,
                timers: opts.timers, now: now,
                // Lider hakem durumundan izleme anlık görüntüsü yayınlar (oynamayanlar salt-okunur izler); değişmediyse yayınlamaz
                onWatch: leader ? function (snap) {
                    if (M.mn !== token || token.pm[w.pair] !== x) return;
                    x.actAt = now();                       // hakem her mesajda güncellenir: boşta sayacı sıfırlanır
                    var next = snap || null;
                    if (JSON.stringify(next) === JSON.stringify(x.wb || null)) return;
                    x.wb = next;
                    publish();
                } : undefined
            });
            if (!leader) return;
            x.actAt = now();
            Promise.resolve(p).then(function (res) {
                if (sessions.indexOf(s) < 0 || M.mn !== token || (res && res.aborted)) return;
                recordPair(token, w.pair, toOutcome(res, x.p));
            }, function () {
                if (sessions.indexOf(s) < 0 || M.mn !== token) return;
                recordPair(token, w.pair, { w: '', l: '', d: 1, r: 'fuse' });
            });
        }

        // Lider: düello gözcüsü — her çift için oyuncu kopması (25 sn sonra hükmen) ve sert süre sigortası
        function duelWatch(t) {
            var mn = M.mn;
            if (!mn || mn.ty !== 'duel' || !mn.gm || mn.applyAt) return;
            mn.pm.slice().forEach(function (x, i) {
                if (x.out || t < x.stAt || M.mn !== mn || mn.applyAt) return;
                var gone = [];
                x.p.forEach(function (id) {
                    var seat = seatOf(id);
                    if (seat && !seat.b && seat.c) { delete x.off[id]; return; }
                    if (x.off[id] === undefined) x.off[id] = t;
                    if (!seat || t - x.off[id] >= C.DUEL_RECONNECT_MS) gone.push(id);
                });
                if (gone.length === 1) {
                    recordPair(mn, i, { w: x.p[0] === gone[0] ? x.p[1] : x.p[0], l: gone[0], d: 0, r: 'forfeit' });
                } else if (gone.length === 2) {
                    recordPair(mn, i, { w: '', l: '', d: 1, r: 'forfeit' });
                } else if (x.actAt && t - Math.max(x.actAt, x.stAt) >= C.DUEL_IDLE_MS) {
                    // Toplam süre yok; yalnız sırası gelen oyuncu çok uzun süre hiç hamle yapmazsa o maçı kaybeder
                    var idler = x.wb && x.wb.r === -1 ? x.wb.o[x.wb.t] : '';
                    if (idler && x.p.indexOf(idler) >= 0) {
                        recordPair(mn, i, { w: x.p[0] === idler ? x.p[1] : x.p[0], l: idler, d: 0, r: 'idle' });
                    } else {
                        // oyun hiç başlamadı (başlangıç mesajı yok): tohumdan çark sonucu, oyun takılmaz
                        var wr = Mini.wheelRanking({ players: x.p, seed: (mn.sd + i) >>> 0 });
                        recordPair(mn, i, { w: wr[0][0], l: wr[1][0], d: 0, r: 'fuse' });
                    }
                }
            });
        }

        function miniView(t) {
            var m = M.mn;
            // Banner verisi (done/winner/draw/reason) son atışın animasyonu bitene (bAt) dek gizli; kayıt ve ödül çoktan yazılmıştır.
            var shownAt = 0;
            var pairs = (m.pm || []).map(function (x) {
                var shown = !!x.out && !(x.bAt && t < x.bAt);
                if (x.out && x.bAt > shownAt) shownAt = x.bAt;
                return { players: x.p, done: shown, winner: shown && !x.out.d ? x.out.w : null, draw: !!(shown && x.out.d), reason: shown ? x.out.r : '',
                    start: Math.max(0, x.stAt - t), left: x.dlAt ? Math.max(0, x.dlAt - t) : -1, watch: x.wb || null };
            });
            var hidden = t < shownAt;
            var mine = -1;
            pairs.forEach(function (x, i) { if (x.players.indexOf(me.id) >= 0 && !x.done && mine < 0) mine = i; });
            var p0 = pairs[0];
            var ffv = null;
            if (m.ff) {
                var el = t - m.ff.stAt;
                ffv = {
                    started: el >= 0, countdown: Math.max(0, -el), elapsed: Math.max(0, el), left: Math.max(0, m.ff.endAt - t),
                    rows: m.pl.map(function (id) {
                        var q = m.ff.rep[id];
                        if (q) return { id: id, bot: false, row: q.r, fin: q.f >= 0 ? q.f : null, d: q.d };
                        var bf = KRules.botFinish(m.sd, id);
                        return { id: id, bot: true, row: el >= 0 ? KRules.botProgress(m.sd, id, el) : 0, fin: bf !== null && bf <= el ? bf : null, d: 0 };
                    })
                };
            }
            return { type: m.ty, ff: ffv, game: m.gm || null, players: m.pl, seed: m.sd, ranking: hidden ? [] : m.rk, medals: hidden ? null : medalsOf(m), pairs: pairs, extra: m.ex || null, myPair: mine,
                live: sessions.some(function (s) { return !s.observer; }),
                left: m.applyAt && !hidden ? Math.max(0, m.applyAt - t) : -1, duelLeft: p0 && p0.left >= 0 ? p0.left : -1 };
        }

        function getView() {
            var t = now();
            if (!M) return { mode: 'connecting', offline: offline };
            var inSeat = !!seatOf(me.id);
            var kicked = M.kk.indexOf(me.id) >= 0 && !inSeat;
            var mode = kicked ? 'kicked' : (M.ph === 'lobby' ? (inSeat ? 'lobby' : 'spectator') : (inSeat ? M.ph : 'spectator'));
            var cur = M.g && M.g.stage !== 'mini' && M.g.stage !== 'over' ? R.current(M.g) : null;
            var curSeat = cur ? seatOf(cur) : null;
            var wait = null;
            if (curSeat && !curSeat.b && !curSeat.c) {
                wait = { id: cur, name: curSeat.n, left: Math.max(0, curSeat.dAt - t), bot: M.bt === cur, botIn: M.bt === cur ? 0 : Math.max(0, M.dlAt - t) };
            }
            var dcs = M.S.filter(function (s) { return !s.b && !s.c; }).map(function (s) { return { id: s.i, name: s.n, left: Math.max(0, s.dAt - t) }; });
            return {
                mode: mode,
                offline: offline,
                isLeader: isLeader(),
                me: me,
                meSeat: seatOf(me.id),
                leader: M.ld,
                cfg: M.cf,
                seats: M.S,
                game: M.g,
                phase: M.ph,
                cur: cur,
                dlLeft: M.pz ? M.dlLeft : Math.max(0, M.dlAt - t),
                paused: false,
                afk: !!(M.g && M.g.P[me.id] && M.g.P[me.id].afk),
                wait: wait,
                disconnected: dcs,
                                mini: M.mn ? miniView(t) : null,
                log: M.lg,
                fx: M.fx,
                fq: M.fq,
                startBlock: isLeader() && M.ph === 'lobby' ? startBlock() : null,
                standings: M.g && M.ph === 'over' ? R.standings(M.g) : null,
                ep: M.ep, rv: M.rv
            };
        }

        // ---- Başlatma ----
        if (opts.creator) initLeader();
        else { send({ type: 'pt_sync', id: me.id }); lastSyncAt = now(); }

        return {
            onMessage: onMessage, tick: tick, dispatch: dispatch, emote: emote, getView: getView,
            destroy: function () { endAllSessions(); },
            _session: function () { var s = sessions.filter(function (x) { return x.ffa; })[0]; return s ? s.api : null; },    // test: Kurbağa oturumu
            _ffaReport: function (from, m) { if (M && isLeader()) leaderFfaReport(from, m); },     // test: lider denetimli rapor girişi
            _state: function () { return M; }, _gone: function () { return gone; }, _publish: function () { if (M && isLeader()) publish(); }
        };
    }

    return { create: create, PHASES: PHASES };
});
