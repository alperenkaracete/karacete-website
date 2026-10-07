// Parti: oyun kuralları (saf, DOM'suz, deterministik). Durum düz JSON'dur; rastgelelik durumdaki tohumdan (rs) gelir,
// bu yüzden yalnızca lider çağırır ve sonuç herkese durumla gider. Her reduce çağrısı yeni durum döndürür.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'), require('./graph.js'));
    else root.PartiRules = factory(root.PartiConfig, root.PartiGraph);
})(typeof self !== 'undefined' ? self : this, function (C, G) {
    'use strict';

    // ---- Rastgelelik ----
    function nextRand(state) {
        state.rs = (state.rs + 0x6D2B79F5) >>> 0;
        var t = state.rs;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    // Dışarıdan gelen anahtarlar yalnızca kendi özellikleriyle eşleşsin ('__proto__', 'constructor' vb. reddedilir).
    function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
    function validNode(g, id) { return Number.isInteger(id) && has(g.byId, id); }
    function validPlayer(state, id) { return typeof id === 'string' && has(state.P, id) && state.order.indexOf(id) >= 0; }

    // ctx: { g: graf indeksi, rand?: () => [0,1) (testler için) }
    function Rng(state, ctx) {
        var f = ctx && ctx.rand ? ctx.rand : function () { return nextRand(state); };
        return {
            f: f,
            int: function (n) { return Math.floor(f() * n); },
            pick: function (arr) { return arr[Math.floor(f() * arr.length)]; },
            shuffle: function (arr) {
                var a = arr.slice();
                for (var i = a.length - 1; i > 0; i--) {
                    var j = Math.floor(f() * (i + 1));
                    var t = a[i]; a[i] = a[j]; a[j] = t;
                }
                return a;
            }
        };
    }

    // ---- Kurulum ----
    // seats: [{id, name, av, t (takım no), bot}], cfg: { mode: 'solo'|'team', goal, map: harita id }
    function createGame(opts, ctx) {
        var g = ctx.g;
        var state = {
            rs: (opts.seed >>> 0) || 1,
            mode: opts.cfg.mode === 'team' ? 'team' : 'solo',
            goal: opts.cfg.goal > 0 ? opts.cfg.goal : C.autoGoal(opts.seats.length),
            mapId: opts.cfg.map,
            home: g.start, rev: 0, atk: 0, rd: 1, turn: 0, stage: 'roll', steps: 0, choices: null,
            order: [], P: {}, chests: {}, mini: null, winner: null, fr: 0
        };
        var rng = Rng(state, ctx);
        var seats = rng.shuffle(opts.seats);
        seats.forEach(function (s, i) {
            state.order.push(s.id);
            state.P[s.id] = {
                id: s.id, n: s.name, av: s.av, t: state.mode === 'team' ? s.t : -1, bot: !!s.bot,
                hp: C.MAX_HP, s: 0, w: {}, pos: g.start, home: g.start,
                sk: 0, shield: false, shl: 0, scd: 0, dmg: {}
            };
        });
        var evts = [];
        spawnChests(state, g, rng, evts);
        state.turn = -1;
        nextTurn(state, g, rng, evts);
        return state;
    }

    // ---- Yardımcılar ----
    function current(state) { return state.order[state.turn]; }

    function isTeammate(state, a, b) {
        return state.mode === 'team' && a !== b && state.P[a].t === state.P[b].t;
    }

    function teamStars(state, t) {
        var sum = 0;
        state.order.forEach(function (id) { if (state.P[id].t === t) sum += state.P[id].s; });
        return sum;
    }

    function checkWin(state) {
        if (state.winner) return;
        var best = null;
        if (state.mode === 'team') {
            var seen = {};
            state.order.forEach(function (id) {
                var t = state.P[id].t;
                if (seen[t]) return;
                seen[t] = true;
                if (teamStars(state, t) >= state.goal && (best === null || teamStars(state, t) > teamStars(state, best))) best = t;
            });
            if (best !== null) state.winner = { kind: 'team', id: best };
        } else {
            state.order.forEach(function (id) {
                if (state.P[id].s >= state.goal && (best === null || state.P[id].s > state.P[best].s)) best = id;
            });
            if (best !== null) state.winner = { kind: 'player', id: best };
        }
        if (state.winner) { state.stage = 'over'; state.choices = null; }
    }

    function addStars(state, id, n, evts, why) {
        var p = state.P[id];
        p.s = Math.max(0, p.s + n);
        evts.push({ t: 'star', id: id, n: n, why: why || '' });
        checkWin(state);
    }

    // ---- Envanter: sayaç nesnesi {silahId: adet}; tür başına ≤3, toplam ≤6, kalkan ≤1 ----
    function invTotal(p) {
        var n = 0;
        Object.keys(p.w).forEach(function (k) { n += p.w[k]; });
        return n;
    }

    function invCount(p, w) { return Object.prototype.hasOwnProperty.call(p.w, w) ? p.w[w] : 0; }

    function canHold(p, w) {
        if (invTotal(p) >= C.INVENTORY_TOTAL) return false;
        if (invCount(p, w) >= (w === 'shield' ? C.SHIELD_MAX : C.INVENTORY_PER_TYPE)) return false;
        return true;
    }

    function takeItem(p, w) {
        p.w[w]--;
        if (p.w[w] <= 0) delete p.w[w];
    }

    // Sığmayan öğe "kaçtı" (lost) olur; seçim aşaması yoktur.
    function giveItem(state, id, w, evts) {
        var p = state.P[id];
        if (canHold(p, w)) {
            p.w[w] = invCount(p, w) + 1;
            evts.push({ t: 'item', id: id, w: w });
        } else {
            evts.push({ t: 'lost', id: id, w: w });
        }
    }

    function randomWeapon(rng) {
        var total = 0;
        C.WEAPON_IDS.forEach(function (w) { total += C.WEAPON_WEIGHTS[w]; });
        var r = rng.f() * total;
        for (var i = 0; i < C.WEAPON_IDS.length; i++) {
            r -= C.WEAPON_WEIGHTS[C.WEAPON_IDS[i]];
            if (r < 0) return C.WEAPON_IDS[i];
        }
        return C.WEAPON_IDS[C.WEAPON_IDS.length - 1];
    }

    function collectChest(state, id, node, rng, evts) {
        var chest = state.chests[node];
        if (!chest) return;
        delete state.chests[node];
        if (chest.k === 'star') {
            evts.push({ t: 'chest', id: id, node: node, k: 'star', n: chest.n });
            addStars(state, id, chest.n, evts, 'chest');
        } else {
            var w = randomWeapon(rng);
            evts.push({ t: 'chest', id: id, node: node, k: 'weapon', w: w });
            giveItem(state, id, w, evts);
        }
    }

    // Biri (takımda takımın toplamı) hedefe FRENZY_STARS_LEFT yıldız ya da daha az kala 'Son Çılgınlık' başlar
    // (bir kez tetiklenir, oyun boyunca sürer): sandık sayıları ×2.
    function nearGoal(state) {
        var left = C.FRENZY_STARS_LEFT;
        if (state.mode === 'team') {
            return state.order.some(function (id) {
                var total = teamStars(state, state.P[id].t);
                return total < state.goal && state.goal - total <= left;
            });
        }
        return state.order.some(function (id) { var s = state.P[id].s; return s < state.goal && state.goal - s <= left; });
    }

    function spawnChests(state, g, rng, evts) {
        if (!state.fr && nearGoal(state)) {
            state.fr = 1;
            evts.push({ t: 'frenzy' });
        }
        var mult = state.fr ? 2 : 1;
        var free = g.map.nodes.filter(function (n) { return n.type === 'treasure' && !state.chests[n.id]; }).map(function (n) { return n.id; });
        free = rng.shuffle(free);
        var wanted = [];
        var i;
        for (i = 0; i < C.starChests(state.order.length) * mult; i++) wanted.push({ k: 'star', n: rng.f() < C.CHESTS.bigStarChance ? 2 : 1 });
        for (i = 0; i < C.CHESTS.weapon * mult; i++) wanted.push({ k: 'weapon' });
        wanted.forEach(function (chest, k) {
            if (k >= free.length) return;
            state.chests[free[k]] = chest;
            evts.push({ t: 'spawn', node: free[k], k: chest.k });
        });
        // sandığın üstünde duran oyuncu hemen alır
        Object.keys(state.chests).forEach(function (node) {
            node = Number(node);
            for (var j = 0; j < state.order.length; j++) {
                if (state.P[state.order[j]].pos === node) { collectChest(state, state.order[j], node, rng, evts); break; }
            }
        });
    }

    // Başlangıç düğümü güvenli bölgedir: orada duran oyuncu hasar almaz, hedef sunulmaz.
    function homeOf(state, p) { return state.home !== undefined ? state.home : p.home; }
    function isSafe(state, p) { return p.pos === homeOf(state, p); }

    // Mesafeye göre hasar: aynı kutucuk (mesafe 0) mesafe 1 hasarıyla aynıdır; tabloda olmayan mesafe null.
    function weaponDamage(def, d) {
        var v = def.dmg[Math.max(1, d)];
        return Number.isFinite(v) ? v : null;
    }

    // ---- Hasar / ölüm ----
    function die(state, id, evts) {
        var p = state.P[id];
        var killer = null;
        var best = 0;
        Object.keys(p.dmg).forEach(function (a) {
            if (state.P[a] && p.dmg[a] > best) { best = p.dmg[a]; killer = a; }
        });
        var lost = Math.min(C.DEATH_LOSS_MAX, Math.floor(p.s / 2));
        p.s -= lost;
        var at = p.pos;
        p.hp = C.MAX_HP;
        p.pos = p.home;
        p.dmg = {};            // ölümde tur atlatma yok: oyuncu hemen başlangıçta bir sonraki turda oynar
        evts.push({ t: 'death', id: id, killer: killer, lost: lost, at: at, to: p.home });
        if (killer && lost > 0) addStars(state, killer, lost, evts, 'kill');
        else checkWin(state);
    }

    // attacker: null olabilir (olay/tuzak/kendi bombası)
    function hit(state, victim, amount, attacker, evts) {
        var p = state.P[victim];
        // NaN/Infinity asla oluşmasın: geçersiz hasar yok sayılır; bozuk (sonlu olmayan) can onarılır.
        if (!Number.isFinite(p.hp)) p.hp = C.MAX_HP;
        if (!Number.isFinite(amount) || amount <= 0) return false;
        if (isSafe(state, p)) return false;          // güvenli bölge: kalkan harcanmaz, hasar yok
        if (p.shield) {
            p.shield = false;
            p.shl = 0;
            p.scd = C.SHIELD_COOLDOWN_TURNS + 1;       // kırıldı: sonraki 2 kendi turda yeniden kurulamaz (tur başı sayaç 3→0)
            evts.push({ t: 'block', id: victim, by: attacker });
            return false;
        }
        var dealt = Math.min(amount, p.hp);
        p.hp -= amount;
        if (attacker && attacker !== victim) p.dmg[attacker] = (p.dmg[attacker] || 0) + dealt;
        evts.push({ t: 'dmg', id: victim, by: attacker, n: amount });
        if (p.hp <= 0) die(state, victim, evts);
        return true;
    }

    // ---- Tur akışı ----
    // Her kendi tur başında: kurulu kalkanın süresi azalır (0'da düşer); kırılma sonrası bekleme sayacı azalır.
    function tickShield(p, evts) {
        if (p.shield) {
            p.shl = (Number.isFinite(p.shl) ? p.shl : C.SHIELD_TURNS) - 1;
            if (p.shl <= 0) {
                p.shield = false;
                p.shl = 0;
                evts.push({ t: 'shieldend', id: p.id });       // süre doldu: bekleme yok
            }
        }
        if (p.scd > 0) p.scd--;
    }

    function shieldBlocked(p) { return !!p.shield || p.scd > 0; }

    function nextTurn(state, g, rng, evts) {
        state.choices = null;
        state.steps = 0;
        var idx = state.turn + 1;
        for (var guard = 0; guard < 1000; guard++) {
            if (idx >= state.order.length) {
                state.stage = 'mini';
                state.mini = null;
                state.turn = state.order.length;
                return;
            }
            var p = state.P[state.order[idx]];
            tickShield(p, evts);                       // kendi tur sayacı (kalkan süresi / bekleme)
            if (p.sk > 0) {
                p.sk--;
                evts.push({ t: 'skip', id: p.id });
                idx++;
                continue;
            }
            state.turn = idx;
            state.stage = 'roll';
            state.atk = 0;              // her turda tek saldırı hakkı (zardan önce)
            return;
        }
    }

    function afterTile(state, g, rng, evts) {
        var id = current(state);
        var p = state.P[id];
        if (state.stage === 'over') return;
        var node = g.byId[p.pos];
        if (node.type === 'weapon') {
            var w = randomWeapon(rng);
            evts.push({ t: 'zone', id: id, w: w });
            giveItem(state, id, w, evts);
        } else if (node.type === 'event') {
            applyEvent(state, id, rng, evts);
        }
        if (state.stage === 'over') return;
        nextTurn(state, g, rng, evts);              // yürüyüş + kutucuk etkisi bitti: tur biter (silah yalnızca zardan önce)
    }

    function applyEvent(state, id, rng, evts) {
        var total = 0;
        C.EVENTS.forEach(function (e) { total += e.weight; });
        var r = rng.f() * total;
        var ev = C.EVENTS[C.EVENTS.length - 1];
        for (var i = 0; i < C.EVENTS.length; i++) {
            r -= C.EVENTS[i].weight;
            if (r < 0) { ev = C.EVENTS[i]; break; }
        }
        evts.push({ t: 'event', id: id, e: ev.id });
        var p = state.P[id];
        if (ev.id === 'star') addStars(state, id, 1, evts, 'event');
        else if (ev.id === 'damage') hit(state, id, ev.damage, null, evts);
        else if (ev.id === 'teleport') {
            evts[evts.length - 1].at = p.pos;       // eski kutucuk (arayüz balonu orada gösterir)
            evts[evts.length - 1].to = p.home;
            p.pos = p.home;
        }
        else if (ev.id === 'weapon') giveItem(state, id, randomWeapon(rng), evts);
        else if (ev.id === 'rest') p.sk = 1;
    }

    function move(state, g, id, w, rng, evts) {
        var p = state.P[id];
        w.path.forEach(function (node) { collectChest(state, id, node, rng, evts); });
        if (w.path.length) evts.push({ t: 'move', id: id, path: w.path.slice() });
        p.pos = w.pos;
        state.steps = w.remaining;
        if (state.stage === 'over') return;
        if (w.choices) {
            state.stage = 'choose';
            state.choices = w.choices;
        } else {
            state.choices = null;
            afterTile(state, g, rng, evts);
        }
    }

    // ---- Eylemler ----
    // action: { type: roll|dir|swap|use|end|forceskip, by, ... }. Dönen: { ok, state, events, error }
    function reduce(prev, action, ctx) {
        var state = clone(prev);
        var g = ctx.g;
        var rng = Rng(state, ctx);
        var evts = [];
        function fail(msg) { return { ok: false, state: prev, events: [], error: msg }; }
        function done() { state.rev = (state.rev || 0) + 1; return { ok: true, state: state, events: evts, error: null }; }

        if (!action || typeof action.type !== 'string') return fail('geçersiz eylem');
        if (state.stage === 'over' || state.stage === 'mini') {
            if (action.type !== 'forceskip') return fail('şu an eylem yok');
        }
        var id = current(state);
        if (action.type === 'forceskip') {
            if (state.stage === 'over' || state.stage === 'mini') return fail('şu an tur yok');
            nextTurn(state, g, rng, evts);
            return done();
        }
        if (action.by !== id) return fail('sıra sende değil');
        var p = state.P[id];

        switch (action.type) {
            case 'roll': {
                if (state.stage !== 'roll') return fail('zar atılamaz');
                var v = ctx.dice ? ctx.dice() : rng.int(C.DICE) + 1;
                evts.push({ t: 'roll', id: id, v: v });
                move(state, g, id, G.walk(g, p.pos, v), rng, evts);
                return done();
            }
            case 'dir': {
                if (state.stage !== 'choose') return fail('yön seçilemez');
                if (!validNode(g, action.to) || state.choices.indexOf(action.to) < 0) return fail('geçersiz yön');
                var w = G.walkVia(g, p.pos, state.steps, action.to);
                if (!w) return fail('geçersiz yön');
                move(state, g, id, w, rng, evts);
                return done();
            }
            case 'use': {
                if (state.stage !== 'roll') return fail('silah yalnızca zardan önce kullanılır');
                if (state.atk) return fail('bu turda saldırı hakkını kullandın');
                var wid = action.w;
                if (typeof wid !== 'string' || !Object.prototype.hasOwnProperty.call(C.WEAPONS, wid) || invCount(p, wid) < 1) return fail('geçersiz öğe');
                var def = C.WEAPONS[wid];
                if (def.kind === 'shield') {
                    if (p.shield) return fail('zaten kalkanın var');
                    if (p.scd > 0) return fail('kalkan henüz yeniden kurulamaz');
                    takeItem(p, wid);
                    p.shield = true;
                    p.shl = C.SHIELD_TURNS;
                    state.atk = 1;            // kalkan kurmak da turun saldırı hakkını harcar (zar atmak serbest)
                    evts.push({ t: 'shield', id: id });
                    return done();
                }
                if (def.kind === 'target') {
                    if (!validPlayer(state, action.target) || action.target === id) return fail('geçersiz hedef');
                    var tgt = state.P[action.target];
                    if (isTeammate(state, id, action.target)) return fail('takım arkadaşına saldırılamaz');
                    if (isSafe(state, tgt)) return fail('başlangıç güvenli bölgedir');
                    var d = G.distance(g, p.pos, tgt.pos);
                    if (d > def.range) return fail('hedef menzil dışında');
                    var dmg = weaponDamage(def, d);
                    if (dmg === null) return fail('hedef menzil dışında');
                    takeItem(p, wid);
                    evts.push({ t: 'attack', id: id, w: def.id, target: action.target });
                    hit(state, action.target, dmg, id, evts);
                } else {
                    var node = action.node;
                    if (!validNode(g, node)) return fail('geçersiz kutucuk');
                    if (node === homeOf(state, p)) return fail('başlangıç güvenli bölgedir');
                    if (G.distance(g, p.pos, node) > def.range) return fail('hedef menzil dışında');
                    takeItem(p, wid);
                    evts.push({ t: 'attack', id: id, w: def.id, node: node });
                    state.order.slice().forEach(function (vid) {
                        var v2 = state.P[vid];
                        if (v2.pos !== node) return;
                        if (vid !== id && isTeammate(state, id, vid)) return;      // takım arkadaşı yara almaz, kendi alır
                        hit(state, vid, def.damage, id, evts);
                    });
                }
                state.atk = 1;                // silah turu bitirmez: ardından zar atılır
                return done();
            }
            default:
                return fail('bilinmeyen eylem');
        }
    }

    // ---- Süre dolunca / bot ----
    function autoAction(state, ctx) {
        var rng = Rng(clone(state), ctx);
        var id = current(state);
        if (state.stage === 'roll') return { type: 'roll', by: id };
        if (state.stage === 'choose') return { type: 'dir', by: id, to: rng.pick(state.choices) };
        return null;
    }

    function attackOptions(state, ctx) {
        var g = ctx.g;
        var id = current(state);
        var p = state.P[id];
        var out = [];
        if (state.stage !== 'roll' || state.atk) return out;         // yalnızca zardan önce, turda tek saldırı hakkı
        C.WEAPON_IDS.forEach(function (w) {
            if (invCount(p, w) < 1) return;
            var def = C.WEAPONS[w];
            if (def.kind === 'target') {
                state.order.forEach(function (o) {
                    if (o === id || isTeammate(state, id, o) || isSafe(state, state.P[o])) return;     // güvenli bölgedekine hedef sunulmaz
                    if (G.distance(g, p.pos, state.P[o].pos) <= def.range) out.push({ type: 'use', by: id, w: w, target: o });
                });
            } else if (def.kind === 'area') {
                var seen = {};
                seen[p.pos] = true;          // atanın kendi kutucuğu hedef olarak sunulmaz (bot kendini bombalamasın)
                state.order.forEach(function (o) {
                    var pos = state.P[o].pos;
                    if (o === id || isTeammate(state, id, o) || seen[pos] || pos === homeOf(state, p)) return;
                    seen[pos] = true;
                    if (G.distance(g, p.pos, pos) <= def.range) out.push({ type: 'use', by: id, w: w, node: pos });
                });
            }
        });
        return out;
    }

    // Yakında rakip var mı (kalkan kurma kararı): başlangıç dışında, takım arkadaşı olmayan biri en çok 3 adım uzakta
    function rivalNear(state, ctx, steps) {
        var id = current(state);
        var p = state.P[id];
        return state.order.some(function (o) {
            if (o === id || isTeammate(state, id, o) || isSafe(state, state.P[o])) return false;
            return G.distance(ctx.g, p.pos, state.P[o].pos) <= steps;
        });
    }

    // Bot (zardan önce): kalkanı varsa ve yakında rakip varsa kurar; menzilde rakip varken %50 saldırır; sonra zar atar.
    function botAction(state, ctx) {
        var rng = Rng(clone(state), ctx);
        var id = current(state);
        var auto = autoAction(state, ctx);
        if (!auto || state.stage !== 'roll' || state.atk) return auto;
        var p = state.P[id];
        if (invCount(p, 'shield') > 0 && !shieldBlocked(p) && rivalNear(state, ctx, 3)) return { type: 'use', by: id, w: 'shield' };
        var opts = attackOptions(state, ctx);
        if (opts.length && rng.f() < 0.5) return rng.pick(opts);
        return auto;
    }

    // ---- Minioyun ----
    // Tur sonunda çalışacak minioyunun belirtimi: { type: 'ffa'|'duel', players: [id], seed, game?, pairs?, extra? }
    // Düello: yalnızca insanlar (botlar seçilmez) tohumlu karıştırılıp ardışık ÇİFTLERE bölünür; hepsi aynı oyunu aynı anda
    // oynar (game = C.DUEL_GAMES[seed % n]). Tek sayıda insanda sondaki kişi `extra`dır (ilk biten maçın kaybedeniyle ikinci
    // şans maçı oynar). pairs[k][0] o maçın ev sahibi (isHost). `players` = ilk çift (geri uyum). rng çekimi eskisiyle aynı
    // (2 insanda spec birebir aynı), eski tohumlu oyunlar değişmez. 1 insan -> çark (ffa).
    function minigameSpec(state, ctx) {
        var rng = Rng(state, ctx);
        var humans = state.order.filter(function (id) { return !state.P[id].bot; });
        var seed = Math.floor(rng.f() * 4294967296) >>> 0;
        if (humans.length >= 2) {
            // ctx.mini (test bayrağı ?mini=, yalnızca lider tarayıcısında okunur): her tur düello. rng çekimi bayraksızla
            // aynı sırada kalır, bayrak yokken davranış (%30) değişmez.
            var roll = rng.f();
            if (ctx.mini || roll < 0.3) {
                var shuffled = rng.shuffle(humans);
                var pairs = [];
                for (var i = 0; i + 1 < shuffled.length; i += 2) pairs.push([shuffled[i], shuffled[i + 1]]);
                var game = ctx.mini && ctx.mini.game ? ctx.mini.game : C.DUEL_GAMES[seed % C.DUEL_GAMES.length];
                return { type: 'duel', game: game, players: pairs[0].slice(), pairs: pairs, extra: shuffled.length % 2 ? shuffled[shuffled.length - 1] : null, seed: seed };
            }
        }
        return { type: 'ffa', players: state.order.slice(), seed: seed };
    }

    // Test bayrağı: adres satırındaki ?mini=duel (rastgele düello oyunu) ya da ?mini=duel:<oyun> (DUEL_GAMES'ten).
    // -> null (bayrak yok/geçersiz) | { game: null | oyun kimliği }
    function parseMiniFlag(search) {
        var m = /[?&]mini=([^&#]*)/.exec(search || '');
        if (!m) return null;
        var v = m[1];
        try { v = decodeURIComponent(v); } catch (e) { return null; }
        if (v === 'duel') return { game: null };
        var g = /^duel:(.+)$/.exec(v);
        if (g && C.DUEL_GAMES.indexOf(g[1]) >= 0) return { game: g[1] };
        return null;
    }

    // Eşit dereceli sıralamadan derece: [[a,b],[c]] -> a:1, b:1, c:3
    function ranksOf(ranking) {
        var ranks = {};
        var before = 0;
        ranking.forEach(function (group) {
            group.forEach(function (id) { ranks[id] = before + 1; });
            before += group.length;
        });
        return ranks;
    }

    // Minioyun sonucu -> ödüller, sonra yeni tur
    function applyMinigame(prev, result, ctx) {
        var state = clone(prev);
        var g = ctx.g;
        var rng = Rng(state, ctx);
        var evts = [];
        if (state.stage !== 'mini') return { ok: false, state: prev, events: [], error: 'minioyun zamanı değil' };
        // Derece 1/2/3 ödülü; derece yoksa (düello dışı) teselli. rank: 1 = kazanç, 2 = kayıp, ...
        function giveMini(id, rank) {
            if (!rank) {
                // Sıralamada yok (düelloda olmayan): teselli iyileşmesi
                var comfort = Math.min(C.MAX_HP, state.P[id].hp + C.MINI_CONSOLATION.heal) - state.P[id].hp;
                if (comfort > 0) {
                    state.P[id].hp += comfort;
                    evts.push({ t: 'heal', id: id, n: comfort });
                }
                return;
            }
            var reward = C.REWARDS[rank];
            if (!reward) return;
            evts.push({ t: 'reward', id: id, rank: rank });
            if (reward.stars) addStars(state, id, reward.stars, evts, 'mini');
            if (reward.weapon) giveItem(state, id, randomWeapon(rng), evts);
            if (reward.heal) {
                var healed = Math.min(C.MAX_HP, state.P[id].hp + reward.heal) - state.P[id].hp;
                state.P[id].hp += healed;
                evts.push({ t: 'heal', id: id, n: healed });
            }
            if (reward.shield) giveItem(state, id, 'shield', evts);
        }
        if (result && result.duelOutcome) {
            // Çoklu düello: sıralama/derece hesabı yok. Kazananlar REWARDS[1], kaybedenler ve beraberlikteler REWARDS[2],
            // düelloda olmayan (bot, kopan, düello dışı) herkes MINI_CONSOLATION. 3 kazanan + 3 kaybeden "4. derece" üretmez.
            var oc = result.duelOutcome;
            var inList = function (list, id) { return Array.isArray(list) && list.indexOf(id) >= 0; };
            state.order.forEach(function (id) {
                giveMini(id, inList(oc.win, id) ? 1 : (inList(oc.lose, id) || inList(oc.draw, id) ? 2 : 0));
            });
        } else {
            var ranks = ranksOf(result && result.ranking ? result.ranking : []);
            state.order.forEach(function (id) { giveMini(id, ranks[id]); });
        }
        state.rev = (state.rev || 0) + 1;
        if (state.stage === 'over') return { ok: true, state: state, events: evts, error: null };
        state.rd++;
        spawnChests(state, g, rng, evts);
        // Her turun başlangıç sırası bir kayar (ilk oynayan sona geçer): sabit ilk sıra avantajı olmasın.
        // Minioyun yalnızca ödülleri etkiler, sırayı etkilemez.
        if (state.order.length > 1) state.order.push(state.order.shift());
        state.turn = -1;
        state.mini = null;
        if (state.stage !== 'over') nextTurn(state, g, rng, evts);
        return { ok: true, state: state, events: evts, error: null };
    }

    // Koltuk ayrıldı (atıldı / süre doldu)
    function removePlayer(prev, id, ctx) {
        var state = clone(prev);
        var rng = Rng(state, ctx);
        var evts = [];
        var at = state.order.indexOf(id);
        if (at < 0) return { ok: false, state: prev, events: [], error: 'oyuncu yok' };
        var wasCurrent = at === state.turn && state.stage !== 'mini' && state.stage !== 'over';
        state.order.splice(at, 1);
        delete state.P[id];
        Object.keys(state.P).forEach(function (o) { delete state.P[o].dmg[id]; });
        if (at <= state.turn) state.turn--;
        if (state.order.length < 2) {
            state.stage = 'over';
            state.winner = state.order.length ? (state.mode === 'team' ? { kind: 'team', id: state.P[state.order[0]].t } : { kind: 'player', id: state.order[0] }) : null;
        } else if (wasCurrent) {
            nextTurn(state, ctx.g, rng, evts);
        } else if (state.stage === 'mini') {
            state.turn = state.order.length;
        } else {
            checkWin(state);
        }
        state.rev = (state.rev || 0) + 1;
        return { ok: true, state: state, events: evts, error: null };
    }

    // Kaç sıra sonra oyuncunun turu: 0 = şu an sırada. Bu turun kalanı (atlanacaklar sayılmaz), sonra bir sonraki turun
    // (sıra bir kaymış) sırası izlenir. Bulunamazsa (oyun/minioyun bitti, koltuk yok) null.
    function turnsUntil(state, id) {
        if (!state || state.stage === 'over' || state.stage === 'mini' || !state.P || !Object.prototype.hasOwnProperty.call(state.P, id)) return null;
        var n = state.order.length;
        if (n < 1 || state.order.indexOf(id) < 0) return null;
        var count = 0;
        if (state.order[state.turn] === id) return 0;
        for (var i = state.turn + 1; i < n; i++) {
            var q = state.P[state.order[i]];
            if (q.sk > 0) continue;                       // atlanacak: sıra sayılmaz
            count++;
            if (state.order[i] === id) return count;
        }
        var next = n > 1 ? state.order.slice(1).concat(state.order[0]) : state.order.slice();      // sonraki turda sıra bir kayar
        for (var j = 0; j < next.length; j++) {
            var r = state.P[next[j]];
            if (r.sk > 1) continue;
            count++;
            if (next[j] === id) return count;
        }
        return null;
    }

    // Oyun sonu sıralaması
    function standings(state) {
        if (state.mode === 'team') {
            var teams = {};
            state.order.forEach(function (id) {
                var p = state.P[id];
                (teams[p.t] = teams[p.t] || { t: p.t, s: 0, players: [] });
                teams[p.t].s += p.s;
                teams[p.t].players.push(id);
            });
            return Object.keys(teams).map(function (k) { return teams[k]; }).sort(function (a, b) { return b.s - a.s; });
        }
        return state.order.map(function (id) { return { id: id, s: state.P[id].s, hp: state.P[id].hp }; })
            .sort(function (a, b) { return b.s - a.s || b.hp - a.hp; });
    }

    return {
        createGame: createGame, reduce: reduce, autoAction: autoAction, botAction: botAction, attackOptions: attackOptions,
        minigameSpec: minigameSpec, parseMiniFlag: parseMiniFlag, applyMinigame: applyMinigame, ranksOf: ranksOf, removePlayer: removePlayer,
        standings: standings, turnsUntil: turnsUntil, teamStars: teamStars, current: current, isTeammate: isTeammate, spawnChests: spawnChests,
        checkWin: checkWin, clone: clone, nextRand: nextRand
    };
});
