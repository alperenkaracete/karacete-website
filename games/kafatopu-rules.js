// Kafa Topu kuralları ve fiziği: saf fonksiyonlar, DOM ve ağdan bağımsız.
//
// Fizik yalnızca oda kurucusunda çalışır (otorite); katılan oyuncu anlık görüntüleri çizer.
// step(state, inputs, dt) yeni bir durum döndürür, girdileri değiştirmez. Olaylar (gol, maç sonu)
// yeni durumdaki `events` dizisinde gelir (her adımda sıfırlanır).
//
// Koordinatlar: mantıksal 800x450, y aşağı doğru artar. Oyuncu indeksi 0 = oda kurucusu.
// Başlangıçta oyuncu 0 solda; `swap` true ise taraflar değişir (rövanş).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KafaTopuRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---- Saha ----
    var W = 800;
    var H = 450;
    var GROUND = 400;
    var GOAL_W = 70;              // kale açıklığı genişliği (x: 0..70 ve 730..800)
    var CROSSBAR_Y = 250;         // üst çizgi üst kenarı
    var CROSSBAR_T = 8;           // üst çizgi kalınlığı

    // ---- Top ----
    var BALL_R = 16;
    var BALL_GRAVITY = 900;
    var BALL_DRAG = 0.12;         // 1/sn
    var BALL_ROLL_FRICTION = 1.6; // zeminde yuvarlanırken 1/sn
    var GROUND_BOUNCE = 0.72;
    var WALL_BOUNCE = 0.75;
    var BAR_BOUNCE = 0.6;
    var BALL_MAX_SPEED = 1300;

    // ---- Oyuncu ----
    var HEAD_R = 27;
    var FOOT_R = 12;
    var HEAD_STAND_Y = 342;       // yerdeyken kafa merkezi (ayak zemine değer)
    var MOVE_SPEED = 340;
    var JUMP_SPEED = 900;
    var PLAYER_GRAVITY = 2200;
    var AIR_CONTROL = 0.85;       // havada hedef hıza yaklaşma oranı
    var KICK_TIME = 0.22;
    var KICK_SPEED = 900;
    var KICK_START_ANGLE = -35;   // derece, aşağıdan geriye
    var KICK_END_ANGLE = 110;     // derece, aşağıdan ileri-yukarı
    var LEG_LENGTH = 38;
    var HEAD_BOUNCE = 0.8;
    var FOOT_BOUNCE = 0.45;

    // ---- Maç ----
    var MATCH_TIME = 90;
    var GOAL_LIMIT = 5;
    var COUNTDOWN_TIME = 3;
    var GOAL_PAUSE = 2;
    var SUBSTEPS = 2;
    var DEFAULT_DT = 1 / 60;

    var PHASES = ['countdown', 'play', 'goal', 'over'];

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function sq(v) { return v * v; }
    function deg(a) { return a * Math.PI / 180; }
    function round1(v) { return Math.round(v * 10) / 10; }

    // ---- Başlangıç durumu ----
    function leftIndex(swap) { return swap ? 1 : 0; }

    function startPlayers(swap) {
        var left = leftIndex(swap);
        var players = [null, null];
        players[left] = newPlayer(200, 1);
        players[1 - left] = newPlayer(600, -1);
        return players;
    }

    function newPlayer(x, dir) {
        return { x: x, y: HEAD_STAND_Y, vx: 0, vy: 0, dir: dir, kick: 0, hit: false, kh: false, grounded: true };
    }

    function startBall() {
        return { x: 400, y: 200, vx: 0, vy: 0 };
    }

    // options: { swap, matchTime, goalLimit, countdown, score, ball } (ball: ilk vuruş için başlangıç topu; testler içindir)
    function createState(options) {
        options = options || {};
        var swap = !!options.swap;
        var countdown = options.countdown === undefined ? COUNTDOWN_TIME : options.countdown;
        return {
            cfg: {
                matchTime: options.matchTime === undefined ? MATCH_TIME : options.matchTime,
                goalLimit: options.goalLimit === undefined ? GOAL_LIMIT : options.goalLimit
            },
            swap: swap,
            phase: countdown > 0 ? 'countdown' : 'play',
            countdown: countdown,
            time: options.matchTime === undefined ? MATCH_TIME : options.matchTime,
            golden: false,
            score: options.score ? options.score.slice() : [0, 0],
            winner: null,
            goalTimer: 0,
            lastScorer: null,
            tick: 0,
            players: startPlayers(swap),
            ball: options.ball ? { x: options.ball.x, y: options.ball.y, vx: options.ball.vx || 0, vy: options.ball.vy || 0 } : startBall(),
            events: []
        };
    }

    function clonePlayer(p) {
        return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, dir: p.dir, kick: p.kick, hit: p.hit, kh: p.kh, grounded: p.grounded };
    }

    function cloneState(s) {
        return {
            cfg: { matchTime: s.cfg.matchTime, goalLimit: s.cfg.goalLimit },
            swap: s.swap, phase: s.phase, countdown: s.countdown, time: s.time, golden: s.golden,
            score: s.score.slice(), winner: s.winner, goalTimer: s.goalTimer, lastScorer: s.lastScorer, tick: s.tick,
            players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
            ball: { x: s.ball.x, y: s.ball.y, vx: s.ball.vx, vy: s.ball.vy },
            events: []
        };
    }

    // ---- Ayak konumu (vuruş yayı) ----
    // Dinlenirken ayak kafanın biraz önünde ve altındadır; vuruşta pivot etrafında yay çizer.
    function kickProgress(p) {
        return p.kick > 0 ? 1 - p.kick / KICK_TIME : 0;
    }

    function footPos(p) {
        var angle;
        if (p.kick > 0) {
            var t = kickProgress(p);
            angle = KICK_START_ANGLE + (KICK_END_ANGLE - KICK_START_ANGLE) * t;
        } else {
            angle = 8;
        }
        var a = deg(angle);
        return {
            x: p.x + p.dir * Math.sin(a) * LEG_LENGTH,
            y: p.y + 8 + Math.cos(a) * LEG_LENGTH
        };
    }

    function kickActive(p) {
        if (p.kick <= 0 || p.hit) return false;
        var t = kickProgress(p);
        return t >= 0.2 && t <= 0.9;
    }

    // ---- Girdi ----
    function emptyInput() { return { left: false, right: false, jump: false, kick: false }; }

    // ---- Yardımcı çarpışmalar ----
    function normalize(x, y, fallbackX, fallbackY) {
        var len = Math.sqrt(x * x + y * y);
        if (len < 1e-6) return { x: fallbackX, y: fallbackY, len: 0 };
        return { x: x / len, y: y / len, len: len };
    }

    // Topun hareketli bir daireyle (kafa/ayak) çarpışması; çözülürse true.
    function collideBallCircle(ball, cx, cy, cr, cvx, cvy, restitution) {
        var dx = ball.x - cx;
        var dy = ball.y - cy;
        var minDist = BALL_R + cr;
        if (dx * dx + dy * dy >= minDist * minDist) return false;
        var n = normalize(dx, dy, 0, -1);
        // konumu dışarı it
        ball.x = cx + n.x * minDist;
        ball.y = cy + n.y * minDist;
        // göreli hız
        var rvx = ball.vx - cvx;
        var rvy = ball.vy - cvy;
        var vn = rvx * n.x + rvy * n.y;
        if (vn < 0) {
            ball.vx -= (1 + restitution) * vn * n.x;
            ball.vy -= (1 + restitution) * vn * n.y;
        }
        return true;
    }

    // Topun üst çizgiyle (dikdörtgen) çarpışması
    function collideBallBar(ball, left) {
        var x0 = left ? 0 : W - GOAL_W;
        var x1 = x0 + GOAL_W;
        var y0 = CROSSBAR_Y;
        var y1 = CROSSBAR_Y + CROSSBAR_T;
        var cx = clamp(ball.x, x0, x1);
        var cy = clamp(ball.y, y0, y1);
        var dx = ball.x - cx;
        var dy = ball.y - cy;
        var d2 = dx * dx + dy * dy;
        if (d2 >= BALL_R * BALL_R) return false;
        var nx;
        var ny;
        if (d2 < 1e-9) {
            // merkez dikdörtgenin içinde: en yakın kenara it
            var toTop = ball.y - y0;
            var toBottom = y1 - ball.y;
            if (toTop <= toBottom) { nx = 0; ny = -1; ball.y = y0 - BALL_R; }
            else { nx = 0; ny = 1; ball.y = y1 + BALL_R; }
        } else {
            var d = Math.sqrt(d2);
            nx = dx / d;
            ny = dy / d;
            ball.x = cx + nx * BALL_R;
            ball.y = cy + ny * BALL_R;
        }
        var vn = ball.vx * nx + ball.vy * ny;
        if (vn < 0) {
            ball.vx -= (1 + BAR_BOUNCE) * vn * nx;
            ball.vy -= (1 + BAR_BOUNCE) * vn * ny;
        }
        return true;
    }

    function limitBallSpeed(ball) {
        var sp2 = ball.vx * ball.vx + ball.vy * ball.vy;
        if (sp2 > BALL_MAX_SPEED * BALL_MAX_SPEED) {
            var k = BALL_MAX_SPEED / Math.sqrt(sp2);
            ball.vx *= k;
            ball.vy *= k;
        }
    }

    // ---- Oyuncu hareketi ----
    function movePlayer(p, input, dt, frozen) {
        var left = !frozen && input.left;
        var right = !frozen && input.right;
        var target = 0;
        if (left && !right) target = -MOVE_SPEED;
        else if (right && !left) target = MOVE_SPEED;

        if (p.grounded) p.vx = target;
        else p.vx += (target - p.vx) * Math.min(1, AIR_CONTROL * dt * 10);

        if (!frozen && input.jump && p.grounded) {
            p.vy = -JUMP_SPEED;
            p.grounded = false;
        }

        // vuruş: yalnızca basış anında başlar
        var kickNow = !frozen && input.kick;
        if (kickNow && !p.kh && p.kick <= 0) {
            p.kick = KICK_TIME;
            p.hit = false;
        }
        p.kh = kickNow;
        if (p.kick > 0) {
            p.kick -= dt;
            if (p.kick <= 0) { p.kick = 0; p.hit = false; }
        }

        p.vy += PLAYER_GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.x < HEAD_R) { p.x = HEAD_R; if (p.vx < 0) p.vx = 0; }
        if (p.x > W - HEAD_R) { p.x = W - HEAD_R; if (p.vx > 0) p.vx = 0; }
        if (p.y < HEAD_R) { p.y = HEAD_R; if (p.vy < 0) p.vy = 0; }
        if (p.y >= HEAD_STAND_Y) {
            p.y = HEAD_STAND_Y;
            if (p.vy > 0) p.vy = 0;
            p.grounded = true;
        } else {
            p.grounded = false;
        }
    }

    // İki kafa birbirinin içinden geçmez; dikeyde üst üste sıkışmaz, yana kayar.
    function separatePlayers(a, b, dt) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var minDist = HEAD_R * 2;
        var d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist) return;
        var d = Math.sqrt(d2);
        var nx;
        var ny;
        if (d < 1e-6) { nx = a.dir > 0 ? 1 : -1; ny = 0; d = 0; }
        else { nx = dx / d; ny = dy / d; }
        var overlap = minDist - d;
        a.x -= nx * overlap / 2;
        a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2;
        b.y += ny * overlap / 2;

        // göreli hızın normal bileşenini sıfırla (iç içe girmeyi sürdürme)
        var rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rvn < 0) {
            a.vx += rvn * nx / 2; a.vy += rvn * ny / 2;
            b.vx -= rvn * nx / 2; b.vy -= rvn * ny / 2;
        }
        // neredeyse dikey hizadaysa (biri diğerinin kafasında) üstteki yana kaysın
        if (Math.abs(nx) < 0.5) {
            var top = ny > 0 ? a : b;
            var side = top.x <= (top === a ? b.x : a.x) ? -1 : 1;
            top.x += side * 220 * dt;
        }
        a.x = clamp(a.x, HEAD_R, W - HEAD_R);
        b.x = clamp(b.x, HEAD_R, W - HEAD_R);
        a.y = clamp(a.y, HEAD_R, HEAD_STAND_Y);
        b.y = clamp(b.y, HEAD_R, HEAD_STAND_Y);
    }

    // ---- Vuruş ----
    function applyKick(ball, p, foot) {
        var n = normalize(ball.x - foot.x, ball.y - foot.y, p.dir, -0.2);
        var fwd = normalize(p.dir, -0.35, p.dir, 0);
        var dx = n.x * 0.5 + fwd.x * 0.5;
        var dy = n.y * 0.5 + fwd.y * 0.5;
        // yön her zaman ileri olsun
        if (dx * p.dir < 0.3) dx = 0.3 * p.dir;
        var d = normalize(dx, dy, p.dir, -0.3);
        ball.vx = d.x * KICK_SPEED + p.vx * 0.3;
        ball.vy = d.y * KICK_SPEED;
        // topu ayağın dışına çıkar
        var min = BALL_R + FOOT_R;
        ball.x = foot.x + n.x * min;
        ball.y = foot.y + n.y * min;
        limitBallSpeed(ball);
    }

    function ballVsPlayer(ball, p, prevFootX, prevFootY, dt) {
        // kafa
        collideBallCircle(ball, p.x, p.y, HEAD_R, p.vx, p.vy, HEAD_BOUNCE);
        // ayak
        var foot = footPos(p);
        var fvx = (foot.x - prevFootX) / dt;
        var fvy = (foot.y - prevFootY) / dt;
        if (kickActive(p)) {
            var dx = ball.x - foot.x;
            var dy = ball.y - foot.y;
            var reach = BALL_R + FOOT_R + 4;
            if (dx * dx + dy * dy <= reach * reach) {
                applyKick(ball, p, foot);
                p.hit = true;
                return;
            }
        }
        collideBallCircle(ball, foot.x, foot.y, FOOT_R, fvx, fvy, FOOT_BOUNCE);
    }

    // ---- Top ----
    function moveBall(ball, dt) {
        ball.vy += BALL_GRAVITY * dt;
        var drag = 1 - BALL_DRAG * dt;
        ball.vx *= drag;
        ball.vy *= drag;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        limitBallSpeed(ball);
    }

    function ballBounds(ball, dt) {
        if (ball.y + BALL_R > GROUND) {
            ball.y = GROUND - BALL_R;
            if (ball.vy > 0) ball.vy = -ball.vy * GROUND_BOUNCE;
            if (Math.abs(ball.vy) < 40) {
                ball.vy = 0;
                ball.vx *= Math.max(0, 1 - BALL_ROLL_FRICTION * dt);
            }
        }
        if (ball.y - BALL_R < 0) {
            ball.y = BALL_R;
            if (ball.vy < 0) ball.vy = -ball.vy * WALL_BOUNCE;
        }
        if (ball.x - BALL_R < 0) {
            ball.x = BALL_R;
            if (ball.vx < 0) ball.vx = -ball.vx * WALL_BOUNCE;
        }
        if (ball.x + BALL_R > W) {
            ball.x = W - BALL_R;
            if (ball.vx > 0) ball.vx = -ball.vx * WALL_BOUNCE;
        }
        collideBallBar(ball, true);
        collideBallBar(ball, false);
    }

    // Gol: top çizgiyi tamamen aşmış ve üst çizginin altında. Dönen değer: golü yiyen taraf ('left'/'right') ya da null.
    function goalSide(ball) {
        if (ball.y <= CROSSBAR_Y + CROSSBAR_T) return null;
        if (ball.x + BALL_R < GOAL_W) return 'left';
        if (ball.x - BALL_R > W - GOAL_W) return 'right';
        return null;
    }

    // ---- Adım ----
    function resetPositions(state) {
        state.players = startPlayers(state.swap);
        state.ball = startBall();
    }

    function registerGoal(state, concedingSide) {
        var left = leftIndex(state.swap);
        // sol kaleye gol yenirse sağdaki (diğer) oyuncu atmıştır
        var scorer = concedingSide === 'left' ? 1 - left : left;
        state.score[scorer]++;
        state.lastScorer = scorer;
        state.events.push({ type: 'goal', scorer: scorer, score: state.score.slice(), golden: state.golden });

        var decided = null;
        var reason = null;
        if (state.golden) { decided = scorer; reason = 'golden'; }
        else if (state.score[scorer] >= state.cfg.goalLimit) { decided = scorer; reason = 'goals'; }

        if (decided !== null) {
            state.phase = 'over';
            state.winner = decided;
            state.events.push({ type: 'end', winner: decided, score: state.score.slice(), reason: reason });
        } else {
            state.phase = 'goal';
            state.goalTimer = GOAL_PAUSE;
        }
    }

    function endByTime(state) {
        if (state.score[0] === state.score[1]) {
            state.golden = true;      // altın gol: süre durur, ilk atan kazanır
            state.time = 0;
            return;
        }
        var winner = state.score[0] > state.score[1] ? 0 : 1;
        state.phase = 'over';
        state.winner = winner;
        state.events.push({ type: 'end', winner: winner, score: state.score.slice(), reason: 'time' });
    }

    function subStep(state, inputs, dt) {
        var frozen = state.phase === 'countdown' || state.phase === 'over';
        var ps = state.players;
        var prevFoot = [footPos(ps[0]), footPos(ps[1])];
        movePlayer(ps[0], inputs[0], dt, frozen);
        movePlayer(ps[1], inputs[1], dt, frozen);
        separatePlayers(ps[0], ps[1], dt);

        if (state.phase !== 'countdown') {
            moveBall(state.ball, dt);
            ballBounds(state.ball, dt);
            ballVsPlayer(state.ball, ps[0], prevFoot[0].x, prevFoot[0].y, dt);
            ballVsPlayer(state.ball, ps[1], prevFoot[1].x, prevFoot[1].y, dt);
            ballBounds(state.ball, dt);
            if (state.phase === 'play') {
                var side = goalSide(state.ball);
                if (side) registerGoal(state, side);
            }
        }
    }

    // step(state, inputs, dt) -> yeni durum. inputs: [giriş0, giriş1]
    function step(state, inputs, dt) {
        if (dt === undefined) dt = DEFAULT_DT;
        var next = cloneState(state);
        var ins = [inputs && inputs[0] ? inputs[0] : emptyInput(), inputs && inputs[1] ? inputs[1] : emptyInput()];
        var sub = dt / SUBSTEPS;
        for (var i = 0; i < SUBSTEPS; i++) subStep(next, ins, sub);
        next.tick = state.tick + 1;

        if (next.phase === 'countdown') {
            next.countdown = Math.max(0, next.countdown - dt);
            if (next.countdown <= 0) next.phase = 'play';
        } else if (next.phase === 'play') {
            if (!next.golden) {
                next.time = Math.max(0, next.time - dt);
                if (next.time <= 0) endByTime(next);
            }
        } else if (next.phase === 'goal') {
            next.goalTimer -= dt;
            if (next.goalTimer <= 0) {
                resetPositions(next);
                next.goalTimer = 0;
                next.phase = 'play';
            }
        }
        return next;
    }

    // ---- Anlık görüntü (ağ) ----
    // { t, ph, cd, tm, g, sc:[a,b], p:[[x,y,k],[x,y,k]], b:[x,y] }; k = vuruş ilerlemesi 0..100
    function snapshot(state) {
        return {
            t: Math.round(state.tick * 1000 / 60),
            ph: PHASES.indexOf(state.phase),
            cd: round1(state.countdown),
            tm: round1(state.time),
            g: state.golden ? 1 : 0,
            sc: [state.score[0], state.score[1]],
            p: state.players.map(function (p) {
                return [round1(p.x), round1(p.y), p.kick > 0 ? Math.round(kickProgress(p) * 100) : 0];
            }),
            b: [round1(state.ball.x), round1(state.ball.y)]
        };
    }

    // Çizim için anlık görüntüyle aynı biçimde, yuvarlamasız görünüm (kurucunun kendi ekranı)
    function frame(state) {
        return {
            t: state.tick * 1000 / 60,
            ph: PHASES.indexOf(state.phase),
            cd: state.countdown,
            tm: state.time,
            g: state.golden ? 1 : 0,
            sc: [state.score[0], state.score[1]],
            p: state.players.map(function (p) {
                return [p.x, p.y, p.kick > 0 ? kickProgress(p) * 100 : 0];
            }),
            b: [state.ball.x, state.ball.y]
        };
    }

    // ---- Doğrulama ----
    function isNum(v, lo, hi) {
        return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
    }
    function isInt(v, lo, hi) {
        return Number.isInteger(v) && v >= lo && v <= hi;
    }

    // kt_input -> { left, right, jump, kick } ya da null
    function validateInput(msg) {
        if (!msg || typeof msg !== 'object') return null;
        var keys = ['left', 'right', 'jump', 'kick'];
        var out = {};
        for (var i = 0; i < keys.length; i++) {
            if (typeof msg[keys[i]] !== 'boolean') return null;
            out[keys[i]] = msg[keys[i]];
        }
        return out;
    }

    // kt_state -> normalize edilmiş anlık görüntü ya da null
    function validateState(msg) {
        if (!msg || typeof msg !== 'object') return null;
        if (!isInt(msg.t, 0, 1e9)) return null;
        if (!isInt(msg.ph, 0, PHASES.length - 1)) return null;
        if (!isNum(msg.cd, 0, COUNTDOWN_TIME + 1)) return null;
        if (!isNum(msg.tm, 0, 600)) return null;
        if (msg.g !== 0 && msg.g !== 1) return null;
        if (!Array.isArray(msg.sc) || msg.sc.length !== 2 || !isInt(msg.sc[0], 0, 99) || !isInt(msg.sc[1], 0, 99)) return null;
        if (!Array.isArray(msg.p) || msg.p.length !== 2) return null;
        var players = [];
        for (var i = 0; i < 2; i++) {
            var p = msg.p[i];
            if (!Array.isArray(p) || p.length !== 3) return null;
            if (!isNum(p[0], -50, W + 50) || !isNum(p[1], -100, H + 50) || !isNum(p[2], 0, 100)) return null;
            players.push([p[0], p[1], p[2]]);
        }
        if (!Array.isArray(msg.b) || msg.b.length !== 2) return null;
        if (!isNum(msg.b[0], -100, W + 100) || !isNum(msg.b[1], -200, H + 100)) return null;
        return { t: msg.t, ph: msg.ph, cd: msg.cd, tm: msg.tm, g: msg.g, sc: [msg.sc[0], msg.sc[1]], p: players, b: [msg.b[0], msg.b[1]] };
    }

    function validateScore(sc) {
        return Array.isArray(sc) && sc.length === 2 && isInt(sc[0], 0, 99) && isInt(sc[1], 0, 99);
    }

    // kt_start -> { round, swap } ya da null
    function validateStart(msg) {
        if (!msg || !isInt(msg.round, 1, 1e6) || typeof msg.swap !== 'boolean') return null;
        return { round: msg.round, swap: msg.swap };
    }

    // kt_goal -> { scorer, score, golden } ya da null
    function validateGoal(msg) {
        if (!msg || !isInt(msg.scorer, 0, 1) || !validateScore(msg.score) || typeof msg.golden !== 'boolean') return null;
        return { scorer: msg.scorer, score: msg.score.slice(), golden: msg.golden };
    }

    // kt_end -> { winner, score, reason } ya da null
    function validateEnd(msg) {
        if (!msg || !isInt(msg.winner, 0, 1) || !validateScore(msg.score)) return null;
        if (['goals', 'time', 'golden'].indexOf(msg.reason) === -1) return null;
        return { winner: msg.winner, score: msg.score.slice(), reason: msg.reason };
    }

    // ---- Yüz verisi ----
    var FACE_MAX_LENGTH = 8192;
    var JPEG_PREFIX = 'data:image/jpeg;base64,/9j/';
    var BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
    var PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

    function graphemeCount(text) {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            var count = 0;
            var it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]();
            while (!it.next().done) count++;
            return count;
        }
        return Array.from(text).length;
    }

    function isEmojiFace(text) {
        if (typeof text !== 'string' || text.length === 0 || text.length > 16) return false;
        return PICTOGRAPHIC.test(text) && graphemeCount(text) === 1;
    }

    function isJpegFace(text) {
        if (typeof text !== 'string' || text.length > FACE_MAX_LENGTH) return false;
        if (text.indexOf(JPEG_PREFIX) !== 0) return false;
        return BASE64_BODY.test(text.slice('data:image/jpeg;base64,'.length));
    }

    // Geçerliyse aynı metni döndürür, değilse null
    function validateFace(face) {
        if (isEmojiFace(face) || isJpegFace(face)) return face;
        return null;
    }

    // ---- İnterpolasyon (katılan taraf) ----
    function lerp(a, b, k) { return a + (b - a) * k; }

    function lerpSnapshots(a, b, k) {
        k = clamp(k, 0, 1);
        return {
            t: lerp(a.t, b.t, k),
            ph: k < 0.5 ? a.ph : b.ph,
            cd: lerp(a.cd, b.cd, k),
            tm: lerp(a.tm, b.tm, k),
            g: b.g,
            sc: b.sc.slice(),
            p: [
                [lerp(a.p[0][0], b.p[0][0], k), lerp(a.p[0][1], b.p[0][1], k), k < 0.5 ? a.p[0][2] : b.p[0][2]],
                [lerp(a.p[1][0], b.p[1][0], k), lerp(a.p[1][1], b.p[1][1], k), k < 0.5 ? a.p[1][2] : b.p[1][2]]
            ],
            b: [lerp(a.b[0], b.b[0], k), lerp(a.b[1], b.b[1], k)]
        };
    }

    // Tampondaki (t'ye göre sıralı) anlık görüntülerden renderT anındaki görünümü üretir; boşsa null.
    function sample(buffer, renderT) {
        if (!buffer.length) return null;
        if (renderT <= buffer[0].t) return buffer[0];
        var last = buffer[buffer.length - 1];
        if (renderT >= last.t) return last;
        for (var i = buffer.length - 1; i > 0; i--) {
            if (buffer[i - 1].t <= renderT) {
                var a = buffer[i - 1];
                var b = buffer[i];
                var span = b.t - a.t;
                return lerpSnapshots(a, b, span > 0 ? (renderT - a.t) / span : 1);
            }
        }
        return buffer[0];
    }

    return {
        W: W, H: H, GROUND: GROUND, GOAL_W: GOAL_W, CROSSBAR_Y: CROSSBAR_Y, CROSSBAR_T: CROSSBAR_T,
        BALL_R: BALL_R, HEAD_R: HEAD_R, FOOT_R: FOOT_R, HEAD_STAND_Y: HEAD_STAND_Y,
        MOVE_SPEED: MOVE_SPEED, JUMP_SPEED: JUMP_SPEED, KICK_TIME: KICK_TIME, KICK_SPEED: KICK_SPEED,
        MATCH_TIME: MATCH_TIME, GOAL_LIMIT: GOAL_LIMIT, COUNTDOWN_TIME: COUNTDOWN_TIME, GOAL_PAUSE: GOAL_PAUSE,
        DT: DEFAULT_DT, FACE_MAX_LENGTH: FACE_MAX_LENGTH, PHASES: PHASES,
        leftIndex: leftIndex, emptyInput: emptyInput, createState: createState,
        footPos: footPos, kickProgress: kickProgress, goalSide: goalSide,
        step: step, snapshot: snapshot, frame: frame,
        validateInput: validateInput, validateState: validateState, validateStart: validateStart,
        validateGoal: validateGoal, validateEnd: validateEnd, validateFace: validateFace,
        isEmojiFace: isEmojiFace, isJpegFace: isJpegFace,
        lerpSnapshots: lerpSnapshots, sample: sample
    };
});
