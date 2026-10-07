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
        var graphs = {};

        var M = null;                 // en son durum (lider: otoriter; diğerleri: son anlık görüntü)
        var gone = {};                // yerelde "koptu" bilinen kimlikler (lider seçimi için)
        var lastSyncAt = -1e9;
        var lastRepublish = -1e9;
        var offline = false;
        var botAt = 0;
        var botSeq = 0;
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
                S: [], g: null, dlAt: 0, dlLeft: 0, pz: false, mn: null, lg: [], fx: [], fq: 0, kk: []
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
                dl: M.pz ? Math.round(M.dlLeft) : Math.max(0, Math.round(M.dlAt - t)), pz: M.pz ? 1 : 0,
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

        function unpack(msg) {
            if (!msg || !isInt(msg.ep, 0, 1e6) || !isInt(msg.rv, 0, 1e9)) return null;
            if (typeof msg.ld !== 'string' || PHASES.indexOf(msg.ph) < 0) return null;
            // Devir en çok bir adım ilerler (takeOver ep'yi tam 1 artırır). Yeniden bağlanma sonrası ilk görüntü muaf:
            // uzun kopan oyuncu birden çok devri kaçırmış olabilir.
            if (M && !resyncOk && msg.ep > M.ep + 1) return null;
            if (!msg.cf || (msg.cf.m !== 'solo' && msg.cf.m !== 'team') || !opts.maps[msg.cf.mp] || C.GOALS.indexOf(msg.cf.gl) < 0) return null;
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
            if (msg.g !== null && (typeof msg.g !== 'object' || !msg.g.P || !Array.isArray(msg.g.order))) return null;
            if (!isInt(msg.dl, 0, 3600000)) return null;
            var mn = null;
            if (msg.mn) {
                if (!Array.isArray(msg.mn.pl) || !Array.isArray(msg.mn.rk) || !isInt(msg.mn.ms, -1, 600000)) return null;
                mn = { ty: msg.mn.ty === 'duel' ? 'duel' : 'ffa', pl: msg.mn.pl, sd: msg.mn.sd >>> 0, rk: msg.mn.rk, applyAt: msg.mn.ms >= 0 ? t + msg.mn.ms : 0, got: t };
            }
            if (!Array.isArray(msg.lg) || msg.lg.length > 60 || !Array.isArray(msg.fx) || !isInt(msg.fq, 0, 1e9)) return null;
            return {
                ep: msg.ep, rv: msg.rv, ld: msg.ld, ph: msg.ph, cf: { m: msg.cf.m, mp: msg.cf.mp, gl: msg.cf.gl },
                S: seats, g: msg.g, dlAt: t + msg.dl, dlLeft: msg.dl, pz: !!msg.pz, mn: mn,
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
                case 'death': return nm(e.id) + ' düştü' + (e.lost ? ' (' + e.lost + ' ⭐ kaybetti)' : '');
                case 'skip': return nm(e.id) + ' turunu atladı';
                case 'lost': return nm(e.id) + ' envanteri dolu: ' + wn(e.w) + ' kaçtı';
                case 'event': {
                    var found = null;
                    C.EVENTS.forEach(function (ev) { if (ev.id === e.e) found = ev; });
                    return '🎁 ' + nm(e.id) + ' ' + (found ? found.text : 'olay');
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
        function setDeadline() {
            M.pz = false;
            M.dlAt = now() + C.STEP_MS;
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
            addLog('Oyun başladı! Hedef: ' + M.cf.gl + ' ⭐');
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
                    if (C.GOALS.indexOf(a.goal) >= 0) M.cf.gl = a.goal;
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
            var allowed = { roll: 1, dir: 1, swap: 1, use: 1, end: 1 };
            if (!allowed[a.type]) return false;
            var act = { type: a.type, by: by };
            if (a.type === 'dir') act.to = a.to;
            if (a.type === 'swap') act.drop = a.drop;
            if (a.type === 'use') { act.item = a.item; act.target = a.target; act.node = a.node; }
            // duraklatılmış (kopan oyuncu bekleniyor) turda yalnızca o oyuncu dışındakiler işlem yapamaz zaten
            var r = R.reduce(M.g, act, rctx());
            if (!r.ok) return false;
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
                        if (M.g && M.g.stage !== 'mini' && M.g.stage !== 'over' && R.current(M.g) === data.id) freeze();
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

        function freeze() {
            if (M.pz) return;
            M.dlLeft = Math.max(0, M.dlAt - now());
            M.pz = true;
        }

        function unfreeze() {
            if (!M.pz) return;
            M.pz = false;
            M.dlAt = now() + (M.dlLeft || C.STEP_MS);
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
            if (seat && !seat.b && !seat.c) {          // sıradaki oyuncu bağlı değil: bekle
                freeze();
                return;
            }
            unfreeze();
            if (seat && seat.b) {
                if (t >= botAt) {
                    var ba = R.botAction(M.g, rctx());
                    if (ba) runAction(ba);
                }
                return;
            }
            if (t >= M.dlAt) {
                var aa = R.autoAction(M.g, rctx());
                if (aa) runAction(aa);
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
            if (curSeat && !curSeat.b && !curSeat.c) wait = { id: cur, name: curSeat.n, left: Math.max(0, curSeat.dAt - t) };
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
                paused: !!M.pz,
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
            onMessage: onMessage, tick: tick, dispatch: dispatch, getView: getView,
            _state: function () { return M; }, _gone: function () { return gone; }
        };
    }

    return { create: create, PHASES: PHASES };
});
