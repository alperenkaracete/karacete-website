// Kedi - Köpek: iki kişilik, sıra tabanlı atış düellosu. Kurallar ve atış hesabı
// games/catdog-rules.js içindedir (saf, deterministik); ortak protokol core/duel.js,
// ortak arayüz core/duel-ui.js. Bu dosya yalnızca sahneyi çizer, animasyonu oynatır ve
// kontrolleri bağlar. Atış sonucu her iki tarafta da aynı fonksiyonla hesaplandığı için
// ağda yalnızca hamle (cd_shot / cd_heal) gider.
(function () {
    var R = CatDogRules;
    var CHARS = {
        cat: { name: '🐱 Kedi', emoji: '🐱', ammo: '🐟' },
        dog: { name: '🐶 Köpek', emoji: '🐶', ammo: '🦴' }
    };
    var POWER_BUTTONS = [
        { key: 'heal', label: '🧪 Can İksiri', hint: '+25 can, atış yok' },
        { key: 'wind', label: '🎯 Rüzgârsız', hint: 'Rüzgâr 0' },
        { key: 'double', label: '✌️ Çift Atış', hint: '2 atış' },
        { key: 'big', label: '💥 Büyük Patlama', hint: '2x alan' }
    ];

    var ui = null;
    var duel = null;
    var els = null;            // DOM öğeleri
    var ctx2d = null;
    var rafId = null;
    var drawQueued = false;
    var listeners = [];

    var latestView = null;     // Duel'in son görünümü (gerçek durum)
    var round = -1;
    var seenTurn = 0;
    var shown = null;          // ekranda gösterilen: { board, hp:[..], hpAnim:[..] }
    var queue = [];            // oynatılmayı bekleyen hamleler
    var anim = null;           // çalışan animasyon
    var effects = [];
    var aim = { angle: 45, power: 60, powerUp: null };
    var dragging = false;

    function now() { return performance.now(); }

    function listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        listeners.push(function () { target.removeEventListener(type, handler, options); });
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // ---------- Yardımcılar ----------
    function board() { return latestView.board; }

    function nameOfIndex(view, i) {
        if (view.myIndex === i) return view.me.name;
        return view.opponent ? view.opponent.name : '…';
    }

    function markText(index) {
        var b = latestView && latestView.board;
        var p = b && b.players[index];
        return p ? CHARS[p.char].name : '?';
    }

    function busy() { return anim !== null || queue.length > 0; }

    function myTurnNow() {
        return !!latestView && latestView.phase === 'playing' && latestView.myTurn && !busy();
    }

    function myPlayer() {
        return latestView.myIndex >= 0 ? board().players[latestView.myIndex] : null;
    }

    // ---------- Sahne çizimi ----------
    function drawScene(t) {
        var c = ctx2d;
        var W = R.WIDTH;
        var H = R.HEIGHT;
        var b = shown.board;
        var scene = R.generateScene(b.seed);

        var sky = c.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#6ec6ff');
        sky.addColorStop(1, '#d6f0ff');
        c.fillStyle = sky;
        c.fillRect(0, 0, W, H);

        // bulutlar (rüzgâra göre yavaşça kayar)
        var windNow = displayWind();
        c.fillStyle = 'rgba(255,255,255,0.8)';
        for (var i = 0; i < 4; i++) {
            var cx = ((i * 190 + 60 + t * 0.004 * windNow) % (W + 120) + (W + 120)) % (W + 120) - 60;
            var cy = 50 + i * 28;
            [[0, 0, 16], [18, 4, 20], [40, 0, 14]].forEach(function (blob) {
                c.beginPath();
                c.arc(cx + blob[0], cy + blob[1], blob[2], 0, Math.PI * 2);
                c.fill();
            });
        }

        // arazi
        c.beginPath();
        c.moveTo(0, H);
        for (var x = 0; x <= W; x += 4) c.lineTo(x, scene.ground[x]);
        c.lineTo(W, scene.ground[W]);
        c.lineTo(W, H);
        c.closePath();
        var soil = c.createLinearGradient(0, 150, 0, H);
        soil.addColorStop(0, '#8a6a3a');
        soil.addColorStop(1, '#5b4122');
        c.fillStyle = soil;
        c.fill();
        c.beginPath();
        for (var gx = 0; gx <= W; gx += 4) {
            if (gx === 0) c.moveTo(gx, scene.ground[gx]);
            else c.lineTo(gx, scene.ground[gx]);
        }
        c.lineWidth = 7;
        c.strokeStyle = '#5cb85c';
        c.stroke();

        // karakterler
        for (var p = 0; p < 2; p++) {
            var pl = b.players[p];
            var ch = CHARS[pl.char];
            c.font = '34px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'alphabetic';
            var dead = shown.hp[p] <= 0;
            c.globalAlpha = dead ? 0.35 : 1;
            c.fillText(ch.emoji, pl.x, pl.y + 2);
            c.globalAlpha = 1;
            drawHpBar(pl.x, pl.y - 48, shown.hpAnim[p]);
            // sırası olanın üstünde zıplayan ok
            if (latestView.phase === 'playing' && !anim && latestView.turnId !== null) {
                var turnIndex = latestView.turnIndex;
                if (turnIndex === p) {
                    var bounce = Math.sin(t / 180) * 3;
                    c.fillStyle = '#ffd400';
                    c.font = '16px sans-serif';
                    c.fillText('▼', pl.x, pl.y - 56 + bounce);
                }
            }
        }

        drawAimGuide();
        drawProjectile(t);
        drawEffects(t);
    }

    function drawHpBar(x, y, hp) {
        var c = ctx2d;
        var w = 52;
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(x - w / 2 - 1, y - 1, w + 2, 8);
        var frac = Math.max(0, Math.min(1, hp / R.MAX_HP));
        c.fillStyle = frac > 0.5 ? '#4caf50' : (frac > 0.25 ? '#f0ad4e' : '#e74c3c');
        c.fillRect(x - w / 2, y, w * frac, 6);
    }

    function displayWind() {
        if (anim && anim.ev) return anim.ev.last.wind;
        return R.windFor(shown.board.seed, shown.board.turn);
    }

    function muzzleOf(index) {
        var pl = shown.board.players[index];
        return { x: pl.x, y: pl.y - R.MUZZLE_OFFSET };
    }

    function drawAimGuide() {
        if (!myTurnNow() || latestView.myIndex < 0) return;
        var c = ctx2d;
        var m = muzzleOf(latestView.myIndex);
        var rad = aim.angle * Math.PI / 180;
        var len = 24 + aim.power * 0.7;
        var ex = m.x + Math.cos(rad) * len;
        var ey = m.y - Math.sin(rad) * len;
        c.save();
        c.setLineDash([5, 6]);
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(255,255,255,0.95)';
        c.beginPath();
        c.moveTo(m.x, m.y);
        c.lineTo(ex, ey);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(ex, ey, 5, 0, Math.PI * 2);
        c.fill();
        c.restore();
    }

    function drawProjectile(t) {
        if (!anim || anim.stage !== 'flight') return;
        var c = ctx2d;
        var pos = anim.pos;
        var ch = CHARS[shown.board.players[anim.ev.last.shooter].char];
        c.save();
        c.translate(pos.x, pos.y);
        c.rotate(t / 90);
        c.font = '24px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(ch.ammo, 0, 0);
        c.restore();
    }

    function drawEffects(t) {
        var c = ctx2d;
        effects = effects.filter(function (e) { return t - e.born < e.dur; });
        effects.forEach(function (e) {
            var k = (t - e.born) / e.dur;
            if (e.kind === 'boom') {
                c.save();
                c.globalAlpha = 1 - k;
                c.beginPath();
                c.arc(e.x, e.y, e.radius * (0.25 + 0.75 * k), 0, Math.PI * 2);
                c.fillStyle = 'rgba(255,170,40,0.55)';
                c.fill();
                c.lineWidth = 3;
                c.strokeStyle = 'rgba(255,90,20,0.9)';
                c.stroke();
                c.font = '22px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillStyle = '#fff';
                c.fillText('✨', e.x - e.radius * 0.35 * k, e.y - e.radius * 0.35 * k);
                c.fillText('✨', e.x + e.radius * 0.4 * k, e.y - e.radius * 0.2 * k);
                c.fillText('⭐', e.x, e.y - e.radius * 0.5 * k);
                c.restore();
            } else if (e.kind === 'puff') {
                c.save();
                c.globalAlpha = 0.8 * (1 - k);
                c.beginPath();
                c.arc(e.x, e.y, 6 + 10 * k, 0, Math.PI * 2);
                c.fillStyle = '#fff';
                c.fill();
                c.restore();
            } else if (e.kind === 'text') {
                c.save();
                c.globalAlpha = 1 - k * k;
                c.font = 'bold 22px sans-serif';
                c.textAlign = 'center';
                c.lineWidth = 4;
                c.strokeStyle = 'rgba(0,0,0,0.7)';
                c.fillStyle = e.color;
                c.strokeText(e.text, e.x, e.y - 40 * k);
                c.fillText(e.text, e.x, e.y - 40 * k);
                c.restore();
            }
        });
    }

    // ---------- Animasyon ----------
    function trajectoryPosition(traj, p) {
        var f = Math.max(0, Math.min(1, p)) * (traj.length - 1);
        var i = Math.floor(f);
        var j = Math.min(traj.length - 1, i + 1);
        var k = f - i;
        return { x: traj[i][0] + (traj[j][0] - traj[i][0]) * k, y: traj[i][1] + (traj[j][1] - traj[i][1]) * k };
    }

    function startEvent(ev) {
        var last = ev.last;
        anim = { ev: ev, stage: null, t0: now(), shotIndex: 0, pos: { x: 0, y: 0 } };
        if (last.kind === 'heal') {
            var pl = shown.board.players[last.shooter];
            shown.hp[last.shooter] = Math.min(R.MAX_HP, shown.hp[last.shooter] + last.healed);
            effects.push({ kind: 'text', x: pl.x, y: pl.y - 50, text: '+' + last.healed + ' ❤️', color: '#7CFC8A', born: now(), dur: 1000 });
            anim.stage = 'wait';
            anim.until = now() + 1000;
        } else {
            beginShot();
        }
        renderControls();
        scheduleLoop();
    }

    function beginShot() {
        var shot = anim.ev.last.shots[anim.shotIndex];
        anim.stage = 'flight';
        anim.t0 = now();
        anim.dur = Math.max(500, Math.min(2600, shot.frames * R.DT * 1000));
        anim.pos = trajectoryPosition(shot.trajectory, 0);
    }

    function tick(t) {
        rafId = null;
        if (anim) {
            var last = anim.ev.last;
            if (anim.stage === 'flight') {
                var shot = last.shots[anim.shotIndex];
                var p = (t - anim.t0) / anim.dur;
                anim.pos = trajectoryPosition(shot.trajectory, p);
                if (p >= 1) {
                    var end = shot.end;
                    var target = 1 - last.shooter;
                    if (end.reason === 'out') {
                        effects.push({ kind: 'puff', x: Math.max(8, Math.min(R.WIDTH - 8, end.x)), y: Math.min(end.y, R.HEIGHT - 8), born: t, dur: 400 });
                    } else {
                        effects.push({ kind: 'boom', x: end.x, y: end.y, radius: shot.hit === 'direct' ? 40 : shot.blastRadius, born: t, dur: 550 });
                    }
                    if (shot.damage > 0) {
                        var tp = shown.board.players[target];
                        shown.hp[target] = shot.hpAfter[target];
                        effects.push({ kind: 'text', x: tp.x, y: tp.y - 50, text: '-' + shot.damage, color: '#ff6b6b', born: t, dur: 900 });
                    }
                    anim.stage = 'wait';
                    anim.until = t + (anim.shotIndex + 1 < last.shots.length ? 650 : 700);
                }
            } else if (anim.stage === 'wait' && t >= anim.until) {
                if (last.kind === 'shot' && anim.shotIndex + 1 < last.shots.length) {
                    anim.shotIndex++;
                    beginShot();
                } else {
                    finishEvent();
                }
            }
        }
        // can çubuklarını yumuşakça hedefe yaklaştır
        var moving = false;
        for (var i = 0; i < 2; i++) {
            var diff = shown.hp[i] - shown.hpAnim[i];
            if (Math.abs(diff) > 0.1) {
                shown.hpAnim[i] += Math.sign(diff) * Math.min(Math.abs(diff), 1.6);
                moving = true;
            } else {
                shown.hpAnim[i] = shown.hp[i];
            }
        }
        if (anim) renderHud();
        drawScene(t);
        // Animasyon, efekt ya da oyun sürerken (zıplayan ok) döngü devam eder; bitince durur.
        if (anim || effects.length || moving || (latestView && latestView.phase === 'playing')) scheduleLoop();
    }

    function finishEvent() {
        var ev = anim.ev;
        anim = null;
        shown.board = ev.board;
        shown.hp = ev.board.players.map(function (pl) { return pl.hp; });
        if (queue.length) {
            startEvent(queue.shift());
            return;
        }
        // sıra sende: seçili güç artık bekleme süresindeyse seçimi kaldır
        var me = myPlayer();
        if (me && aim.powerUp && me.cd[aim.powerUp] > 0) aim.powerUp = null;
        ui.update(latestView, markText);
        renderHud();
        renderControls();
    }

    function scheduleLoop() {
        if (rafId === null) rafId = requestAnimationFrame(tick);
    }

    function requestDraw() {
        if (drawQueued || rafId !== null) return;
        drawQueued = true;
        requestAnimationFrame(function (t) {
            drawQueued = false;
            if (shown) drawScene(t);
        });
    }

    // ---------- HUD ve kontroller ----------
    function renderHud() {
        var view = latestView;
        var b = shown.board;
        for (var i = 0; i < 2; i++) {
            var pl = b.players[i];
            var box = els.hud[pl.char];
            box.name.textContent = CHARS[pl.char].emoji + ' ' + nameOfIndex(view, i) + (view.myIndex === i ? ' (sen)' : '');
            box.hp.textContent = String(shown.hp[i]);
            box.fill.style.width = Math.max(0, Math.min(100, shown.hp[i])) + '%';
            box.fill.className = 'cd-hp-fill' + (shown.hp[i] <= 25 ? ' low' : (shown.hp[i] <= 50 ? ' mid' : ''));
            box.root.classList.toggle('active', view.phase === 'playing' && view.turnIndex === i);
        }
        var w = displayWind();
        els.windArrow.textContent = w === 0 ? '•' : (w > 0 ? '→' : '←');
        els.windValue.textContent = String(Math.abs(w));
        els.windBar.style.width = (Math.abs(w) / R.WIND_MAX * 50) + '%';
        els.windBar.style.left = w >= 0 ? '50%' : (50 - Math.abs(w) / R.WIND_MAX * 50) + '%';
    }

    function renderControls() {
        if (!latestView) return;
        var enabled = myTurnNow();
        var me = myPlayer();
        els.angle.disabled = !enabled;
        els.power.disabled = !enabled;
        els.angle.value = String(aim.angle);
        els.power.value = String(aim.power);
        els.angleOut.textContent = aim.angle + '°';
        els.powerOut.textContent = String(aim.power);
        els.fire.disabled = !enabled;
        POWER_BUTTONS.forEach(function (def) {
            var btn = els.powers[def.key];
            var left = me ? me.cd[def.key] : 0;
            var cooling = left > 0;
            btn.disabled = !enabled || cooling;
            btn.classList.toggle('cooling', cooling);
            btn.classList.toggle('selected', aim.powerUp === def.key);
            btn.setAttribute('aria-pressed', aim.powerUp === def.key ? 'true' : 'false');
            btn.querySelector('.cd-power-note').textContent = cooling ? left + ' tur bekle' : def.hint;
        });
        els.cancel.style.display = aim.powerUp ? '' : 'none';
        els.fire.textContent = aim.powerUp === 'wind' ? 'Fırlat! (rüzgâr 0)' : (aim.powerUp === 'double' ? 'Fırlat! ×2' : (aim.powerUp === 'big' ? 'Fırlat! 💥' : 'Fırlat!'));
        els.hint.textContent = enabled
            ? 'Açı ve gücü kaydırıcılarla ya da sahnede sürükleyerek ayarla.'
            : (anim ? '' : 'Rakibin sırası…');
    }

    function fire() {
        if (!myTurnNow()) return;
        var b = board();
        var ok = duel.move({ kind: 'shot', turn: b.turn, angle: aim.angle, power: aim.power, powerUp: aim.powerUp });
        if (ok) aim.powerUp = null;
    }

    function heal() {
        if (!myTurnNow()) return;
        duel.move({ kind: 'heal', turn: board().turn });
    }

    function pointerAim(e) {
        if (!myTurnNow()) return;
        var rect = els.canvas.getBoundingClientRect();
        var lx = (e.clientX - rect.left) * (R.WIDTH / rect.width);
        var ly = (e.clientY - rect.top) * (R.HEIGHT / rect.height);
        var m = muzzleOf(latestView.myIndex);
        var dx = lx - m.x;
        var dy = m.y - ly;      // yukarı pozitif
        var angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
        if (angle < 0) angle = dx >= 0 ? 0 : 180;   // zeminin altına çekilirse en yakın yatay yön
        angle = Math.max(0, Math.min(180, angle));
        var dist = Math.sqrt(dx * dx + dy * dy);
        aim.angle = angle;
        aim.power = Math.max(0, Math.min(100, Math.round(dist / 1.6)));
        renderControls();
        requestDraw();
    }

    // ---------- Duel olayları ----------
    function resetRound(view) {
        round = view.round;
        queue = [];
        anim = null;
        effects = [];
        seenTurn = view.board.turn;
        shown = {
            board: view.board,
            hp: view.board.players.map(function (pl) { return pl.hp; }),
            hpAnim: view.board.players.map(function (pl) { return pl.hp; })
        };
        var me = view.myIndex >= 0 ? view.board.players[view.myIndex] : null;
        aim = { angle: me && me.char === 'dog' ? 135 : 45, power: 60, powerUp: null };
    }

    function onChange(view) {
        latestView = view;
        if (!shown || view.round !== round) {
            resetRound(view);
        } else if (view.board.turn > seenTurn && view.board.last) {
            seenTurn = view.board.turn;
            queue.push({ board: view.board, last: view.board.last });
        }
        if (!anim && queue.length) {
            startEvent(queue.shift());
            return;
        }
        if (!busy()) {
            ui.update(view, markText);
            renderHud();
            renderControls();
            scheduleLoop();
        } else {
            renderControls();
        }
    }

    // ---------- Kurulum ----------
    function buildDom(root) {
        var wrap = el('div', 'cd-wrap');

        var hud = el('div', 'cd-hud');
        function hudBox(char) {
            var box = el('div', 'cd-hud-box ' + char);
            var name = el('span', 'cd-hud-name');
            var bar = el('div', 'cd-hp');
            var fill = el('div', 'cd-hp-fill');
            bar.appendChild(fill);
            var hp = el('strong', 'cd-hud-hp');
            box.append(name, bar, hp);
            return { root: box, name: name, fill: fill, hp: hp };
        }
        var catBox = hudBox('cat');
        var dogBox = hudBox('dog');
        var wind = el('div', 'cd-wind');
        wind.setAttribute('aria-label', 'Rüzgâr');
        var windTitle = el('small', '', 'Rüzgâr');
        var windMain = el('div', 'cd-wind-main');
        var windArrow = el('span', 'cd-wind-arrow', '•');
        var windValue = el('strong', 'cd-wind-value', '0');
        windMain.append(windArrow, windValue);
        var windTrack = el('div', 'cd-wind-track');
        var windBar = el('div', 'cd-wind-bar');
        windTrack.appendChild(windBar);
        wind.append(windTitle, windMain, windTrack);
        hud.append(catBox.root, wind, dogBox.root);

        var canvas = document.createElement('canvas');
        canvas.className = 'cd-canvas';
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = R.WIDTH * dpr;
        canvas.height = R.HEIGHT * dpr;

        var controls = el('div', 'cd-controls');
        function slider(label, min, max, value) {
            var row = el('label', 'cd-slider');
            var title = el('span', 'cd-slider-label', label);
            var out = el('output', 'cd-slider-out');
            var input = document.createElement('input');
            input.type = 'range';
            input.min = String(min);
            input.max = String(max);
            input.step = '1';
            input.value = String(value);
            row.append(title, input, out);
            return { row: row, input: input, out: out };
        }
        var angleS = slider('Açı', 0, 180, 45);
        var powerS = slider('Güç', 0, 100, 60);

        var powersRow = el('div', 'cd-powers');
        var powerBtns = {};
        POWER_BUTTONS.forEach(function (def) {
            var btn = el('button', 'cd-power');
            btn.type = 'button';
            btn.append(el('span', 'cd-power-label', def.label), el('small', 'cd-power-note', def.hint));
            powerBtns[def.key] = btn;
            powersRow.appendChild(btn);
        });
        var cancel = el('button', 'cd-cancel', 'Seçili gücü iptal et');
        cancel.type = 'button';
        var fireBtn = el('button', 'cd-fire', 'Fırlat!');
        fireBtn.type = 'button';
        var hint = el('p', 'cd-hint');

        controls.append(angleS.row, powerS.row, powersRow, cancel, fireBtn, hint);
        wrap.append(hud, canvas, controls);
        root.appendChild(wrap);

        return {
            hud: { cat: catBox, dog: dogBox },
            windArrow: windArrow, windValue: windValue, windBar: windBar,
            canvas: canvas,
            angle: angleS.input, angleOut: angleS.out,
            power: powerS.input, powerOut: powerS.out,
            powers: powerBtns, cancel: cancel, fire: fireBtn, hint: hint,
            dpr: dpr
        };
    }

    function init(ctx) {
        ui = DuelUI.mount(ctx.root, {
            title: 'Kedi - Köpek',
            className: 'duel-wide',
            onRematch: function () { duel.rematch(); },
            onLeave: function () { ctx.leave(); }
        });
        els = buildDom(ui.boardEl);
        ui.boardEl.classList.add('cd-board');
        ctx2d = els.canvas.getContext('2d');
        ctx2d.setTransform(els.dpr, 0, 0, els.dpr, 0, 0);

        latestView = null;
        shown = null;
        round = -1;
        queue = [];
        anim = null;
        effects = [];
        dragging = false;

        listen(els.angle, 'input', function () {
            aim.angle = parseInt(els.angle.value, 10);
            renderControls();
            requestDraw();
        });
        listen(els.power, 'input', function () {
            aim.power = parseInt(els.power.value, 10);
            renderControls();
            requestDraw();
        });
        POWER_BUTTONS.forEach(function (def) {
            listen(els.powers[def.key], 'click', function () {
                if (!myTurnNow()) return;
                if (def.key === 'heal') {
                    heal();
                    return;
                }
                aim.powerUp = aim.powerUp === def.key ? null : def.key;
                renderControls();
            });
        });
        listen(els.cancel, 'click', function () {
            aim.powerUp = null;
            renderControls();
        });
        listen(els.fire, 'click', fire);

        listen(els.canvas, 'pointerdown', function (e) {
            if (!myTurnNow()) return;
            dragging = true;
            try { els.canvas.setPointerCapture(e.pointerId); } catch (err) { /* yoksay */ }
            pointerAim(e);
            e.preventDefault();
        });
        listen(els.canvas, 'pointermove', function (e) {
            if (dragging) pointerAim(e);
        });
        var stopDrag = function () { dragging = false; };
        listen(els.canvas, 'pointerup', stopDrag);
        listen(els.canvas, 'pointercancel', stopDrag);

        duel = Duel.create({ prefix: 'cd', rules: R, ctx: ctx, onChange: onChange });
        duel.start();
    }

    function onMessage(data) {
        if (duel) duel.onMessage(data);
    }

    function destroy() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        drawQueued = false;
        listeners.forEach(function (off) { off(); });
        listeners = [];
        if (ui) ui.destroy();
        ui = null;
        duel = null;
        els = null;
        ctx2d = null;
        latestView = null;
        shown = null;
        queue = [];
        anim = null;
        effects = [];
    }

    Games.register({
        id: 'catdog',
        name: 'Kedi - Köpek',
        icon: '🐱',
        tagline: '2 oyuncu · atış düellosu',
        maxPlayers: 2,
        init: init,
        onMessage: onMessage,
        destroy: destroy
    });
})();
