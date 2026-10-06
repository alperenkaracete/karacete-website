const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/kafatopu-rules.js');

const DT = 1 / 60;
const none = () => [K.emptyInput(), K.emptyInput()];
const held = (p0, p1) => [Object.assign(K.emptyInput(), p0 || {}), Object.assign(K.emptyInput(), p1 || {})];

function run(state, steps, inputs) {
    const events = [];
    let s = state;
    for (let i = 0; i < steps; i++) {
        s = K.step(s, typeof inputs === 'function' ? inputs(i, s) : (inputs || none()), DT);
        events.push(...s.events);
    }
    return { state: s, events };
}

function play(options) {
    return K.createState(Object.assign({ countdown: 0 }, options || {}));
}

test('başlangıç: oyuncu 0 solda, oyuncu 1 sağda; top ortada; swap tarafları değiştirir', () => {
    const s = K.createState();
    assert.equal(s.phase, 'countdown');
    assert.ok(s.players[0].x < s.players[1].x);
    assert.equal(s.players[0].dir, 1);
    assert.equal(s.players[1].dir, -1);
    assert.equal(s.ball.x, 400);
    assert.deepEqual(s.score, [0, 0]);
    const sw = K.createState({ swap: true });
    assert.ok(sw.players[0].x > sw.players[1].x);
    assert.equal(sw.players[0].dir, -1);
    assert.equal(sw.players[1].dir, 1);
    assert.equal(K.leftIndex(true), 1);
});

test('step: aynı girdi aynı sonucu verir ve girdi durumunu değiştirmez', () => {
    const s0 = play();
    const before = JSON.stringify(s0);
    const inputs = held({ right: true, jump: true, kick: true }, { left: true });
    const a = run(s0, 120, inputs).state;
    const b = run(s0, 120, inputs).state;
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(s0), before);
});

test('geri sayım: oyuncular ve top donuk, 3 sn sonra oyun başlar; süre akmaz', () => {
    let s = K.createState();
    const start = JSON.stringify([s.players, s.ball, s.time]);
    s = run(s, 90, held({ right: true, jump: true }, { left: true })).state;   // 1.5 sn
    assert.equal(s.phase, 'countdown');
    assert.equal(JSON.stringify([s.players, s.ball, s.time]), start);
    assert.ok(s.countdown > 1.4 && s.countdown < 1.6);
    s = run(s, 95).state;
    assert.equal(s.phase, 'play');
    assert.equal(s.countdown, 0);
});

test('top zemine düşer, sekiyor ve zeminin altına inmez', () => {
    let s = play();
    let bounces = 0;
    let prevVy = 0;
    for (let i = 0; i < 400; i++) {
        s = K.step(s, none(), DT);
        assert.ok(s.ball.y + K.BALL_R <= K.GROUND + 1e-6, 'zemin altı y=' + s.ball.y);
        if (prevVy > 50 && s.ball.vy < 0) bounces++;
        prevVy = s.ball.vy;
    }
    assert.ok(bounces >= 3, 'sekme sayısı ' + bounces);
    assert.ok(Math.abs(s.ball.y - (K.GROUND - K.BALL_R)) < 1, 'sonunda zeminde durur');
});

test('top sönümlü seker: her sekme bir öncekinden alçak', () => {
    let s = play();
    const peaks = [];
    let minY = Infinity;
    let prevVy = 0;
    for (let i = 0; i < 600; i++) {
        s = K.step(s, none(), DT);
        minY = Math.min(minY, s.ball.y);
        if (prevVy < 0 && s.ball.vy >= 0) { peaks.push(minY); minY = Infinity; }
        prevVy = s.ball.vy;
    }
    assert.ok(peaks.length >= 3);
    for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] >= peaks[i - 1] - 1e-6, 'tepe ' + i);
});

test('top duvarlardan ve tavandan seker', () => {
    // sol duvar (kale üstü bölgede, gol bölgesi değil)
    let s = play();
    s.ball = { x: 300, y: 100, vx: -900, vy: 0 };
    let bounced = false;
    for (let i = 0; i < 90 && !bounced; i++) {
        s = K.step(s, none(), DT);
        assert.ok(s.ball.x >= K.BALL_R - 1e-6);
        if (s.ball.vx > 0) bounced = true;
    }
    assert.ok(bounced, 'sol duvardan döndü');
    // sağ duvar
    s = play();
    s.ball = { x: 500, y: 100, vx: 900, vy: 0 };
    bounced = false;
    for (let i = 0; i < 90 && !bounced; i++) {
        s = K.step(s, none(), DT);
        assert.ok(s.ball.x <= K.W - K.BALL_R + 1e-6);
        if (s.ball.vx < 0) bounced = true;
    }
    assert.ok(bounced, 'sağ duvardan döndü');
    // tavan
    s = play();
    s.ball = { x: 400, y: 60, vx: 0, vy: -1000 };
    s = K.step(s, none(), DT);
    s = K.step(s, none(), DT);
    s = K.step(s, none(), DT);
    assert.ok(s.ball.vy > 0 && s.ball.y >= K.BALL_R - 1e-6);
});

test('gol: top sağ kale çizgisini tamamen geçince sol oyuncu (0) gol atar', () => {
    const s0 = play();
    s0.ball = { x: 700, y: 340, vx: 600, vy: 0 };
    const { state, events } = run(s0, 60);
    assert.equal(events.filter((e) => e.type === 'goal').length, 1);
    assert.deepEqual(events[0], { type: 'goal', scorer: 0, score: [1, 0], golden: false });
    assert.deepEqual(state.score, [1, 0]);
    assert.equal(state.phase, 'goal');
    assert.equal(state.lastScorer, 0);
});

test('gol: sol kaleye gol, sağdaki oyuncu (1) atar; swap ile golü atan değişir', () => {
    const s0 = play();
    s0.ball = { x: 100, y: 340, vx: -600, vy: 0 };
    const a = run(s0, 60);
    assert.deepEqual(a.state.score, [0, 1]);
    assert.equal(a.events[0].scorer, 1);
    const sw = play({ swap: true });
    sw.ball = { x: 100, y: 340, vx: -600, vy: 0 };
    const b = run(sw, 60);
    assert.deepEqual(b.state.score, [1, 0]);   // sol taraftaki oyuncu artık 1; sol kaleye gol → sağdaki (0) atar
    assert.equal(b.events[0].scorer, 0);
});

test('goalSide: çizgiyi tamamen aşmak gerekir ve üst çizginin altında olmalı', () => {
    assert.equal(K.goalSide({ x: 53, y: 300 }), 'left');
    assert.equal(K.goalSide({ x: 54, y: 300 }), null);          // merkez + r = 70, henüz tamamen geçmedi
    assert.equal(K.goalSide({ x: 747, y: 300 }), 'right');
    assert.equal(K.goalSide({ x: 746, y: 300 }), null);
    assert.equal(K.goalSide({ x: 30, y: 200 }), null);          // üst çizginin üstünde
    assert.equal(K.goalSide({ x: 30, y: 258 }), null);          // tam üst çizgide
    assert.equal(K.goalSide({ x: 400, y: 300 }), null);
});

test('üst çizgiye (üstten) çarpan top seker, gol sayılmaz', () => {
    const s0 = play();
    s0.ball = { x: 30, y: 150, vx: 0, vy: 300 };
    let s = s0;
    let hit = false;
    const events = [];
    for (let i = 0; i < 120; i++) {
        const prevVy = s.ball.vy;
        s = K.step(s, none(), DT);
        events.push(...s.events);
        if (prevVy > 0 && s.ball.vy < 0 && s.ball.y < K.CROSSBAR_Y) hit = true;
        assert.ok(!(s.ball.y > K.CROSSBAR_Y + K.CROSSBAR_T && s.ball.x < K.GOAL_W), 'çizginin altına geçmemeli');
    }
    assert.ok(hit, 'üst çizgiden sekti');
    assert.equal(events.filter((e) => e.type === 'goal').length, 0);
    assert.deepEqual(s.score, [0, 0]);
});

test('direğe (üst çizginin ucuna) çarpan top geri döner, gol sayılmaz', () => {
    const s0 = play();
    // üst çizginin ucu x=70, y=254: top yandan geliyor
    s0.ball = { x: 130, y: 254, vx: -500, vy: 0 };
    const { state, events } = run(s0, 20);
    assert.equal(events.filter((e) => e.type === 'goal').length, 0);
    assert.deepEqual(state.score, [0, 0]);
    assert.ok(state.ball.vx > 0, 'top geri döndü, vx=' + state.ball.vx);
    assert.ok(state.ball.x > K.GOAL_W);
});

test('üst çizginin altından açıklığa giren top gol olur', () => {
    const s0 = play();
    s0.ball = { x: 150, y: 330, vx: -700, vy: 0 };
    const { events } = run(s0, 60);
    assert.equal(events.filter((e) => e.type === 'goal').length, 1);
});

test('vuruş: topa ileri yönde güçlü hız verir (sol oyuncu sağa, sağ oyuncu sola)', () => {
    for (const idx of [0, 1]) {
        let s = play();
        const p = s.players[idx];
        const foot = K.footPos(p);
        s.ball = { x: foot.x + p.dir * 30, y: foot.y - 4, vx: 0, vy: 0 };
        const kick = idx === 0 ? held({ kick: true }) : held({}, { kick: true });
        s = run(s, 20, (i) => (i === 0 ? kick : none())).state;
        assert.ok(s.ball.vx * p.dir > 600, `oyuncu ${idx}: vx=${s.ball.vx}`);
        assert.ok(s.players[idx].kick === 0, 'vuruş bitti');
    }
});

test('vuruş yalnızca ayak topa yakınken hız verir', () => {
    let s = play();
    s.ball = { x: 400, y: K.GROUND - K.BALL_R, vx: 0, vy: 0 };      // orta saha, oyuncudan uzak
    s = run(s, 30, (i) => (i === 0 ? held({ kick: true }) : none())).state;
    assert.ok(Math.abs(s.ball.vx) < 5);
});

test('tuşu basılı tutmak tek vuruş başlatır; yeniden vurmak için bırakıp basmak gerekir', () => {
    let s = play();
    let starts = 0;
    let prevKick = 0;
    for (let i = 0; i < 60; i++) {
        s = K.step(s, held({ kick: true }), DT);
        if (prevKick === 0 && s.players[0].kick > 0) starts++;
        prevKick = s.players[0].kick;
    }
    assert.equal(starts, 1);
    // bırak, tekrar bas
    s = run(s, 3).state;
    assert.ok(s.players[0].kick === 0);
    s = K.step(s, held({ kick: true }), DT);
    assert.ok(s.players[0].kick > 0);
});

test('bir vuruşta top yalnızca bir kez fırlatılır', () => {
    let s = play();
    const p = s.players[0];
    const foot = K.footPos(p);
    s.ball = { x: foot.x + 30, y: foot.y - 4, vx: 0, vy: 0 };
    s = run(s, 5, (i) => (i === 0 ? held({ kick: true }) : none())).state;
    assert.equal(s.players[0].hit, true);
    const vx = s.ball.vx;
    assert.ok(vx > 600);
});

test('kafa topu sektirir', () => {
    let s = play();
    const p = s.players[0];
    s.ball = { x: p.x, y: p.y - 140, vx: 0, vy: 0 };
    let bouncedOffHead = false;
    let prevVy = 0;
    for (let i = 0; i < 90; i++) {
        s = K.step(s, none(), DT);
        if (prevVy > 100 && s.ball.vy < 0 && s.ball.y < K.HEAD_STAND_Y - 40) bouncedOffHead = true;
        prevVy = s.ball.vy;
    }
    assert.ok(bouncedOffHead, 'top kafadan seker (zeminden değil)');
});

test('oyuncular saha dışına çıkamaz', () => {
    let s = play();
    s = run(s, 240, held({ left: true }, { right: true })).state;
    assert.equal(s.players[0].x, K.HEAD_R);
    assert.equal(s.players[1].x, K.W - K.HEAD_R);
    s = run(s, 240, held({ right: true }, { left: true })).state;
    for (const p of s.players) {
        assert.ok(p.x >= K.HEAD_R && p.x <= K.W - K.HEAD_R);
        assert.ok(p.y >= K.HEAD_R && p.y <= K.HEAD_STAND_Y);
    }
    // sürekli zıplayarak da sınırlar içinde
    s = play();
    let maxHeight = 0;
    for (let i = 0; i < 300; i++) {
        s = K.step(s, held({ jump: true, left: true }), DT);
        maxHeight = Math.max(maxHeight, K.HEAD_STAND_Y - s.players[0].y);
        assert.ok(s.players[0].y >= K.HEAD_R && s.players[0].x >= K.HEAD_R);
    }
    assert.ok(maxHeight > 150 && maxHeight < 200, 'zıplama yüksekliği ' + maxHeight);
});

test('zıplama yalnızca yerdeyken çalışır; havada tekrar zıplanamaz', () => {
    let s = play();
    s = K.step(s, held({ jump: true }), DT);
    assert.equal(s.players[0].grounded, false);
    const vy1 = s.players[0].vy;
    s = K.step(s, held({ jump: true }), DT);
    assert.ok(s.players[0].vy > vy1, 'havada yerçekimi etkili, ikinci zıplama yok');
});

test('oyuncular birbirinin içinden geçmez ama sıkışıp kalmaz', () => {
    let s = play();
    for (let i = 0; i < 300; i++) {
        s = K.step(s, held({ right: true }, { left: true }), DT);
        const a = s.players[0];
        const b = s.players[1];
        const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
        assert.ok(d >= 2 * K.HEAD_R - 1, 'iç içe: ' + d);
        assert.ok(a.x < b.x, 'yer değiştirmediler');
    }
    // sıkışmadan ayrılabilirler
    const gap0 = s.players[1].x - s.players[0].x;
    s = run(s, 60, held({ left: true }, { right: true })).state;
    assert.ok(s.players[1].x - s.players[0].x > gap0 + 100);
});

test('bir oyuncu diğerinin kafasına inerse yana kayar', () => {
    let s = play();
    s.players[0].x = 400; s.players[0].y = K.HEAD_STAND_Y;
    s.players[1].x = 402; s.players[1].y = K.HEAD_STAND_Y - 2 * K.HEAD_R + 4; s.players[1].grounded = false;
    s = run(s, 90).state;
    assert.ok(Math.abs(s.players[0].x - s.players[1].x) > 20, 'ayrıldılar');
});

test('süre yalnızca oyun fazında akar', () => {
    let s = K.createState();                                    // geri sayım
    s = run(s, 60).state;
    assert.equal(s.time, K.MATCH_TIME);
    const g = play();
    g.ball = { x: 700, y: 340, vx: 600, vy: 0 };
    const afterGoal = run(g, 30).state;                         // gol sonrası kutlama
    assert.equal(afterGoal.phase, 'goal');
    const t = afterGoal.time;
    assert.equal(run(afterGoal, 30).state.time, t);
    const playing = run(play(), 60).state;
    assert.ok(Math.abs(playing.time - (K.MATCH_TIME - 1)) < 0.05);
});

test('gol sonrası kutlama biter, herkes başlangıç pozisyonuna döner, top ortadan başlar', () => {
    const s0 = play();
    s0.ball = { x: 700, y: 340, vx: 600, vy: 0 };
    let s = run(s0, 40).state;
    assert.equal(s.phase, 'goal');
    s = run(s, 100).state;                                      // > 2 sn
    assert.equal(s.phase, 'play');
    assert.equal(s.players[0].x, 200);
    assert.equal(s.players[1].x, 600);
    assert.equal(s.ball.x, 400);
    assert.deepEqual(s.score, [1, 0]);
});

test('ilk 5 gol maçı bitirir; sonrasında skor değişmez', () => {
    let s = play();
    const events = [];
    for (let goal = 1; goal <= 5; goal++) {
        s.ball = { x: 700, y: 340, vx: 600, vy: 0 };
        const r = run(s, 60);
        events.push(...r.events);
        s = r.state;
        if (goal < 5) {
            assert.equal(s.phase, 'goal');
            s = run(s, 150).state;                              // kutlama bitsin
            assert.equal(s.phase, 'play');
        }
    }
    assert.equal(s.phase, 'over');
    assert.equal(s.winner, 0);
    assert.deepEqual(s.score, [5, 0]);
    const end = events.filter((e) => e.type === 'end');
    assert.equal(end.length, 1);
    assert.deepEqual(end[0], { type: 'end', winner: 0, score: [5, 0], reason: 'goals' });
    const after = run(Object.assign({}, s, { ball: { x: 700, y: 340, vx: 600, vy: 0 } }), 60);
    assert.deepEqual(after.state.score, [5, 0]);
    assert.equal(after.events.length, 0);
});

test('süre dolunca skor farklıysa öndeki kazanır', () => {
    const s0 = play({ matchTime: 1, score: [0, 2] });
    const { state, events } = run(s0, 70);
    assert.equal(state.phase, 'over');
    assert.equal(state.winner, 1);
    assert.deepEqual(events.filter((e) => e.type === 'end'), [{ type: 'end', winner: 1, score: [0, 2], reason: 'time' }]);
});

test('süre dolunca skor eşitse altın gol: süre durur, ilk gol kazandırır', () => {
    const s0 = play({ matchTime: 1, score: [2, 2] });
    let s = run(s0, 70).state;
    assert.equal(s.phase, 'play');
    assert.equal(s.golden, true);
    assert.equal(s.time, 0);
    s = run(s, 600).state;                                      // 10 sn daha: hâlâ altın gol bekliyor
    assert.equal(s.phase, 'play');
    s.ball = { x: 100, y: 340, vx: -600, vy: 0 };               // sol kaleye gol → oyuncu 1 atar
    const { state, events } = run(s, 60);
    assert.equal(state.phase, 'over');
    assert.equal(state.winner, 1);
    assert.deepEqual(state.score, [2, 3]);
    assert.deepEqual(events.map((e) => e.type), ['goal', 'end']);
    assert.equal(events[0].golden, true);
    assert.equal(events[1].reason, 'golden');
});

test('anlık görüntü: doğrulanır, küçüktür ve değerleri korur', () => {
    let s = run(play(), 30, held({ right: true }, { kick: true })).state;
    const snap = K.snapshot(s);
    const msg = Object.assign({ type: 'kt_state' }, snap);
    const ok = K.validateState(msg);
    assert.ok(ok);
    assert.equal(ok.t, snap.t);
    assert.ok(JSON.stringify(msg).length < 200, 'boyut ' + JSON.stringify(msg).length);
    assert.equal(snap.ph, 1);
    assert.equal(K.snapshot(K.createState()).ph, 0);
    assert.ok(snap.p[0][0] > 200);                               // sağa gitti
});

test('kt_state doğrulaması geçersizleri reddeder', () => {
    const good = Object.assign({ type: 'kt_state' }, K.snapshot(play()));
    assert.ok(K.validateState(good));
    const bad = (patch) => K.validateState(Object.assign({}, good, patch));
    assert.equal(bad({ t: -1 }), null);
    assert.equal(bad({ t: 1.5 }), null);
    assert.equal(bad({ t: '5' }), null);
    assert.equal(bad({ ph: 9 }), null);
    assert.equal(bad({ cd: 99 }), null);
    assert.equal(bad({ tm: -1 }), null);
    assert.equal(bad({ g: 2 }), null);
    assert.equal(bad({ sc: [0] }), null);
    assert.equal(bad({ sc: [0, 1.5] }), null);
    assert.equal(bad({ sc: [0, 500] }), null);
    assert.equal(bad({ p: [[1, 2, 3]] }), null);
    assert.equal(bad({ p: [[1, 2, 3], [1, 2]] }), null);
    assert.equal(bad({ p: [[1e9, 2, 3], [1, 2, 3]] }), null);
    assert.equal(bad({ p: [[NaN, 2, 3], [1, 2, 3]] }), null);
    assert.equal(bad({ p: [[1, 2, 500], [1, 2, 3]] }), null);
    assert.equal(bad({ b: [1] }), null);
    assert.equal(bad({ b: [Infinity, 1] }), null);
    assert.equal(bad({ b: ['1', 2] }), null);
    assert.equal(K.validateState(null), null);
    assert.equal(K.validateState('x'), null);
});

test('kt_input / kt_start / kt_goal / kt_end doğrulaması', () => {
    assert.deepEqual(K.validateInput({ type: 'kt_input', left: true, right: false, jump: false, kick: true }), { left: true, right: false, jump: false, kick: true });
    assert.equal(K.validateInput({ left: true, right: false, jump: false }), null);
    assert.equal(K.validateInput({ left: 1, right: 0, jump: 0, kick: 0 }), null);
    assert.equal(K.validateInput({ left: 'true', right: false, jump: false, kick: false }), null);
    assert.equal(K.validateInput(null), null);
    assert.deepEqual(K.validateStart({ round: 2, swap: true }), { round: 2, swap: true });
    assert.equal(K.validateStart({ round: 0, swap: true }), null);
    assert.equal(K.validateStart({ round: 1, swap: 'yes' }), null);
    assert.deepEqual(K.validateGoal({ scorer: 1, score: [2, 3], golden: false }), { scorer: 1, score: [2, 3], golden: false });
    assert.equal(K.validateGoal({ scorer: 2, score: [2, 3], golden: false }), null);
    assert.equal(K.validateGoal({ scorer: 0, score: [2], golden: false }), null);
    assert.equal(K.validateGoal({ scorer: 0, score: [2, 3] }), null);
    assert.deepEqual(K.validateEnd({ winner: 0, score: [5, 1], reason: 'goals' }), { winner: 0, score: [5, 1], reason: 'goals' });
    assert.equal(K.validateEnd({ winner: 0, score: [5, 1], reason: 'cheat' }), null);
    assert.equal(K.validateEnd({ winner: 3, score: [5, 1], reason: 'time' }), null);
});

test('yüz doğrulaması: tek emoji kabul, diğerleri red', () => {
    for (const ok of ['⚽', '😀', '🐱', '🧑‍🚀', '👨‍👩‍👧', '👍🏽', '❤️']) assert.equal(K.validateFace(ok), ok, ok);
    for (const bad of ['', 'a', 'ab', '😀😀', '😀a', ' 😀', '1', '<script>', '😀'.repeat(20), null, undefined, 5, {}, ['😀']]) {
        assert.equal(K.validateFace(bad), null, String(bad));
    }
});

test('yüz doğrulaması: yalnızca JPEG data URL, base64 ve boyut sınırı', () => {
    const body = '/9j/' + 'A'.repeat(200);
    const good = 'data:image/jpeg;base64,' + body;
    assert.equal(K.validateFace(good), good);
    assert.equal(K.validateFace(good + '=='), good + '==');
    const max = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(K.FACE_MAX_LENGTH - 'data:image/jpeg;base64,/9j/'.length);
    assert.equal(max.length, K.FACE_MAX_LENGTH);
    assert.equal(K.validateFace(max), max);
    assert.equal(K.validateFace(max + 'A'), null);                                  // sınırı aşar
    assert.equal(K.validateFace('data:image/png;base64,' + body), null);
    assert.equal(K.validateFace('data:image/svg+xml;base64,' + body), null);
    assert.equal(K.validateFace('data:image/jpeg;base64,iVBORw0KGgo='), null);      // JPEG imzası değil
    assert.equal(K.validateFace('data:image/jpeg;base64,/9j/<script>alert(1)</script>'), null);
    assert.equal(K.validateFace('data:image/jpeg;base64,/9j/AAAA" onerror="x'), null);
    assert.equal(K.validateFace('data:image/jpeg;base64,/9j/AA AA'), null);
    assert.equal(K.validateFace('data:image/jpeg;base64,/9j/AAAA\n'), null);
    assert.equal(K.validateFace('javascript:alert(1)'), null);
    assert.equal(K.validateFace('http://evil.example/a.jpg'), null);
    assert.equal(K.validateFace('DATA:image/jpeg;base64,' + body), null);
});

test('interpolasyon: iki görüntü arasında doğrusal, uçlarda sabit', () => {
    const mk = (t, bx, px) => ({ t, ph: 1, cd: 0, tm: 80, g: 0, sc: [0, 0], p: [[px, 342, 0], [600, 342, 0]], b: [bx, 200] });
    const buf = [mk(0, 100, 200), mk(100, 200, 220), mk(200, 400, 260)];
    assert.equal(K.sample([], 5), null);
    assert.equal(K.sample(buf, -50).b[0], 100);
    assert.equal(K.sample(buf, 999).b[0], 400);
    const mid = K.sample(buf, 50);
    assert.equal(mid.b[0], 150);
    assert.equal(mid.p[0][0], 210);
    const second = K.sample(buf, 150);
    assert.equal(second.b[0], 300);
    assert.equal(K.sample(buf, 100).b[0], 200);
});

test('maç sonu ve olaylar: gol olayı skorla birlikte gelir', () => {
    const s0 = play();
    s0.ball = { x: 700, y: 340, vx: 600, vy: 0 };
    const { events } = run(s0, 60);
    assert.deepEqual(events, [{ type: 'goal', scorer: 0, score: [1, 0], golden: false }]);
});
