// Parti düello adaptörü: mevcut iki kişilik oyunları (XOX, Dörtlü Bağla) olduğu gibi, iki oyunculu SAHTE bir ctx ile
// Parti'nin içinde çalıştırır. core/duel.js, core/duel-ui.js, *-rules.js ve games/<oyun>.js değişmez.
//
//   run(spec) -> Promise<{ ranking }>            (spec: minigame.js sözleşmesi + defs/rules/timers/now/names/leader)
//
// Sahte ctx: players = düellodaki ikili, isHost() = ilk oyuncu, send = pt_mg yükü, root = minioyun kökü, leave = boş.
// Rövanş kapalı: *_rematch mesajları ne gönderilir ne iletilir. Gelen oyun mesajı yalnızca düellodaki RAKİPTEN iletilir.
//
// Yükler (net.send(m) / net.on(fn(from, m)); makine bunları pt_mg zarfına sarar ve gönderen kimliğini ekler):
//   oyun mesajları          { type:'xox_start' | 'xox_move' | ... }  (core/duel.js protokolü)
//   { k:'hello', n, r, have }    oyuncu: "ben bu örnekteyim, rakipten `have` mesaj aldım" (başlangıç / yeniden bağlanma)
//   { k:'catchup', to, msgs }    lider: kaçan rakip mesajlarını bir oyuncuya yeniden gönderir
//   { k:'reset', r }             lider: düello yeniden kurulur (oyuncu örneği yenilenmiş; durum kurtarılamaz)
// Hakem (duel-referee.js) yalnızca lider oturumunda çalışır; sonucu lider belirler.
// Sonuç: kazanan [[k],[k]], beraberlik [[a,b]]; süre dolunca bitmemiş oyun beraberlik sayılır.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./duel-referee.js'), true);
    else root.PartiDuelAdapter = factory(root.PartiDuelReferee, false);
})(typeof self !== 'undefined' ? self : this, function (Referee, isNode) {
    'use strict';

    var GLOBAL = typeof self !== 'undefined' ? self : this;

    // Kedi - Köpek: kural modülü atış/süre sınırı bilmez (ve değişmez); sınır hakemde, kalan can sıralaması burada.
    // Atış = kind 'shot' (güçlendirmeli atış dahil); 'heal' atış sayılmaz. Eşit canda null -> hakem beraberlik verir.
    function catdogPartial(board, order) {
        var a = board.players[0].hp;
        var b = board.players[1].hp;
        if (a === b) return null;
        var w = a > b ? 0 : 1;
        return [[order[w]], [order[1 - w]]];
    }

    // Hazır düello oyunları. Yeni oyun: buraya satır ekle (README).
    var GAMES = {
        xox: {
            prefix: 'xox', title: 'XOX',
            rules: function () { return isNode ? require('../../xox-rules.js') : GLOBAL.XoxRules; }
        },
        connect4: {
            prefix: 'c4', title: 'Dörtlü Bağla',
            rules: function () { return isNode ? require('../../connect4-rules.js') : GLOBAL.Connect4Rules; }
        }
    };

    GAMES.catdog = {
        prefix: 'cd', title: 'Kedi - Köpek',
        limit: { shots: 3, counts: function (move) { return move.kind === 'shot'; } },
        rules: function () {
            var r = isNode ? require('../../catdog-rules.js') : GLOBAL.CatDogRules;
            return Object.assign({}, r, { partial: catdogPartial });
        }
    };

    function supports(id) { return Object.prototype.hasOwnProperty.call(GAMES, id); }

    function fmtTime(ms) {
        var s = Math.max(0, Math.ceil(ms / 1000));
        return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }

    // İzleyici kartı verisi (saf): "A ve B XOX oynuyor" + kalan süre
    function spectatorInfo(spec, leftMs) {
        var info = GAMES[spec.game];
        var names = spec.names || {};
        var a = names[spec.players[0]] || spec.players[0];
        var b = names[spec.players[1]] || spec.players[1];
        return {
            title: '⚔️ Düello',
            text: a + ' ve ' + b + ' ' + info.title + ' oynuyor',
            left: leftMs === undefined || leftMs === null ? null : Math.max(0, leftMs),
            leftText: leftMs === undefined || leftMs === null ? '' : 'Kalan süre ' + fmtTime(leftMs)
        };
    }

    function defaultTimers() {
        return {
            set: function (f, ms) { return setTimeout(f, ms); },
            clear: function (id) { clearTimeout(id); },
            every: function (f, ms) { return setInterval(f, ms); },
            stop: function (id) { clearInterval(id); }
        };
    }

    function run(spec) {
        var info = GAMES[spec.game];
        if (!info) return Promise.reject(new Error('bilinmeyen düello oyunu: ' + spec.game));
        var rules = spec.rules || info.rules();
        var players = spec.players.slice(0, 2);
        var meId = spec.me.id;
        var isPlayer = players.indexOf(meId) >= 0;
        var oppId = isPlayer ? (players[0] === meId ? players[1] : players[0]) : null;
        var timers = spec.timers || defaultTimers();
        var now = spec.now || Date.now;
        var net = spec.net;
        var names = spec.names || {};
        var nameOf = function (id) { return names[id] || (id === meId ? spec.me.name : id); };

        return new Promise(function (resolve, reject) {
            var resolved = false;
            var torn = false;
            var referee = spec.isLeader ? Referee.create({ prefix: info.prefix, rules: rules, players: players }) : null;
            var offNet = null;
            var deadlineTimer = null;
            var tickTimer = null;
            var def = null;
            var inst = 0;
            var resetNo = 0;                 // yapılan sıfırlama sayısı (bayat hello'ları ayıklamak için)
            var oppSeen = 0;                 // rakipten alıp oyuna ilettiğim mesaj sayısı
            var seenInst = {};               // lider: oyuncu -> bu sıfırlamadaki örnek kimliği

            function finish(ranking, reason) {
                if (resolved) return;
                resolved = true;
                if (deadlineTimer !== null) { timers.clear(deadlineTimer); deadlineTimer = null; }
                resolve({ ranking: ranking, reason: reason });
            }

            function check() {
                if (!referee || resolved) return;
                var out = referee.outcome();
                if (out) finish(out.ranking, out.reason);
            }

            function destroyGame() {
                if (def) { try { def.destroy(); } catch (e) { /* yoksay */ } }
                def = null;
                if (spec.root) spec.root.textContent = '';
            }

            // Oyuncu: oyunu kur. Örnek kimliği her kurulumda yenilenir.
            function startGame() {
                inst = Math.floor(Math.random() * 1e9) + 1;
                oppSeen = 0;
                var defs = spec.defs || (GLOBAL.Games && GLOBAL.Games.get(spec.game));
                if (!defs) throw new Error('oyun tanımı yok: ' + spec.game);
                var ctx = {
                    root: spec.root,
                    me: { id: meId, name: spec.me.name },
                    room: spec.room || '',
                    players: players.map(function (id) { return { id: id, name: nameOf(id) }; }),
                    isHost: function () { return meId === players[0]; },
                    send: function (m) {
                        if (torn || !m || typeof m.type !== 'string' || /_rematch$/.test(m.type)) return;
                        if (referee) referee.feed(meId, m);
                        net.send(m);
                        check();
                    },
                    leave: function () { /* düelloda çıkış yok: Parti sonucu uygular */ }
                };
                def = defs;
                def.init(ctx);
                hello();
            }

            function hello() {
                if (isPlayer && !torn) net.send({ k: 'hello', n: inst, r: resetNo, have: oppSeen });
            }

            function rebuild(no) {
                resetNo = no;
                seenInst = {};
                if (referee) referee.reset();
                if (!isPlayer) return;
                if (def) { try { def.destroy(); } catch (e) { /* yoksay */ } def = null; }
                if (spec.root) spec.root.textContent = '';
                try { startGame(); } catch (e) { /* oyun kurulamadı: lider süre sonunda sonucu verir */ }
            }

            function leaderHello(from, m) {
                if (!referee || resolved || players.indexOf(from) < 0) return;
                if (!Number.isInteger(m.r) || m.r < resetNo) return;            // sıfırlamadan önceki bayat hello
                var log = referee.log();
                var theirs = log.filter(function (e) { return e.f !== from; });
                if (seenInst[from] !== undefined && seenInst[from] !== m.n) {
                    // aynı oyuncudan yeni bir oyun örneği: kendi hamlelerini kaybetti, durum kurtarılamaz
                    rebuild(resetNo + 1);
                    net.send({ k: 'reset', r: resetNo });
                    return;
                }
                seenInst[from] = m.n;
                var have = Number.isInteger(m.have) && m.have >= 0 ? m.have : 0;
                if (theirs.length > have) {
                    net.send({ k: 'catchup', to: from, msgs: theirs.slice(have) });
                }
            }

            function onNet(from, m) {
                if (torn || !m || typeof m !== 'object') return;
                if (m.k === '_reconnected') { hello(); return; }              // yerel olay: bağlantı döndü
                if (m.k === 'hello') { leaderHello(from, m); return; }
                if (m.k === 'catchup') {
                    if (!isPlayer || from !== spec.leader || m.to !== meId || !Array.isArray(m.msgs) || !def) return;
                    m.msgs.forEach(function (e) {
                        if (e && e.f === oppId && e.m && typeof e.m.type === 'string' && !/_rematch$/.test(e.m.type)) {
                            oppSeen++;
                            def.onMessage(e.m);
                        }
                    });
                    return;
                }
                if (m.k === 'reset') {
                    if (from !== spec.leader || !Number.isInteger(m.r) || m.r <= resetNo) return;
                    rebuild(m.r);
                    return;
                }
                if (typeof m.type !== 'string' || /_rematch$/.test(m.type) || players.indexOf(from) < 0) return;
                if (referee && from !== meId) { referee.feed(from, m); check(); }
                if (isPlayer && from === oppId && def) { oppSeen++; def.onMessage(m); }
            }

            function teardown() {
                if (torn) return;
                torn = true;
                if (deadlineTimer !== null) { timers.clear(deadlineTimer); deadlineTimer = null; }
                if (tickTimer !== null) { timers.stop(tickTimer); tickTimer = null; }
                if (offNet) offNet();
                destroyGame();
                if (!resolved) { resolved = true; resolve({ ranking: null, aborted: true }); }
            }

            if (spec.signal) {
                if (spec.signal.aborted) { teardown(); return; }
                spec.signal.addEventListener('abort', teardown);
            }

            offNet = net.on(onNet);
            if (spec.root && spec.root.classList) spec.root.classList.add('pt-duel');

            if (referee && spec.deadlineMs > 0) {
                deadlineTimer = timers.set(function () {
                    deadlineTimer = null;
                    finish(referee.timeout(), 'timeout');
                }, spec.deadlineMs);
            }

            if (isPlayer) {
                try { startGame(); } catch (e) { if (!resolved) { resolved = true; teardown(); reject(e); } }
            } else if (spec.root) {
                // izleyici kartı
                var deadlineAt = now() + (spec.deadlineMs > 0 ? spec.deadlineMs : 0);
                var card = spec.root.ownerDocument.createElement('div');
                card.className = 'pt-duel-spectator';
                var title = spec.root.ownerDocument.createElement('strong');
                var line = spec.root.ownerDocument.createElement('span');
                var left = spec.root.ownerDocument.createElement('span');
                line.className = 'pt-hint';
                left.className = 'pt-hint';
                card.appendChild(title); card.appendChild(line); card.appendChild(left);
                spec.root.appendChild(card);
                var paint = function () {
                    var s = spectatorInfo({ game: spec.game, players: players, names: names }, spec.deadlineMs > 0 ? deadlineAt - now() : null);
                    title.textContent = s.title;
                    line.textContent = s.text;
                    left.textContent = s.leftText;
                };
                paint();
                tickTimer = timers.every(paint, 500);
            }
        });
    }

    return { run: run, supports: supports, spectatorInfo: spectatorInfo, GAMES: GAMES, fmtTime: fmtTime };
});
