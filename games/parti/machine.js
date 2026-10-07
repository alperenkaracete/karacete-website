// Parti: ağ/oda durum makinesi (DOM'suz; saat ve gönderim enjekte edilir, Node'da test edilir).
//
// Lider (otorite) durumu hesaplar, her kabul edilen eylemden sonra TAM `pt_state` anlık görüntüsünü yayınlar.
// Diğerleri `pt_action` yollar ve son görüntüyü saklar. Lider `players[0]`'dan DEĞİL, durumdan türetilir (`ld`):
// backend yeniden katılanı listenin sonuna ekler. Lider düşerse bağlı insan koltuklar arasında koltuk sırasına göre
// ilk kişi lider olur (herkes aynı kuralı yerelde uygular), `ep` (devir sayısı) artar ve saklı durumdan sürer.
//
// Mesajlar: pt_state {ep, rv, ld, ph, cf, S, g, dl, pz, mn, lg, fx, fq, kk}, pt_action {id, a}, pt_sync {id}
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./config.js'), require('./graph.js'), require('./rules.js'), require('./minigame.js'));
    } else {
        root.PartiMachine = factory(root.PartiConfig, root.PartiGraph, root.PartiRules, root.PartiMinigame);
    }
})(typeof self !== 'undefined' ? self : this, function (C, G, R, Mini) {
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
        function rctx() { return { g: graphFor(M.cf.mp) }; }

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
                mn: M.mn ? { ty: M.mn.ty, pl: M.mn.pl, sd: M.mn.sd, rk: M.mn.rk, ms: M.mn.applyAt ? Math.max(0, Math.round(M.mn.applyAt - t)) : -1 } : null,
                lg: M.lg, fx: M.fx, fq: M.fq, kk: M.kk
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
            g.order.forEach(function (id) {
                var p = g.P[id];
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
                mn = { ty: msg.mn.ty === 'duel' ? 'duel' : 'ffa', pl: msg.mn.pl, sd: msg.mn.sd >>> 0, rk: msg.mn.rk, applyAt: msg.mn.ms >= 0 ? t + msg.mn.ms : 0, got: t };
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
                case 'swap': return nm(e.id) + ' ' + wn(e.old) + ' yerine ' + wn(e.w) + ' aldı';
                case 'decline': return nm(e.id) + ' ' + wn(e.w) + ' almadı';
                case 'attack': return nm(e.id) + ' ' + wn(e.w) + ' kullandı' + (e.target ? ' → ' + nm(e.target) : '');
                case 'dmg': return nm(e.id) + ' ' + e.n + ' hasar aldı';
                case 'block': return nm(e.id) + ' kalkanla korundu';
                case 'shield': return nm(e.id) + ' 🛡️ kalkanını kurdu';
                case 'frenzy': return '🔥 SON ÇILGINLIK! Sandıklar ×2';
                case 'heal': return e.n > 0 ? nm(e.id) + ' +' + e.n + ' ❤️ iyileşti' : null;
                case 'death': return nm(e.id) + ' düştü' + (e.lost ? ' (' + e.lost + ' ⭐ kaybetti)' : '');
                case 'skip': return nm(e.id) + ' turunu atladı';
                case 'lost': return nm(e.id) + ' envanteri dolu: ' + wn(e.w) + ' kaçtı';
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
        function resultLine(ranking) {
            var rank = 1;
            var parts = [];
            ranking.forEach(function (group) {
                var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '▫️';
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
            else { M.bt = null; M.dlAt = t + (C.STAGE_MS[g.stage] || C.STAGE_MS.act); }
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

        function beginMini() {
            var spec = R.minigameSpec(M.g, rctx());
            var token = { ty: spec.type, pl: spec.players, sd: spec.seed, rk: [], applyAt: 0 };
            M.mn = token;
            M.pz = true;
            M.dlLeft = 0;
            var p = startMinigame({ type: spec.type, players: spec.players.slice(), seed: spec.seed });
            Promise.resolve(p).then(function (res) {
                if (M.mn !== token) return;
                token.rk = normalizeRanking(res && res.ranking, spec.players);
                token.applyAt = now() + C.MINI_HOLD_MS;
                publish();
            }, function () {
                if (M.mn !== token) return;
                token.rk = [spec.players.slice()];
                token.applyAt = now() + C.MINI_HOLD_MS;
                publish();
            });
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
            var r = R.applyMinigame(M.g, { ranking: ranking }, rctx());
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
            var allowed = { roll: 1, dir: 1, swap: 1, use: 1, end: 1 };
            if (!allowed[a.type]) return false;
            var act = { type: a.type, by: by };
            if (a.type === 'dir') act.to = a.to;
            if (a.type === 'swap') act.drop = a.drop;
            if (a.type === 'use') { act.item = a.item; act.target = a.target; act.node = a.node; }
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
            if (M.mn && !M.mn.applyAt) {
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
        function emit() { onChange(getView()); }

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
                mini: M.mn ? { type: M.mn.ty, players: M.mn.pl, seed: M.mn.sd, ranking: M.mn.rk, left: M.mn.applyAt ? Math.max(0, M.mn.applyAt - t) : -1 } : null,
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
            _state: function () { return M; }, _gone: function () { return gone; }
        };
    }

    return { create: create, PHASES: PHASES };
});
