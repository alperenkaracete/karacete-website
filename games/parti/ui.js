// Parti: arayüz (canvas tahta, lobi/ayarlar, oyuncu paneli, kontroller, efektler). Mantık PartiMachine/PartiRules'ta.
(function () {
    'use strict';

    var C = PartiConfig;
    var G = PartiGraph;
    var R = PartiRules;
    var EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    var BOARD_W = 1000;
    var BOARD_H = 700;
    var STEP_ANIM_MS = 260;
    var NODE_R = 18;
    var TYPE_STYLE = {
        normal: { fill: null, icon: '' },
        start: { fill: '#c9ced6', icon: '🏁' },
        treasure: { fill: '#ffd24a', icon: '✨' },
        weapon: { fill: '#ff7a6b', icon: '⚔️' },
        event: { fill: '#b78cff', icon: '🎁' }
    };
    var DIR_ARROWS = ['➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️', '⬆️', '↗️'];

    var machine = null;
    var gctx = null;
    var els = null;
    var view = null;
    var listeners = [];
    var raf = null;
    var graphs = {};
    var shown = {};          // oyuncu -> son gösterilen düğüm
    var anims = {};          // oyuncu -> { from, path, t0 }
    var particles = [];
    var banner = null;
    var lastFq = -1;
    var sig = '';
    var targeting = null;    // { item, kind, range }
    var logOpen = false;
    var scale = { css: 1, dpr: 1 };
    var timerEls = [];

    function listen(target, type, handler, opts) {
        target.addEventListener(type, handler, opts);
        listeners.push(function () { target.removeEventListener(type, handler, opts); });
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function btn(label, cls, handler, disabled) {
        var b = el('button', 'pt-btn ' + (cls || ''), label);
        b.type = 'button';
        b.disabled = !!disabled;
        b.addEventListener('click', handler);
        return b;
    }
    function nowMs() { return performance.now(); }
    function fmtTime(ms) {
        var s = Math.max(0, Math.ceil(ms / 1000));
        return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }
    function graphFor(mapId) {
        if (!graphs[mapId]) graphs[mapId] = G.index(window.PartiMaps[mapId]);
        return graphs[mapId];
    }
    function weaponLabel(w) { var d = C.WEAPONS[w]; return d ? d.emoji + ' ' + d.name : w; }
    function teamColor(t) { return C.TEAMS[t] ? C.TEAMS[t].color : '#ffffff'; }
    function seatById(v, id) {
        for (var i = 0; i < v.seats.length; i++) if (v.seats[i].i === id) return v.seats[i];
        return null;
    }
    function act(a) { if (machine) machine.dispatch(a); }

    // ---------------- DOM ----------------
    function buildDom() {
        var root = gctx.root;
        root.textContent = '';
        var rootEl = el('div', 'pt-root');
        var lobby = el('div', 'pt-lobby');
        var game = el('div', 'pt-game hidden');
        var bar = el('div', 'pt-bar');
        var barLeft = el('span', 'pt-bar-left');
        var barMid = el('span', 'pt-bar-mid');
        var barTime = el('span', 'pt-bar-time');
        var main = el('div', 'pt-main');
        var boardWrap = el('div', 'pt-board');
        var canvas = el('canvas', 'pt-canvas');
        boardWrap.appendChild(canvas);
        var side = el('div', 'pt-side');
        var players = el('div', 'pt-players');
        var controls = el('div', 'pt-controls');
        side.appendChild(players); side.appendChild(controls);
        main.appendChild(boardWrap); main.appendChild(side);
        var logBtn = btn('📜', 'pt-logbtn small', function () { logOpen = !logOpen; sig = ''; render(); });
        bar.appendChild(barLeft); bar.appendChild(barMid); bar.appendChild(barTime); bar.appendChild(logBtn);
        var logPanel = el('div', 'pt-log hidden');
        var overlay = el('div', 'pt-overlay hidden');
        var toast = el('div', 'pt-toast hidden');
        game.appendChild(bar); game.appendChild(main); game.appendChild(logPanel); game.appendChild(toast);
        rootEl.appendChild(lobby); rootEl.appendChild(game); rootEl.appendChild(overlay);
        root.appendChild(rootEl);
        return {
            root: rootEl, lobby: lobby, game: game, bar: bar, barLeft: barLeft, barMid: barMid, barTime: barTime, board: boardWrap,
            canvas: canvas, players: players, controls: controls, logPanel: logPanel, overlay: overlay, toast: toast
        };
    }

    function resize() {
        if (!els || els.game.classList.contains('hidden')) return;
        var rect = els.board.getBoundingClientRect();
        var w = Math.max(120, rect.width);
        var h = Math.max(90, rect.height);
        var s = Math.min(w / BOARD_W, h / BOARD_H);
        var cssW = Math.floor(BOARD_W * s);
        var cssH = Math.floor(BOARD_H * s);
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        els.canvas.style.width = cssW + 'px';
        els.canvas.style.height = cssH + 'px';
        els.canvas.width = Math.round(cssW * dpr);
        els.canvas.height = Math.round(cssH * dpr);
        scale = { css: cssW / BOARD_W, dpr: dpr, px: (cssW * dpr) / BOARD_W };
        if (view && view.game) draw(nowMs());      // boyut değişimi canvas'ı temizler: hemen yeniden çiz
    }

    // ---------------- Render (DOM) ----------------
    function signature(v) {
        var parts = [v.mode, v.ep, v.rv, v.offline ? 1 : 0, targeting ? targeting.item : -1, logOpen ? 1 : 0, v.wait ? 1 : 0, v.mini ? (v.mini.left > 1500 ? 1 : 2) : 0];
        return parts.join(':');
    }

    function render() {
        if (!els) return;
        if (!view) return;
        var v = view;
        var s = signature(v);
        if (s === sig) return;
        sig = s;
        timerEls = [];
        var inGame = v.mode === 'play' || v.mode === 'over' || v.mode === 'spectator';
        els.lobby.classList.toggle('hidden', v.mode !== 'lobby');
        els.game.classList.toggle('hidden', !(inGame && v.game));
        if (v.mode === 'lobby') renderLobby(v);
        if (inGame && v.game) {
            renderBar(v);
            renderPlayers(v);
            renderControls(v);
            renderLog(v);
            window.requestAnimationFrame(resize);
        }
        renderOverlay(v);
    }

    function renderOverlay(v) {
        var o = els.overlay;
        o.textContent = '';
        var cards = [];
        if (v.mode === 'connecting') cards.push(card('Bağlanılıyor…', ['Oda durumu bekleniyor.']));
        else if (v.mode === 'kicked') cards.push(card('Odadan çıkarıldın', [], [btn('Lobiye Dön', 'primary', function () { gctx.leave(); })]));
        else if (v.mode === 'spectator') cards.push(toastCard('👀 İzleyicisin: oyun başlamış, eylem yapamazsın.', [btn('Lobiye Dön', '', function () { gctx.leave(); })]));
        if (v.offline) cards.push(toastCard('📡 Bağlantı koptu, yeniden bağlanılıyor…'));
        if (v.wait) cards.push(waitCard(v));
        if (v.game && v.game.stage === 'mini' && v.mini) cards.push(miniCard(v));
        if (v.mode === 'over' && v.game) cards.push(overCard(v));
        if (v.mode !== 'lobby' && v.game && v.game.stage === 'swap' && v.cur === v.me.id) cards.push(swapCard(v));
        o.classList.toggle('hidden', !cards.length);
        cards.forEach(function (c) { o.appendChild(c); });
    }

    function card(title, lines, buttons) {
        var c = el('div', 'pt-card');
        c.appendChild(el('strong', 'pt-card-title', title));
        (lines || []).forEach(function (l) { c.appendChild(el('span', 'pt-hint', l)); });
        (buttons || []).forEach(function (b) { c.appendChild(b); });
        return c;
    }
    function toastCard(text, buttons) {
        var c = el('div', 'pt-card pt-card-small');
        c.appendChild(el('span', '', text));
        (buttons || []).forEach(function (b) { c.appendChild(b); });
        return c;
    }

    function waitCard(v) {
        var c = el('div', 'pt-card pt-card-small pt-wait');
        c.appendChild(el('strong', '', '📵 ' + v.wait.name + ' bağlantısı koptu'));
        var t = el('span', 'pt-hint');
        t.dataset.wait = v.wait.id;
        t.textContent = 'Kalan süre ' + fmtTime(v.wait.left);
        timerEls.push({ node: t, fn: function (vv) { return vv.wait ? 'Kalan süre ' + fmtTime(vv.wait.left) : ''; } });
        c.appendChild(t);
        if (v.isLeader) {
            var row = el('div', 'pt-row');
            row.appendChild(btn('Bekle', '', function () { els.overlay.querySelector('.pt-wait').classList.add('hidden'); }));
            row.appendChild(btn('Turu geç', '', function () { act({ type: 'skipturn' }); }));
            row.appendChild(btn('At', 'danger', function () { act({ type: 'drop', id: v.wait.id }); }));
            c.appendChild(row);
        } else {
            c.appendChild(el('span', 'pt-hint', 'Lider bekleyip beklemeyeceğine karar verir.'));
        }
        return c;
    }

    function miniCard(v) {
        var mn = v.mini;
        var c = el('div', 'pt-card pt-mini');
        var spinning = mn.left < 0 || mn.left > 1500;
        c.appendChild(el('strong', 'pt-card-title', mn.type === 'duel' ? '🎡 Şans Çarkı — Düello' : '🎡 Şans Çarkı'));
        c.appendChild(el('span', 'pt-hint', 'Yer tutucu minioyun: sıralama rastgele belirlenir.'));
        var wheel = el('div', 'pt-wheel' + (spinning ? ' spinning' : ''), '🎡');
        c.appendChild(wheel);
        if (spinning) {
            c.appendChild(el('span', 'pt-hint', mn.type === 'duel' ? 'Düello: ' + mn.players.map(function (id) { return nameOf(v, id); }).join(' ⚔️ ') : 'Çark dönüyor…'));
        } else {
            var list = el('ol', 'pt-rank');
            var pos = 0;
            mn.ranking.forEach(function (group) {
                var medal = ['🥇', '🥈', '🥉'][pos] || '▫️';
                group.forEach(function (id) { list.appendChild(el('li', '', medal + ' ' + nameOf(v, id))); });
                pos += group.length;
            });
            c.appendChild(list);
            c.appendChild(el('span', 'pt-hint', '1.: ⭐+silah · 2.: silah · 3.: 🛡️'));
        }
        return c;
    }

    function overCard(v) {
        var g = v.game;
        var c = el('div', 'pt-card pt-over');
        var title = '🏆 Oyun bitti';
        if (g.winner && g.winner.kind === 'player') title = '🏆 ' + nameOf(v, g.winner.id) + ' kazandı!';
        else if (g.winner && g.winner.kind === 'team') title = '🏆 ' + C.TEAMS[g.winner.id].name + ' takım kazandı!';
        c.appendChild(el('strong', 'pt-card-title', title));
        var list = el('ol', 'pt-rank');
        (v.standings || []).forEach(function (row, i) {
            var medal = ['🥇', '🥈', '🥉'][i] || '▫️';
            if (row.players) {
                list.appendChild(el('li', '', medal + ' ' + C.TEAMS[row.t].name + ': ' + row.players.map(function (id) { return nameOf(v, id); }).join(' + ') + ' — ' + row.s + ' ⭐'));
            } else {
                list.appendChild(el('li', '', medal + ' ' + nameOf(v, row.id) + ' — ' + row.s + ' ⭐'));
            }
        });
        c.appendChild(list);
        var row = el('div', 'pt-row');
        row.appendChild(btn('Lobiye Dön', '', function () { gctx.leave(); }));
        if (v.isLeader) row.appendChild(btn('🔁 Yeniden Oyna', 'primary', function () { act({ type: 'again' }); }));
        else c.appendChild(el('span', 'pt-hint', 'Lider yeniden başlatabilir.'));
        c.appendChild(row);
        return c;
    }

    function swapCard(v) {
        var p = v.game.P[v.me.id];
        var c = el('div', 'pt-card pt-swap');
        c.appendChild(el('strong', 'pt-card-title', 'Envanter dolu'));
        c.appendChild(el('span', 'pt-hint', 'Yeni: ' + weaponLabel(p.offers[0]) + ' — hangisini bırakmak istersin?'));
        var row = el('div', 'pt-row');
        p.w.forEach(function (w, i) { row.appendChild(btn(weaponLabel(w), '', function () { act({ type: 'swap', drop: i }); })); });
        c.appendChild(row);
        c.appendChild(btn('Vazgeç (yenisini alma)', 'primary', function () { act({ type: 'swap', drop: -1 }); }));
        return c;
    }

    function nameOf(v, id) {
        var s = seatById(v, id);
        if (s) return s.a + ' ' + s.n;
        return v.game && v.game.P[id] ? v.game.P[id].av + ' ' + v.game.P[id].n : '?';
    }

    // ---- Lobi ----
    function renderLobby(v) {
        var L = els.lobby;
        L.textContent = '';
        var panel = el('div', 'pt-lobby-panel');
        panel.appendChild(el('h2', 'pt-title', '🎲 Parti'));
        panel.appendChild(el('span', 'pt-hint', 'Oda kodu: ' + gctx.room + ' · ' + v.seats.length + '/' + C.MAX_PLAYERS + ' oyuncu · ' + (v.isLeader ? 'Lider sensin 👑' : 'Ayarları lider değiştirir')));

        // koltuklar
        var seats = el('div', 'pt-seats');
        v.seats.forEach(function (s) {
            var row = el('div', 'pt-seat');
            if (v.cfg.m === 'team') row.style.borderColor = teamColor(s.t);
            row.appendChild(el('span', 'pt-seat-av', s.a));
            var name = el('span', 'pt-seat-name', s.n + (s.i === v.leader ? ' 👑' : '') + (s.b ? ' 🤖' : '') + (s.i === v.me.id ? ' (sen)' : ''));
            row.appendChild(name);
            if (!s.b && !s.c) row.appendChild(el('span', 'pt-chip', 'bağlı değil'));
            if (v.cfg.m === 'team') {
                if (v.isLeader) {
                    var sel = el('select', 'pt-select');
                    C.TEAMS.forEach(function (t) { var o = el('option', '', t.name); o.value = t.id; if (t.id === s.t) o.selected = true; sel.appendChild(o); });
                    sel.addEventListener('change', function () { act({ type: 'team', id: s.i, t: Number(sel.value) }); });
                    row.appendChild(sel);
                } else {
                    var tag = el('span', 'pt-chip', C.TEAMS[s.t].name);
                    tag.style.background = teamColor(s.t);
                    row.appendChild(tag);
                }
            }
            if (v.isLeader && s.i !== v.me.id) {
                row.appendChild(btn(s.b ? '✕' : 'At', 'small danger', function () { act(s.b ? { type: 'bot_del', id: s.i } : { type: 'kick', id: s.i }); }));
            }
            seats.appendChild(row);
        });
        panel.appendChild(seats);

        // avatar
        panel.appendChild(el('span', 'pt-label', 'Avatarın'));
        var grid = el('div', 'pt-avatars');
        var mine = v.meSeat ? v.meSeat.a : null;
        C.AVATARS.forEach(function (a) {
            var taken = v.seats.some(function (s) { return s.a === a && s.i !== v.me.id; });
            var b = btn(a, 'pt-av' + (a === mine ? ' selected' : ''), function () { act({ type: 'av', av: a }); }, taken);
            grid.appendChild(b);
        });
        panel.appendChild(grid);

        // ayarlar
        var settings = el('div', 'pt-settings');
        var modeRow = el('div', 'pt-row');
        modeRow.appendChild(el('span', 'pt-label', 'Mod'));
        modeRow.appendChild(btn('Bireysel', v.cfg.m === 'solo' ? 'primary' : '', function () { act({ type: 'cfg', mode: 'solo' }); }, !v.isLeader));
        modeRow.appendChild(btn('2\'şerli Takım', v.cfg.m === 'team' ? 'primary' : '', function () { act({ type: 'cfg', mode: 'team' }); }, !v.isLeader));
        if (v.cfg.m === 'team') modeRow.appendChild(btn('🎲 Karıştır', 'small', function () { act({ type: 'teams_random' }); }, !v.isLeader));
        settings.appendChild(modeRow);
        var mapRow = el('div', 'pt-row');
        mapRow.appendChild(el('span', 'pt-label', 'Harita'));
        Object.keys(window.PartiMaps).forEach(function (id) {
            mapRow.appendChild(btn(window.PartiMaps[id].name, v.cfg.mp === id ? 'primary' : '', function () { act({ type: 'cfg', map: id }); }, !v.isLeader));
        });
        settings.appendChild(mapRow);
        var goalRow = el('div', 'pt-row');
        goalRow.appendChild(el('span', 'pt-label', 'Hedef ⭐'));
        C.GOALS.forEach(function (n) {
            goalRow.appendChild(btn(String(n), v.cfg.gl === n ? 'primary small' : 'small', function () { act({ type: 'cfg', goal: n }); }, !v.isLeader));
        });
        settings.appendChild(goalRow);
        panel.appendChild(settings);

        if (v.isLeader) {
            var row = el('div', 'pt-row');
            row.appendChild(btn('🤖 Bot ekle', '', function () { act({ type: 'bot_add' }); }, v.seats.length >= C.MAX_PLAYERS));
            row.appendChild(btn('Bot çıkar', '', function () { act({ type: 'bot_del' }); }, !v.seats.some(function (s) { return s.b; })));
            panel.appendChild(row);
            panel.appendChild(btn('▶ Başlat', 'primary big', function () { act({ type: 'start' }); }, !!v.startBlock));
            if (v.startBlock) panel.appendChild(el('span', 'pt-hint pt-warn', v.startBlock));
        } else {
            panel.appendChild(el('span', 'pt-hint', 'Lider oyunu başlatınca başlar…'));
        }
        L.appendChild(panel);
    }

    // ---- Oyun: üst çubuk, oyuncular, kontroller, günlük ----
    function renderBar(v) {
        var g = v.game;
        els.barLeft.textContent = 'Tur ' + g.rd + ' · Hedef ' + g.goal + ' ⭐';
        var mid = '';
        if (g.stage === 'mini') mid = '🎡 Minioyun';
        else if (g.stage === 'over') mid = '🏆 Oyun bitti';
        else if (v.cur) mid = (v.cur === v.me.id ? 'Sıra sende!' : nameOf(v, v.cur) + ' oynuyor');
        els.barMid.textContent = mid;
        els.barMid.classList.toggle('mine', v.cur === v.me.id);
        timerEls.push({ node: els.barTime, fn: function (vv) { return vv.game && vv.game.stage !== 'mini' && vv.game.stage !== 'over' ? (vv.paused ? '⏸ ' : '⏱ ') + fmtTime(vv.dlLeft) : ''; } });
        els.barTime.textContent = '';
    }

    function renderPlayers(v) {
        var g = v.game;
        var P = els.players;
        P.textContent = '';
        if (g.mode === 'team') {
            var teams = {};
            g.order.forEach(function (id) { teams[g.P[id].t] = true; });
            var strip = el('div', 'pt-teams');
            Object.keys(teams).forEach(function (t) {
                var chip = el('span', 'pt-chip', C.TEAMS[t].name + ' ' + R.teamStars(g, Number(t)) + '/' + g.goal + ' ⭐');
                chip.style.background = teamColor(Number(t));
                strip.appendChild(chip);
            });
            P.appendChild(strip);
        }
        var grid = el('div', 'pt-pgrid');
        g.order.forEach(function (id) {
            var p = g.P[id];
            var seat = seatById(v, id);
            var cardEl = el('div', 'pt-pcard' + (id === v.cur ? ' current' : '') + (id === v.me.id ? ' me' : ''));
            cardEl.style.borderColor = g.mode === 'team' ? teamColor(p.t) : '';
            var top = el('div', 'pt-ptop');
            top.appendChild(el('span', 'pt-pav', p.av));
            top.appendChild(el('span', 'pt-pname', p.n + (p.bot ? ' 🤖' : '') + (v.leader === id ? '👑' : '')));
            cardEl.appendChild(top);
            var hp = el('div', 'pt-hp');
            var fill = el('i');
            fill.style.width = Math.max(0, p.hp) + '%';
            fill.style.background = p.hp > 60 ? '#37c46b' : (p.hp > 30 ? '#f1b72d' : '#e5484d');
            hp.appendChild(fill);
            cardEl.appendChild(hp);
            var stats = el('div', 'pt-pstats');
            stats.appendChild(el('span', '', '❤️' + p.hp + ' ⭐' + p.s));
            var items = '';
            p.w.forEach(function (w) { items += C.WEAPONS[w].emoji; });
            if (p.shield) items += '🛡️';
            stats.appendChild(el('span', 'pt-items', items || '·'));
            cardEl.appendChild(stats);
            var status = '';
            if (seat && !seat.b && !seat.c) status += '📵';
            if (p.sk > 0) status += '💤';
            if (status) cardEl.appendChild(el('span', 'pt-pstatus', status));
            grid.appendChild(cardEl);
        });
        P.appendChild(grid);
    }

    function renderControls(v) {
        var g = v.game;
        var Ctl = els.controls;
        Ctl.textContent = '';
        if (v.mode === 'spectator') { Ctl.appendChild(el('span', 'pt-hint', 'İzliyorsun')); return; }
        if (g.stage === 'over' || g.stage === 'mini') return;
        var mine = v.cur === v.me.id;
        if (!mine) {
            Ctl.appendChild(el('span', 'pt-hint pt-wait-text', v.cur ? nameOf(v, v.cur) + ' oynuyor…' : ''));
            appendWeaponPreview(Ctl, v);
            return;
        }
        var p = g.P[v.me.id];
        if (g.stage === 'roll') {
            Ctl.appendChild(btn('🎲 Zar At', 'primary big', function () { act({ type: 'roll' }); }));
        } else if (g.stage === 'choose') {
            Ctl.appendChild(el('span', 'pt-hint', 'Yön seç (' + g.steps + ' adım kaldı) — haritaya da dokunabilirsin:'));
            var row = el('div', 'pt-row');
            var from = graphFor(g.mapId).byId[p.pos];
            g.choices.forEach(function (to) {
                var n = graphFor(g.mapId).byId[to];
                row.appendChild(btn(arrowFor(from, n) + ' ' + (TYPE_STYLE[n.type].icon || 'Yol'), 'primary', function () { act({ type: 'dir', to: to }); }));
            });
            Ctl.appendChild(row);
        } else if (g.stage === 'swap') {
            Ctl.appendChild(el('span', 'pt-hint', 'Envanter dolu: bir seçim yap.'));
        } else if (g.stage === 'act') {
            renderActControls(Ctl, v, p);
        }
    }

    function appendWeaponPreview(Ctl, v) {
        var p = v.game.P[v.me.id];
        if (!p || !p.w.length) return;
        var row = el('div', 'pt-row');
        p.w.forEach(function (w) { row.appendChild(el('span', 'pt-chip', weaponLabel(w))); });
        Ctl.appendChild(row);
    }

    function arrowFor(a, b) {
        var ang = Math.atan2(b.y - a.y, b.x - a.x);
        var idx = Math.round(ang / (Math.PI / 4));
        return DIR_ARROWS[((idx % 8) + 8) % 8];
    }

    function renderActControls(Ctl, v, p) {
        var g = v.game;
        var graph = graphFor(g.mapId);
        var rctx = { g: graph };
        var opts = R.attackOptions(g, rctx);
        Ctl.appendChild(el('span', 'pt-hint', targeting ? targetingHint(targeting) : 'İstersen bir silah kullan, sonra turu bitir.'));
        var row = el('div', 'pt-row');
        p.w.forEach(function (w, i) {
            var def = C.WEAPONS[w];
            var usable = def.kind === 'shield' ? !p.shield : (def.kind === 'area' ? true : opts.some(function (o) { return o.item === i; }));
            var b = btn(def.emoji + ' ' + def.name, targeting && targeting.item === i ? 'primary' : '', function () {
                if (def.kind === 'shield') { act({ type: 'use', item: i }); return; }
                targeting = targeting && targeting.item === i ? null : { item: i, kind: def.kind, range: def.range, w: w };
                sig = ''; render();
            }, !usable);
            row.appendChild(b);
        });
        Ctl.appendChild(row);
        if (targeting) {
            var tray = el('div', 'pt-row');
            var def2 = C.WEAPONS[targeting.w];
            if (def2.kind === 'target') {
                opts.filter(function (o) { return o.item === targeting.item; }).forEach(function (o) {
                    var d = G.distance(graph, p.pos, g.P[o.target].pos);
                    tray.appendChild(btn(g.P[o.target].av + ' ' + g.P[o.target].n + ' (−' + def2.dmg[d] + ')', 'danger', function () { targeting = null; act({ type: 'use', item: o.item, target: o.target }); }));
                });
            } else {
                opts.filter(function (o) { return o.item === targeting.item; }).forEach(function (o) {
                    var names = g.order.filter(function (id) { return g.P[id].pos === o.node; }).map(function (id) { return g.P[id].av; }).join('');
                    tray.appendChild(btn('📍 ' + names + ' (−' + def2.damage + ')', 'danger', function () { targeting = null; act({ type: 'use', item: o.item, node: o.node }); }));
                });
            }
            tray.appendChild(btn('İptal', 'small', function () { targeting = null; sig = ''; render(); }));
            Ctl.appendChild(tray);
        }
        Ctl.appendChild(btn('Turu Bitir ➜', 'primary', function () { targeting = null; act({ type: 'end' }); }));
    }

    function targetingHint(t) {
        return t.kind === 'area' ? 'Bomba: listeden ya da haritada bir kutucuğa dokun (menzil ' + t.range + ').' : 'Hedef seç (menzil ' + t.range + ').';
    }

    function renderLog(v) {
        els.logPanel.classList.toggle('hidden', !logOpen);
        els.logPanel.textContent = '';
        if (!logOpen) return;
        var lines = v.log.slice().reverse();
        els.logPanel.appendChild(el('strong', '', 'Olay günlüğü'));
        lines.forEach(function (l) { els.logPanel.appendChild(el('div', 'pt-logline', l)); });
    }

    // ---------------- Canvas ----------------
    function font(c, px) { c.font = px + 'px ' + EMOJI_FONT; }

    function nodePos(g, id) { var n = g.byId[id]; return { x: n.x, y: n.y }; }

    function tokenPos(v, g, id, t) {
        var p = v.game.P[id];
        var a = anims[id];
        if (a) {
            var e = Math.max(0, (t - a.t0) / STEP_ANIM_MS);
            var seq = [a.from].concat(a.path);
            if (e >= seq.length - 1) { delete anims[id]; shown[id] = p.pos; }
            else {
                var i = Math.floor(e);
                var f = e - i;
                var A = nodePos(g, seq[i]);
                var B = nodePos(g, seq[i + 1]);
                return { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f - Math.sin(f * Math.PI) * 14, moving: true };
            }
        }
        shown[id] = p.pos;
        var q = nodePos(g, p.pos);
        return { x: q.x, y: q.y };
    }

    function ingestFx(v, t) {
        if (!v.game || v.fq === lastFq) return;
        var first = lastFq === -1;
        lastFq = v.fq;
        if (first) return;
        var g = graphFor(v.game.mapId);
        v.fx.forEach(function (e) {
            function at(id) { var s = shown[id] !== undefined && v.game.P[id] ? shown[id] : (v.game.P[id] ? v.game.P[id].pos : null); return s === null ? null : nodePos(g, s); }
            function pop(id, text, color, dx) {
                var pos = e.node !== undefined && !id ? nodePos(g, e.node) : (v.game.P[id] ? nodePos(g, v.game.P[id].pos) : at(id));
                if (!pos) return;
                particles.push({ x: pos.x + (dx || 0), y: pos.y - 26, text: text, color: color, t0: t, life: 1400 });
            }
            if (e.t === 'move' && v.game.P[e.id]) {
                anims[e.id] = { from: shown[e.id] !== undefined ? shown[e.id] : e.path[0], path: e.path, t0: t };
            } else if (e.t === 'roll') {
                banner = { text: '🎲 ' + e.v, sub: nameOf(v, e.id), t0: t };
            } else if (e.t === 'dmg') pop(e.id, '−' + e.n, '#ff5d5d');
            else if (e.t === 'star') pop(e.id, (e.n >= 0 ? '+' : '') + e.n + '⭐', '#ffd24a');
            else if (e.t === 'chest') pop(null, e.k === 'star' ? '🧰 +' + e.n + '⭐' : '🧰 ' + C.WEAPONS[e.w].emoji, '#fff3b0', 0);
            else if (e.t === 'death') pop(e.id, '💀', '#ffffff');
            else if (e.t === 'block') pop(e.id, '🛡️', '#9fe8ff');
            else if (e.t === 'item' || e.t === 'zone') pop(e.id, '+' + C.WEAPONS[e.w].emoji, '#ffffff');
            else if (e.t === 'event') pop(e.id, '🎁', '#e3c9ff');
            else if (e.t === 'attack' && e.w) pop(e.id, C.WEAPONS[e.w].emoji, '#ffffff');
        });
    }

    function drawBackground(c, map, t) {
        var pal = map.palette;
        var grd = c.createLinearGradient(0, 0, 0, BOARD_H);
        grd.addColorStop(0, pal.bgTop);
        grd.addColorStop(1, pal.bgBottom);
        c.fillStyle = grd;
        c.fillRect(0, 0, BOARD_W, BOARD_H);
        if (pal.fx === 'waves') {
            c.strokeStyle = pal.wave;
            c.lineWidth = 3;
            for (var row = 0; row < 9; row++) {
                c.beginPath();
                for (var x = 0; x <= BOARD_W; x += 20) {
                    var y = 40 + row * 80 + Math.sin(x / 60 + t / 700 + row) * 7;
                    if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
                }
                c.stroke();
            }
        } else if (pal.fx === 'stars') {
            for (var i = 0; i < 70; i++) {
                var sx = (i * 137.5) % BOARD_W;
                var sy = (i * 71.3 + (i % 7) * 40) % BOARD_H;
                var a = 0.35 + 0.65 * Math.abs(Math.sin(t / 900 + i));
                c.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
                c.fillRect(sx, sy, i % 5 === 0 ? 3 : 2, i % 5 === 0 ? 3 : 2);
            }
        }
    }

    function drawDecor(c, map, t) {
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        map.decor.forEach(function (d, i) {
            var dy = 0;
            var alpha = 1;
            if (d.a === 'float') dy = Math.sin(t / 1100 + i) * 6;
            else if (d.a === 'bob') dy = Math.sin(t / 700 + i * 2) * 4;
            else if (d.a === 'twinkle') alpha = 0.55 + 0.45 * Math.sin(t / 500 + i);
            c.globalAlpha = alpha * 0.92;
            font(c, d.s);
            c.fillText(d.e, d.x, d.y + dy);
        });
        c.globalAlpha = 1;
    }

    function drawBoard(c, v, t) {
        var g = v.game;
        var graph = graphFor(g.mapId);
        var map = graph.map;
        drawBackground(c, map, t);
        drawDecor(c, map, t);
        // yollar
        c.lineCap = 'round';
        map.nodes.forEach(function (n) {
            n.next.forEach(function (to) {
                var m = graph.byId[to];
                c.strokeStyle = map.palette.pathEdge;
                c.lineWidth = 15;
                c.beginPath(); c.moveTo(n.x, n.y); c.lineTo(m.x, m.y); c.stroke();
            });
        });
        map.nodes.forEach(function (n) {
            n.next.forEach(function (to) {
                var m = graph.byId[to];
                c.strokeStyle = map.palette.path;
                c.lineWidth = 9;
                c.beginPath(); c.moveTo(n.x, n.y); c.lineTo(m.x, m.y); c.stroke();
            });
        });
        // düğümler
        var me = g.P[v.me.id];
        var rangeNodes = {};
        if (targeting && targeting.kind === 'area' && me) {
            map.nodes.forEach(function (n) { if (G.distance(graph, me.pos, n.id) <= targeting.range) rangeNodes[n.id] = true; });
        }
        var choices = v.cur === v.me.id && g.stage === 'choose' ? g.choices : null;
        map.nodes.forEach(function (n) {
            var st = TYPE_STYLE[n.type];
            c.beginPath();
            c.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
            c.fillStyle = st.fill || map.palette.path;
            c.fill();
            c.lineWidth = 3;
            c.strokeStyle = map.palette.pathEdge;
            c.stroke();
            if (st.icon) { c.textAlign = 'center'; c.textBaseline = 'middle'; font(c, 17); c.fillText(st.icon, n.x, n.y + 1); }
            if (rangeNodes[n.id]) {
                c.beginPath(); c.arc(n.x, n.y, NODE_R + 6, 0, Math.PI * 2);
                c.strokeStyle = '#ff5d5d'; c.lineWidth = 4; c.stroke();
            }
            if (choices && choices.indexOf(n.id) >= 0) {
                var pulse = 5 + Math.sin(t / 150) * 3;
                c.beginPath(); c.arc(n.x, n.y, NODE_R + pulse, 0, Math.PI * 2);
                c.strokeStyle = '#ffffff'; c.lineWidth = 5; c.stroke();
            }
        });
        // sandıklar
        Object.keys(g.chests).forEach(function (id) {
            var n = graph.byId[id];
            var ch = g.chests[id];
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            font(c, 34);
            c.fillText(ch.k === 'star' ? '🧰' : '🎁', n.x, n.y - 26 - Math.abs(Math.sin(t / 380 + n.id)) * 7);
            if (ch.k === 'star') { font(c, 15); c.fillText(ch.n === 2 ? '⭐⭐' : '⭐', n.x, n.y - 5); }
            else { font(c, 15); c.fillText('🔫', n.x, n.y - 5); }
        });
        // oyuncular
        var byNode = {};
        g.order.forEach(function (id) {
            var pos = tokenPos(v, graph, id, t);
            var key = pos.moving ? 'm' + id : 'n' + g.P[id].pos;
            (byNode[key] = byNode[key] || []).push({ id: id, pos: pos });
        });
        Object.keys(byNode).forEach(function (key) {
            var list = byNode[key];
            list.forEach(function (it, i) {
                var off = list.length > 1 ? { x: (i - (list.length - 1) / 2) * 22, y: (i % 2) * 8 } : { x: 0, y: 0 };
                drawToken(c, g, it.id, it.pos.x + off.x, it.pos.y + off.y - 4, v, t);
            });
        });
        // parçacıklar
        particles = particles.filter(function (p) { return t - p.t0 < p.life; });
        c.textAlign = 'center';
        particles.forEach(function (p) {
            var k = (t - p.t0) / p.life;
            c.globalAlpha = 1 - k * k;
            c.fillStyle = p.color;
            c.strokeStyle = 'rgba(0,0,0,0.6)';
            c.lineWidth = 4;
            c.font = 'bold 26px ' + EMOJI_FONT;
            c.strokeText(p.text, p.x, p.y - k * 40);
            c.fillText(p.text, p.x, p.y - k * 40);
        });
        c.globalAlpha = 1;
        if (banner) {
            var bk = (t - banner.t0) / 1500;
            if (bk >= 1) banner = null;
            else {
                c.globalAlpha = bk < 0.7 ? 1 : 1 - (bk - 0.7) / 0.3;
                c.fillStyle = 'rgba(0,0,0,0.45)';
                c.fillRect(BOARD_W / 2 - 150, BOARD_H / 2 - 70, 300, 130);
                c.fillStyle = '#fff';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.font = 'bold 64px ' + EMOJI_FONT;
                c.fillText(banner.text, BOARD_W / 2, BOARD_H / 2 - 18);
                c.font = 'bold 24px sans-serif';
                c.fillText(banner.sub, BOARD_W / 2, BOARD_H / 2 + 36);
                c.globalAlpha = 1;
            }
        }
    }

    function drawToken(c, g, id, x, y, v, t) {
        var p = g.P[id];
        var current = id === v.cur;
        var bob = current ? Math.sin(t / 200) * 3 : 0;
        c.beginPath();
        c.arc(x, y + bob, 17, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.fill();
        c.lineWidth = current ? 5 : 3;
        c.strokeStyle = g.mode === 'team' ? teamColor(p.t) : (id === v.me.id ? '#ffd24a' : '#334');
        c.stroke();
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        font(c, 22);
        c.fillText(p.av, x, y + bob + 1);
        // can çubuğu
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(x - 15, y + bob + 19, 30, 5);
        c.fillStyle = p.hp > 60 ? '#37c46b' : (p.hp > 30 ? '#f1b72d' : '#e5484d');
        c.fillRect(x - 15, y + bob + 19, 30 * Math.max(0, p.hp) / 100, 5);
        if (p.shield) { font(c, 14); c.fillText('🛡️', x + 16, y + bob - 14); }
        if (p.sk > 0) { font(c, 14); c.fillText('💤', x - 16, y + bob - 14); }
    }

    function draw(t) {
        if (!els || !view || !view.game || els.game.classList.contains('hidden')) return;
        var c = els.canvas.getContext('2d');
        c.setTransform(scale.px, 0, 0, scale.px, 0, 0);
        ingestFx(view, t);
        drawBoard(c, view, t);
    }

    // ---------------- Girdi (canvas) ----------------
    function onCanvasClick(e) {
        if (!view || !view.game) return;
        var rect = els.canvas.getBoundingClientRect();
        var x = (e.clientX - rect.left) / scale.css;
        var y = (e.clientY - rect.top) / scale.css;
        var g = view.game;
        var graph = graphFor(g.mapId);
        function nearest(ids) {
            var best = null;
            var bd = 1e9;
            ids.forEach(function (id) {
                var n = graph.byId[id];
                var d = Math.hypot(n.x - x, n.y - y);
                if (d < bd) { bd = d; best = id; }
            });
            return bd <= 55 ? best : null;
        }
        if (view.cur === view.me.id && g.stage === 'choose') {
            var to = nearest(g.choices);
            if (to !== null) act({ type: 'dir', to: to });
        } else if (view.cur === view.me.id && g.stage === 'act' && targeting && targeting.kind === 'area') {
            var me = g.P[view.me.id];
            var inRange = graph.map.nodes.filter(function (n) { return G.distance(graph, me.pos, n.id) <= targeting.range; }).map(function (n) { return n.id; });
            var node = nearest(inRange);
            if (node !== null) { var item = targeting.item; targeting = null; act({ type: 'use', item: item, node: node }); }
        }
    }

    // ---------------- Döngü ----------------
    function frame(t) {
        raf = requestAnimationFrame(frame);
        if (!machine) return;
        machine.tick();
        draw(t);
        timerEls.forEach(function (te) { var txt = te.fn(view); if (te.node.textContent !== txt) te.node.textContent = txt; });
    }

    function onView(v) {
        view = v;
        render();
    }

    function init(ctx) {
        gctx = ctx;
        document.body.classList.add('parti-active');
        els = buildDom();
        view = null;
        sig = '';
        shown = {}; anims = {}; particles = []; banner = null; lastFq = -1; targeting = null; logOpen = false;
        var creator = ctx.isHost();
        machine = PartiMachine.create({
            me: ctx.me, players: ctx.players, send: ctx.send, now: Date.now, maps: window.PartiMaps, creator: creator,
            onChange: onView, startMinigame: PartiMinigame.startMinigame
        });
        listen(els.canvas, 'click', onCanvasClick);
        listen(window, 'resize', resize);
        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(resize);
            ro.observe(els.board);
            listeners.push(function () { ro.disconnect(); });
        }
        view = machine.getView();
        raf = requestAnimationFrame(frame);
        render();
    }

    function onMessage(data) { if (machine) machine.onMessage(data); }

    function destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        listeners.forEach(function (off) { off(); });
        listeners = [];
        document.body.classList.remove('parti-active');
        if (gctx && gctx.root) gctx.root.textContent = '';
        machine = null; els = null; view = null; gctx = null;
    }

    Games.register({
        id: 'parti',
        name: 'Parti',
        icon: '🎲',
        tagline: '2–8 oyuncu · tahta oyunu',
        maxPlayers: 8,
        reconnect: true,
        init: init,
        onMessage: onMessage,
        destroy: destroy
    });
})();
