// Kurbağa saf kuralları: araç determinizmi, çarpışma, hareket, makullük denetimi, sıralama, bot kalibrasyonu.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/parti/mini/kurbaga-rules.js');

test('şeritler tohumdan deterministik; sekiz şerit, makul hız/uzunluk/boşluk', () => {
    const a = JSON.parse(JSON.stringify(K.lanes(1234)));
    assert.deepEqual(a, K.lanes(1234));
    assert.notDeepEqual(a, K.lanes(1235));
    for (let seed = 1; seed < 300; seed++) {
        const ls = K.lanes(seed);
        assert.equal(ls.length, 8);
        ls.forEach((l) => {
            assert.ok(l.dir === 1 || l.dir === -1);
            assert.ok(l.speed >= 1.4 && l.speed <= 3.4, 'hız ' + l.speed);
            assert.ok(l.len === 1 || l.len === 2);
            assert.ok(l.spacing - l.len >= 2.5, 'araçlar arası boşluk geçilebilir: ' + (l.spacing - l.len));
            assert.ok(l.L >= K.COLS + 4 - 1e-9, 'halka ızgaradan geniş (sarma görünmez)');
        });
        assert.ok(ls.some((l) => l.dir === 1) && ls.some((l) => l.dir === -1), 'iki yön de var');
    }
});

test('araç konumu saf f(t): aynı (tohum, t) her seferinde aynı; zamanla yön ve hızla ilerler', () => {
    const l = K.lanes(7)[2];
    assert.deepEqual(K.cars(l, 12345), K.cars(l, 12345));
    const key = (c) => c.map((x) => x.x.toFixed(3) + ':' + x.len).join('|');
    assert.notEqual(key(K.cars(l, 0)), key(K.cars(l, 700)));
    // yüksek hassasiyetle: bir araç dt sonra dir*speed*dt kadar kayar
    const dt = 100;
    const a = K.cars(l, 5000);
    const b = K.cars(l, 5000 + dt);
    const moved = a.map((x) => x.x + l.dir * l.speed * dt / 1000);
    const hit = moved.filter((m) => b.some((y) => Math.abs(y.x - m) < 1e-6));
    assert.ok(hit.length >= 1, 'en az bir araç beklenen kadar kaydı');
    // ızgarada her an araç görünür ve sayısı makul (boş yol yok)
    for (let t = 0; t < 60000; t += 1700) {
        K.lanes(7).forEach((ln) => assert.ok(K.cars(ln, t).length >= 1, 'şerit boş kalmadı'));
    }
});

test('çarpışma: araç hücreye girince çarpar, boş hücre/başlangıç/hedef çarpmaz', () => {
    const ls = K.lanes(99);
    const l = ls[0];
    // aracın tam üstündeki hücre
    const t = 3000;
    const car = K.cars(l, t).find((c) => c.x >= 0 && c.x + c.len <= K.COLS);
    assert.ok(car, 'ızgara içinde araç var');
    const c = Math.floor(car.x + 0.5);
    assert.equal(K.hit(ls, 1, Math.min(K.COLS - 1, c), t), true);
    assert.equal(K.hit(ls, 0, c, t), false, 'başlangıç güvenli');
    assert.equal(K.hit(ls, 9, c, t), false, 'hedef güvenli');
    // hiçbir araç olmayan en az bir hücre vardır (geçit): her zaman
    for (let tt = 0; tt < 40000; tt += 900) {
        for (let r = 1; r <= 8; r++) {
            let free = 0;
            for (let col = 0; col < K.COLS; col++) if (!K.hit(ls, r, col, tt)) free++;
            assert.ok(free >= 2, 'şerit ' + r + ' t=' + tt + ': boş hücre ' + free);
        }
    }
    // hücre kenarındaki hafif temas bağışlanır (inset)
    const edge = { dir: 1, speed: 0, len: 1, spacing: 6, n: 3, L: 18, phase: 0.1 };
    assert.equal(K.hit([edge], 1, 0, 0), true, 'araç 0. hücrenin içinde');
    const touching = { dir: 1, speed: 0, len: 1, spacing: 6, n: 3, L: 18, phase: 1.05 };
    assert.equal(K.hit([touching], 1, 0, 0), false, 'yalnız kenara değiyor: çarpmaz');
});

test('hop: sınırlar içinde kalır; yukarı hedefte durur', () => {
    assert.deepEqual(K.hop({ r: 0, c: 0 }, 'down'), { r: 0, c: 0 });
    assert.deepEqual(K.hop({ r: 0, c: 0 }, 'left'), { r: 0, c: 0 });
    assert.deepEqual(K.hop({ r: 0, c: 8 }, 'right'), { r: 0, c: 8 });
    assert.deepEqual(K.hop({ r: 9, c: 4 }, 'up'), { r: 9, c: 4 });
    assert.deepEqual(K.hop({ r: 3, c: 4 }, 'up'), { r: 4, c: 4 });
    assert.deepEqual(K.hop({ r: 3, c: 4 }, 'down'), { r: 2, c: 4 });
    assert.deepEqual(K.hop({ r: 3, c: 4 }, 'left'), { r: 3, c: 3 });
    assert.deepEqual(K.hop({ r: 3, c: 4 }, 'right'), { r: 3, c: 5 });
});

test('plausible: 1 hücre / zaman bütçesi, ölüm başa döner, geri gitmek ve saçma sıçrama reddedilir', () => {
    const p = { r: 3, c: 4, d: 0 };
    assert.equal(K.plausible(p, { r: 4, c: 4, d: 0 }, 0), true, 'bir hücre');
    assert.equal(K.plausible(p, { r: 3, c: 3, d: 0 }, 150), true);
    assert.equal(K.plausible(p, { r: 5, c: 4, d: 0 }, 0), false, 'iki hücre, süre yok');
    assert.equal(K.plausible(p, { r: 5, c: 4, d: 0 }, 150), true, 'birleştirilmiş: 150 ms = 2 sıçrama bütçesi');
    assert.equal(K.plausible(p, { r: 9, c: 4, d: 0 }, 300), false, '6 hücre / 300 ms');
    assert.equal(K.plausible(p, { r: 9, c: 4, d: 0 }, 900), true, '6 hücre / 900 ms (7 sıçrama bütçesi)');
    assert.equal(K.plausible(p, { r: 3, c: 4, d: 0 }, 0), true, 'aynı yer (kalp atışı)');
    assert.equal(K.plausible(p, { r: 0, c: 4, d: 1 }, 0), true, 'ölüm: başa dön');
    assert.equal(K.plausible(p, { r: 1, c: 4, d: 1 }, 150), true, 'ölüm sonrası bir sıçrama');
    assert.equal(K.plausible(p, { r: 0, c: 4, d: 2 }, 0), false, 'tek ölümden fazlası, süre yok');
    assert.equal(K.plausible(p, { r: 3, c: 4, d: 1 }, 0), false, 'ölüm ama başlangıçta değil (3 satır sıçrama)');
    assert.equal(K.plausible({ r: 3, c: 4, d: 2 }, { r: 3, c: 4, d: 1 }, 5000), false, 'ölüm sayacı azalamaz');
    assert.equal(K.plausible(p, { r: 10, c: 4, d: 0 }, 5000), false, 'sınır dışı');
    assert.equal(K.plausible(p, { r: 3, c: -1, d: 0 }, 5000), false);
    assert.equal(K.plausible(p, { r: 3.5, c: 4, d: 0 }, 5000), false, 'tamsayı değil');
    assert.equal(K.plausible(p, { r: 'x', c: 4, d: 0 }, 5000), false);
    assert.equal(K.plausible(null, p, 0), false);
});

test('plausibleFinish: alt sınır 9 sıçrama, üst sınır lider saati + tolerans', () => {
    assert.equal(K.plausibleFinish(9 * K.HOP_MS - 1, 60000), false);
    assert.equal(K.plausibleFinish(9 * K.HOP_MS, 60000), true);
    assert.equal(K.plausibleFinish(30000, 30000 - K.FINISH_TOL_MS), true, 'tolerans sınırı');
    assert.equal(K.plausibleFinish(30000, 30000 - K.FINISH_TOL_MS - 1), false, 'liderin saatinden fazla ileri');
    assert.equal(K.plausibleFinish(-5, 1000), false);
    assert.equal(K.plausibleFinish(NaN, 1000), false);
});

test('rank: varanlar süreye göre (eşit ms eşit derece), kalanlar anlık satıra göre, varan her zaman önde', () => {
    const base = { players: ['a', 'b', 'c', 'd', 'e'], bots: [], seed: 1, endMs: 100000 };
    // karışım: a ve c aynı ms'de varmış, b daha geç; d 7. satırda, e 7. satırda; f yok
    const r1 = K.rank(Object.assign({}, base, { reports: { a: { r: 9, f: 21000, d: 0 }, b: { r: 9, f: 30500, d: 1 }, c: { r: 9, f: 21000, d: 2 }, d: { r: 7, f: null, d: 0 }, e: { r: 7, f: -1, d: 3 } } }));
    assert.deepEqual(r1.map((g) => g.slice().sort()), [['a', 'c'], ['b'], ['d', 'e']]);
    // yalnız kalanlar: satır azalan, eşit satır eşit derece
    const r2 = K.rank(Object.assign({}, base, { reports: { a: { r: 2, f: null, d: 0 }, b: { r: 8, f: null, d: 0 }, c: { r: 2, f: null, d: 0 }, d: { r: 5, f: null, d: 0 } } }));
    assert.deepEqual(r2.map((g) => g.slice().sort()), [['b'], ['d'], ['a', 'c'], ['e']], 'raporsuz e 0. satır');
    // yüksek satırda ama varmamış, düşük satırda varmış olanı geçemez
    const r3 = K.rank(Object.assign({}, base, { players: ['a', 'b'], reports: { a: { r: 8, f: null, d: 0 }, b: { r: 9, f: 99000, d: 0 } } }));
    assert.deepEqual(r3, [['b'], ['a']]);
    // herkes aynı: tek grup
    assert.deepEqual(K.rank({ players: ['a', 'b'], bots: [], seed: 1, endMs: 5, reports: {} }), [['a', 'b']]);
});

test('rank: botlar insanlarla aynı sıralamaya girer (varış süresi ya da bitiş anındaki satır)', () => {
    let early = 0;
    for (let seed = 1; seed < 400 && early < 5; seed++) {
        const f = K.botFinish(seed, 'bot1');
        if (f === null || f > 100000) continue;
        early++;
        const r = K.rank({ players: ['h', 'bot1'], bots: ['bot1'], seed, endMs: 120000, reports: { h: { r: 9, f: f - 1, d: 0 } } });
        assert.deepEqual(r, [['h'], ['bot1']], 'insan 1 ms önce vardı');
        const r2 = K.rank({ players: ['h', 'bot1'], bots: ['bot1'], seed, endMs: 120000, reports: { h: { r: 9, f: f + 1, d: 0 } } });
        assert.deepEqual(r2, [['bot1'], ['h']]);
        const r3 = K.rank({ players: ['h', 'bot1'], bots: ['bot1'], seed, endMs: f - 1, reports: { h: { r: 0, f: null, d: 0 } } });
        assert.ok(!(K.botProgress(seed, 'bot1', f - 1) >= K.GOAL_ROW), 'bitişten önce bot hedefte değil');
        assert.equal(r3.flat().length, 2);
    }
    assert.ok(early >= 5, 'varan bot örneği bulundu');
    // bitiş anında hedefe varmamış bot satırıyla girer
    const r = K.rank({ players: ['h', 'bot1'], bots: ['bot1'], seed: 5, endMs: 1000, reports: { h: { r: 4, f: null, d: 0 } } });
    assert.deepEqual(r, [['h'], ['bot1']], 'bot 1 sn\'de henüz başlamadı');
});

test('bot: saf ve tohumlu; satır 0..9; botFinish ile botProgress tutarlı', () => {
    for (let seed = 1; seed < 100; seed++) {
        const f = K.botFinish(seed, 'bot3');
        assert.equal(f, K.botFinish(seed, 'bot3'));
        for (let t = 0; t <= 125000; t += 2500) {
            const row = K.botProgress(seed, 'bot3', t);
            assert.ok(Number.isInteger(row) && row >= 0 && row <= 9);
            assert.equal(row, K.botProgress(seed, 'bot3', t));
        }
        if (f !== null) {
            assert.equal(K.botProgress(seed, 'bot3', f), 9);
            assert.ok(K.botProgress(seed, 'bot3', f - 1) < 9);
            assert.ok(f >= 9 * K.HOP_MS, 'insan alt sınırından hızlı değil');
        } else assert.ok(K.botProgress(seed, 'bot3', 125000) < 9);
    }
    assert.notEqual(JSON.stringify([1, 2, 3, 4, 5].map((s) => K.botFinish(s, 'botA'))), JSON.stringify([1, 2, 3, 4, 5].map((s) => K.botFinish(s, 'botB'))), 'kimliğe göre farklı');
});

test('bot kalibrasyonu (tohum süpürmesi): çoğu bot süre dolmadan varmaz, ortalama ilerleme orta seviye', () => {
    let n = 0; let fin = 0; let sum60 = 0; let sum120 = 0;
    const finTimes = [];
    for (let seed = 1; seed <= 400; seed++) {
        for (let b = 0; b < 7; b++) {
            const id = 'bot' + b;
            n++;
            const f = K.botFinish(seed, id);
            if (f !== null && f <= 120000) { fin++; finTimes.push(f); }
            sum60 += K.botProgress(seed, id, 60000);
            sum120 += K.botProgress(seed, id, 120000);
        }
    }
    const rate = fin / n;
    assert.ok(rate > 0.15 && rate < 0.40, 'varış oranı ≈ %15–40: ' + rate.toFixed(3));
    const avg60 = sum60 / n;
    const avg120 = sum120 / n;
    assert.ok(avg60 > 1.5 && avg60 < 4.5, '60 sn ort. satır ' + avg60.toFixed(2));
    assert.ok(avg120 > 3 && avg120 < 5.5, '120 sn ort. satır ' + avg120.toFixed(2));
    finTimes.sort((a, b) => a - b);
    const median = finTimes[finTimes.length >> 1];
    assert.ok(median > 40000, 'varan botların medyanı yavaş-orta (>40 sn): ' + median);
});
