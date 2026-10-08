// Parti / Kurbağa: arayüz (kanvas + 4 ok düğmesi + klavye). Mantık kurbaga-session.js / kurbaga-rules.js içindedir; burası yalnız çizer
// ve girişi api.hop'a çevirir.
//
//   mount(root, api, spec, env?) -> { destroy() }      env: { doc, win, raf, caf } (testte sahte; tarayıcıda varsayılan)
//
// Başkalarının kurbağaları: oturumun api.peers durumu (k:'pos' mesajları) hedeftir, çizilen konum üstel yaklaşmayla (tau ~90 ms)
// akar -> lider yayınına (≤2/sn) bağlı kalmaz. Botlar: botProgress(seed, id, t) ile hayalet olarak çizilir. Güven yalnız liderde.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./kurbaga-rules.js'), null, null);
    else root.PartiKurbagaUi = factory(root.PartiKurbagaRules, root.Emoji, root);
})(typeof self !== 'undefined' ? self : this, function (K, EmojiDefault, win) {
    'use strict';

    var CELL = 40;
    var W = K.COLS * CELL;
    var H = K.ROWS * CELL;
    var TAU_OTHERS = 90;       // ms: başkalarının görsel yumuşatması
    var TAU_ME = 35;           // ms: kendi sıçrama animasyonu
    var DEATH_FLASH_MS = 450;
    var CAR_COLORS = ['#e74c3c', '#f1c40f', '#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1', '#e84393'];
    var CAR_ICONS = { 1: ['🚗', '🚕', '🚙'], 2: ['🚚', '🚌', '🚛'] };

    var KEYS = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right'
    };

    function keyToDir(key) { return Object.prototype.hasOwnProperty.call(KEYS, key) ? KEYS[key] : null; }

    // Üstel yaklaşma (dt'den bağımsız); büyük sıçramada (ölüm / ilk görünüm) anında
    function approach(v, tx, ty, dtMs, tau) {
        if (!v || Math.abs(v.x - tx) > 3 * CELL || Math.abs(v.y - ty) > 3 * CELL) return { x: tx, y: ty };
        var k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
        return { x: v.x + (tx - v.x) * k, y: v.y + (ty - v.y) * k };
    }

    function cellX(c) { return c * CELL; }
    function cellY(r) { return (K.GOAL_ROW - r) * CELL; }

    function countdownLabel(e) {
        if (e >= 0) return e < 600 ? 'BAŞLA!' : '';
        return -e > 3000 ? 'Hazır' : String(Math.ceil(-e / 1000));       // 4 sn payı: ilk sn "Hazır", sonra 3-2-1
    }

    function fmtSecs(ms) { return (ms / 1000).toFixed(1) + ' sn'; }

    function botColumn(seed, id) {
        var s = 0;
        for (var i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0;
        return (s + (seed >>> 0)) % K.COLS;
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
        var box = el('div', 'pt-frog');
        var hud = el('div', 'pt-frog-hud');
        var hudTime = el('span', 'pt-frog-time', '');
        var hudInfo = el('span', 'pt-frog-info', '');
        hud.appendChild(hudTime);
        hud.appendChild(hudInfo);
        var canvas = el('canvas', 'pt-frog-canvas');
        var dpr = Math.min(2, (wnd && wnd.devicePixelRatio) || 1);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        var c2d = canvas.getContext ? canvas.getContext('2d') : null;
        var pad = el('div', 'pt-frog-pad');
        var buttons = [];
        [['up', '▲', 'pt-frog-up'], ['left', '◀', 'pt-frog-left'], ['down', '▼', 'pt-frog-down'], ['right', '▶', 'pt-frog-right']].forEach(function (d) {
            var b = el('button', 'pt-frog-btn ' + d[2], d[1]);
            b.setAttribute('type', 'button');
            b.setAttribute('aria-label', d[0]);
            var onDown = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); api.hop(d[0], now()); };
            b.addEventListener('pointerdown', onDown);
            buttons.push({ b: b, onDown: onDown });
            pad.appendChild(b);
        });
        box.appendChild(hud);
        box.appendChild(canvas);
        box.appendChild(pad);
        rootEl.appendChild(box);

        var onKey = function (ev) {
            var dir = keyToDir(ev.key);
            if (!dir) return;
            if (ev.preventDefault) ev.preventDefault();            // oklarla sayfa kaymasın
            if (ev.repeat) return;                                  // basılı tutma yok: tek dokunuş = tek sıçrama
            api.hop(dir, now());
        };
        if (doc.addEventListener) doc.addEventListener('keydown', onKey);

        var vis = {};          // id -> görsel konum (piksel)
        var lastT = null;
        var rafId = null;
        var dead = false;

        function visual(id, tx, ty, dt, tau) {
            var v = approach(vis[id], tx, ty, dt, tau);
            vis[id] = v;
            return v;
        }

        function roundRect(c, x, y, w, h, r) {
            c.beginPath();
            c.moveTo(x + r, y);
            c.lineTo(x + w - r, y);
            c.quadraticCurveTo(x + w, y, x + w, y + r);
            c.lineTo(x + w, y + h - r);
            c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            c.lineTo(x + r, y + h);
            c.quadraticCurveTo(x, y + h, x, y + h - r);
            c.lineTo(x, y + r);
            c.quadraticCurveTo(x, y, x + r, y);
            c.closePath();
        }

        function drawFrog(c, id, x, y, alpha, label, big) {
            var icon = avatars[id] || '🐸';
            Emoji.draw(c, icon, x + CELL / 2, y + CELL * 0.78, big ? CELL * 0.8 : CELL * 0.7, { alpha: alpha });
            if (label) {
                c.save();
                c.globalAlpha = Math.min(1, alpha + 0.2);
                c.font = '10px sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'alphabetic';
                c.fillStyle = '#fff';
                c.strokeStyle = 'rgba(0,0,0,0.7)';
                c.lineWidth = 3;
                c.strokeText(label, x + CELL / 2, y + 7);
                c.fillText(label, x + CELL / 2, y + 7);
                c.restore();
            }
        }

        function paint(t, dt) {
            var e = api.elapsed();
            var st = api.state();
            var lanes = api.lanes;
            var ecar = Math.max(0, e);
            if (!c2d) return;
            c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
            // zemin: başlangıç çimi, yol şeritleri, hedef
            for (var r = 0; r <= K.GOAL_ROW; r++) {
                c2d.fillStyle = r === 0 ? '#58a65c' : (r === K.GOAL_ROW ? '#f3c24f' : (r % 2 ? '#4a4f57' : '#41454d'));
                c2d.fillRect(0, cellY(r), W, CELL);
            }
            c2d.fillStyle = 'rgba(255,255,255,0.18)';
            for (var rr = 1; rr <= 8; rr++) for (var cx = 0; cx < K.COLS; cx += 2) c2d.fillRect(cellX(cx) + 6, cellY(rr) + CELL / 2 - 1, CELL - 12, 2);
            Emoji.draw(c2d, '🏁', W / 2, cellY(K.GOAL_ROW) + CELL * 0.78, CELL * 0.75, {});
            // araçlar
            for (var li = 0; li < 8; li++) {
                var lane = lanes[li];
                var list = K.cars(lane, ecar);
                for (var ci = 0; ci < list.length; ci++) {
                    var car = list[ci];
                    var x = car.x * CELL;
                    var y = cellY(li + 1) + 5;
                    var w = car.len * CELL - 4;
                    c2d.fillStyle = CAR_COLORS[(li + car.len) % CAR_COLORS.length];
                    roundRect(c2d, x + 2, y, w, CELL - 10, 7);
                    c2d.fill();
                    var icons = CAR_ICONS[car.len];
                    Emoji.draw(c2d, icons[li % icons.length], x + 2 + w / 2, y + CELL * 0.62, CELL * 0.55, {});
                }
            }
            // botlar (hayalet), sonra insanlar (başkaları), en üstte kendin
            api.players.forEach(function (id) {
                if (api.bots.indexOf(id) < 0) return;
                var row = K.botProgress(api.seed, id, ecar);
                var p = visual(id, cellX(botColumn(api.seed, id)), cellY(row), dt, TAU_OTHERS);
                drawFrog(c2d, id, p.x, p.y, 0.4, names[id] || '', false);
            });
            Object.keys(api.peers).forEach(function (id) {
                var q = api.peers[id];
                var p = visual(id, cellX(q.c), cellY(q.r), dt, TAU_OTHERS);
                drawFrog(c2d, id, p.x, p.y, 0.55, names[id] || '', false);
            });
            var mp = visual(me, cellX(st.c), cellY(st.r), dt, TAU_ME);
            drawFrog(c2d, me, mp.x, mp.y, 1, '', true);
            c2d.strokeStyle = '#fff';
            c2d.lineWidth = 2;
            roundRect(c2d, mp.x + 3, mp.y + 3, CELL - 6, CELL - 6, 8);
            c2d.stroke();
            // ölüm yanıp sönmesi
            var sinceDeath = t - st.deathAt;
            if (sinceDeath >= 0 && sinceDeath < DEATH_FLASH_MS) {
                c2d.fillStyle = 'rgba(231,76,60,' + (0.45 * (1 - sinceDeath / DEATH_FLASH_MS)).toFixed(3) + ')';
                c2d.fillRect(0, 0, W, H);
            }
            // geri sayım / bitiş yazıları
            var label = st.f >= 0 ? '🏁 Vardın! ' + fmtSecs(st.f) : countdownLabel(e);
            if (label) {
                var endAt0 = spec.getEndAt ? spec.getEndAt() : 0;
                var sub = st.f >= 0 ? 'Diğerleri bekleniyor' + (endAt0 ? ' · kalan ' + Math.max(0, Math.ceil((endAt0 - t) / 1000)) + ' sn' : '') : '';
                c2d.save();
                c2d.fillStyle = 'rgba(0,0,0,0.45)';
                c2d.fillRect(0, H / 2 - 36, W, sub ? 96 : 72);
                c2d.fillStyle = '#fff';
                c2d.font = 'bold 34px sans-serif';
                c2d.textAlign = 'center';
                c2d.textBaseline = 'middle';
                c2d.fillText(label, W / 2, H / 2);
                if (sub) {
                    c2d.font = 'bold 16px sans-serif';
                    c2d.fillText(sub, W / 2, H / 2 + 36);
                }
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
            var locked = st.f >= 0;
            buttons.forEach(function (x) { if (x.b.disabled !== locked) x.b.disabled = locked; });       // vardıktan sonra düğmeler pasif
            var endAt = spec.getEndAt ? spec.getEndAt() : 0;
            hudTime.textContent = api.elapsed() < 0 || !endAt ? '' : '⏱ ' + Math.max(0, Math.ceil((endAt - tt) / 1000)) + ' sn';
            hudInfo.textContent = '💥 ' + st.d + ' · satır ' + st.r + '/' + K.GOAL_ROW;
        }
        rafId = raf(frame);

        return {
            destroy: function () {
                if (dead) return;
                dead = true;
                if (rafId !== null) caf(rafId);
                if (doc.removeEventListener) doc.removeEventListener('keydown', onKey);
                buttons.forEach(function (x) { x.b.removeEventListener('pointerdown', x.onDown); });
                rootEl.textContent = '';
            }
        };
    }

    return { mount: mount, keyToDir: keyToDir, approach: approach, countdownLabel: countdownLabel, botColumn: botColumn, CELL: CELL, W: W, H: H };
});
