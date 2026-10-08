// Parti / Düşen Zemin: oyuncu oturumu (DOM'suz çekirdek). Her istemci KENDİ oyuncusunun fiziğini koşturur (dusenzemin-rules.js step, sabit 1/60 sn);
// başkalarını rapor mesajlarından görüntüler. Arayüz (dusenzemin-ui.js) girişi setInput/press ile besler ve api.state/peers ile çizer.
//
//   run(spec) -> Promise<{ ranking: null, aborted: true }>   (sonucu lider raporlardan hesaplar)
//   spec: minigame.js sözleşmesi (ffa) + { startAt (yerel ms: oyun t=0), bots, resume?: {x,y,z,vx,vy,out}, onReport?(m), register?(api), root?, names?, avatars?, now? }
//
// Ağ (pt_mg, makine zarfında gönderen kimliği eklenir):
//   { k:'pos',  n, x, y, z, vx, vy, a }   ≤ ~8 Hz birleştirilmiş (DUSENZEMIN_SEND_MS); zıplama/it anında hemen; DUSENZEMIN_HEARTBEAT_MS kalp atışı
//   { k:'push', to, dx, dy, n }            itici yollar; YALNIZ 'to' (kurban) kendi üzerine uygular; menzil/bekleme kurbanın yerelinde denetlenir
//   { k:'out',  t, n }                     elenme: kurban kendi bildirir (t = oyun saatinden ms), TEK sefer
// Sıra no n oyun saatinden (ms) başlar: yenilenen sayfanın yeni oturumu liderin önceki n'sinin altında kalmaz (Kurbağa'daki çözüm).
// Zamanlayıcı yok: makine her tick'te api.tick(now) çağırır, arayüz ayrıca kare başına; tick sabit adımla YAKALAR (arka plandaki telefon/sekme
// dönünce en çok CATCHUP_MAX_MS ileri sarar; girişler o sürede sabit varsayılır).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./dusenzemin-rules.js'), require('../config.js'), null);
    else root.PartiDusenZeminSession = factory(root.PartiDusenZeminRules, root.PartiConfig, root);
})(typeof self !== 'undefined' ? self : this, function (D, Config, win) {
    'use strict';

    var CATCHUP_MAX_MS = 2000;
    var PUSH_REQ_TTL_MS = 250;           // basılı düğme isteği bu kadar eskiyse (sekme donduysa) atılır
    var PEER_EXTRAP_MS = 150;            // başkasının konumunu en çok bu kadar ileri tahmin et
    var PUSH_RANGE_SLACK = 70;           // itme menzil denetiminde konum gecikmesi payı
    var PUSH_CD_SLACK = 150;             // itme bekleme denetiminde saat payı
    var MIN_MOVE = 0.5;                  // bu kadar kımıldamadıysa değişmedi say

    function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }

    function run(spec) {
        var now = spec.now || Date.now;
        var net = spec.net;
        var startAt = spec.startAt;
        var me = spec.me.id;
        var players = spec.players || [];
        var bots = spec.bots || [];
        var humans = players.filter(function (id) { return bots.indexOf(id) < 0; });
        var sched = D.schedule(spec.seed, players.length);
        var starts = D.startPositions(spec.seed, players.length);
        var myStart = starts[Math.max(0, players.indexOf(me))] || { x: D.SIZE / 2, y: D.SIZE / 2 };

        var state = D.newState(myStart);
        var ghost = false;
        var resumed = false;
        var rs = spec.resume;
        if (rs) {
            resumed = true;
            if (isInt(rs.x, -120, D.SIZE + 120)) state.x = rs.x;
            if (isInt(rs.y, -120, D.SIZE + 120)) state.y = rs.y;
            if (isInt(rs.vx, -800, 800)) state.vx = rs.vx;
            if (isInt(rs.vy, -800, 800)) state.vy = rs.vy;
            if (isInt(rs.out, 0, 1e7)) { state.alive = false; state.outAt = rs.out; ghost = true; }        // elenmiş: hayalet izleyici, tekrar oynamaz
        }
        var n = Math.max(0, Math.round(now() - startAt));
        var simT = 0;
        var inMx = 0;
        var inMy = 0;
        var jumpReq = -1;
        var pushReq = -1;
        var lastSend = -1e9;
        var lastSent = null;
        var immediate = !ghost;                // ilk tick'te ilk rapor hemen gider (hayalet hiç göndermez)
        var outSent = ghost;                   // elenme raporu tek sefer; hayalet (yenileme) ikinci kez göndermez
        var peers = {};
        var lastPushFrom = {};
        var pushedAt = -1e9;
        var done = false;

        function elapsed(t) { return t - startAt; }

        function emit(m, t) {
            try { net.send(m); } catch (e) { /* ağ hatası oyunu durdurmaz */ }
            if (spec.onReport && (m.k === 'pos' || m.k === 'out')) spec.onReport(m);
            if (m.k === 'pos') lastSend = t;
        }

        function sendPos(t) {
            var m = { k: 'pos', n: ++n, x: Math.round(state.x), y: Math.round(state.y), z: Math.round(D.zOf(state)), vx: Math.round(state.vx), vy: Math.round(state.vy), a: state.alive ? 1 : 0 };
            lastSent = { x: state.x, y: state.y, vx: state.vx, vy: state.vy };
            immediate = false;
            emit(m, t);
        }

        function sendOut(t) {
            if (outSent) return;
            outSent = true;
            emit({ k: 'out', t: state.outAt, n: ++n }, t);
        }

        // Başkalarının görüntü konumu: son rapor + kısa ileri tahmin
        function peerPos(p, t) {
            var age = Math.min(PEER_EXTRAP_MS, Math.max(0, t - p.at)) / 1000;
            return { x: p.x + p.vx * age, y: p.y + p.vy * age };
        }

        function alivePeers(t) {
            var out = [];
            Object.keys(peers).forEach(function (id) {
                var p = peers[id];
                if (p.out >= 0) return;
                var q = peerPos(p, t);
                out.push({ id: id, x: q.x, y: q.y, alive: true });
            });
            return out;
        }

        function stepOnce(t) {
            simT += D.STEP_MS;
            var jump = jumpReq >= 0 && t - jumpReq <= PUSH_REQ_TTL_MS;
            var push = pushReq >= 0 && t - pushReq <= PUSH_REQ_TTL_MS;
            jumpReq = -1; pushReq = -1;
            var ev = D.step(state, { mx: inMx, my: inMy, jump: jump, push: push }, simT, sched);
            // gövde teması: iç içe giren hayatta insanlardan ayrıl (karşı taraf kendi yerelinde aynısını yapar)
            if (state.alive) {
                var others = alivePeers(t);
                for (var i = 0; i < others.length; i++) {
                    var c = D.bodyContact(state, others[i]);
                    if (c.dx || c.dy) { state.x += c.dx; state.y += c.dy; state.vx += c.dvx * 0.1; state.vy += c.dvy * 0.1; }
                }
            }
            if (ev.jump) immediate = true;
            if (ev.push) {
                immediate = true;
                var targets = D.pushTargets(state, alivePeers(t));
                if (targets.length) {
                    var v = D.pushVector(targets[0].dx, targets[0].dy);
                    emit({ k: 'push', to: targets[0].id, dx: v.dx, dy: v.dy, n: ++n }, t);
                }
            }
            if (ev.out) { immediate = true; }
        }

        function tick(t) {
            if (done) return;
            if (t === undefined) t = now();
            var e = elapsed(t);
            if (e >= 0 && !ghost) {
                if (resumed) { simT = e; resumed = false; }                            // yenileme: ilk kare şimdiden başlar (kaçan zamanı yakalama)
                if (e - simT > CATCHUP_MAX_MS) simT = e - CATCHUP_MAX_MS;
                var guard = 0;
                while (state.alive && simT + D.STEP_MS <= e && guard++ < 400) stepOnce(t);
                if (!state.alive && simT < e) simT = e;
            }
            if (ghost) return;
            if (!state.alive) {
                sendOut(t);
                return;
            }
            // pos raporu
            var moved = !lastSent || Math.abs(state.x - lastSent.x) > MIN_MOVE || Math.abs(state.y - lastSent.y) > MIN_MOVE ||
                Math.abs(state.vx - lastSent.vx) > 2 || Math.abs(state.vy - lastSent.vy) > 2;
            if (immediate || (moved && t - lastSend >= Config.DUSENZEMIN_SEND_MS) || t - lastSend >= Config.DUSENZEMIN_HEARTBEAT_MS) sendPos(t);
        }

        // Girişler (arayüz): analog yön [-1,1]; zıpla/it kenar tetiklemeli
        function setInput(mx, my) { inMx = isFinite(mx) ? mx : 0; inMy = isFinite(my) ? my : 0; }
        function press(kind, t) {
            if (done || ghost || !state.alive) return false;
            if (t === undefined) t = now();
            if (elapsed(t) < 0) return false;
            if (kind === 'jump') { jumpReq = t; return true; }
            if (kind === 'push') { pushReq = t; return true; }
            return false;
        }

        var off = net.on(function (from, m) {
            if (!m || typeof m !== 'object' || from === me || humans.indexOf(from) < 0) return;
            var t = now();
            if (m.k === 'pos') {
                if (!isInt(m.x, -120, D.SIZE + 120) || !isInt(m.y, -120, D.SIZE + 120) || !isInt(m.z, 0, D.JUMP_H + 4) || !isInt(m.vx, -800, 800) || !isInt(m.vy, -800, 800)) return;
                var prev = peers[from];
                if (prev && prev.out >= 0) return;
                peers[from] = { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, out: -1, at: t };
            } else if (m.k === 'out') {
                if (!isInt(m.t, 0, 1e7)) return;
                var p = peers[from] || { x: D.SIZE / 2, y: D.SIZE / 2, z: 0, vx: 0, vy: 0, at: t };
                p.out = m.t;
                peers[from] = p;
            } else if (m.k === 'push') {
                // kurban kendi üzerine uygular: yalnız bana gelen, canlıyken, sahte olmayan (menzil/bekleme) itme
                if (m.to !== me || !state.alive || ghost) return;
                if (!isInt(m.dx, -700, 700) || !isInt(m.dy, -700, 700)) return;
                if (Math.sqrt(m.dx * m.dx + m.dy * m.dy) > D.PUSH_IMPULSE + 5) return;
                var last = lastPushFrom[from];
                if (last !== undefined && t - last < D.PUSH_CD_MS - PUSH_CD_SLACK) return;               // bekleme (kurbanın yerelinde)
                var sp = peers[from];
                if (!sp || sp.out >= 0) return;                                                           // göndereni tanımıyorum / elenmiş
                var q = peerPos(sp, t);
                var dist = Math.sqrt((q.x - state.x) * (q.x - state.x) + (q.y - state.y) * (q.y - state.y));
                if (dist > D.PUSH_RANGE + 2 * D.R + PUSH_RANGE_SLACK) return;                              // menzil
                lastPushFrom[from] = t;
                D.applyPush(state, m.dx, m.dy);
                pushedAt = t;
            }
        });

        var api = {
            tick: tick, setInput: setInput, press: press, sched: sched, startAt: startAt, bots: bots, players: players, seed: spec.seed, me: me,
            names: spec.names || {}, peers: peers, starts: starts,
            state: function () {
                return {
                    x: state.x, y: state.y, z: D.zOf(state), vx: state.vx, vy: state.vy, alive: state.alive, outAt: state.outAt, ghost: ghost,
                    jcd: state.jcd, pcd: state.pcd, airborne: D.airborne(state), fall: state.fall, pushedAt: pushedAt, n: n, fx: state.fx, fy: state.fy
                };
            },
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
        if (spec.root && win && win.PartiDusenZeminUi) ui = win.PartiDusenZeminUi.mount(spec.root, api, spec);

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
