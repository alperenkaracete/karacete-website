// Parti düello izleme: oynamayanların (ve maçı bitenlerin) görmesi için salt-okunur, kompakt tahta anlık görüntüsü.
// DOM'suz çekirdek (Node'da test edilir) + küçük DOM çizici. Oyun dosyalarına/çekirdeğe dokunmaz:
//   lider (zaten çalışan hakemlerden)  snapshot(game, st, rules)  -> kompakt nesne (pm[i].wb, pt_state ile yayınlanır)
//   alıcı (makine)                     sanitize(raw)              -> doğrulanmış nesne | null (asla oyunu bozmaz)
//   arayüz                             render(doc, snap, names)   -> DOM düğümü (yalnız textContent; salt-okunur)
//
// st = { order:[ilk, ikinci], turn, board, result:{ranking,reason}|null, shots:[n,n] }  (hakem durumu)
// Anlık görüntü:
//   XOX / Dörtlü  { g, b:[-1|0|1 …(9|42)], o:[id,id], t, r }          r: -1 sürüyor | 0/1 kazanan indeks | 2 beraberlik
//   Kedi-Köpek    { g, c:[char,char], hp:[a,b], o, t, r, wind, sh:[n,n], last:null|{s,k,u,h,d,a,p} }
//                 (yörünge/atış dizileri taşınmaz: yük küçük kalır)
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
            return base;
        }
        if (!Array.isArray(st.board) || st.board.length !== GAMES[game]) return null;
        base.b = st.board.map(function (v) { return v === 0 || v === 1 ? v : -1; });
        return base;
    }

    function isInt(x, lo, hi) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi; }
    function isId(x) { return typeof x === 'string' && x.length <= 24; }

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

    function renderCatdog(doc, snap, names) {
        var wrap = make(doc, 'div', 'pt-watch pt-watch-catdog');
        wrap.appendChild(header(doc, snap, names, [CD_EMOJI[snap.c[0]], CD_EMOJI[snap.c[1]]]));
        var bars = make(doc, 'div', 'pt-watch-bars');
        for (var i = 0; i < 2; i++) {
            var bar = make(doc, 'div', 'pt-watch-bar');
            var fill = make(doc, 'span', 'pt-watch-fill' + (snap.hp[i] <= 25 ? ' low' : (snap.hp[i] <= 50 ? ' mid' : '')));
            if (fill.style) fill.style.width = snap.hp[i] + '%';
            bar.appendChild(fill);
            bar.appendChild(make(doc, 'small', '', String(snap.hp[i])));
            bars.appendChild(bar);
        }
        wrap.appendChild(bars);
        var wind = snap.wind === 0 ? 'Rüzgâr yok' : 'Rüzgâr ' + (snap.wind > 0 ? '→' : '←') + ' ' + Math.abs(snap.wind);
        wrap.appendChild(make(doc, 'div', 'pt-watch-info', lastText(snap, names)));
        wrap.appendChild(make(doc, 'div', 'pt-watch-info dim', wind + ' · atış ' + snap.sh[0] + '/' + snap.sh[1]));
        var res = resultLine(doc, snap, names);
        if (res) wrap.appendChild(res);
        return wrap;
    }

    function render(doc, snap, names) {
        if (!snap) return null;
        return snap.g === 'catdog' ? renderCatdog(doc, snap, names) : renderGrid(doc, snap, names);
    }

    return { snapshot: snapshot, sanitize: sanitize, render: render, lastText: lastText, GAMES: GAMES };
});
