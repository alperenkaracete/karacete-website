// Parti düello izleme: oynamayanların (ve maçı bitenlerin) görmesi için salt-okunur, kompakt tahta anlık görüntüsü.
// DOM'suz çekirdek (Node'da test edilir) + küçük DOM çizici. Oyun dosyalarına/çekirdeğe dokunmaz:
//   lider (zaten çalışan hakemlerden)  snapshot(game, st, rules)  -> kompakt nesne (pm[i].wb, pt_state ile yayınlanır)
//   alıcı (makine)                     sanitize(raw)              -> doğrulanmış nesne | null (asla oyunu bozmaz)
//   arayüz                             render(doc, snap, names)   -> DOM düğümü (yalnız textContent; salt-okunur)
//
// st = { order:[ilk, ikinci], turn, board, result:{ranking,reason}|null, shots:[n,n] }  (hakem durumu)
// Anlık görüntü:
//   XOX / Dörtlü  { g, b:[-1|0|1 …(9|42)], o:[id,id], t, r }          r: -1 sürüyor | 0/1 kazanan indeks | 2 beraberlik
//   Kedi-Köpek    { g, c:[char,char], hp:[a,b], o, t, r, wind, sh:[n,n], last:null|{s,k,u,h,d,a,p},
//                   sd (tohum), tn (hamle no), shots:[{ p:[x,y,...] (≤80 nokta), fr (kare), e:[x,y], h, d, r, hp:[a,b] }] (son atış yörüngeleri) }
//                 Sahne tohumdan (rules.generateScene) çizilir; son atış yörüngesi izleyicide yeniden oynatılır (createScene).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiDuelWatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var GAMES = { xox: 9, connect4: 42, catdog: 0 };
    var CD_EMOJI = { cat: '🐱', dog: '🐶' };
    var POWER_TEXT = { wind: '🎯', double: '✌️', big: '💥', guide: '🧭' };
    var COLS = 7;

    function resultIndex(st) {
        var res = st && st.result;
        if (!res || !res.ranking || !res.ranking.length) return -1;
        if (res.ranking.length === 1 && res.ranking[0].length > 1) return 2;      // beraberlik
        var w = res.ranking[0][0];
        var i = st.order ? st.order.indexOf(w) : -1;
        return i < 0 ? 2 : i;
    }

    function ids(st) {
        var o = (st && st.order) || [];
        return [typeof o[0] === 'string' ? o[0] : '', typeof o[1] === 'string' ? o[1] : ''];
    }

    function hitRank(h) { return h === 'direct' ? 2 : (h === 'area' ? 1 : 0); }

    // Kedi - Köpek son hamle özeti: shots -> en iyi isabet türü + toplam hasar
    function lastSummary(last) {
        if (!last) return null;
        if (last.kind === 'heal') return { s: last.shooter, k: 'h', u: '', h: '', d: last.healed | 0, a: 0, p: 0 };
        var hit = 'none';
        var dmg = 0;
        (last.shots || []).forEach(function (sh) {
            dmg += sh.damage | 0;
            if (hitRank(sh.hit) > hitRank(hit)) hit = sh.hit;
        });
        return { s: last.shooter, k: 's', u: last.powerUp || '', h: hit, d: dmg, a: last.angle | 0, p: last.power | 0 };
    }

    // Son atışın yörüngeleri (izleyicide animasyon için). Kompakt: tamsayı noktalar, en çok MAX_POINTS.
    var MAX_POINTS = 80;
    function shotsOf(last) {
        if (!last || last.kind !== 'shot' || !last.shots) return [];
        return last.shots.slice(0, 2).map(function (sh) {
            var traj = sh.trajectory || [];
            var stride = Math.max(1, Math.ceil(traj.length / MAX_POINTS));
            var p = [];
            for (var i = 0; i < traj.length; i += stride) { p.push(Math.round(traj[i][0]), Math.round(traj[i][1])); }
            var lastPt = traj[traj.length - 1];
            if (lastPt && (traj.length - 1) % stride !== 0) p.push(Math.round(lastPt[0]), Math.round(lastPt[1]));
            var end = sh.end || {};
            return {
                p: p, fr: Math.max(0, Math.min(1200, sh.frames | 0)), e: [Math.round(end.x || 0), Math.round(end.y || 0)],
                h: sh.hit === 'direct' || sh.hit === 'area' ? sh.hit : 'none', d: Math.max(0, Math.min(100, sh.damage | 0)),
                r: Math.max(0, Math.min(200, Math.round(sh.blastRadius || 0))),
                hp: (sh.hpAfter || [0, 0]).map(function (v) { return Math.max(0, Math.min(100, v | 0)); })
            };
        });
    }

    function snapshot(game, st, rules) {
        if (!st || !st.board || !Object.prototype.hasOwnProperty.call(GAMES, game)) return null;
        var base = { g: game, o: ids(st), t: st.turn === 1 ? 1 : 0, r: resultIndex(st) };
        if (game === 'catdog') {
            var b = st.board;
            if (!b.players || b.players.length !== 2) return null;
            base.c = b.players.map(function (p) { return p.char === 'dog' ? 'dog' : 'cat'; });
            base.hp = b.players.map(function (p) { return Math.max(0, Math.min(100, p.hp | 0)); });
            base.wind = rules && rules.windFor ? rules.windFor(b.seed, b.turn) : 0;
            base.sh = [(st.shots && st.shots[0]) | 0, (st.shots && st.shots[1]) | 0];
            base.last = lastSummary(b.last);
            base.sd = (b.seed >>> 0);
            base.tn = b.turn | 0;
            base.shots = shotsOf(b.last);
            return base;
        }
        if (!Array.isArray(st.board) || st.board.length !== GAMES[game]) return null;
        base.b = st.board.map(function (v) { return v === 0 || v === 1 ? v : -1; });
        return base;
    }

    function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }
    function isId(x) { return typeof x === 'string' && x.length <= 24; }

    function cleanShot(sh) {
        if (!sh || typeof sh !== 'object' || !Array.isArray(sh.p) || sh.p.length < 4 || sh.p.length > 2 * (MAX_POINTS + 2) || sh.p.length % 2) return null;
        for (var i = 0; i < sh.p.length; i++) if (!isInt(sh.p[i], -3000, 3000)) return null;
        if (!isInt(sh.fr, 0, 1200) || !Array.isArray(sh.e) || sh.e.length !== 2 || !isInt(sh.e[0], -3000, 3000) || !isInt(sh.e[1], -3000, 3000)) return null;
        if (sh.h !== 'none' && sh.h !== 'area' && sh.h !== 'direct') return null;
        if (!isInt(sh.d, 0, 100) || !isInt(sh.r, 0, 200) || !Array.isArray(sh.hp) || sh.hp.length !== 2 || !isInt(sh.hp[0], 0, 100) || !isInt(sh.hp[1], 0, 100)) return null;
        return { p: sh.p.slice(), fr: sh.fr, e: sh.e.slice(), h: sh.h, d: sh.d, r: sh.r, hp: sh.hp.slice() };
    }

    // Gelen (güvenilmeyen) anlık görüntü -> temiz kopya ya da null
    function sanitize(raw) {
        if (!raw || typeof raw !== 'object' || !Object.prototype.hasOwnProperty.call(GAMES, raw.g)) return null;
        if (!Array.isArray(raw.o) || raw.o.length !== 2 || !isId(raw.o[0]) || !isId(raw.o[1])) return null;
        if (!isInt(raw.t, 0, 1) || !isInt(raw.r, -1, 2)) return null;
        var out = { g: raw.g, o: [raw.o[0], raw.o[1]], t: raw.t, r: raw.r };
        if (raw.g === 'catdog') {
            if (!Array.isArray(raw.c) || raw.c.length !== 2 || !Array.isArray(raw.hp) || raw.hp.length !== 2 || !Array.isArray(raw.sh) || raw.sh.length !== 2) return null;
            for (var i = 0; i < 2; i++) {
                if (raw.c[i] !== 'cat' && raw.c[i] !== 'dog') return null;
                if (!isInt(raw.hp[i], 0, 100) || !isInt(raw.sh[i], 0, 1000)) return null;
            }
            if (!isInt(raw.wind, -10, 10)) return null;
            out.c = raw.c.slice(); out.hp = raw.hp.slice(); out.sh = raw.sh.slice(); out.wind = raw.wind;
            out.sd = isInt(raw.sd, 0, 4294967295) ? raw.sd : null;       // eski lider: yok -> sahne yerine metin/can çubuğu
            out.tn = isInt(raw.tn, 0, 100000) ? raw.tn : 0;
            out.shots = [];
            if (Array.isArray(raw.shots)) {
                if (raw.shots.length > 2) return null;
                for (var si = 0; si < raw.shots.length; si++) {
                    var sh = cleanShot(raw.shots[si]);
                    if (!sh) return null;
                    out.shots.push(sh);
                }
            }
            out.last = null;
            var l = raw.last;
            if (l && typeof l === 'object') {
                if (!isInt(l.s, 0, 1) || (l.k !== 's' && l.k !== 'h') || typeof l.u !== 'string' || l.u.length > 8 ||
                    (l.h !== '' && l.h !== 'none' && l.h !== 'area' && l.h !== 'direct') || !isInt(l.d, 0, 400) || !isInt(l.a, 0, 180) || !isInt(l.p, 0, 100)) return null;
                out.last = { s: l.s, k: l.k, u: l.u, h: l.h, d: l.d, a: l.a, p: l.p };
            }
            return out;
        }
        if (!Array.isArray(raw.b) || raw.b.length !== GAMES[raw.g]) return null;
        for (var j = 0; j < raw.b.length; j++) if (!isInt(raw.b[j], -1, 1)) return null;
        out.b = raw.b.slice();
        return out;
    }

    // ---- Çizim (salt-okunur DOM) ----
    function make(doc, tag, cls, text) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function nameOf(names, id) { return (names && names[id]) || id || '?'; }

    function header(doc, snap, names, marks) {
        var h = make(doc, 'div', 'pt-watch-head');
        for (var i = 0; i < 2; i++) {
            var cls = 'pt-watch-who' + (snap.r === -1 && snap.t === i ? ' turn' : '') + (snap.r === i ? ' win' : '');
            h.appendChild(make(doc, 'span', cls, marks[i] + ' ' + nameOf(names, snap.o[i])));
        }
        return h;
    }

    function resultLine(doc, snap, names) {
        if (snap.r === -1) return null;
        return make(doc, 'div', 'pt-watch-result', snap.r === 2 ? '🤝 Beraberlik' : '🏆 ' + nameOf(names, snap.o[snap.r]) + ' kazandı');
    }

    function renderGrid(doc, snap, names) {
        var wrap = make(doc, 'div', 'pt-watch pt-watch-' + snap.g);
        var marks = snap.g === 'xox' ? ['X', 'O'] : ['🔴', '🟡'];
        wrap.appendChild(header(doc, snap, names, marks));
        var cols = snap.g === 'xox' ? 3 : COLS;
        var grid = make(doc, 'div', 'pt-watch-grid cols' + cols);
        snap.b.forEach(function (v) {
            var text = v < 0 ? '' : (snap.g === 'xox' ? marks[v] : '●');
            grid.appendChild(make(doc, 'span', 'pt-watch-cell' + (v < 0 ? '' : ' p' + v), text));
        });
        wrap.appendChild(grid);
        var res = resultLine(doc, snap, names);
        if (res) wrap.appendChild(res);
        return wrap;
    }

    function lastText(snap, names) {
        var l = snap.last;
        if (!l) return 'Henüz atış yok';
        var who = nameOf(names, snap.o[l.s]);
        if (l.k === 'h') return who + ': 🧪 can iksiri +' + l.d;
        var res = l.h === 'direct' ? '💥 isabet −' + l.d : (l.h === 'area' ? '💨 sıyırdı −' + l.d : '❌ ıskaladı');
        return who + ': ' + l.a + '° / ' + l.p + (l.u && POWER_TEXT[l.u] ? ' ' + POWER_TEXT[l.u] : '') + ' · ' + res;
    }

    // opts.scene: createScene denetleyicisi (kalıcı kanvas; arayüz yeniden çizilse de animasyon sürer). Varsa can çubukları kanvastadır.
    function renderCatdog(doc, snap, names, opts) {
        var wrap = make(doc, 'div', 'pt-watch pt-watch-catdog');
        wrap.appendChild(header(doc, snap, names, [CD_EMOJI[snap.c[0]], CD_EMOJI[snap.c[1]]]));
        var scene = opts && opts.scene && snap.sd !== null && snap.sd !== undefined ? opts.scene : null;
        if (scene) {
            scene.update(snap);
            wrap.appendChild(scene.el);
        }
        var bars = make(doc, 'div', 'pt-watch-bars');
        for (var i = 0; !scene && i < 2; i++) {
            var bar = make(doc, 'div', 'pt-watch-bar');
            var fill = make(doc, 'span', 'pt-watch-fill' + (snap.hp[i] <= 25 ? ' low' : (snap.hp[i] <= 50 ? ' mid' : '')));
            if (fill.style) fill.style.width = snap.hp[i] + '%';
            bar.appendChild(fill);
            bar.appendChild(make(doc, 'small', '', String(snap.hp[i])));
            bars.appendChild(bar);
        }
        if (!scene) wrap.appendChild(bars);
        var wind = snap.wind === 0 ? 'Rüzgâr yok' : 'Rüzgâr ' + (snap.wind > 0 ? '→' : '←') + ' ' + Math.abs(snap.wind);
        wrap.appendChild(make(doc, 'div', 'pt-watch-info', lastText(snap, names)));
        wrap.appendChild(make(doc, 'div', 'pt-watch-info dim', wind + ' · atış ' + snap.sh[0] + '/' + snap.sh[1]));
        var res = resultLine(doc, snap, names);
        if (res) wrap.appendChild(res);
        return wrap;
    }

    function render(doc, snap, names, opts) {
        if (!snap) return null;
        return snap.g === 'catdog' ? renderCatdog(doc, snap, names, opts) : renderGrid(doc, snap, names);
    }

    // ---- Kedi - Köpek canlı sahne (izleyici) ----
    // Model (saf): tohumdan sahne + hamle sırasıyla oynatılan atış animasyonları. catdog.js ile AYNI süreler:
    // mermi başına clamp(kare/60 sn, 0,5-2,6 sn), mermiler arası 650 ms, son mermiden sonra 700 ms; can çubuğu çarpma anında düşer.
    var DT_MS = 1000 / 60;
    var FLIGHT_MIN = 500;
    var FLIGHT_MAX = 2600;
    var BETWEEN_MS = 650;
    var TAIL_MS = 700;
    var BOOM_MS = 550;
    var TEXT_MS = 900;

    function flightMs(shot) { return Math.max(FLIGHT_MIN, Math.min(FLIGHT_MAX, shot.fr * DT_MS)); }

    function createModel(rules) {
        var m = { seed: null, scene: null, hp: [100, 100], target: [100, 100], c: ['cat', 'dog'], r: -1, queue: [], anim: null, effects: [], clock: 0, lastTn: -1 };

        function startNext() {
            m.anim = null;
            if (!m.queue.length) { m.hp = m.target.slice(); return; }
            var ev = m.queue.shift();
            m.anim = { ev: ev, i: 0, stage: 'flight', t0: m.clock, dur: flightMs(ev.shots[0]) };
        }

        function update(snap) {
            if (!snap || snap.g !== 'catdog' || snap.sd === null || snap.sd === undefined) return;
            if (snap.sd !== m.seed) {
                // yeni maç (ya da ilk görüş): animasyon yok, doğrudan mevcut durum
                m.seed = snap.sd;
                m.scene = rules.generateScene(snap.sd);
                m.queue = []; m.anim = null; m.effects = [];
                m.lastTn = snap.tn;
                m.hp = snap.hp.slice();
            } else if (snap.tn !== m.lastTn) {
                m.lastTn = snap.tn;
                if (snap.shots && snap.shots.length && snap.last) m.queue.push({ shooter: snap.last.s, shots: snap.shots });
            }
            m.c = snap.c.slice();
            m.target = snap.hp.slice();
            m.r = snap.r;
            if (!m.anim && !m.queue.length) m.hp = m.target.slice();
            else if (!m.anim) startNext();
        }

        function positionAt(shot, p) {
            var pts = shot.p;
            var n = pts.length / 2 - 1;
            var f = Math.max(0, Math.min(1, p)) * n;
            var i = Math.min(n - 1, Math.floor(f));
            var k = f - i;
            return { x: pts[2 * i] + (pts[2 * i + 2] - pts[2 * i]) * k, y: pts[2 * i + 1] + (pts[2 * i + 3] - pts[2 * i + 1]) * k };
        }

        function advance(dtMs) {
            m.clock += Math.max(0, Math.min(100, dtMs));
            var a = m.anim;
            if (a) {
                var shot = a.ev.shots[a.i];
                if (a.stage === 'flight' && m.clock - a.t0 >= a.dur) {
                    var tgt = 1 - a.ev.shooter;
                    var tp = m.scene ? m.scene[m.c[tgt]] : { x: shot.e[0], y: shot.e[1] };
                    m.effects.push({ kind: 'boom', x: shot.e[0], y: shot.e[1], radius: shot.h === 'direct' ? 40 : (shot.r || 40), born: m.clock });
                    if (shot.d > 0) m.effects.push({ kind: 'text', x: tp.x, y: tp.y - 50, text: '-' + shot.d, born: m.clock });
                    m.hp = shot.hp.slice();
                    a.stage = 'wait';
                    a.t0 = m.clock;
                    a.dur = a.i + 1 < a.ev.shots.length ? BETWEEN_MS : TAIL_MS;
                } else if (a.stage === 'wait' && m.clock - a.t0 >= a.dur) {
                    if (a.i + 1 < a.ev.shots.length) {
                        a.i++; a.stage = 'flight'; a.t0 = m.clock; a.dur = flightMs(a.ev.shots[a.i]);
                    } else {
                        startNext();
                    }
                }
            }
            m.effects = m.effects.filter(function (e) { return m.clock - e.born < (e.kind === 'boom' ? BOOM_MS : TEXT_MS); });
        }

        // Çizim için kare durumu
        function frame() {
            var proj = null;
            var a = m.anim;
            if (a && a.stage === 'flight') {
                var shot = a.ev.shots[a.i];
                var pos = positionAt(shot, (m.clock - a.t0) / a.dur);
                proj = { x: pos.x, y: pos.y, char: m.c[a.ev.shooter] };
            }
            var fx = m.effects.map(function (e) {
                return { kind: e.kind, x: e.x, y: e.y, radius: e.radius, text: e.text, k: (m.clock - e.born) / (e.kind === 'boom' ? BOOM_MS : TEXT_MS) };
            });
            return { scene: m.scene, hp: m.hp.slice(), c: m.c.slice(), r: m.r, proj: proj, effects: fx, busy: !!m.anim || m.effects.length > 0 };
        }

        return { update: update, advance: advance, frame: frame, state: function () { return m; } };
    }

    var AMMO = { cat: '🐟', dog: '🦴' };
    var SW = 640;
    var SH = 400;

    // Kanvasa çizim (catdog.js drawScene'in sadeleştirilmiş hali). emoji: core/emoji.js (düz fillStyle: iPhone Safari uyumu)
    function paintScene(c, fr, emoji) {
        var scene = fr.scene;
        if (!scene) return;
        var sky = c.createLinearGradient(0, 0, 0, SH);
        sky.addColorStop(0, '#6ec6ff');
        sky.addColorStop(1, '#d6f0ff');
        c.fillStyle = sky;
        c.fillRect(0, 0, SW, SH);
        c.beginPath();
        c.moveTo(0, SH);
        for (var x = 0; x <= SW; x += 4) c.lineTo(x, scene.ground[x]);
        c.lineTo(SW, scene.ground[SW]);
        c.lineTo(SW, SH);
        c.closePath();
        var soil = c.createLinearGradient(0, 150, 0, SH);
        soil.addColorStop(0, '#8a6a3a');
        soil.addColorStop(1, '#5b4122');
        c.fillStyle = soil;
        c.fill();
        c.beginPath();
        for (var gx = 0; gx <= SW; gx += 4) { if (gx === 0) c.moveTo(gx, scene.ground[gx]); else c.lineTo(gx, scene.ground[gx]); }
        c.lineWidth = 7;
        c.strokeStyle = '#5cb85c';
        c.stroke();
        for (var i = 0; i < 2; i++) {
            var ch = fr.c[i];
            var pos = scene[ch];
            var dead = fr.hp[i] <= 0;
            c.globalAlpha = dead ? 0.2 : 0.38;
            c.fillStyle = '#ffffff';
            c.beginPath();
            c.arc(pos.x, pos.y - 14, 23, 0, Math.PI * 2);
            c.fill();
            c.globalAlpha = 1;
            emoji.draw(c, CD_EMOJI[ch], pos.x, pos.y + 2, 36, { alpha: dead ? 0.35 : 1 });
            var frac = Math.max(0, Math.min(1, fr.hp[i] / 100));
            c.fillStyle = 'rgba(0,0,0,0.55)';
            c.fillRect(pos.x - 27, pos.y - 49, 54, 8);
            c.fillStyle = frac > 0.5 ? '#4caf50' : (frac > 0.25 ? '#f0ad4e' : '#e74c3c');
            c.fillRect(pos.x - 26, pos.y - 48, 52 * frac, 6);
        }
        if (fr.proj) emoji.draw(c, AMMO[fr.proj.char] || '🐟', fr.proj.x, fr.proj.y, 24, { baseline: 'middle' });
        fr.effects.forEach(function (e) {
            c.save();
            if (e.kind === 'boom') {
                c.globalAlpha = 1 - e.k;
                c.beginPath();
                c.arc(e.x, e.y, e.radius * (0.25 + 0.75 * e.k), 0, Math.PI * 2);
                c.fillStyle = 'rgba(255,170,40,0.55)';
                c.fill();
                c.lineWidth = 3;
                c.strokeStyle = 'rgba(255,90,20,0.9)';
                c.stroke();
            } else {
                c.globalAlpha = 1 - e.k * e.k;
                c.font = 'bold 22px sans-serif';
                c.textAlign = 'center';
                c.lineWidth = 4;
                c.strokeStyle = 'rgba(0,0,0,0.7)';
                c.fillStyle = '#ff6b6b';
                c.strokeText(e.text, e.x, e.y - 40 * e.k);
                c.fillText(e.text, e.x, e.y - 40 * e.k);
            }
            c.restore();
        });
    }

    // Kalıcı sahne denetleyicisi: el (kanvas) arayüz yeniden çizilse de aynı kalır; tick(tMs) her karede çağrılır.
    function createScene(doc, rules, emoji) {
        var model = createModel(rules);
        var el = doc.createElement('canvas');
        el.className = 'pt-watch-canvas';
        el.width = SW;
        el.height = SH;
        var c2d = el.getContext ? el.getContext('2d') : null;
        var lastT = 0;
        var dirty = true;
        return {
            el: el,
            update: function (snap) { model.update(snap); dirty = true; },
            tick: function (t) {
                var dt = lastT ? Math.min(100, t - lastT) : 16;
                lastT = t;
                model.advance(dt);
                var fr = model.frame();
                if ((fr.busy || dirty) && c2d && fr.scene) { paintScene(c2d, fr, emoji); dirty = false; }
            },
            model: model
        };
    }


    return { snapshot: snapshot, sanitize: sanitize, render: render, lastText: lastText, createModel: createModel, createScene: createScene, paintScene: paintScene, GAMES: GAMES };
});
