// Kafa Topu: hızlı topun oyuncudan, direkten, üst çizgiden ve duvardan geçmemesi (tünelleme).
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/kafatopu-rules.js');

const DT = 1 / 60;
const none = () => [K.emptyInput(), K.emptyInput()];

function play(options) {
    return K.createState(Object.assign({ countdown: 0 }, options || {}));
}

test('üst çizgiye (üstten) 600–1300 px/s ile inen top çizginin içinden geçip gol olmaz', () => {
    let tried = 0;
    for (let vy = 600; vy <= 1300; vy += 50) {
        for (let x = 5; x <= 65; x += 5) {
            for (let y0 = 200; y0 <= 245; y0 += 5) {
                tried++;
                let s = play();
                s.ball = { x, y: y0, vx: 0, vy };
                for (let i = 0; i < 40; i++) {
                    s = K.step(s, none(), DT);
                    assert.equal(s.events.length, 0, `gol: vy=${vy} x=${x} y0=${y0} adım ${i}`);
                    assert.ok(!(s.ball.y > K.CROSSBAR_Y + K.CROSSBAR_T && s.ball.x < K.GOAL_W), `çizginin altına geçti: vy=${vy} x=${x} y0=${y0}`);
                }
            }
        }
    }
    assert.ok(tried > 1000);
});

test('üst çizgiye alttan (yukarı) hızla çarpan top çizgiyi geçmez', () => {
    for (let vy = -600; vy >= -1300; vy -= 100) {
        for (let x = 10; x <= 60; x += 10) {
            let s = play();
            s.ball = { x, y: 330, vx: 0, vy };
            for (let i = 0; i < 20; i++) {
                s = K.step(s, none(), DT);
                assert.ok(!(s.ball.y < K.CROSSBAR_Y && s.ball.x < K.GOAL_W && i < 5 && s.ball.vy < 0 && s.ball.y < K.CROSSBAR_Y - 20), 'alttan üste geçti');
            }
        }
    }
});

test('kale ağzındaki kalecinin kafasına (çekirdek bölge) 700–1300 px/s atış: top kafanın içinden geçmez, gol olmaz', () => {
    let tried = 0;
    for (let kx = 27; kx <= 150; kx += 9) {
        for (let dy = -25; dy <= 25; dy += 5) {
            for (const vx of [-700, -1000, -1300]) {
                tried++;
                let s = play();
                s.players[0].x = kx;
                s.players[0].y = K.HEAD_STAND_Y;
                s.ball = { x: 400, y: K.HEAD_STAND_Y + dy, vx, vy: 0 };
                for (let i = 0; i < 40; i++) {
                    s = K.step(s, none(), DT);
                    assert.equal(s.events.length, 0, `gol: kx=${kx} dy=${dy} vx=${vx} adım ${i}`);
                    const head = s.players[0];
                    // top, kafa merkezinin öbür yanına geçmemeli (çekirdek bölgede)
                    assert.ok(s.ball.x > head.x - 1 || Math.abs(s.ball.y - head.y) > 30, `kafanın içinden geçti: kx=${kx} dy=${dy} vx=${vx} adım ${i}`);
                }
            }
        }
    }
    assert.ok(tried > 300);
});

test('kaleciye doğru koşarken hızlı topla karşılaşma: top kafanın içinden geçmez', () => {
    for (let vx = -1300; vx <= -300; vx += 100) {
        let s = play();
        s.players[1].x = 500;
        s.ball = { x: 250, y: s.players[1].y, vx: -vx * 0.3, vy: 0 };   // sağa gelen top
        const inputs = [K.emptyInput(), { left: true, right: false, jump: false, kick: false }];
        for (let i = 0; i < 60; i++) {
            s = K.step(s, inputs, DT);
            const head = s.players[1];
            assert.ok(!(s.ball.x > head.x + 5 && Math.abs(s.ball.y - head.y) < 25 && s.ball.x - head.x < 60 && s.ball.vx > 0 && i > 0 && s.ball.x > head.x + 20), 'kafayı geçti: vx=' + vx + ' adım ' + i);
        }
    }
});

test('hızlı top duvardan, tavandan ve zeminden geçmez', () => {
    for (const [vx, vy] of [[-1300, 0], [1300, 0], [0, -1300], [0, 1300], [-900, 900], [900, -900]]) {
        let s = play();
        s.ball = { x: 400, y: 200, vx, vy };
        for (let i = 0; i < 120; i++) {
            s = K.step(s, none(), DT);
            assert.ok(s.ball.x >= K.BALL_R - 1e-6 && s.ball.x <= K.W - K.BALL_R + 1e-6, 'yatay sınır: ' + s.ball.x);
            assert.ok(s.ball.y >= K.BALL_R - 1e-6 && s.ball.y <= K.GROUND - K.BALL_R + 1e-6, 'dikey sınır: ' + s.ball.y);
        }
    }
});

test('kale ağzında hızlı vuruş: kaleci topu durdurduysa (çözüm sonrası) gol sayılmaz', () => {
    let s = play();
    s.players[0].x = 60;
    s.ball = { x: 150, y: 335, vx: -1300, vy: 0 };
    for (let i = 0; i < 40; i++) {
        s = K.step(s, none(), DT);
        assert.equal(s.events.length, 0, 'adım ' + i);
    }
    assert.deepEqual(s.score, [0, 0]);
});

test('top, ayak (vuruş yayı) içinden geçmez: hızla gelen topa vurulduğunda arkaya geçmez', () => {
    for (let vx = -1300; vx <= -300; vx += 100) {
        let s = play();
        const p = s.players[0];
        const f = K.footPos(p);
        s.ball = { x: f.x + 120, y: f.y, vx, vy: 0 };
        for (let i = 0; i < 40; i++) {
            const kick = i === 4;
            s = K.step(s, [{ left: false, right: false, jump: false, kick }, K.emptyInput()], DT);
            assert.ok(s.ball.x > p.x - 10, `ayağın arkasına geçti vx=${vx} adım ${i}: ${s.ball.x}`);
        }
    }
});

test('alt adım sayısı hıza göre artar, 2..8 arasındadır ve yer değiştirme yarıçapın yarısını aşmaz', () => {
    let prev = 0;
    for (let speed = 0; speed <= 3000; speed += 50) {
        const n = K.substepsFor(speed, 0, DT);
        assert.ok(n >= 2 && n <= 8, `n=${n} hız=${speed}`);
        assert.ok(n >= prev, 'hız arttıkça azalmamalı');
        prev = n;
        if (n < 8) assert.ok(speed * DT / n <= K.BALL_R / 2 + 1e-9, `yer değiştirme ${speed * DT / n}`);
    }
    assert.equal(K.substepsFor(0, 0, DT), 2);
    assert.equal(K.substepsFor(1200, 0, DT), 3);
    assert.equal(K.substepsFor(1200, 1000, DT), 5);
    assert.equal(K.substepsFor(100000, 0, DT), 8);
    assert.ok(K.substepsFor(1200, 500, DT) > K.substepsFor(1200, 0, DT), 'göreli oyuncu hızı da alt adımı artırır');
});

test('step, kullanılan top alt adım sayısını bildirir ve hızlı topta artırır', () => {
    let slow = play();
    slow.ball = { x: 400, y: 380, vx: 0, vy: 0 };
    slow = K.step(slow, none(), DT);
    let fast = play();
    fast.ball = { x: 400, y: 200, vx: 1200, vy: 0 };
    fast = K.step(fast, none(), DT);
    assert.equal(slow.sub, 2);
    assert.ok(fast.sub >= 3 && fast.sub <= 8);
});

test('top hız sınırı 1200 px/s', () => {
    assert.equal(K.BALL_MAX_SPEED, 1200);
    let s = play();
    s.ball = { x: 400, y: 200, vx: 5000, vy: 5000 };
    s = K.step(s, none(), DT);
    assert.ok(Math.sqrt(s.ball.vx ** 2 + s.ball.vy ** 2) <= 1200 + 1e-6);
});

test('gol yalnızca top çizgiyi tamamen geçince ve çarpışma çözüldükten sonra sayılır', () => {
    // çizgiyi kısmen aşan, ama kaleciye değen top
    let s = play();
    s.players[0].x = 40;
    s.ball = { x: 95, y: 342, vx: -900, vy: 0 };
    let goals = 0;
    for (let i = 0; i < 30; i++) { s = K.step(s, none(), DT); goals += s.events.length; }
    assert.equal(goals, 0);
    // boş kale: gol
    s = play();
    s.players[0].x = 300;
    s.ball = { x: 150, y: 335, vx: -900, vy: 0 };
    goals = 0;
    for (let i = 0; i < 40; i++) { s = K.step(s, none(), DT); goals += s.events.filter((e) => e.type === 'goal').length; }
    assert.equal(goals, 1);
});
