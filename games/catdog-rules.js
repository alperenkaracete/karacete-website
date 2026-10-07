// Kedi - Köpek atış düellosu kuralları: saf fonksiyonlar, DOM ve ağdan bağımsız.
//
// Sahne ve rüzgâr tohumdan (seed) deterministik üretilir; atış hesabı sabit zaman adımlıdır.
// Her iki istemci aynı girdiyle aynı sonucu bulur, ağda yalnızca hamle gider.
//
// Determinizm kuralları: yalnızca + - * /, Math.sqrt, Math.imul kullanılır; sin/cos yalnızca tam
// sayı açılar için hesaplanıp 6 ondalığa yuvarlanır (motorlar arası 1 ulp farkını yutar);
// Math.hypot kullanılmaz.
//
// Koordinatlar: mantıksal 640x400, y aşağı doğru artar. Açı: 0 = sağ, 90 = yukarı, 180 = sol.
// Tahta: { seed, turn, catIndex, players:[{char,x,y,hp,cd}], last }; players[0] ilk başlayan.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CatDogRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var WIDTH = 640;
    var HEIGHT = 400;
    var PLATFORM_LEFT = 90;                 // x < 90: sol düz platform
    var PLATFORM_RIGHT = WIDTH - 90;        // x > 550: sağ düz platform
    var CHAR_X = 45;                        // karakterlerin kenardan uzaklığı
    var BODY_OFFSET = 18;                   // ayaktan gövde merkezine yükseklik
    var MUZZLE_OFFSET = 36;                 // ayaktan merminin çıkış noktasına yükseklik

    var GRAVITY = 600;                      // px/sn²
    var SPEED_PER_POWER = 7.5;              // px/sn, güç başına
    var WIND_ACCEL = 8;                     // px/sn², rüzgâr birimi başına
    var WIND_MAX = 10;                      // rüzgâr -10..+10
    var DT = 1 / 60;
    var MAX_STEPS = 60 * 20;                // en çok 20 sn uçuş
    var SAMPLE_EVERY = 6;                   // yörüngede kaç adımda bir nokta

    var MAX_HP = 100;
    var HIT_RADIUS = 14;
    var DIRECT_DAMAGE = 30;
    var BLAST_RADIUS = 40;
    var HEAL_AMOUNT = 25;
    var COOLDOWN = 3;                       // varsayılan bekleme (tur); güç başına değerler COOLDOWNS'ta
    // Güç başına bekleme: oyuncunun KENDİ sonraki hamleleri boyunca kapalı (wind 1 = bir tur atlar).
    var COOLDOWNS = { heal: 3, wind: 1, double: 3, big: 3, guide: 4 };
    var POWERUPS = ['wind', 'double', 'big', 'guide'];   // atışla kullanılanlar ('guide' fiziği değiştirmez, yalnız tam yolu gösterir)
    var POWER_KEYS = ['heal', 'wind', 'double', 'big', 'guide'];
    var TRAIL_FRACTION = 0.3;               // herkese açık nişan izi: yolun ilk %30'u

    // ---- Rastgele sayı üreteci (mulberry32) ----
    function mulberry32(seed) {
        var a = seed | 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function round1(v) { return Math.round(v * 10) / 10; }
    function round2(v) { return Math.round(v * 100) / 100; }
    function round6(v) { return Math.round(v * 1e6) / 1e6; }

    function distance(ax, ay, bx, by) {
        var dx = ax - bx;
        var dy = ay - by;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ---- Sahne ----
    var sceneCache = [];

    // { width, height, ground:[641 değer], cat:{x,y}, dog:{x,y} }; y = zemin yüksekliği (ayak noktası)
    function generateScene(seed) {
        seed = seed >>> 0;
        for (var c = 0; c < sceneCache.length; c++) {
            if (sceneCache[c].seed === seed) return sceneCache[c].scene;
        }
        var rng = mulberry32((seed ^ 0xA5A5A5A5) | 0);
        var leftY = 220 + Math.floor(rng() * 80);     // 220..299
        var rightY = 220 + Math.floor(rng() * 80);
        var hills = 3 + Math.floor(rng() * 3);        // 3..5 ara nokta
        var xs = [PLATFORM_LEFT];
        var ys = [leftY];
        for (var i = 1; i <= hills; i++) {
            xs.push(PLATFORM_LEFT + (PLATFORM_RIGHT - PLATFORM_LEFT) * i / (hills + 1));
            ys.push(150 + Math.floor(rng() * 190));   // 150..339
        }
        xs.push(PLATFORM_RIGHT);
        ys.push(rightY);

        var ground = [];
        for (var x = 0; x <= WIDTH; x++) {
            var y;
            if (x <= PLATFORM_LEFT) y = leftY;
            else if (x >= PLATFORM_RIGHT) y = rightY;
            else {
                var seg = 0;
                while (seg < xs.length - 2 && x > xs[seg + 1]) seg++;
                var t = (x - xs[seg]) / (xs[seg + 1] - xs[seg]);
                var s = t * t * (3 - 2 * t);          // smoothstep
                y = ys[seg] + (ys[seg + 1] - ys[seg]) * s;
            }
            ground.push(round2(y));
        }
        var scene = {
            width: WIDTH,
            height: HEIGHT,
            ground: ground,
            cat: { x: CHAR_X, y: ground[CHAR_X] },
            dog: { x: WIDTH - CHAR_X, y: ground[WIDTH - CHAR_X] }
        };
        sceneCache.push({ seed: seed, scene: scene });
        if (sceneCache.length > 6) sceneCache.shift();
        return scene;
    }

    // x konumundaki zemin yüksekliği (doğrusal ara değer; sınır dışı kenar değeri)
    function groundAt(scene, x) {
        if (x <= 0) return scene.ground[0];
        if (x >= scene.width) return scene.ground[scene.width];
        var i = Math.floor(x);
        var f = x - i;
        return scene.ground[i] + (scene.ground[i + 1] - scene.ground[i]) * f;
    }

    // ---- Rüzgâr ----
    // Tur için rüzgâr: -10..+10 tam sayı, tohum ve tur numarasından deterministik.
    function windFor(seed, turn) {
        var rng = mulberry32(((seed >>> 0) ^ Math.imul(turn + 1, 0x9E3779B1)) | 0);
        rng();   // ilk çıktıyı at (tohumlar birbirine yakınken dağılım için)
        return Math.floor(rng() * (2 * WIND_MAX + 1)) - WIND_MAX;
    }

    // Atışta uygulanan rüzgâr: "rüzgârsız atış" gücü rüzgârı sıfırlar.
    function shotWind(seed, turn, powerUp) {
        return powerUp === 'wind' ? 0 : windFor(seed, turn);
    }

    // ---- Atış hesabı ----
    function bodyCenter(pos) {
        return { x: pos.x, y: pos.y - BODY_OFFSET };
    }

    // Tek bir atışın uçuşu. target: hedef oyuncunun gövde merkezi.
    function flight(scene, from, target, angle, power, wind, blastRadius) {
        var rad = angle * Math.PI / 180;
        var speed = power * SPEED_PER_POWER;
        var vx = round6(Math.cos(rad)) * speed;
        var vy = -round6(Math.sin(rad)) * speed;
        var x = from.x;
        var y = from.y - MUZZLE_OFFSET;
        var ax = wind * WIND_ACCEL;
        var trajectory = [[round1(x), round1(y)]];
        var reason = 'timeout';
        var damage = 0;
        var hit = 'none';
        var steps = 0;

        for (var step = 1; step <= MAX_STEPS; step++) {
            vx += ax * DT;
            vy += GRAVITY * DT;
            x += vx * DT;
            y += vy * DT;
            steps = step;

            if (distance(x, y, target.x, target.y) <= HIT_RADIUS) {
                reason = 'player';
                hit = 'direct';
                damage = DIRECT_DAMAGE;
                break;
            }
            if (x < 0 || x > scene.width || y > scene.height) {
                reason = 'out';
                break;
            }
            if (y >= groundAt(scene, x)) {
                reason = 'terrain';
                var d = distance(x, y, target.x, target.y);
                if (d < blastRadius) {
                    damage = Math.round(DIRECT_DAMAGE * (1 - d / blastRadius));
                    if (damage > 0) hit = 'area';
                }
                break;
            }
            if (step % SAMPLE_EVERY === 0) trajectory.push([round1(x), round1(y)]);
        }
        trajectory.push([round1(x), round1(y)]);
        return {
            trajectory: trajectory,
            frames: steps,
            end: { x: round1(x), y: round1(y), reason: reason },
            hit: hit,
            damage: damage,
            blastRadius: blastRadius
        };
    }

    // simulateShot({ seed, turn, shooter, angle, power, powerUp, positions, hp, windOverride? })
    //   positions: [{x,y}, {x,y}] (ayak noktaları, oyuncu indeksine göre), hp: [hp0, hp1]
    // -> { seed, turn, shooter, wind, powerUp, shots:[{trajectory, frames, end, hit, damage, blastRadius, hpAfter}], hpAfter }
    function simulateShot(p) {
        var scene = p.scene || generateScene(p.seed);
        var wind = p.windOverride !== undefined ? p.windOverride : shotWind(p.seed, p.turn, p.powerUp);
        var shooter = p.shooter;
        var target = 1 - shooter;
        var hp = p.hp.slice();
        var shots = [];
        var count = p.powerUp === 'double' ? 2 : 1;
        var blast = p.powerUp === 'big' ? BLAST_RADIUS * 2 : BLAST_RADIUS;
        var targetCenter = bodyCenter(p.positions[target]);

        for (var i = 0; i < count; i++) {
            if (hp[target] <= 0) break;   // ilk atış öldürdüyse ikincisi yapılmaz
            var one = flight(scene, p.positions[shooter], targetCenter, p.angle, p.power, wind, blast);
            hp[target] = Math.max(0, hp[target] - one.damage);
            one.hpAfter = hp.slice();
            shots.push(one);
        }
        return { seed: p.seed, turn: p.turn, shooter: shooter, wind: wind, powerUp: p.powerUp || null, shots: shots, hpAfter: hp };
    }

    // Nişan izi (yalnız çizim yardımı): index'in verilen açı/güçle ATACAĞI ilk merminin yolu, simulateShot ile aynı hesap.
    // fraction (0-1): yolun ilk kısmı, örnek noktası sayısına göre (en az 2 nokta); 1 = tam yol. powerUp 'wind' seçiliyse
    // rüzgâr 0 ile hesaplanır. Fizik değişmez: dönen nokta dizisi gerçek atışın trajectory'sinin ön ekidir.
    function aimPath(board, index, angle, power, powerUp, fraction) {
        var sim = simulateShot({
            seed: board.seed, turn: board.turn, shooter: index, angle: angle, power: power, powerUp: powerUp || null,
            positions: board.players, hp: [MAX_HP, MAX_HP]
        });
        var shot = sim.shots[0];
        var traj = shot.trajectory;
        var f = fraction === undefined ? 1 : Math.max(0, Math.min(1, fraction));
        var n = Math.max(2, Math.min(traj.length, Math.ceil(f * (traj.length - 1)) + 1));
        return { points: traj.slice(0, n), full: n === traj.length, end: shot.end, wind: sim.wind };
    }

    // Güç düğmelerinin durumu (saf; arayüz bunu okur). Seçilen atış gücü BAĞLANIR: seçildikten sonra o tur iptal edilemez,
    // başka güç seçilemez; yalnız atış kalır. Böylece 🧭 gibi güçler bedava önizleme/açı ayarı için kullanılamaz.
    //   controlState({ enabled, powerUp, cd }) -> { locked, buttons: { <anahtar>: { disabled, selected, left } } }
    function controlState(s) {
        var cd = s.cd || {};
        var locked = !!s.enabled && !!s.powerUp;
        var buttons = {};
        POWER_KEYS.forEach(function (key) {
            var left = cd[key] > 0 ? cd[key] : 0;
            buttons[key] = {
                disabled: !s.enabled || left > 0 || locked,
                selected: s.powerUp === key,
                left: left
            };
        });
        return { locked: locked, buttons: buttons };
    }

    // ---- Duel kuralları arayüzü ----
    function initial(start) {
        start = start || {};
        var seed = Number.isInteger(start.seed) ? start.seed >>> 0 : 0;
        var order = start.order || [null, null];
        var catIndex = order[0] !== null && order[0] === start.cat ? 0 : 1;
        var scene = generateScene(seed);
        var players = [];
        for (var i = 0; i < 2; i++) {
            var char = i === catIndex ? 'cat' : 'dog';
            players.push({
                char: char,
                x: scene[char].x,
                y: scene[char].y,
                hp: MAX_HP,
                cd: { heal: 0, wind: 0, double: 0, big: 0, guide: 0 }
            });
        }
        return { seed: seed, turn: 0, catIndex: catIndex, players: players, last: null };
    }

    // Host start mesajına tohumu ve kedi oyuncuyu ekler (oda kurucusu = kedi).
    function createStart(info) {
        return { seed: Math.floor(info.random() * 4294967296) >>> 0, cat: info.hostId };
    }

    function parseStart(data, info) {
        if (!Number.isInteger(data.seed) || data.seed < 0 || data.seed > 4294967295) return null;
        if (data.cat !== info.hostId) return null;   // kedi her zaman oda kurucusudur
        return { seed: data.seed, cat: data.cat };
    }

    // Mesaj: cd_shot { turn, angle, power, powerUp } | cd_heal { turn }
    function parse(data) {
        if (data.type === 'cd_shot') {
            if (!Number.isInteger(data.turn) || !Number.isInteger(data.angle) || !Number.isInteger(data.power)) return null;
            var up = data.powerUp === undefined ? null : data.powerUp;
            if (up !== null && typeof up !== 'string') return null;
            return { kind: 'shot', turn: data.turn, angle: data.angle, power: data.power, powerUp: up };
        }
        if (data.type === 'cd_heal') {
            if (!Number.isInteger(data.turn)) return null;
            return { kind: 'heal', turn: data.turn };
        }
        return null;
    }

    function toMessage(move) {
        if (move.kind === 'heal') return { type: 'cd_heal', turn: move.turn };
        return { type: 'cd_shot', turn: move.turn, angle: move.angle, power: move.power, powerUp: move.powerUp || null };
    }

    function validate(board, move, index) {
        if (index !== 0 && index !== 1) return false;
        if (!move || !Number.isInteger(move.turn) || move.turn !== board.turn) return false;
        if (board.players[0].hp <= 0 || board.players[1].hp <= 0) return false;
        var me = board.players[index];
        if (move.kind === 'heal') return me.cd.heal === 0;
        if (move.kind !== 'shot') return false;
        if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle > 180) return false;
        if (!Number.isInteger(move.power) || move.power < 0 || move.power > 100) return false;
        if (move.powerUp !== null && move.powerUp !== undefined) {
            if (POWERUPS.indexOf(move.powerUp) === -1) return false;
            if (me.cd[move.powerUp] !== 0) return false;
        }
        return true;
    }

    function apply(board, move, index) {
        var players = board.players.map(function (pl) {
            return { char: pl.char, x: pl.x, y: pl.y, hp: pl.hp, cd: { heal: pl.cd.heal, wind: pl.cd.wind, double: pl.cd.double, big: pl.cd.big, guide: pl.cd.guide || 0 } };
        });
        var me = players[index];
        var used = null;
        var last;

        if (move.kind === 'heal') {
            var before = me.hp;
            me.hp = Math.min(MAX_HP, me.hp + HEAL_AMOUNT);
            used = 'heal';
            last = { kind: 'heal', shooter: index, turn: board.turn, healed: me.hp - before };
        } else {
            var sim = simulateShot({
                seed: board.seed, turn: board.turn, shooter: index,
                angle: move.angle, power: move.power, powerUp: move.powerUp || null,
                positions: players, hp: players.map(function (pl) { return pl.hp; })
            });
            players[0].hp = sim.hpAfter[0];
            players[1].hp = sim.hpAfter[1];
            used = move.powerUp || null;
            last = {
                kind: 'shot', shooter: index, turn: board.turn, wind: sim.wind, powerUp: sim.powerUp,
                angle: move.angle, power: move.power, shots: sim.shots
            };
        }

        // Bekleme: oyuncunun her hamlesinden sonra azalır; bu hamlede kullanılan güç COOLDOWNS değerine kurulur.
        POWER_KEYS.forEach(function (key) { if (me.cd[key] > 0) me.cd[key]--; });
        if (used) me.cd[used] = COOLDOWNS[used] === undefined ? COOLDOWN : COOLDOWNS[used];

        return {
            board: { seed: board.seed, turn: board.turn + 1, catIndex: board.catIndex, players: players, last: last },
            cell: null
        };
    }

    function result(board) {
        if (board.players[0].hp <= 0) return { status: 'win', winner: 1 };
        if (board.players[1].hp <= 0) return { status: 'win', winner: 0 };
        return null;
    }

    return {
        WIDTH: WIDTH, HEIGHT: HEIGHT, PLATFORM_LEFT: PLATFORM_LEFT, PLATFORM_RIGHT: PLATFORM_RIGHT,
        GRAVITY: GRAVITY, SPEED_PER_POWER: SPEED_PER_POWER, WIND_ACCEL: WIND_ACCEL, WIND_MAX: WIND_MAX,
        DT: DT, SAMPLE_EVERY: SAMPLE_EVERY, MAX_HP: MAX_HP, HIT_RADIUS: HIT_RADIUS, DIRECT_DAMAGE: DIRECT_DAMAGE,
        BLAST_RADIUS: BLAST_RADIUS, HEAL_AMOUNT: HEAL_AMOUNT, COOLDOWN: COOLDOWN, COOLDOWNS: COOLDOWNS, TRAIL_FRACTION: TRAIL_FRACTION, POWERUPS: POWERUPS,
        BODY_OFFSET: BODY_OFFSET, MUZZLE_OFFSET: MUZZLE_OFFSET,
        messageTypes: ['cd_shot', 'cd_heal'],
        mulberry32: mulberry32, generateScene: generateScene, groundAt: groundAt, bodyCenter: bodyCenter,
        windFor: windFor, shotWind: shotWind, simulateShot: simulateShot, aimPath: aimPath, controlState: controlState,
        initial: initial, createStart: createStart, parseStart: parseStart,
        parse: parse, toMessage: toMessage, validate: validate, apply: apply, result: result
    };
});
