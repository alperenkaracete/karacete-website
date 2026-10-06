// stepOwn (katılandaki tahmin adımı) ile kurucunun tam step'i aynı oyuncu yörüngesini üretir.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/kafatopu-rules.js');

const DT = 1 / 60;

function lcg(seed) {
    let a = seed >>> 0;
    return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

// Rastgele ama tuş basılı tutan (gerçekçi) girdi dizisi
function randomInputs(seed, steps) {
    const rnd = lcg(seed);
    const out = [];
    let cur = K.emptyInput();
    for (let i = 0; i < steps; i++) {
        if (rnd() < 0.08) {
            cur = { left: rnd() < 0.4, right: rnd() < 0.4, jump: rnd() < 0.3, kick: rnd() < 0.3 };
        }
        out.push(cur);
    }
    return out;
}

const FIELDS = ['x', 'y', 'vx', 'vy', 'kick', 'kh', 'grounded'];

function compare(a, b, msg) {
    for (const f of FIELDS) {
        if (typeof a[f] === 'number') assert.ok(Math.abs(a[f] - b[f]) < 1e-9, `${msg}: ${f} ${a[f]} != ${b[f]}`);
        else assert.equal(a[f], b[f], `${msg}: ${f}`);
    }
}

for (const index of [0, 1]) {
    test(`stepOwn ≡ step (oyuncu ${index}, rakip boşta, uzak): 600 adım rastgele girdi`, () => {
        for (let seed = 1; seed <= 6; seed++) {
            let s = K.createState({ countdown: 0 });
            let own = s.players[index];
            let opp = s.players[1 - index];
            const inputs = randomInputs(seed * 17 + index, 600);
            for (let i = 0; i < inputs.length; i++) {
                const ins = index === 0 ? [inputs[i], K.emptyInput()] : [K.emptyInput(), inputs[i]];
                s = K.step(s, ins, DT);
                s.ball = { x: 400, y: 30, vx: 0, vy: 0 };           // top oyunculardan uzak: gol/vuruş olmasın
                const r = K.stepOwn(own, opp, index, inputs[i], DT, false);
                own = r.own;
                opp = r.opp;
                compare(own, s.players[index], `seed ${seed} adım ${i}`);
            }
        }
    });

    test(`stepOwn ≡ step (oyuncu ${index}): rakiple temas (kafa-kafa ayrışma), rakip taşınan kopya`, () => {
        let s = K.createState({ countdown: 0 });
        s.players[0].x = 380; s.players[1].x = 420;            // birbirine yakın
        let own = s.players[index];
        let opp = s.players[1 - index];
        const toward = index === 0 ? { right: true } : { left: true };
        const inputs = [];
        for (let i = 0; i < 200; i++) inputs.push(Object.assign(K.emptyInput(), toward, i % 50 === 20 ? { jump: true } : {}));
        for (let i = 0; i < inputs.length; i++) {
            const ins = index === 0 ? [inputs[i], K.emptyInput()] : [K.emptyInput(), inputs[i]];
            s = K.step(s, ins, DT);
            s.ball = { x: 400, y: 30, vx: 0, vy: 0 };
            const r = K.stepOwn(own, opp, index, inputs[i], DT, false);
            own = r.own;
            opp = r.opp;
            compare(own, s.players[index], `adım ${i}`);
            compare(opp, s.players[1 - index], `rakip adım ${i}`);
        }
    });
}

test('stepOwn: dondurulmuş fazda (geri sayım / maç sonu) girdiyi yok sayar, oyuncu kıpırdamaz', () => {
    const s = K.createState();               // geri sayım
    const r = K.stepOwn(s.players[0], s.players[1], 0, { left: true, right: true, jump: true, kick: true }, DT, true);
    assert.equal(r.own.x, s.players[0].x);
    assert.equal(r.own.y, s.players[0].y);
    assert.equal(r.own.kick, 0);
    const full = K.step(s, [{ left: false, right: true, jump: true, kick: true }, K.emptyInput()], DT);
    assert.equal(full.players[0].x, s.players[0].x);
});

test('stepOwn girdi nesnelerini değiştirmez', () => {
    const s = K.createState({ countdown: 0 });
    const own = s.players[0];
    const before = JSON.stringify(own);
    K.stepOwn(own, s.players[1], 0, { left: false, right: true, jump: true, kick: true }, DT, false);
    assert.equal(JSON.stringify(own), before);
});

test('top oyuncu hareketini etkilemez: aynı girdiyle top nerede olursa olsun oyuncu yörüngesi aynı', () => {
    const inputs = randomInputs(99, 300);
    const run = (ball) => {
        let s = K.createState({ countdown: 0 });
        s.ball = ball;
        for (const i of inputs) s = K.step(s, [i, K.emptyInput()], DT);
        return s.players[0];
    };
    // gol olmayacak, oyuncuların uzağında: sahne ortasında farklı konum/hızlar
    const a = run({ x: 400, y: 100, vx: 0, vy: 0 });
    const b = run({ x: 420, y: 60, vx: 150, vy: -300 });
    compare(a, b, 'top farkı');
});
