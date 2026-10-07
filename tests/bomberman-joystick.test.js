const test = require('node:test');
const assert = require('node:assert/strict');
const Joystick = require('../games/bomberman-joystick.js');

// Oyun döngüsünü taklit eder: her `frame` ms'de bir (a) girdi gelir (update), (b) tek zamanlayıcı tick atar. Adımları sayar.
function run(inputs, durationMs, options) {
    const j = Joystick.create(options);
    const steps = [];
    for (let t = 0; t <= durationMs; t += 10) {
        const input = inputs(t);
        if (input === 'release') j.release();
        else if (input) {
            const r = j.update(input[0], input[1], t);
            if (r.step) steps.push({ t, dir: r.dir, by: 'update' });
        }
        if (t % 50 === 0) {
            const d = j.tick(t);
            if (d) steps.push({ t, dir: d, by: 'tick' });
        }
    }
    return { steps, j };
}

test('adım sayısı süre/150 ms\'yi geçmez: çapraz sınırda 16 ms\'lik titreşim (eski hata)', () => {
    // dx ve dy neredeyse eşit; baskın eksen her karede değişiyor
    const { steps } = run((t) => (Math.floor(t / 16) % 2 ? [31, 30] : [30, 31]), 3000);
    assert.ok(steps.length <= Math.floor(3000 / 150) + 1, 'adım sayısı: ' + steps.length);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i].t - steps[i - 1].t >= 150, 'adımlar arası >= 150 ms');
});

test('adım sınırı yön değişimiyle, bırakıp yeniden basmayla ve ölü bölge titreşimiyle atlatılamaz', () => {
    // her 40 ms'de sağ / sol / yukarı / ölü bölge arasında zıplayan girdi
    const seq = [[40, 0], [-40, 0], [0, -40], [2, 2], [0, 40]];
    const { steps } = run((t) => seq[Math.floor(t / 40) % seq.length], 2000);
    assert.ok(steps.length <= Math.floor(2000 / 150) + 1, 'adım sayısı: ' + steps.length);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i].t - steps[i - 1].t >= 150);
    const { steps: s2 } = run((t) => (Math.floor(t / 20) % 2 ? 'release' : [40, 0]), 2000);
    assert.ok(s2.length <= Math.floor(2000 / 150) + 1, 'bırak/bas titreşimi: ' + s2.length);
});

test('sabit basış: 150 ms\'de bir adım (ilk adım anında), yönler korunur', () => {
    const { steps } = run(() => [40, 0], 1000);
    assert.equal(steps[0].t, 0, 'ilk adım hemen');
    assert.equal(steps[0].by, 'update');
    steps.forEach((s) => assert.equal(s.dir, 'right'));
    // tick 50 ms'de çalıştığı için adımlar 150 ms aralıkla (0, 150, 300, ...)
    assert.deepEqual(steps.map((s) => s.t), [0, 150, 300, 450, 600, 750, 900]);
});

test('histerezis: mevcut yönden diğer eksene geçmek için oran >= 1.3; ilk yön baskın eksen', () => {
    const j = Joystick.create();
    assert.equal(j.update(40, 20, 0).dir, 'right', 'ilk yön baskın eksen');
    assert.equal(j.update(30, 35, 10).dir, 'right', 'oran 1.17: yatayda kalır');
    assert.equal(j.update(30, 38, 20).dir, 'right', 'oran 1.27: eşiğin altında');
    assert.equal(j.update(30, 39, 30).dir, 'down', 'oran tam 1.3: dikeye geçer');
    assert.equal(j.update(35, 30, 40).dir, 'down', 'dikeyde kalır (oran 1.17)');
    assert.equal(j.update(40, 30, 50).dir, 'right', 'oran 1.33: yataya döner');
    assert.equal(j.update(-40, 10, 60).dir, 'left', 'aynı eksende işaret serbest');
    const k = Joystick.create();
    assert.equal(k.update(0, -30, 0).dir, 'up');
    assert.equal(k.update(0, 30, 10).dir, 'down');
    assert.equal(k.update(20, 0, 20).dir, 'right', 'dy=0: tamamen yatay');
});

test('ölü bölge: yön bırakılır, tick adım vermez; sonra yeniden basış yalnız gap geçtiyse hemen adım atar', () => {
    const j = Joystick.create();
    assert.equal(j.update(30, 0, 0).step, true);
    assert.deepEqual(j.update(5, 5, 20), { dir: null, step: false });
    assert.equal(j.direction(), null);
    assert.equal(j.tick(200), null);
    assert.equal(j.update(30, 0, 100).step, false, '100 ms: sınır dolmadı, hemen adım yok');
    assert.equal(j.tick(100), null);
    assert.equal(j.tick(150), 'right', 'tick sınır dolunca atar');
    j.release();
    assert.equal(j.tick(1000), null, 'bırakınca adım yok');
    assert.equal(j.update(0, 40, 1000).step, true, 'uzun bekleme sonrası ilk adım hemen');
});

test('saat geriye giderse adım kilitlenmez; özel ayarlar', () => {
    const j = Joystick.create({ stepMs: 100, deadZone: 5 });
    j.update(10, 0, 5000);
    assert.equal(j.tick(5100), 'right');
    assert.equal(j.tick(4000), null, 'saat geriye gitti: bu çağrıda adım yok');
    assert.equal(j.tick(4100), 'right', 'sonra normal akış');
    assert.equal(j.update(3, 3, 4100).dir, null, 'ölü bölge 5');
});
