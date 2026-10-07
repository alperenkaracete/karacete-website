// Kafa Topu: vuruş sırasında ayak havaya kalkınca top oyuncunun kafası ile zemin arasındaki boşluktan (altından) geçmemeli.
// Oyuncunun gövdesi (kafadan zemine kapsül) her zaman çarpışır; vuruş animasyonu gövdeyi açmaz.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/kafatopu-rules.js');

const DT = 1 / 60;
const idle = () => K.emptyInput();

// Sol oyuncu (0) x=px'te durur; top sağdan zemine yakın gelir; oyuncu `kickAt`. adımda vuruş tuşuna basar.
function run(px, ballY, vx, kickAt, steps) {
    let s = K.createState({ countdown: 0 });
    s.players[0].x = px;
    s.players[0].y = K.HEAD_STAND_Y;
    s.players[1].x = 760;                      // rakip uzakta
    s.ball = { x: px + 260, y: ballY, vx, vy: 0 };
    const trace = [];
    for (let i = 0; i < steps; i++) {
        const input0 = { left: false, right: false, jump: false, kick: i >= kickAt && i < kickAt + 12 };
        s = K.step(s, [input0, idle()], DT);
        trace.push({ bx: s.ball.x, by: s.ball.y, px: s.players[0].x, py: s.players[0].y, vx: s.ball.vx });
        if (s.events.length) break;
    }
    return trace;
}

test('vuruş yaparken karşıdan zemine yakın gelen top oyuncunun altından geçip öbür tarafa düşmez', () => {
    let tried = 0;
    for (const px of [200, 400]) {
        for (const ballY of [364, 372, 378, 384]) {                     // kafa altı ile zemin arası boşluk (top yarıçapı 16, zemin 400)
            for (const vx of [-300, -500, -800, -1100]) {
                for (let kickAt = 0; kickAt <= 40; kickAt += 2) {
                    tried++;
                    const trace = run(px, ballY, vx, kickAt, 90);
                    for (let i = 0; i < trace.length; i++) {
                        const t = trace[i];
                        assert.ok(!(t.bx < t.px - 8 && t.by > t.py + 18),
                            `top oyuncunun altından geçti: px=${px} y=${ballY} vx=${vx} vuruş=${kickAt} adım=${i} bx=${t.bx.toFixed(1)}`);
                    }
                }
            }
        }
    }
    assert.ok(tried > 600);
});

test('sağdaki oyuncu (rakip yönü) için de aynı: soldan gelen top altından geçmez', () => {
    for (const ballY of [372, 378, 384]) {
        for (const vx of [300, 600, 1000]) {
            for (let kickAt = 0; kickAt <= 40; kickAt += 4) {
                let s = K.createState({ countdown: 0 });
                s.players[1].x = 500;
                s.players[1].y = K.HEAD_STAND_Y;
                s.players[0].x = 60;
                s.ball = { x: 240, y: ballY, vx, vy: 0 };
                for (let i = 0; i < 90; i++) {
                    const input1 = { left: false, right: false, jump: false, kick: i >= kickAt && i < kickAt + 12 };
                    s = K.step(s, [idle(), input1], DT);
                    const p = s.players[1];
                    assert.ok(!(s.ball.x > p.x + 8 && s.ball.y > p.y + 18), `altından geçti: y=${ballY} vx=${vx} vuruş=${kickAt} adım=${i}`);
                    if (s.events.length) break;
                }
            }
        }
    }
});

test('vuruş topa hâlâ vurur: ayağın önündeki top ileri gider (gövde çarpışması vuruşu bozmaz)', () => {
    let s = K.createState({ countdown: 0 });
    s.players[0].x = 300;
    s.players[0].y = K.HEAD_STAND_Y;
    s.players[1].x = 760;
    s.ball = { x: 346, y: 376, vx: 0, vy: 0 };
    let kicked = false;
    for (let i = 0; i < 30 && !kicked; i++) {
        s = K.step(s, [{ left: false, right: false, jump: false, kick: i >= 1 }, idle()], DT);
        if (s.ball.vx > 400) kicked = true;
    }
    assert.ok(kicked, 'top vuruşla ileri fırladı');
});

test('zıplayan oyuncunun altından top geçebilir (gövde kafayla birlikte havada, zemini kapatmaz)', () => {
    let s = K.createState({ countdown: 0 });
    s.players[0].x = 300;
    s.players[0].y = 150;                       // havada (yüksek)
    s.players[0].grounded = false;
    s.players[1].x = 760;
    s.ball = { x: 420, y: 384, vx: -1000, vy: 0 };
    let passed = false;
    for (let i = 0; i < 40; i++) {
        s = K.step(s, [idle(), idle()], DT);
        if (s.ball.x < 280) passed = true;
    }
    assert.ok(passed, 'havadaki oyuncunun altından yuvarlanıp geçti');
});
