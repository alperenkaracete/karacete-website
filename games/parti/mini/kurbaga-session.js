// Parti / Kurbağa: oyuncu oturumu (DOM'suz çekirdek). Yerel sıçrama + çarpışma + ağ raporu; arayüz (kurbaga-ui.js) bunun üstüne biner.
//
//   run(spec) -> Promise<{ ranking: null, aborted: true }>   (sonuç lider tarafından raporlardan hesaplanır; burada yok)
//   spec: minigame.js sözleşmesi (ffa) + { startAt (yerel saat, ms: oyunun t=0 anı), bots: [id], resume?: {r,c,d,f}, onReport?(m),
//         register?(api), root?, names?, now?() }
//
// Ağ (pt_mg, makine zarfında gönderen kimliği eklenir): { k:'pos', r, c, d, n, e? }  n artan sıra no, e varışta istemcinin ölçtüğü süre.
//   - Sıçrama/ölüm/varış anında hemen, aksi halde en çok KURBAGA_SEND_MS'de bir (birleştirme: lider zaman bütçesiyle denetler),
//     değişiklik olmasa da KURBAGA_HEARTBEAT_MS'de bir (lider devrinde yeni lider durumu toparlar).
//   - Herkes başkalarının k:'pos' mesajlarını GÖRÜNTÜ için dinler (yumuşatmayı arayüz yapar); güven ve sonuç yalnız liderde.
// Zamanlayıcı yok: makine her tick'te api.tick(now) çağırır (arayüz ayrıca kare başına çağırır; tekrar çağrı zararsızdır).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./kurbaga-rules.js'), require('../config.js'), null);
    else root.PartiKurbagaSession = factory(root.PartiKurbagaRules, root.PartiConfig, root);
})(typeof self !== 'undefined' ? self : this, function (K, Config, win) {
    'use strict';

    function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }

    function run(spec) {
        var now = spec.now || Date.now;
        var net = spec.net;
        var lanes = K.lanes(spec.seed);
        var startAt = spec.startAt;
        var me = spec.me.id;
        var bots = spec.bots || [];
        var humans = (spec.players || []).filter(function (id) { return bots.indexOf(id) < 0; });
        var s = { r: 0, c: Math.floor(K.COLS / 2), d: 0, f: -1 };
        if (spec.resume) {
            if (isInt(spec.resume.r, 0, K.GOAL_ROW)) s.r = spec.resume.r;
            if (isInt(spec.resume.c, 0, K.COLS - 1)) s.c = spec.resume.c;
            if (isInt(spec.resume.d, 0, 100000)) s.d = spec.resume.d;
            if (isInt(spec.resume.f, 0, 1e7)) s.f = spec.resume.f;
        }
        // Sıra no oyun saatinden başlar: yenilenen sayfanın yeni oturumu, liderin önceki oturumdan kaydettiği n'nin altında kalıp
        // raporları yok saydırmasın (önceki oturum ≤ geçen_ms/250 mesaj gönderdi).
        var n = Math.max(0, Math.round(now() - startAt));
        var lastHop = -1e9;
        var lastSend = -1e9;
        var dirty = true;           // ilk tick'te ilk rapor hemen gider
        var immediate = true;
        if (s.f >= 0) {
            // Vardı durumunda açılır (yenileme): lider kaydı zaten var, varış raporu yeniden GÖNDERİLMEZ; kalp atışı durumu taşır
            dirty = false;
            immediate = false;
            lastSend = now();
        }
        var deathAt = -1e9;
        var peers = {};
        var done = false;

        function elapsed(t) { return t - startAt; }

        function send(t) {
            n++;
            var m = { k: 'pos', r: s.r, c: s.c, d: s.d, n: n };
            if (s.f >= 0) m.e = s.f;
            try { net.send(m); } catch (e) { /* ağ hatası oyunu durdurmaz */ }
            if (spec.onReport) spec.onReport(m);
            lastSend = t;
            dirty = false;
            immediate = false;
        }

        function die(t) {
            s.d++;
            s.r = 0;
            deathAt = t;
            dirty = true;
            immediate = true;
        }

        function tick(t) {
            if (done) return;
            if (t === undefined) t = now();
            var e = elapsed(t);
            if (e >= 0 && s.f < 0 && s.r >= 1 && s.r <= 8 && K.hit(lanes, s.r, s.c, e)) die(t);
            if (dirty && (immediate || t - lastSend >= Config.KURBAGA_SEND_MS)) send(t);
            else if (t - lastSend >= Config.KURBAGA_HEARTBEAT_MS) send(t);
        }

        // dir: 'up' | 'down' | 'left' | 'right'. Tek dokunuş = tek sıçrama; HOP_MS'den sık gelen yok sayılır.
        function hop(dir, t) {
            if (done) return false;
            if (t === undefined) t = now();
            var e = elapsed(t);
            if (e < 0 || s.f >= 0) return false;
            if (t - lastHop < K.HOP_MS) return false;
            var np = K.hop(s, dir);
            if (np.r === s.r && np.c === s.c) return false;
            lastHop = t;
            s.r = np.r;
            s.c = np.c;
            dirty = true;
            if (s.r === K.GOAL_ROW) {
                s.f = Math.max(K.GOAL_ROW * K.HOP_MS, Math.round(e));
                immediate = true;
            } else if (s.r >= 1 && K.hit(lanes, s.r, s.c, e)) {
                die(t);
            } else if (t - lastSend >= Config.KURBAGA_SEND_MS) {
                immediate = true;
            }
            return true;
        }

        var off = net.on(function (from, m) {
            if (!m || m.k !== 'pos' || from === me || humans.indexOf(from) < 0) return;
            if (!isInt(m.r, 0, K.GOAL_ROW) || !isInt(m.c, 0, K.COLS - 1) || !isInt(m.d, 0, 100000)) return;
            peers[from] = { r: m.r, c: m.c, d: m.d, f: isInt(m.e, 0, 1e7) ? m.e : -1, at: now() };
        });

        var api = {
            tick: tick, hop: hop, lanes: lanes, startAt: startAt, bots: bots, players: spec.players || [], seed: spec.seed, me: me,
            names: spec.names || {}, peers: peers,
            state: function () { return { r: s.r, c: s.c, d: s.d, f: s.f, deathAt: deathAt, n: n }; },
            elapsed: function () { return elapsed(now()); },
            destroy: destroy
        };
        var ui = null;

        function destroy() {
            if (done) return;
            done = true;
            if (off) off();
            if (ui && ui.destroy) ui.destroy();
            ui = null;
        }

        if (spec.register) spec.register(api);
        if (spec.root && win && win.PartiKurbagaUi) ui = win.PartiKurbagaUi.mount(spec.root, api, spec);

        return new Promise(function (resolve) {
            var finish = function () { destroy(); resolve({ ranking: null, aborted: true }); };
            if (spec.signal) {
                if (spec.signal.aborted) finish();
                else spec.signal.addEventListener('abort', finish);
            }
        });
    }

    return { run: run };
});
