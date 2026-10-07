const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../games/catdog-rules.js');

function startBoard(seed, cat) {
    return R.initial({ seed, order: ['A', 'B'], cat: cat || 'A' });
}

function positionsOf(board) {
    return board.players.map((p) => ({ x: p.x, y: p.y }));
}

// Sahnede verilen atıcı için koşulu sağlayan ilk (açı, güç) çiftini arar.
function findShot(board, shooter, predicate, powerUp) {
    for (let angle = 0; angle <= 180; angle++) {
        for (let power = 0; power <= 100; power++) {
            const sim = R.simulateShot({
                seed: board.seed, turn: board.turn, shooter, angle, power, powerUp: powerUp || null,
                positions: positionsOf(board), hp: board.players.map((p) => p.hp)
            });
            if (predicate(sim.shots[0], sim)) return { angle, power, sim };
        }
    }
    return null;
}

test('mulberry32: aynı tohum aynı dizi, değerler [0,1) aralığında', () => {
    const a = R.mulberry32(123);
    const b = R.mulberry32(123);
    const c = R.mulberry32(124);
    let differs = false;
    for (let i = 0; i < 50; i++) {
        const x = a();
        assert.equal(x, b());
        assert.ok(x >= 0 && x < 1);
        if (x !== c()) differs = true;
    }
    assert.ok(differs);
});

test('sahne aynı tohumdan aynı üretilir, farklı tohumdan farklı', () => {
    const s1 = R.generateScene(777);
    assert.deepEqual(R.generateScene(777).ground, s1.ground);
    assert.notDeepEqual(R.generateScene(778).ground, s1.ground);
});

test('sahne yapısı: iki yanda düz platform, karakterler zeminde, yükseklikler sınır içinde', () => {
    for (let seed = 1; seed <= 60; seed++) {
        const sc = R.generateScene(seed);
        assert.equal(sc.ground.length, R.WIDTH + 1);
        for (let x = 0; x <= R.PLATFORM_LEFT; x++) assert.equal(sc.ground[x], sc.ground[0], 'sol platform düz');
        for (let x = R.PLATFORM_RIGHT; x <= R.WIDTH; x++) assert.equal(sc.ground[x], sc.ground[R.WIDTH], 'sağ platform düz');
        for (const y of sc.ground) assert.ok(y >= 150 && y <= 340, 'zemin yüksekliği ' + y);
        assert.equal(sc.cat.y, sc.ground[sc.cat.x]);
        assert.equal(sc.dog.y, sc.ground[sc.dog.x]);
        assert.ok(sc.cat.x < R.PLATFORM_LEFT && sc.dog.x > R.PLATFORM_RIGHT);
    }
});

test('rüzgâr: deterministik, -10..10 tam sayı, turlar arasında değişir, iki yönde de eser', () => {
    const seen = new Set();
    for (let turn = 0; turn < 200; turn++) {
        const w = R.windFor(99, turn);
        assert.equal(w, R.windFor(99, turn));
        assert.ok(Number.isInteger(w) && w >= -10 && w <= 10);
        seen.add(w);
    }
    assert.ok(seen.size >= 15, 'çeşitli değerler: ' + seen.size);
    assert.ok([...seen].some((w) => w < 0) && [...seen].some((w) => w > 0));
    let sameAcrossSeeds = 0;
    for (let turn = 0; turn < 50; turn++) if (R.windFor(1, turn) === R.windFor(2, turn)) sameAcrossSeeds++;
    assert.ok(sameAcrossSeeds < 25);
});

test('shotWind: rüzgârsız atış 0, diğerleri turun rüzgârı', () => {
    for (let turn = 0; turn < 30; turn++) {
        assert.equal(R.shotWind(5, turn, 'wind'), 0);
        assert.equal(R.shotWind(5, turn, null), R.windFor(5, turn));
        assert.equal(R.shotWind(5, turn, 'double'), R.windFor(5, turn));
        assert.equal(R.shotWind(5, turn, 'big'), R.windFor(5, turn));
    }
});

test('simulateShot: aynı girdi aynı sonucu verir ve girdileri değiştirmez', () => {
    const board = startBoard(42);
    const input = {
        seed: 42, turn: 3, shooter: 0, angle: 40, power: 70, powerUp: null,
        positions: positionsOf(board), hp: [100, 100]
    };
    const before = JSON.stringify(input);
    const a = R.simulateShot(input);
    const b = R.simulateShot(input);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(input), before);
    assert.ok(a.shots[0].trajectory.length > 3);
    assert.ok(a.shots[0].frames > 0);
});

test('rüzgârsız atış rüzgâr değerini yok sayar', () => {
    const board = startBoard(42);
    let turnA = -1;
    let turnB = -1;
    for (let t = 0; t < 100; t++) {
        if (R.windFor(42, t) === 0) continue;
        if (turnA < 0) turnA = t;
        else if (R.windFor(42, t) !== R.windFor(42, turnA)) { turnB = t; break; }
    }
    assert.ok(turnA >= 0 && turnB >= 0);
    const base = { seed: 42, shooter: 0, angle: 45, power: 76, positions: positionsOf(board), hp: [100, 100] };
    const noWindA = R.simulateShot({ ...base, turn: turnA, powerUp: 'wind' });
    const noWindB = R.simulateShot({ ...base, turn: turnB, powerUp: 'wind' });
    const zero = R.simulateShot({ ...base, turn: turnA, powerUp: null, windOverride: 0 });
    assert.equal(noWindA.wind, 0);
    assert.deepEqual(noWindA.shots, noWindB.shots);          // farklı rüzgârlı turlarda aynı yörünge
    assert.deepEqual(noWindA.shots, zero.shots);             // rüzgâr = 0 ile aynı
    const windy = R.simulateShot({ ...base, turn: turnA, powerUp: null });
    assert.notEqual(windy.wind, 0);
    assert.notDeepEqual(windy.shots[0].trajectory, noWindA.shots[0].trajectory);   // normal atışta rüzgâr etkili
});

test('rüzgâr yörüngeyi kaydırır: arkadan esen rüzgâr daha uzağa taşır', () => {
    const board = startBoard(9);
    const base = { seed: 9, turn: 0, shooter: 0, angle: 45, power: 60, powerUp: null, positions: positionsOf(board), hp: [100, 100] };
    const calm = R.simulateShot({ ...base, windOverride: 0 }).shots[0].end.x;
    const tail = R.simulateShot({ ...base, windOverride: 10 }).shots[0].end.x;
    const head = R.simulateShot({ ...base, windOverride: -10 }).shots[0].end.x;
    assert.ok(tail > calm && calm > head, `${head} < ${calm} < ${tail}`);
});

test('doğrudan isabet 30 hasar verir', () => {
    const board = startBoard(1);
    const found = findShot(board, 0, (s) => s.hit === 'direct');
    assert.ok(found, 'doğrudan isabet veren atış bulunmalı');
    const s = found.sim.shots[0];
    assert.equal(s.damage, 30);
    assert.equal(s.end.reason, 'player');
    assert.deepEqual(found.sim.hpAfter, [100, 70]);
});

test('alan hasarı mesafeyle doğrusal azalır, yarıçap dışında 0', () => {
    const board = startBoard(1);
    const base = { seed: 1, turn: 0, shooter: 0, angle: 45, power: 60, powerUp: null, windOverride: 0, hp: [100, 100] };
    const ref = R.simulateShot({ ...base, positions: positionsOf(board) }).shots[0];
    assert.equal(ref.end.reason, 'terrain');
    const impact = ref.end;
    const damageAt = (dx, powerUp) => {
        // rakibin gövde merkezi (impact.x + dx, impact.y) olacak şekilde yerleştir
        const positions = [positionsOf(board)[0], { x: impact.x + dx, y: impact.y + R.BODY_OFFSET }];
        return R.simulateShot({ ...base, powerUp, positions }).shots[0];
    };
    const expected = (d, radius) => Math.max(0, Math.round(30 * (1 - d / radius)));
    let previous = 31;
    for (const dx of [15, 20, 25, 30, 35, 39]) {
        const s = damageAt(dx, null);
        assert.equal(s.hit, expected(dx, 40) > 0 ? 'area' : 'none');
        assert.ok(Math.abs(s.damage - expected(dx, 40)) <= 1, `dx=${dx}: ${s.damage}`);
        assert.ok(s.damage <= previous);
        previous = s.damage;
    }
    assert.equal(damageAt(45, null).damage, 0);
    assert.equal(damageAt(45, null).hit, 'none');
});

test('büyük patlama hasar yarıçapını 2 katına çıkarır', () => {
    const board = startBoard(1);
    const base = { seed: 1, turn: 0, shooter: 0, angle: 45, power: 60, windOverride: 0, hp: [100, 100] };
    const impact = R.simulateShot({ ...base, powerUp: null, positions: positionsOf(board) }).shots[0].end;
    const positions = [positionsOf(board)[0], { x: impact.x + 60, y: impact.y + R.BODY_OFFSET }];
    const normal = R.simulateShot({ ...base, powerUp: null, positions }).shots[0];
    const big = R.simulateShot({ ...base, powerUp: 'big', positions }).shots[0];
    assert.equal(normal.damage, 0);
    assert.equal(normal.blastRadius, 40);
    assert.equal(big.blastRadius, 80);
    assert.ok(big.damage > 0, 'yarıçap 80 içinde: ' + big.damage);
    assert.ok(Math.abs(big.damage - Math.round(30 * (1 - 60 / 80))) <= 1);
});

test('sahne dışına çıkan atış pas geçer; kendine hasar yok', () => {
    const board = startBoard(1);
    const out = R.simulateShot({ seed: 1, turn: 0, shooter: 0, angle: 180, power: 100, powerUp: null, positions: positionsOf(board), hp: [100, 100] });
    assert.equal(out.shots[0].end.reason, 'out');
    assert.equal(out.shots[0].damage, 0);
    const up = R.simulateShot({ seed: 1, turn: 0, shooter: 0, angle: 90, power: 100, powerUp: null, windOverride: 0, positions: positionsOf(board), hp: [100, 100] });
    assert.deepEqual(up.hpAfter, [100, 100]);   // dik atış geri düşse de atıcıya hasar vermez
});

test('çift atış iki ayrı sonuç üretir; ikinci atış ilkinden sonraki cana uygulanır', () => {
    const board = startBoard(1);
    const found = findShot(board, 0, (s) => s.hit === 'direct');
    const double = R.simulateShot({
        seed: 1, turn: 0, shooter: 0, angle: found.angle, power: found.power, powerUp: 'double',
        positions: positionsOf(board), hp: [100, 100]
    });
    assert.equal(double.shots.length, 2);
    assert.deepEqual(double.shots[0].trajectory, double.shots[1].trajectory);   // aynı açı, güç ve rüzgâr
    assert.deepEqual(double.shots[0].hpAfter, [100, 70]);
    assert.deepEqual(double.shots[1].hpAfter, [100, 40]);
    assert.deepEqual(double.hpAfter, [100, 40]);
    assert.equal(double.wind, R.windFor(1, 0));    // çift atışta rüzgâr normal
});

test('çift atışta ilk atış öldürürse ikinci atış yapılmaz', () => {
    const board = startBoard(1);
    const found = findShot(board, 0, (s) => s.hit === 'direct');
    const sim = R.simulateShot({
        seed: 1, turn: 0, shooter: 0, angle: found.angle, power: found.power, powerUp: 'double',
        positions: positionsOf(board), hp: [100, 30]
    });
    assert.equal(sim.shots.length, 1);
    assert.deepEqual(sim.hpAfter, [100, 0]);
});

// ---- Kurallar arayüzü ----

test('initial: kedi oda kurucusudur, solda; köpek sağda; canlar 100, beklemeler 0', () => {
    const b = startBoard(5, 'A');           // order ['A','B'], kedi A -> indeks 0
    assert.equal(b.catIndex, 0);
    assert.equal(b.players[0].char, 'cat');
    assert.equal(b.players[1].char, 'dog');
    assert.ok(b.players[0].x < b.players[1].x);
    for (const p of b.players) {
        assert.equal(p.hp, 100);
        assert.deepEqual(p.cd, { heal: 0, wind: 0, double: 0, big: 0, guide: 0 });
    }
    const swapped = R.initial({ seed: 5, order: ['B', 'A'], cat: 'A' });   // başlayan B, kedi A
    assert.equal(swapped.catIndex, 1);
    assert.equal(swapped.players[1].char, 'cat');
    assert.equal(swapped.players[1].x, b.players[0].x);
    assert.equal(swapped.turn, 0);
});

test('initial: eksik başlangıç verisiyle de çökmez', () => {
    const b = R.initial();
    assert.equal(b.players.length, 2);
    assert.equal(R.initial({ order: [null, null], round: 0 }).seed, 0);
});

test('createStart / parseStart: tohum ve kedi oyuncu', () => {
    const ext = R.createStart({ random: () => 0.5, hostId: 'A', guestId: 'B', round: 1, order: ['A', 'B'] });
    assert.equal(ext.seed, 2147483648);
    assert.equal(ext.cat, 'A');
    assert.deepEqual(R.parseStart({ seed: 5, cat: 'A' }, { hostId: 'A', guestId: 'B' }), { seed: 5, cat: 'A' });
    assert.equal(R.parseStart({ seed: 5, cat: 'B' }, { hostId: 'A', guestId: 'B' }), null);   // kedi host olmalı
    assert.equal(R.parseStart({ seed: -1, cat: 'A' }, { hostId: 'A' }), null);
    assert.equal(R.parseStart({ seed: 1.5, cat: 'A' }, { hostId: 'A' }), null);
    assert.equal(R.parseStart({ seed: '5', cat: 'A' }, { hostId: 'A' }), null);
    assert.equal(R.parseStart({ cat: 'A' }, { hostId: 'A' }), null);
});

test('parse / toMessage: gidiş dönüş ve bozuk mesajlar', () => {
    const shot = { kind: 'shot', turn: 2, angle: 45, power: 70, powerUp: 'big' };
    assert.deepEqual(R.parse(R.toMessage(shot)), shot);
    assert.deepEqual(R.parse(R.toMessage({ kind: 'shot', turn: 0, angle: 0, power: 0, powerUp: null })),
        { kind: 'shot', turn: 0, angle: 0, power: 0, powerUp: null });
    assert.deepEqual(R.parse({ type: 'cd_shot', turn: 1, angle: 10, power: 10 }).powerUp, null);   // powerUp yok = null
    const heal = { kind: 'heal', turn: 4 };
    assert.deepEqual(R.parse(R.toMessage(heal)), heal);
    assert.equal(R.toMessage(shot).type, 'cd_shot');
    assert.equal(R.toMessage(heal).type, 'cd_heal');
    assert.equal(R.parse({ type: 'cd_shot', turn: 1, angle: '10', power: 10 }), null);
    assert.equal(R.parse({ type: 'cd_shot', turn: 1, angle: 10.5, power: 10 }), null);
    assert.equal(R.parse({ type: 'cd_shot', turn: '1', angle: 10, power: 10 }), null);
    assert.equal(R.parse({ type: 'cd_shot', angle: 10, power: 10 }), null);
    assert.equal(R.parse({ type: 'cd_shot', turn: 1, angle: 10, power: 10, powerUp: ['wind', 'big'] }), null);
    assert.equal(R.parse({ type: 'cd_heal' }), null);
    assert.equal(R.parse({ type: 'cd_other', turn: 1 }), null);
});

test('validate: geçerli ve geçersiz atışlar', () => {
    const b = startBoard(1);
    const ok = (m, i) => R.validate(b, { kind: 'shot', turn: 0, powerUp: null, ...m }, i === undefined ? 0 : i);
    assert.equal(ok({ angle: 0, power: 0 }), true);
    assert.equal(ok({ angle: 180, power: 100 }), true);
    assert.equal(ok({ angle: 90, power: 50, powerUp: 'wind' }), true);
    assert.equal(ok({ angle: 90, power: 50, powerUp: 'double' }), true);
    assert.equal(ok({ angle: 90, power: 50, powerUp: 'big' }), true);
    assert.equal(ok({ angle: -1, power: 50 }), false);
    assert.equal(ok({ angle: 181, power: 50 }), false);
    assert.equal(ok({ angle: 45, power: -1 }), false);
    assert.equal(ok({ angle: 45, power: 101 }), false);
    assert.equal(ok({ angle: 45.5, power: 50 }), false);
    assert.equal(ok({ angle: 45, power: 50.5 }), false);
    assert.equal(ok({ angle: 45, power: 50, powerUp: 'heal' }), false);    // iksir atışla kullanılamaz
    assert.equal(ok({ angle: 45, power: 50, powerUp: 'x' }), false);
    assert.equal(ok({ angle: 45, power: 50, turn: 1 }), false);           // tur numarası uyuşmuyor
    assert.equal(ok({ angle: 45, power: 50, turn: -1 }), false);
    assert.equal(ok({ angle: 45, power: 50 }, 2), false);                  // bilinmeyen oyuncu
    assert.equal(R.validate(b, null, 0), false);
    assert.equal(R.validate(b, { kind: 'jump', turn: 0 }, 0), false);
});

test('apply: tur artar, girdi tahtası değişmez', () => {
    const b = startBoard(1);
    const snapshot = JSON.stringify(b);
    const { board } = R.apply(b, { kind: 'shot', turn: 0, angle: 45, power: 60, powerUp: null }, 0);
    assert.equal(JSON.stringify(b), snapshot);
    assert.equal(board.turn, 1);
    assert.equal(board.last.kind, 'shot');
    assert.equal(board.last.shooter, 0);
    assert.equal(board.last.wind, R.windFor(1, 0));
    assert.equal(board.last.shots.length, 1);
    assert.equal(board.seed, b.seed);
    assert.equal(board.catIndex, b.catIndex);
});

test('iksir: 25 can yeniler, 100\'ü aşmaz, atış yapmaz, turu geçirir', () => {
    let b = startBoard(1);
    b.players[0].hp = 60;
    let r = R.apply(b, { kind: 'heal', turn: 0 }, 0);
    assert.equal(r.board.players[0].hp, 85);
    assert.equal(r.board.last.kind, 'heal');
    assert.equal(r.board.last.healed, 25);
    assert.equal(r.board.turn, 1);
    assert.deepEqual(r.board.players[1], b.players[1]);   // rakip etkilenmez
    b = startBoard(1);
    b.players[0].hp = 90;
    r = R.apply(b, { kind: 'heal', turn: 0 }, 0);
    assert.equal(r.board.players[0].hp, 100);
    assert.equal(r.board.last.healed, 10);
    b = startBoard(1);
    r = R.apply(b, { kind: 'heal', turn: 0 }, 0);
    assert.equal(r.board.players[0].hp, 100);
    assert.equal(r.board.last.healed, 0);
});

test('bekleme: kullanımdan sonra kendi sonraki 3 turunda kapalı, 4. turda açık', () => {
    let b = startBoard(1);
    let r = R.apply(b, { kind: 'heal', turn: 0 }, 0);   // oyuncu 0 iksir kullandı
    b = r.board;
    assert.equal(b.players[0].cd.heal, 3);
    // oyuncu 1 oynar: oyuncu 0'ın beklemesi etkilenmez
    b = R.apply(b, { kind: 'shot', turn: b.turn, angle: 135, power: 50, powerUp: null }, 1).board;
    assert.equal(b.players[0].cd.heal, 3);
    for (const expected of [3, 2, 1]) {
        // oyuncu 0'ın kendi turu: iksir kapalı
        assert.equal(R.validate(b, { kind: 'heal', turn: b.turn }, 0), false, 'kalan ' + expected);
        assert.equal(b.players[0].cd.heal, expected);
        b = R.apply(b, { kind: 'shot', turn: b.turn, angle: 45, power: 50, powerUp: null }, 0).board;
        b = R.apply(b, { kind: 'shot', turn: b.turn, angle: 135, power: 50, powerUp: null }, 1).board;
    }
    assert.equal(b.players[0].cd.heal, 0);
    assert.equal(R.validate(b, { kind: 'heal', turn: b.turn }, 0), true);
});

test('atış gücü beklemesi: kullanılan güç kapanır, diğerleri açık kalır; bekleme bitince tekrar kullanılabilir', () => {
    let b = startBoard(1);
    b = R.apply(b, { kind: 'shot', turn: 0, angle: 45, power: 50, powerUp: 'big' }, 0).board;
    assert.equal(b.players[0].cd.big, 3);
    assert.equal(b.players[0].cd.wind, 0);
    assert.equal(b.players[0].cd.double, 0);
    assert.equal(R.validate(b, { kind: 'shot', turn: 1, angle: 45, power: 50, powerUp: 'big' }, 0), false);
    assert.equal(R.validate(b, { kind: 'shot', turn: 1, angle: 45, power: 50, powerUp: 'wind' }, 0), true);
    assert.equal(R.validate(b, { kind: 'heal', turn: 1 }, 0), true);
    // oyuncu 0 üç kez güçsüz atar; dördüncüde tekrar 'big' kullanabilir
    for (let i = 0; i < 3; i++) {
        b = R.apply(b, { kind: 'shot', turn: b.turn, angle: 135, power: 40, powerUp: null }, 1).board;
        assert.equal(R.validate(b, { kind: 'shot', turn: b.turn, angle: 45, power: 40, powerUp: 'big' }, 0), false);
        b = R.apply(b, { kind: 'shot', turn: b.turn, angle: 45, power: 40, powerUp: null }, 0).board;
    }
    b = R.apply(b, { kind: 'shot', turn: b.turn, angle: 135, power: 40, powerUp: null }, 1).board;
    assert.equal(R.validate(b, { kind: 'shot', turn: b.turn, angle: 45, power: 40, powerUp: 'big' }, 0), true);
});

test('result: can 0 olan taraf kaybeder; oyun bitince hamle kabul edilmez', () => {
    const b = startBoard(1);
    assert.equal(R.result(b), null);
    b.players[1].hp = 0;
    assert.deepEqual(R.result(b), { status: 'win', winner: 0 });
    assert.equal(R.validate(b, { kind: 'heal', turn: 0 }, 0), false);
    const c = startBoard(1);
    c.players[0].hp = 0;
    assert.deepEqual(R.result(c), { status: 'win', winner: 1 });
});

test('uçtan uca kural akışı: isabetli atışlarla oyun biter', () => {
    let b = startBoard(1);
    let guard = 0;
    while (!R.result(b) && guard++ < 10) {
        const found = findShot(b, 0, (s) => s.hit === 'direct');
        assert.ok(found);
        // oyuncu 0 doğrudan isabet eder, oyuncu 1 geçersiz sayılmayan bir atış yapar
        b = R.apply(b, { kind: 'shot', turn: b.turn, angle: found.angle, power: found.power, powerUp: null }, 0).board;
        if (R.result(b)) break;
        b = R.apply(b, { kind: 'shot', turn: b.turn, angle: 135, power: 30, powerUp: null }, 1).board;
    }
    assert.deepEqual(R.result(b), { status: 'win', winner: 0 });
    assert.equal(b.players[1].hp, 0);
});

// ---- 1b: güç başına bekleme, Nişan Rehberi, nişan izi ----
const shotMv = (b, powerUp) => ({ kind: 'shot', turn: b.turn, angle: 45, power: 50, powerUp: powerUp || null });
const oppMove = (b) => R.apply(b, { kind: 'shot', turn: b.turn, angle: 135, power: 40, powerUp: null }, 1).board;
const myMove = (b) => R.apply(b, shotMv(b), 0).board;

test('bekleme tablosu: rüzgârsız 1 tur, nişan rehberi 4 tur, diğerleri 3 tur', () => {
    assert.deepEqual(R.COOLDOWNS, { heal: 3, wind: 1, double: 3, big: 3, guide: 4 });
    for (const [key, turns] of [['wind', 1], ['double', 3], ['big', 3], ['guide', 4]]) {
        let b = startBoard(1);
        b = R.apply(b, shotMv(b, key), 0).board;
        assert.equal(b.players[0].cd[key], turns, key + ' kurulum');
        for (let i = 0; i < turns; i++) {
            b = oppMove(b);
            assert.equal(R.validate(b, shotMv(b, key), 0), false, key + ' kapalı, ' + (i + 1) + '. tur');
            b = myMove(b);
        }
        b = oppMove(b);
        assert.equal(b.players[0].cd[key], 0, key + ' bitti');
        assert.equal(R.validate(b, shotMv(b, key), 0), true, key + ' tekrar açık');
    }
});

test('rüzgârsız: bir sonraki hamlede kapalı, ondan sonra açık; diğer güçleri etkilemez', () => {
    let b = startBoard(1);
    b = R.apply(b, shotMv(b, 'wind'), 0).board;
    b = oppMove(b);
    assert.equal(R.validate(b, shotMv(b, 'wind'), 0), false);
    assert.equal(R.validate(b, shotMv(b, 'guide'), 0), true);
    assert.equal(R.validate(b, shotMv(b, 'double'), 0), true);
    b = myMove(b);
    b = oppMove(b);
    assert.equal(R.validate(b, shotMv(b, 'wind'), 0), true);
});

test('nişan rehberi: parse/validate kabul, bekleme sırasında red, iksir atış gücü olamaz, kullanım diğer sayaçlara dokunmaz', () => {
    const msg = R.toMessage({ kind: 'shot', turn: 0, angle: 45, power: 50, powerUp: 'guide' });
    assert.deepEqual(R.parse(msg), { kind: 'shot', turn: 0, angle: 45, power: 50, powerUp: 'guide' });
    let b = startBoard(1);
    assert.equal(R.validate(b, shotMv(b, 'guide'), 0), true);
    assert.equal(R.validate(b, shotMv(b, 'heal'), 0), false);
    b = R.apply(b, shotMv(b, 'guide'), 0).board;
    assert.deepEqual(b.players[0].cd, { heal: 0, wind: 0, double: 0, big: 0, guide: 4 });
    assert.deepEqual(b.players[1].cd, { heal: 0, wind: 0, double: 0, big: 0, guide: 0 });
    assert.equal(R.validate(oppMove(b), shotMv(oppMove(b), 'guide'), 0), false);
    assert.equal(b.last.powerUp, 'guide');
});

test("nişan rehberi fiziği değiştirmez: simulateShot('guide') ile null birebir aynı", () => {
    const board = startBoard(7);
    for (const [angle, power] of [[45, 60], [30, 90], [80, 40], [10, 100]]) {
        const base = { seed: board.seed, turn: 2, shooter: 0, angle, power, positions: positionsOf(board), hp: [100, 100] };
        const plain = R.simulateShot({ ...base, powerUp: null });
        const guide = R.simulateShot({ ...base, powerUp: 'guide' });
        assert.deepEqual({ ...guide, powerUp: null }, plain, angle + '/' + power);
    }
});

test('aimPath: kesir gerçek atışın yörüngesinin ön eki; 1 = tam yol; deterministik', () => {
    const board = startBoard(11);
    const sim = (angle, power, powerUp) => R.simulateShot({
        seed: board.seed, turn: board.turn, shooter: 0, angle, power, powerUp: powerUp || null,
        positions: positionsOf(board), hp: [100, 100]
    }).shots[0];
    for (const [angle, power] of [[45, 60], [60, 80], [25, 100]]) {
        const real = sim(angle, power).trajectory;
        const part = R.aimPath(board, 0, angle, power, null, R.TRAIL_FRACTION);
        assert.equal(R.TRAIL_FRACTION, 0.3);
        assert.deepEqual(part.points, real.slice(0, part.points.length), 'ön ek');
        assert.ok(part.points.length >= 2 && part.points.length < real.length);
        const segs = part.points.length - 1;
        const want = 0.3 * (real.length - 1);
        assert.ok(segs >= want - 1e-9 && segs < Math.max(want, 1) + 1, 'yolun ilk ~%30 (parça sayısı yukarı yuvarlanır): ' + segs + ' / ' + want);
        assert.equal(part.full, false);
        const full = R.aimPath(board, 0, angle, power, 'guide', 1);
        assert.deepEqual(full.points, real, 'tam yol');
        assert.equal(full.full, true);
        assert.deepEqual(R.aimPath(board, 0, angle, power, null, 0.3), part, 'deterministik');
    }
});

test('aimPath: rüzgârsız seçiliyse rüzgâr 0 yolu; çok kısa atışta en az 2 nokta', () => {
    const board = startBoard(11);
    let turn = 0;
    while (R.windFor(board.seed, turn) === 0) turn++;
    const b = { ...board, turn };
    const withWind = R.aimPath(b, 0, 45, 70, null, 1);
    const noWind = R.aimPath(b, 0, 45, 70, 'wind', 1);
    assert.equal(withWind.wind, R.windFor(b.seed, turn));
    assert.equal(noWind.wind, 0);
    assert.notDeepEqual(noWind.points, withWind.points);
    const tiny = R.aimPath(b, 0, 45, 0, null, 0.3);
    assert.ok(tiny.points.length >= 2);
});
