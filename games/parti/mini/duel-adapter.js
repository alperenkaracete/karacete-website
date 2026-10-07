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
// İzleme: spec.onWatch(snap|null) verilirse (yalnız lider) hakem durumu her değiştiğinde duel-watch.js anlık görüntüsü verilir;
// makine bunu pt_state ile yayınlar ve oynamayanlar salt-okunur tahtayı görür.
// Sonuç: kazanan [[k],[k]], beraberlik [[a,b]]; süre dolunca bitmemiş oyun beraberlik sayılır.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./duel-referee.js'), true, require('../config.js'), require('./duel-watch.js'));
    else root.PartiDuelAdapter = factory(root.PartiDuelReferee, false, root.PartiConfig, root.PartiDuelWatch);
})(typeof self !== 'undefined' ? self : this, function (Referee, isNode, Config, Watch) {
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

    // Kedi - Köpek son atış animasyonu (games/catdog.js beginShot/tick ile AYNI sayılar; catdog.js değişmez, test ayrışmayı yakalar):
    // her mermi clamp(frames*DT*1000, 500, 2600); mermiler arası 650 ms bekleme, son mermiden sonra 700 ms.
    var CD_ANIM = { flightMin: 500, flightMax: 2600, between: 650, tail: 700 };

    // Saf: board.last (catdog-rules apply çıktısı) -> animasyon ms. Atış değilse (iyileşme, last yok) 0. Ağ payı İÇERMEZ.
    function animMs(last, dt) {
        if (!last || last.kind !== 'shot' || !last.shots || !last.shots.length) return 0;
        var step = dt || 1 / 60;
        var total = 0;
        last.shots.forEach(function (shot, i) {
            total += Math.max(CD_ANIM.flightMin, Math.min(CD_ANIM.flightMax, shot.frames * step * 1000));
            total += i + 1 < last.shots.length ? CD_ANIM.between : CD_ANIM.tail;
        });
        return total;
    }

    // Banner gecikmesi: animasyon süresi + ağ payı; animasyonu olmayan oyunda (0) pad eklenmez.
    function bannerMs(anim) {
        return anim > 0 ? Math.round(anim) + Config.ANIM_NET_PAD_MS : 0;
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
        limit: { shots: Config.DUEL_CATDOG_SHOTS, counts: function (move) { return move.kind === 'shot'; } },
        // Son hamlenin animasyon süresi (bannerı geciktirir); yalnız atışla biten sonuçlarda anlamlı
        anim: function (board, rules) { return animMs(board && board.last, rules && rules.DT); },
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

    // Şerit metinleri (saf)
    function limitInfo() {
        return { title: 'Atışlar bitti', hint: 'Sonuç hesaplanıyor…', text: 'Atışlar bitti, sonuç hesaplanıyor…' };
    }

    // [[kazanan],[kaybeden]] -> "🏆 A kazandı"; [[a,b]] -> "🤝 Beraberlik"
    function resultText(ranking, nameOf) {
        if (ranking.length === 1 && ranking[0].length > 1) return '🤝 Beraberlik';
        return '🏆 ' + nameOf(ranking[0][0]) + ' kazandı';
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
        var isPlayer = !spec.observer && players.indexOf(meId) >= 0;
        var oppId = isPlayer ? (players[0] === meId ? players[1] : players[0]) : null;
        var timers = spec.timers || defaultTimers();
        var now = spec.now || Date.now;
        var net = spec.net;
        var names = spec.names || {};
        var nameOf = function (id) { return names[id] || (id === meId ? spec.me.name : id); };

        return new Promise(function (resolve, reject) {
            var resolved = false;
            var torn = false;
            // Hakem: lider her zaman (sonucu o belirler); atış sınırı olan oyunlarda oyuncular da (yalnız şerit/kilit
            // için; sonucu çözmez, zamanlayıcı kurmaz).
            var referee = (spec.isLeader || (info.limit && isPlayer))
                ? Referee.create({ prefix: info.prefix, rules: rules, players: players, limit: info.limit || null, onLimit: onLimit, onUpdate: function () { emitWatch(); } })
                : null;
            var stripEl = null;
            var stripTimer = null;
            var limitAt = null;
            var presented = false;
            var offNet = null;
            var deadlineTimer = null;
            var tickTimer = null;
            var def = null;
            var inst = 0;
            var resetNo = 0;                 // yapılan sıfırlama sayısı (bayat hello'ları ayıklamak için)
            var oppSeen = 0;                 // rakipten alıp oyuna ilettiğim (tekrarsız) mesaj sayısı
            var sentSeq = 0;                 // gönderdiğim oyun mesajı sayacı (ps)
            var oppKeys = {};                // iletilmiş rakip mesajları (aynı mesaj hem doğrudan hem catchup ile gelebilir)
            var seenInst = {};               // lider: oyuncu -> bu sıfırlamadaki örnek kimliği

            // Bu sonucun banner gecikmesi (ms): son atışın animasyonu + ağ payı. Süre dolumu/hükmen/sigorta taze animasyon
            // içermez; atışsız oyunlarda 0.
            function bannerFor(why) {
                if (!referee || !info.anim) return 0;
                if (why !== 'win' && why !== 'draw' && why !== 'limit') return 0;
                return bannerMs(info.anim(referee.board(), rules));
            }

            // İzleme anlık görüntüsü (yalnız onWatch verilen lider oturumu). ranking: hakem dışı sonuçlar (süre/hükmen) için.
            function emitWatch(ranking) {
                if (!spec.onWatch || !referee || torn) return;
                var st = referee.state();
                if (ranking) st.result = { ranking: ranking, reason: '' };
                spec.onWatch(Watch.snapshot(spec.game, st, rules));
            }

            function finish(ranking, reason) {
                if (resolved) return;
                resolved = true;
                if (deadlineTimer !== null) { timers.clear(deadlineTimer); deadlineTimer = null; }
                var bm = bannerFor(reason);
                // bm yalnız gecikme varsa taşınır (yoksa eski biçim: { ranking, reason })
                var res = { ranking: ranking, reason: reason };
                var msg = { k: 'result', r: ranking, why: reason };
                if (bm > 0) { res.bm = bm; msg.bm = bm; }
                resolve(res);
                emitWatch(ranking);
                // Sonucu oyunculara bildir (şerit); lider oyuncuysa kendisi de gösterir
                net.send(msg);
                presentResult(ranking, reason, bm);
            }

            // Üst şerit: oyun alanını kapatmaz (üstte ince bir bant); oyun alanı kilitlenir (pointer-events) ki sınırdan sonra
            // fazladan hamle girmesin. Sonuç hakemden (lider) gelir; yalnız gösterim gecikmeli olabilir.
            function lockBoard() {
                if (spec.root && spec.root.classList) spec.root.classList.add('pt-duel-locked');
            }

            function setStrip(text) {
                if (!isPlayer || !spec.root || torn) return;
                if (!stripEl) {
                    stripEl = spec.root.ownerDocument.createElement('div');
                    stripEl.className = 'pt-duel-strip';
                    spec.root.appendChild(stripEl);
                }
                stripEl.textContent = text;
            }

            function scheduleStrip(text, ms) {
                if (stripTimer !== null) { timers.clear(stripTimer); stripTimer = null; }
                if (ms <= 0) { setStrip(text); return; }
                stripTimer = timers.set(function () { stripTimer = null; setStrip(text); }, ms);
            }

            // Atış sınırı doldu (oyuncunun kendi hakemi): tahta kilitlenir, şerit en az LIMIT_STRIP_MS sonra belirir.
            function onLimit() {
                if (!isPlayer || torn) return;
                limitAt = now();
                lockBoard();
                if (!presented) scheduleStrip(limitInfo().text, limitDelay());
            }

            // Sınır şeridi gecikmesi: son atışın animasyonu bitince (sabit değer yalnız süre bilinmiyorsa yedek)
            function limitDelay() {
                var b = bannerFor('limit');
                return b > 0 ? b : Config.DUEL_LIMIT_STRIP_MS;
            }

            // Tek şerit elemanı: "hesaplanıyor" şeridi ile sonuç bannerı aynı elemanı paylaşır, üst üste binmez.
            // Sonuç şeritten önce gelirse "hesaplanıyor" hiç görünmez (scheduleStrip önceki zamanlayıcıyı iptal eder).
            function presentResult(ranking, why, bm) {
                if (presented || !isPlayer || !spec.root || torn) return;
                presented = true;
                lockBoard();
                var text = resultText(ranking, nameOf);
                if (why === 'limit') {
                    var since = limitAt === null ? 0 : now() - limitAt;
                    scheduleStrip(limitInfo().title + ' · ' + text, Math.max(0, (bm > 0 ? bm : Config.DUEL_LIMIT_STRIP_MS) - since));
                } else {
                    scheduleStrip(text, bm > 0 ? bm : 0);
                }
            }

            function check() {
                if (!referee || !spec.isLeader || resolved) return;
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
                oppKeys = {};
                sentSeq = 0;
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
                        m = Object.assign({}, m, { ps: ++sentSeq });
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

            // Rakip mesajı ilk kez mi geliyor? (yinelenenler oyuna iletilmez, sayılmaz)
            function takeOpp(m) {
                // gönderen her mesaja artan `ps` ekler (aynı hamle tekrarlanabilir: Dörtlü'de aynı sütun); yoksa içerik
                var key = typeof m.ps === 'number' ? 'p' + m.ps : JSON.stringify(m);
                if (oppKeys[key]) return false;
                oppKeys[key] = true;
                oppSeen++;
                return true;
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
                stripEl = null; limitAt = null; presented = false;
                if (stripTimer !== null) { timers.clear(stripTimer); stripTimer = null; }
                if (spec.root && spec.root.classList && spec.root.classList.remove) spec.root.classList.remove('pt-duel-locked');
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
                            if (!takeOpp(e.m)) return;
                            if (referee) referee.feed(oppId, e.m);
                            def.onMessage(e.m);
                        }
                    });
                    return;
                }
                if (m.k === 'result') {
                    if (from !== spec.leader || !Array.isArray(m.r) || !isPlayer) return;
                    var why = typeof m.why === 'string' ? m.why : '';
                    presentResult(m.r, why, typeof m.bm === 'number' && m.bm >= 0 ? Math.min(m.bm, 15000) : bannerFor(why));
                    return;
                }
                if (m.k === 'reset') {
                    if (from !== spec.leader || !Number.isInteger(m.r) || m.r <= resetNo) return;
                    rebuild(m.r);
                    return;
                }
                if (typeof m.type !== 'string' || /_rematch$/.test(m.type) || players.indexOf(from) < 0) return;
                if (referee && from !== meId) { referee.feed(from, m); check(); }
                if (isPlayer && from === oppId && def && takeOpp(m)) def.onMessage(m);
            }

            function teardown() {
                if (torn) return;
                torn = true;
                if (deadlineTimer !== null) { timers.clear(deadlineTimer); deadlineTimer = null; }
                if (tickTimer !== null) { timers.stop(tickTimer); tickTimer = null; }
                if (stripTimer !== null) { timers.clear(stripTimer); stripTimer = null; }
                if (offNet) offNet();
                destroyGame();
                if (spec.root && spec.root.classList && spec.root.classList.remove) spec.root.classList.remove('pt-duel-locked', 'pt-duel');
                if (!resolved) { resolved = true; resolve({ ranking: null, aborted: true }); }
            }

            if (spec.signal) {
                if (spec.signal.aborted) { teardown(); return; }
                spec.signal.addEventListener('abort', teardown);
            }

            offNet = net.on(onNet);
            // Parti kök düğümü minioyunlar arasında KALICI kullanılır: önceki düellonun kilidi (pt-duel-locked: sonuçta/atış sınırında
            // tahta tıklamaya kapatılır) sonraki düelloya taşınırsa XOX/Dörtlü tahtası tıklanamaz kalırdı (sayfa yenileyince düzelen hata).
            if (spec.root && spec.root.classList && spec.root.classList.remove) spec.root.classList.remove('pt-duel-locked');
            if (spec.root && spec.root.classList) spec.root.classList.add('pt-duel');

            if (referee && spec.isLeader && spec.deadlineMs > 0) {
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

    return { run: run, supports: supports, spectatorInfo: spectatorInfo, limitInfo: limitInfo, resultText: resultText, animMs: animMs, bannerMs: bannerMs, GAMES: GAMES, fmtTime: fmtTime };
});
