// Parti / Düşen Zemin: arayüz (üstten görünüm kanvas + analog joystick + 🦘/👊 düğmeleri + klavye). Fizik/mantık dusenzemin-session.js ve
// dusenzemin-rules.js içindedir; burası yalnız çizer ve girişi api.setInput/api.press'e çevirir.
//
//   mount(root, api, spec, env?) -> { destroy() }      env: { doc, win, raf, caf, emoji } (testte sahte; tarayıcıda varsayılan)
//
// Başkalarının oyuncuları: oturumun api.peers durumu (pos/out mesajları) hedeftir; çizilen konum üstel yaklaşmayla akar (≈150 ms geriden).
// Botlar: D.botPosition ile hayalet. Kontroller: mobil — tek analog joystick (ölü bölge + histerezis) + iki düğme, her biri kendi pointerId'siyle
// (joystick ve düğme AYNI ANDA); masaüstü — WASD/oklar + Boşluk (zıpla) + E/Shift (it). Zıpla/it kenar tetiklidir (basılı tutma gerekmez).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./dusenzemin-rules.js'), null, null);
    else root.PartiDusenZeminUi = factory(root.PartiDusenZeminRules, root.Emoji, root);
})(typeof self !== 'undefined' ? self : this, function (D, EmojiDefault, win) {
    'use strict';

    var W = D.SIZE;
    var TAU_OTHERS = 120;                 // ms: başkalarının görsel yumuşatması
    var DEAD_ZONE = 0.18;                 // joystick ölü bölgesi (yarıçapın oranı)
    var DEAD_RELEASE = 0.12;              // histerezis: bir kez aktifken bu orana inene dek aktif
    var SHRINK_MS = 450;                  // düşen oyuncunun küçülüp kaybolma süresi

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    // Joystick: (dx,dy) = dokunuşun merkezden uzaklığı (px), radius = joystick yarıçapı. wasActive: önceki durum (histerezis).
    // -> { mx, my, active }
    function joyVector(dx, dy, radius, wasActive) {
        var len = Math.sqrt(dx * dx + dy * dy);
        var frac = radius > 0 ? len / radius : 0;
        var thr = wasActive ? DEAD_RELEASE : DEAD_ZONE;
        if (frac < thr) return { mx: 0, my: 0, active: false };
        var k = Math.min(1, (frac - thr) / (1 - thr));                 // ölü bölgeden sonra 0..1 yumuşak
        return { mx: (dx / len) * k, my: (dy / len) * k, active: true };
    }

    var KEY_DIR = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], W: [0, -1], s: [0, 1], S: [0, 1], a: [-1, 0], A: [-1, 0], d: [1, 0], D: [1, 0] };

    function keyDir(key) { return Object.prototype.hasOwnProperty.call(KEY_DIR, key) ? KEY_DIR[key] : null; }
    function keyAction(key) {
        if (key === ' ' || key === 'Spacebar') return 'jump';
        if (key === 'e' || key === 'E' || key === 'Shift') return 'push';
        return null;
    }

    // Basılı yön tuşlarından birim vektör
    function keysVector(down) {
        var mx = 0;
        var my = 0;
        Object.keys(down).forEach(function (k) { if (down[k]) { var d = KEY_DIR[k]; mx += d[0]; my += d[1]; } });
        var len = Math.sqrt(mx * mx + my * my);
        return len > 0 ? { mx: mx / len, my: my / len } : { mx: 0, my: 0 };
    }

    function approach(v, tx, ty, dtMs, tau) {
        if (!v || Math.abs(v.x - tx) > 200 || Math.abs(v.y - ty) > 200) return { x: tx, y: ty };
        var k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
        return { x: v.x + (tx - v.x) * k, y: v.y + (ty - v.y) * k };
    }

    function countdownLabel(e) {
        if (e >= 0) return e < 700 ? 'BAŞLA!' : '';
        return -e > 3000 ? 'Hazır' : String(Math.ceil(-e / 1000));
    }

    // Elenme animasyonu: küçülme oranı (1 = tam boy, 0 = kayboldu)
    function shrink(e, outAt) {
        if (outAt < 0) return 1;
        return clamp(1 - (e - outAt) / SHRINK_MS, 0, 1);
    }

    function mount(rootEl, api, spec, env) {
        env = env || {};
        var doc = env.doc || (win && win.document);
        var wnd = env.win || win;
        var Emoji = env.emoji || EmojiDefault || (wnd && wnd.Emoji);
        var raf = env.raf || (wnd && wnd.requestAnimationFrame ? wnd.requestAnimationFrame.bind(wnd) : function (f) { return setTimeout(function () { f(Date.now()); }, 16); });
        var caf = env.caf || (wnd && wnd.cancelAnimationFrame ? wnd.cancelAnimationFrame.bind(wnd) : clearTimeout);
        var now = spec.now || Date.now;
        var names = spec.names || {};
        var avatars = spec.avatars || {};
        var me = spec.me.id;

        function el(tag, cls, text) {
            var e = doc.createElement(tag);
            if (cls) e.className = cls;
            if (text !== undefined) e.textContent = text;
            return e;
        }

        rootEl.textContent = '';
        var box = el('div', 'pt-dz');
        var hud = el('div', 'pt-dz-hud');
        var hudTime = el('span', 'pt-dz-time', '');
        var hudInfo = el('span', 'pt-dz-info', '');
        hud.appendChild(hudTime);
        hud.appendChild(hudInfo);
        var canvas = el('canvas', 'pt-dz-canvas');
        var dpr = Math.min(2, (wnd && wnd.devicePixelRatio) || 1);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(W * dpr);
        var c2d = canvas.getContext ? canvas.getContext('2d') : null;
        var pad = el('div', 'pt-dz-pad');
        var joy = el('div', 'pt-dz-joy');
        var knob = el('div', 'pt-dz-knob');
        joy.appendChild(knob);
        var actions = el('div', 'pt-dz-actions');
        var btnJump = el('button', 'pt-dz-btn pt-dz-jump', '🦘 Zıpla');
        var btnPush = el('button', 'pt-dz-btn pt-dz-push', '👊 İt');
        btnJump.setAttribute('type', 'button');
        btnPush.setAttribute('type', 'button');
        actions.appendChild(btnJump);
        actions.appendChild(btnPush);
        pad.appendChild(joy);
        pad.appendChild(actions);
        box.appendChild(hud);
        box.appendChild(canvas);
        box.appendChild(pad);
        rootEl.appendChild(box);

        // ---- Girişler ----
        var joyId = null;                     // joystick'i tutan pointerId
        var joyActive = false;
        var keysDown = {};
        var joyVec = { mx: 0, my: 0 };
        var cleanups = [];

        function applyInput() {
            var kv = keysVector(keysDown);
            var useKeys = kv.mx !== 0 || kv.my !== 0;
            api.setInput(useKeys ? kv.mx : joyVec.mx, useKeys ? kv.my : joyVec.my);
        }

        function joyGeom() {
            var r = joy.getBoundingClientRect ? joy.getBoundingClientRect() : { left: 0, top: 0, width: 120, height: 120 };
            return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: Math.max(20, Math.min(r.width, r.height) / 2) };
        }

        function joyMove(ev) {
            var g = joyGeom();
            var v = joyVector(ev.clientX - g.cx, ev.clientY - g.cy, g.radius, joyActive);
            joyActive = v.active;
            joyVec = { mx: v.mx, my: v.my };
            // düğme görseli: parmağı izler (yarıçapla sınırlı)
            var kx = clamp(ev.clientX - g.cx, -g.radius, g.radius);
            var ky = clamp(ev.clientY - g.cy, -g.radius, g.radius);
            if (knob.style) knob.style.transform = 'translate(' + Math.round(kx) + 'px,' + Math.round(ky) + 'px)';
            applyInput();
        }

        function joyRelease() {
            joyId = null;
            joyActive = false;
            joyVec = { mx: 0, my: 0 };
            if (knob.style) knob.style.transform = 'translate(0px,0px)';
            applyInput();
        }

        function on(target, type, fn) {
            target.addEventListener(type, fn);
            cleanups.push(function () { target.removeEventListener(type, fn); });
        }

        on(joy, 'pointerdown', function (ev) {
            if (joyId !== null) return;
            if (ev.preventDefault) ev.preventDefault();
            joyId = ev.pointerId;
            if (joy.setPointerCapture && ev.pointerId !== undefined) { try { joy.setPointerCapture(ev.pointerId); } catch (e) { /* yoksay */ } }
            joyMove(ev);
        });
        on(joy, 'pointermove', function (ev) { if (ev.pointerId === joyId) joyMove(ev); });
        on(joy, 'pointerup', function (ev) { if (ev.pointerId === joyId) joyRelease(); });
        on(joy, 'pointercancel', function (ev) { if (ev.pointerId === joyId) joyRelease(); });
        [[btnJump, 'jump'], [btnPush, 'push']].forEach(function (b) {
            on(b[0], 'pointerdown', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); api.press(b[1], now()); });
        });

        var onKeyDown = function (ev) {
            var d = keyDir(ev.key);
            var a = keyAction(ev.key);
            if (!d && !a) return;
            if (ev.preventDefault) ev.preventDefault();                  // oklar/boşlukla sayfa kaymasın
            if (ev.repeat) return;                                        // basılı tutma yok: zıpla/it kenar tetiklidir
            if (d) { keysDown[ev.key] = true; applyInput(); }
            else api.press(a, now());
        };
        var onKeyUp = function (ev) {
            if (keyDir(ev.key)) { keysDown[ev.key] = false; applyInput(); }
        };
        if (doc.addEventListener) {
            doc.addEventListener('keydown', onKeyDown);
            doc.addEventListener('keyup', onKeyUp);
            cleanups.push(function () { doc.removeEventListener('keydown', onKeyDown); doc.removeEventListener('keyup', onKeyUp); });
        }

        // ---- Çizim ----
        var vis = {};
        var lastT = null;
        var rafId = null;
        var dead = false;

        function visual(id, tx, ty, dt) {
            var v = approach(vis[id], tx, ty, dt, TAU_OTHERS);
            vis[id] = v;
            return v;
        }

        function drawPlayer(c, id, x, y, z, alpha, scale, label, mine) {
            if (scale <= 0) return;
            var size = 30 * scale;
            // gölge (yerde) + zıplarken yükselen emoji
            c.save();
            c.globalAlpha = alpha * 0.35;
            c.fillStyle = '#000';
            c.beginPath();
            c.ellipse(x, y + 6, 13 * scale * (1 - z / 90), 6 * scale, 0, 0, Math.PI * 2);
            c.fill();
            c.restore();
            if (mine) {
                c.save();
                c.strokeStyle = '#ffd24a';
                c.lineWidth = 2.5;
                c.beginPath();
                c.arc(x, y - z, 17 * scale, 0, Math.PI * 2);
                c.stroke();
                c.restore();
            }
            Emoji.draw(c, avatars[id] || '🐸', x, y - z + size * 0.35, size, { alpha: alpha, baseline: 'alphabetic' });
            if (label) {
                c.save();
                c.globalAlpha = Math.min(1, alpha + 0.25);
                c.font = '10px sans-serif';
                c.textAlign = 'center';
                c.fillStyle = '#fff';
                c.strokeStyle = 'rgba(0,0,0,0.7)';
                c.lineWidth = 3;
                c.strokeText(label, x, y - z - 20);
                c.fillText(label, x, y - z - 20);
                c.restore();
            }
        }

        function paint(t, dt) {
            if (!c2d) return;
            var e = api.elapsed();
            var st = api.state();
            var sched = api.sched;
            var ee = Math.max(0, e);
            c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
            c2d.fillStyle = '#12162a';
            c2d.fillRect(0, 0, W, W);
            // kareler
            var blink = Math.floor(t / 200) % 2 === 0;
            for (var tile = 0; tile < D.N * D.N; tile++) {
                var state = D.tileState(sched, tile, ee);
                if (state === 'gone') continue;
                var tx = (tile % D.N) * D.TILE;
                var ty = Math.floor(tile / D.N) * D.TILE;
                var top = state === 'warn' ? (blink ? '#fff3a8' : '#cfe0ff') : (state === 'doomed' ? '#8f9bb5' : '#cfe0ff');
                c2d.fillStyle = 'rgba(0,0,0,0.35)';
                c2d.fillRect(tx + 2, ty + 5, D.TILE - 2, D.TILE - 2);          // yükselti gölgesi
                c2d.fillStyle = top;
                c2d.fillRect(tx + 1, ty + 1, D.TILE - 3, D.TILE - 5);
                c2d.strokeStyle = 'rgba(40,60,110,0.35)';
                c2d.lineWidth = 1;
                c2d.strokeRect(tx + 1.5, ty + 1.5, D.TILE - 4, D.TILE - 6);
                if (state === 'doomed') {                                      // çatlak
                    c2d.strokeStyle = 'rgba(30,30,50,0.55)';
                    c2d.beginPath();
                    c2d.moveTo(tx + 12, ty + 10);
                    c2d.lineTo(tx + 30, ty + 30);
                    c2d.lineTo(tx + 22, ty + 48);
                    c2d.stroke();
                }
            }
            // botlar (hayalet)
            api.players.forEach(function (id) {
                if (api.bots.indexOf(id) < 0) return;
                var p = D.botPosition(api.seed, id, ee, sched);
                var v = visual(id, p.x, p.y, dt);
                var fallT = D.botFall(api.seed, id, sched);
                drawPlayer(c2d, id, v.x, v.y, 0, 0.4, p.out ? shrink(ee, fallT) : 1, names[id] || '', false);
            });
            // başkaları
            Object.keys(api.peers).forEach(function (id) {
                var q = api.peers[id];
                var sc = shrink(ee, q.out);
                var v = visual(id, q.x + q.vx * Math.min(0.15, Math.max(0, (t - q.at) / 1000)), q.y + q.vy * Math.min(0.15, Math.max(0, (t - q.at) / 1000)), dt);
                drawPlayer(c2d, id, v.x, v.y, q.z || 0, 0.6, sc, names[id] || '', false);
            });
            // kendin (elendiyse küçülerek kaybolur; hayalet hiç çizilmez)
            if (!st.ghost) drawPlayer(c2d, me, st.x, st.y, st.z, 1, st.alive ? (st.fall > 0 ? 1 - st.fall / D.FALL_MS * 0.3 : 1) : shrink(ee, st.outAt), '', true);
            // yazılar
            var label = !st.alive ? '' : countdownLabel(e);
            var big = label;
            var sub = '';
            if (!st.alive) { big = 'Elendin'; sub = 'Diğerlerini izliyorsun'; }
            if (big) {
                c2d.save();
                c2d.fillStyle = 'rgba(0,0,0,0.45)';
                c2d.fillRect(0, W / 2 - 40, W, sub ? 96 : 72);
                c2d.fillStyle = '#fff';
                c2d.font = 'bold 40px sans-serif';
                c2d.textAlign = 'center';
                c2d.textBaseline = 'middle';
                c2d.fillText(big, W / 2, W / 2 - 6);
                if (sub) { c2d.font = 'bold 18px sans-serif'; c2d.fillText(sub, W / 2, W / 2 + 34); }
                c2d.restore();
            }
        }

        function frame(t) {
            if (dead) return;
            rafId = raf(frame);
            var tt = now();
            api.tick(tt);
            var dt = lastT === null ? 16 : Math.min(100, t - lastT);
            lastT = t;
            paint(tt, dt);
            var st = api.state();
            var e = api.elapsed();
            var endAt = spec.getEndAt ? spec.getEndAt() : 0;
            hudTime.textContent = e < 0 || !endAt ? '' : '⏱ ' + Math.max(0, Math.ceil((endAt - tt) / 1000)) + ' sn';
            var alive = (st.alive ? 1 : 0);
            Object.keys(api.peers).forEach(function (id) { if (api.peers[id].out < 0) alive++; });
            api.players.forEach(function (id) { if (api.bots.indexOf(id) >= 0 && D.botFall(api.seed, id, api.sched) > Math.max(0, e)) alive++; });
            var jr = st.jcd > 0 ? '🦘 ' + (st.jcd / 1000).toFixed(1) : '🦘 ✓';
            var pr = st.pcd > 0 ? '👊 ' + (st.pcd / 1000).toFixed(1) : '👊 ✓';
            hudInfo.textContent = '👥 ' + alive + ' · ' + jr + ' · ' + pr;
            btnJump.disabled = !st.alive || st.jcd > 0;
            btnPush.disabled = !st.alive || st.pcd > 0;
        }
        rafId = raf(frame);

        return {
            destroy: function () {
                if (dead) return;
                dead = true;
                if (rafId !== null) caf(rafId);
                cleanups.forEach(function (f) { f(); });
                cleanups = [];
                api.setInput(0, 0);
                rootEl.textContent = '';
            }
        };
    }

    return { mount: mount, joyVector: joyVector, keysVector: keysVector, keyDir: keyDir, keyAction: keyAction, approach: approach, countdownLabel: countdownLabel, shrink: shrink, DEAD_ZONE: DEAD_ZONE, DEAD_RELEASE: DEAD_RELEASE };
});
