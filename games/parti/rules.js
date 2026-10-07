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
            goal: opts.cfg.goal || C.DEFAULT_GOAL,
            mapId: opts.cfg.map,
            rd: 1, turn: 0, stage: 'roll', steps: 0, choices: null,
            order: [], P: {}, chests: {}, mini: null, winner: null
        };
        var rng = Rng(state, ctx);
        var seats = rng.shuffle(opts.seats);
        seats.forEach(function (s, i) {
            state.order.push(s.id);
            state.P[s.id] = {
                id: s.id, n: s.name, av: s.av, t: state.mode === 'team' ? s.t : -1, bot: !!s.bot,
                hp: C.MAX_HP, s: 0, w: [], pos: g.starts[i % g.starts.length], home: g.starts[i % g.starts.length],
                sk: 0, shield: false, dmg: {}, offers: []
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

    function giveItem(state, id, w, evts, allowOffer) {
        var p = state.P[id];
        if (p.w.length < C.INVENTORY) {
            p.w.push(w);
            evts.push({ t: 'item', id: id, w: w });
        } else if (allowOffer) {
            p.offers.push(w);
        } else if (w === 'shield' && !p.shield) {
            p.shield = true;
            evts.push({ t: 'shield', id: id });
        } else {
            evts.push({ t: 'lost', id: id, w: w });
        }
    }

    function randomWeapon(rng) { return rng.pick(C.WEAPON_IDS); }

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
            giveItem(state, id, w, evts, true);
        }
    }

    function spawnChests(state, g, rng, evts) {
        var free = g.map.nodes.filter(function (n) { return n.type === 'treasure' && !state.chests[n.id]; }).map(function (n) { return n.id; });
        free = rng.shuffle(free);
        var wanted = [];
        var i;
        for (i = 0; i < C.CHESTS.star; i++) wanted.push({ k: 'star', n: rng.f() < C.CHESTS.bigStarChance ? 2 : 1 });
        for (i = 0; i < C.CHESTS.weapon; i++) wanted.push({ k: 'weapon' });
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

    // ---- Hasar / ölüm ----
    function die(state, id, evts) {
        var p = state.P[id];
        var killer = null;
        var best = 0;
        Object.keys(p.dmg).forEach(function (a) {
            if (state.P[a] && p.dmg[a] > best) { best = p.dmg[a]; killer = a; }
        });
        var lost = Math.floor(p.s / 2);
        p.s -= lost;
        var at = p.pos;
        p.hp = C.MAX_HP;
        p.pos = p.home;
        p.sk = 1;
        p.dmg = {};
        p.offers = [];
        evts.push({ t: 'death', id: id, killer: killer, lost: lost, at: at, to: p.home });
        if (killer && lost > 0) addStars(state, killer, lost, evts, 'kill');
        else checkWin(state);
    }

    // attacker: null olabilir (olay/tuzak/kendi bombası)
    function hit(state, victim, amount, attacker, evts) {
        var p = state.P[victim];
        if (p.shield) {
            p.shield = false;
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
            if (p.sk > 0) {
                p.sk--;
                evts.push({ t: 'skip', id: p.id });
                idx++;
                continue;
            }
            state.turn = idx;
            state.stage = 'roll';
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
            giveItem(state, id, w, evts, true);
        } else if (node.type === 'event') {
            applyEvent(state, id, rng, evts);
        }
        if (state.stage === 'over') return;
        var died = evts.some(function (e) { return e.t === 'death' && e.id === id; });
        if (died) {
            nextTurn(state, g, rng, evts);          // turunda öldü: tur biter
            return;
        }
        state.stage = p.offers.length ? 'swap' : 'act';
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
        else if (ev.id === 'weapon') giveItem(state, id, randomWeapon(rng), evts, true);
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
        function done() { return { ok: true, state: state, events: evts, error: null }; }

        if (!action || typeof action.type !== 'string') return fail('geçersiz eylem');
        if (state.stage === 'over' || state.stage === 'mini') {
            if (action.type !== 'forceskip') return fail('şu an eylem yok');
        }
        var id = current(state);
        if (action.type === 'forceskip') {
            if (state.stage === 'over' || state.stage === 'mini') return fail('şu an tur yok');
            state.P[id].offers = [];
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
                var w = G.walkVia(g, p.pos, state.steps, action.to);
                if (!w || state.choices.indexOf(action.to) < 0) return fail('geçersiz yön');
                move(state, g, id, w, rng, evts);
                return done();
            }
            case 'swap': {
                if (state.stage !== 'swap' || !p.offers.length) return fail('seçim yok');
                var offer = p.offers.shift();
                var drop = action.drop;
                if (drop !== -1 && !(Number.isInteger(drop) && drop >= 0 && drop < p.w.length)) { p.offers.unshift(offer); return fail('geçersiz seçim'); }
                if (drop >= 0) { var old = p.w.splice(drop, 1)[0]; p.w.push(offer); evts.push({ t: 'swap', id: id, w: offer, old: old }); }
                else evts.push({ t: 'decline', id: id, w: offer });
                if (!p.offers.length) state.stage = 'act';
                return done();
            }
            case 'use': {
                if (state.stage !== 'act') return fail('silah şu an kullanılamaz');
                var idx = action.item;
                if (!Number.isInteger(idx) || idx < 0 || idx >= p.w.length) return fail('geçersiz öğe');
                var def = C.WEAPONS[p.w[idx]];
                if (def.kind === 'shield') {
                    if (p.shield) return fail('zaten kalkanın var');
                    p.w.splice(idx, 1);
                    p.shield = true;
                    evts.push({ t: 'shield', id: id });
                    return done();            // tur harcanmaz
                }
                if (def.kind === 'target') {
                    var tgt = state.P[action.target];
                    if (!tgt || action.target === id) return fail('geçersiz hedef');
                    if (isTeammate(state, id, action.target)) return fail('takım arkadaşına saldırılamaz');
                    var d = G.distance(g, p.pos, tgt.pos);
                    if (d > def.range) return fail('hedef menzil dışında');
                    p.w.splice(idx, 1);
                    evts.push({ t: 'attack', id: id, w: def.id, target: action.target });
                    hit(state, action.target, def.dmg[d], id, evts);
                } else {
                    var node = action.node;
                    if (!g.byId[node]) return fail('geçersiz kutucuk');
                    if (G.distance(g, p.pos, node) > def.range) return fail('hedef menzil dışında');
                    p.w.splice(idx, 1);
                    evts.push({ t: 'attack', id: id, w: def.id, node: node });
                    state.order.slice().forEach(function (vid) {
                        var v2 = state.P[vid];
                        if (v2.pos !== node) return;
                        if (vid !== id && isTeammate(state, id, vid)) return;      // takım arkadaşı yara almaz, kendi alır
                        hit(state, vid, def.damage, id, evts);
                    });
                }
                if (state.stage !== 'over') nextTurn(state, g, rng, evts);
                return done();
            }
            case 'end': {
                if (state.stage !== 'act') return fail('tur şimdi bitirilemez');
                nextTurn(state, g, rng, evts);
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
        if (state.stage === 'swap') return { type: 'swap', by: id, drop: -1 };
        if (state.stage === 'act') return { type: 'end', by: id };
        return null;
    }

    function attackOptions(state, ctx) {
        var g = ctx.g;
        var id = current(state);
        var p = state.P[id];
        var out = [];
        p.w.forEach(function (w, i) {
            var def = C.WEAPONS[w];
            if (def.kind === 'target') {
                state.order.forEach(function (o) {
                    if (o === id || isTeammate(state, id, o)) return;
                    if (G.distance(g, p.pos, state.P[o].pos) <= def.range) out.push({ type: 'use', by: id, item: i, target: o });
                });
            } else if (def.kind === 'area') {
                var seen = {};
                state.order.forEach(function (o) {
                    var pos = state.P[o].pos;
                    if (o === id || isTeammate(state, id, o) || seen[pos]) return;
                    seen[pos] = true;
                    if (G.distance(g, p.pos, pos) <= def.range) out.push({ type: 'use', by: id, item: i, node: pos });
                });
            }
        });
        return out;
    }

    // Bot: zar, rastgele yön; menzilde rakip varken %50 olasılıkla silah; kalkanı varsa kurar.
    function botAction(state, ctx) {
        var rng = Rng(clone(state), ctx);
        var id = current(state);
        var auto = autoAction(state, ctx);
        if (!auto || state.stage !== 'act') return auto;
        var p = state.P[id];
        var si = p.w.indexOf('shield');
        if (si >= 0 && !p.shield) return { type: 'use', by: id, item: si };
        var opts = attackOptions(state, ctx);
        if (opts.length && rng.f() < 0.5) return rng.pick(opts);
        return auto;
    }

    // ---- Minioyun ----
    // Tur sonunda çalışacak minioyunun belirtimi: { type: 'ffa'|'duel', players: [id], seed }
    function minigameSpec(state, ctx) {
        var rng = Rng(state, ctx);
        var humans = state.order.filter(function (id) { return !state.P[id].bot; });
        var seed = Math.floor(rng.f() * 4294967296) >>> 0;
        if (humans.length >= 2 && rng.f() < 0.3) {
            var pair = rng.shuffle(humans).slice(0, 2);
            return { type: 'duel', players: pair, seed: seed };
        }
        return { type: 'ffa', players: state.order.slice(), seed: seed };
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
        var ranks = ranksOf(result && result.ranking ? result.ranking : []);
        state.order.forEach(function (id) {
            var rank = ranks[id];
            var reward = rank && C.REWARDS[rank];
            if (!reward) return;
            evts.push({ t: 'reward', id: id, rank: rank });
            if (reward.stars) addStars(state, id, reward.stars, evts, 'mini');
            if (reward.weapon) giveItem(state, id, randomWeapon(rng), evts, false);
            if (reward.shield) giveItem(state, id, 'shield', evts, false);
        });
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
        return { ok: true, state: state, events: evts, error: null };
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
        minigameSpec: minigameSpec, applyMinigame: applyMinigame, ranksOf: ranksOf, removePlayer: removePlayer,
        standings: standings, teamStars: teamStars, current: current, isTeammate: isTeammate, spawnChests: spawnChests,
        checkWin: checkWin, clone: clone, nextRand: nextRand
    };
});
