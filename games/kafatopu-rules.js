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
    var BALL_MAX_SPEED = 1200;

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
    var BODY_TOP_OFFSET = 8;      // gövde kapsülünün üst ucu: kafa merkezinin bu kadar altı (ayak pivotu)
    var HEAD_BOUNCE = 0.8;
    var FOOT_BOUNCE = 0.45;

    // ---- Maç ----
    var MATCH_TIME = 90;
    var GOAL_LIMIT = 5;
    var COUNTDOWN_TIME = 3;
    var GOAL_PAUSE = 2;
    var SUBSTEPS = 2;                 // oyuncu hareketi için sabit alt adım (kurucu ve tahmin aynı)
    var MIN_BALL_SUBSTEPS = 2;
    var MAX_BALL_SUBSTEPS = 8;
    var RESOLVE_PASSES = 3;
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
            sub: MIN_BALL_SUBSTEPS,
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
            sub: s.sub,
            events: []
        };
    }

    // ---- Ayak konumu (vuruş yayı) ----
    // Dinlenirken ayak kafanın biraz önünde ve altındadır; vuruşta pivot etrafında yay çizer.
    function kickProgress(p) {
        return p.kick > 0 ? 1 - p.kick / KICK_TIME : 0;
    }

    // Kafa konumu (x, y), yön ve kalan vuruş süresi verilince ayak konumu
    function footPosAt(x, y, dir, kick) {
        var angle;
        if (kick > 0) {
            var t = 1 - kick / KICK_TIME;
            angle = KICK_START_ANGLE + (KICK_END_ANGLE - KICK_START_ANGLE) * t;
        } else {
            angle = 8;
        }
        var a = deg(angle);
        return {
            x: x + dir * Math.sin(a) * LEG_LENGTH,
            y: y + 8 + Math.cos(a) * LEG_LENGTH
        };
    }

    function footPos(p) {
        return footPosAt(p.x, p.y, p.dir, p.kick);
    }

    function kickActiveAt(kick, hit) {
        if (kick <= 0 || hit) return false;
        var t = 1 - kick / KICK_TIME;
        return t >= 0.2 && t <= 0.9;
    }

    function kickActive(p) {
        return kickActiveAt(p.kick, p.hit);
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
    // Top dışarı itilir (penetrasyon çözümü), göreli hızın normal bileşeni yansıtılır. Zemine ya da
    // duvara sıkışmış top, sıkıştığı yönde değil kayarak (yana/yukarı) itilir; merkezler çakışıksa
    // göreli hızın tersine (yoksa yukarı) itilir. Böylece top kafanın öbür yanına geçmez.
    function collideBallCircle(ball, cx, cy, cr, cvx, cvy, restitution) {
        var dx = ball.x - cx;
        var dy = ball.y - cy;
        var minDist = BALL_R + cr;
        var d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist) return false;
        var rvx = ball.vx - cvx;
        var rvy = ball.vy - cvy;
        var d = Math.sqrt(d2);
        var nx;
        var ny;
        if (d < 1e-4) {
            var rl = Math.sqrt(rvx * rvx + rvy * rvy);
            if (rl > 1e-3) { nx = -rvx / rl; ny = -rvy / rl; } else { nx = 0; ny = -1; }
        } else {
            nx = dx / d;
            ny = dy / d;
        }
        var onGround = ball.y + BALL_R >= GROUND - 0.01;
        var onLeftWall = ball.x - BALL_R <= 0.01;
        var onRightWall = ball.x + BALL_R >= W - 0.01;
        if (onGround && ny > 0) {
            // zemine sıkışık: yatay olarak dışarı kay
            var h = minDist * minDist - dy * dy;
            var hx = h > 0 ? Math.sqrt(h) : 0;
            var side = Math.abs(dx) > 0.5 ? (dx > 0 ? 1 : -1) : (rvx < 0 ? 1 : -1);
            nx = side * hx / minDist;
            ny = dy / minDist;
        } else if ((onLeftWall && nx < 0) || (onRightWall && nx > 0)) {
            // duvara sıkışık: dikey olarak dışarı kay (yukarı tercih)
            var h2 = minDist * minDist - dx * dx;
            var hy = h2 > 0 ? Math.sqrt(h2) : 0;
            nx = dx / minDist;
            ny = -hy / minDist;
        }
        ball.x = cx + nx * minDist;
        ball.y = cy + ny * minDist;
        var vn = rvx * nx + rvy * ny;
        if (vn < 0) {
            ball.vx -= (1 + restitution) * vn * nx;
            ball.vy -= (1 + restitution) * vn * ny;
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

    // Bir oyuncunun (adım içi konumundaki) kafa ve ayağıyla top çarpışması. g: oyuncunun adım geometrisi.
    function resolveBallPlayer(ball, p, g, f) {
        var hx = g.hx0 + (g.hx1 - g.hx0) * f;
        var hy = g.hy0 + (g.hy1 - g.hy0) * f;
        var kick = g.kb + (g.ke - g.kb) * f;
        if (kick < 0) kick = 0;
        var changed = collideBallCircle(ball, hx, hy, HEAD_R, g.hvx, g.hvy, HEAD_BOUNCE);
        // Gövde: kafadan zemindeki dinlenme ayağına uzanan dikey kapsül. Vuruşta ayak havaya kalkınca kafa ile zemin arasındaki
        // ~31 px'lik boşluk açılırdı (top 32 px) ve zemine yakın gelen top oyuncunun ALTINDAN geçerdi; gövde her zaman çarpışır.
        var bodyTop = hy + BODY_TOP_OFFSET;
        var bodyY = clamp(ball.y, bodyTop, bodyTop + LEG_LENGTH);
        if (collideBallCircle(ball, hx, bodyY, FOOT_R, g.hvx, g.hvy, FOOT_BOUNCE)) changed = true;
        var foot = footPosAt(hx, hy, p.dir, kick);
        if (kickActiveAt(kick, p.hit)) {
            var dx = ball.x - foot.x;
            var dy = ball.y - foot.y;
            var reach = BALL_R + FOOT_R + 4;
            if (dx * dx + dy * dy <= reach * reach) {
                applyKick(ball, p, foot);
                p.hit = true;
                return true;
            }
        }
        if (collideBallCircle(ball, foot.x, foot.y, FOOT_R, g.fvx, g.fvy, FOOT_BOUNCE)) changed = true;
        return changed;
    }

    // ---- Top ----
    function moveBall(ball, dt) {
        limitBallSpeed(ball);
        ball.vy += BALL_GRAVITY * dt;
        var drag = 1 - BALL_DRAG * dt;
        ball.vx *= drag;
        ball.vy *= drag;
        limitBallSpeed(ball);
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
    }

    // Sınırlar: zemin, tavan, duvarlar, üst çizgiler. Bir şey düzeltildiyse true.
    function ballBounds(ball, dt) {
        var changed = false;
        if (ball.y + BALL_R > GROUND) {
            ball.y = GROUND - BALL_R;
            if (ball.vy > 0) ball.vy = -ball.vy * GROUND_BOUNCE;
            if (Math.abs(ball.vy) < 40) {
                ball.vy = 0;
                ball.vx *= Math.max(0, 1 - BALL_ROLL_FRICTION * dt);
            }
            changed = true;
        }
        if (ball.y - BALL_R < 0) {
            ball.y = BALL_R;
            if (ball.vy < 0) ball.vy = -ball.vy * WALL_BOUNCE;
            changed = true;
        }
        if (ball.x - BALL_R < 0) {
            ball.x = BALL_R;
            if (ball.vx < 0) ball.vx = -ball.vx * WALL_BOUNCE;
            changed = true;
        }
        if (ball.x + BALL_R > W) {
            ball.x = W - BALL_R;
            if (ball.vx > 0) ball.vx = -ball.vx * WALL_BOUNCE;
            changed = true;
        }
        if (collideBallBar(ball, true)) changed = true;
        if (collideBallBar(ball, false)) changed = true;
        return changed;
    }

    // Top için alt adım sayısı: top (ve oyuncu/ayak) hiçbir alt adımda yarıçapın yarısından fazla
    // göreli yer değiştirmesin (üst sınır MAX_BALL_SUBSTEPS).
    function substepsFor(ballSpeed, playerSpeed, dt) {
        var rel = (ballSpeed || 0) + (playerSpeed || 0);
        var n = Math.ceil(rel * dt / (BALL_R / 2) - 1e-9);
        return clamp(n, MIN_BALL_SUBSTEPS, MAX_BALL_SUBSTEPS);
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

    // Oyuncuları sabit alt adımlarla ilerletir. Top bundan bağımsızdır (tahmin için önemli).
    // Her oyuncu için adım içi geometriyi (kafa başı/sonu, vuruş süresi başı/sonu, ayak) döndürür.
    function advancePlayers(ps, inputs, dt, frozen) {
        var before = [clonePlayer(ps[0]), clonePlayer(ps[1])];
        var sub = dt / SUBSTEPS;
        for (var i = 0; i < SUBSTEPS; i++) {
            movePlayer(ps[0], inputs[0], sub, frozen);
            movePlayer(ps[1], inputs[1], sub, frozen);
            separatePlayers(ps[0], ps[1], sub);
        }
        var geo = [];
        for (var k = 0; k < 2; k++) {
            var b = before[k];
            var a = ps[k];
            var kb = b.kick > 0 ? b.kick : (a.kick > 0 ? KICK_TIME : 0);
            var f0 = footPosAt(b.x, b.y, b.dir, kb);
            var f1 = footPosAt(a.x, a.y, a.dir, a.kick);
            geo.push({
                hx0: b.x, hy0: b.y, hx1: a.x, hy1: a.y,
                hvx: (a.x - b.x) / dt, hvy: (a.y - b.y) / dt,
                kb: kb, ke: a.kick,
                fvx: (f1.x - f0.x) / dt, fvy: (f1.y - f0.y) / dt
            });
        }
        return geo;
    }

    // Katılan taraftaki tahmin: yalnızca kendi oyuncusunu, kurucuyla aynı fonksiyonlarla (movePlayer,
    // separatePlayers, aynı sabit alt adımlar) ilerletir. Rakip kendi girdisiyle hareket etmez (son bilinen
    // durum, girdisiz) varsayılır; kafa-kafa ayrışmasından etkilenir. { own, opp } döndürür; opp'u çağıran
    // adımlar arasında taşır. Rakip gerçekten boştayken sonuç, tam step'teki oyuncu yörüngesiyle birebir aynıdır.
    function stepOwn(own, opp, index, input, dt, frozen) {
        var p = clonePlayer(own);
        var o = clonePlayer(opp);
        var sub = dt / SUBSTEPS;
        var idle = emptyInput();
        for (var i = 0; i < SUBSTEPS; i++) {
            movePlayer(p, input, sub, frozen);
            movePlayer(o, idle, sub, frozen);              // rakip: girdisiz (tuşlara basmıyor) varsayımı
            if (index === 0) separatePlayers(p, o, sub);
            else separatePlayers(o, p, sub);
        }
        return { own: p, opp: o };
    }

    function stepBall(state, geo, n, dt) {
        var ball = state.ball;
        var ps = state.players;
        var sub = dt / n;
        for (var k = 1; k <= n; k++) {
            var f = k / n;
            moveBall(ball, sub);
            for (var pass = 0; pass < RESOLVE_PASSES; pass++) {
                var changed = false;
                if (resolveBallPlayer(ball, ps[0], geo[0], f)) changed = true;
                if (resolveBallPlayer(ball, ps[1], geo[1], f)) changed = true;
                if (ballBounds(ball, sub)) changed = true;
                if (!changed) break;
            }
            if (state.phase === 'play') {
                var side = goalSide(ball);     // çarpışmalar çözüldükten sonra
                if (side) { registerGoal(state, side); break; }
            }
        }
    }

    // step(state, inputs, dt) -> yeni durum. inputs: [giriş0, giriş1]
    function step(state, inputs, dt) {
        if (dt === undefined) dt = DEFAULT_DT;
        var next = cloneState(state);
        var ins = [inputs && inputs[0] ? inputs[0] : emptyInput(), inputs && inputs[1] ? inputs[1] : emptyInput()];
        var frozen = next.phase === 'countdown' || next.phase === 'over';

        var geo = advancePlayers(next.players, ins, dt, frozen);

        if (next.phase !== 'countdown') {
            var ball = next.ball;
            limitBallSpeed(ball);
            var ballSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            var playerSpeed = 0;
            var anyKick = false;
            for (var i = 0; i < 2; i++) {
                playerSpeed = Math.max(playerSpeed, Math.sqrt(geo[i].hvx * geo[i].hvx + geo[i].hvy * geo[i].hvy),
                    Math.sqrt(geo[i].fvx * geo[i].fvx + geo[i].fvy * geo[i].fvy));
                if (geo[i].ke > 0 || geo[i].kb > 0) anyKick = true;
            }
            // vuruş topa ~KICK_SPEED hız verebilir: alt adım sayısını buna göre öngör
            var n = substepsFor(anyKick ? Math.max(ballSpeed, KICK_SPEED) : ballSpeed, playerSpeed, dt);
            next.sub = n;
            stepBall(next, geo, n, dt);
        }
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
    // Tel biçimi (kısa alanlar, yuvarlanmış; ~60 Hz):
    //   { t: sim adımı (1/60 sn), f: faz, d: geri sayım (0.1 sn), m: süre (0.1 sn), g: altın gol, s: [a, b] skor,
    //     p: [[x, y, k, vx, vy], [..]] oyuncular (k = vuruş ilerlemesi 0..100), b: [x, y, vx, vy] top }
    // Kurucu ağ katmanı ayrıca `a` (uygulanan son girdi sıra numarası) ve `c` (o girdinin kaç adımdır uygulandığı) ekler.
    function snapshot(state) {
        return {
            t: state.tick,
            f: PHASES.indexOf(state.phase),
            d: Math.round(state.countdown * 10),
            m: Math.round(state.time * 10),
            g: state.golden ? 1 : 0,
            s: [state.score[0], state.score[1]],
            p: state.players.map(function (p) {
                return [round1(p.x), round1(p.y), p.kick > 0 ? Math.round(kickProgress(p) * 100) : 0, Math.round(p.vx), Math.round(p.vy)];
            }),
            b: [round1(state.ball.x), round1(state.ball.y), Math.round(state.ball.vx), Math.round(state.ball.vy)]
        };
    }

    // Çizim için normalize görünüm biçimi (validateState çıktısıyla aynı): t ms, ph, cd/tm saniye, sc, p, b.
    // Kurucunun kendi ekranı için yuvarlamasız.
    function frame(state) {
        return {
            tick: state.tick,
            t: state.tick * 1000 / 60,
            ph: PHASES.indexOf(state.phase),
            cd: state.countdown,
            tm: state.time,
            g: state.golden ? 1 : 0,
            sc: [state.score[0], state.score[1]],
            p: state.players.map(function (p) {
                return [p.x, p.y, p.kick > 0 ? kickProgress(p) * 100 : 0, p.vx, p.vy];
            }),
            b: [state.ball.x, state.ball.y, state.ball.vx, state.ball.vy],
            ex: 0
        };
    }

    // ---- Doğrulama ----
    function isNum(v, lo, hi) {
        return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
    }
    function isInt(v, lo, hi) {
        return Number.isInteger(v) && v >= lo && v <= hi;
    }

    // kt_input -> { r, n, left, right, jump, kick } ya da null.
    // r: maç turu (>=1), n: tur içinde artan girdi sıra numarası (>=0).
    function validateInput(msg) {
        if (!msg || typeof msg !== 'object') return null;
        if (!isInt(msg.r, 1, 1e6) || !isInt(msg.n, 0, 1e9)) return null;
        var keys = ['left', 'right', 'jump', 'kick'];
        var out = { r: msg.r, n: msg.n };
        for (var i = 0; i < keys.length; i++) {
            if (typeof msg[keys[i]] !== 'boolean') return null;
            out[keys[i]] = msg[keys[i]];
        }
        return out;
    }

    // kt_state -> normalize edilmiş görünüm ({tick, t, ph, cd, tm, g, sc, p, b, a, c, ex:0}) ya da null
    function validateState(msg) {
        if (!msg || typeof msg !== 'object') return null;
        if (!isInt(msg.t, 0, 1e9)) return null;
        if (!isInt(msg.f, 0, PHASES.length - 1)) return null;
        if (!isInt(msg.d, 0, 40)) return null;
        if (!isInt(msg.m, 0, 6000)) return null;
        if (msg.g !== 0 && msg.g !== 1) return null;
        if (!Array.isArray(msg.s) || msg.s.length !== 2 || !isInt(msg.s[0], 0, 99) || !isInt(msg.s[1], 0, 99)) return null;
        if (!isInt(msg.a, 0, 1e9) || !isInt(msg.c, 0, 1e9)) return null;
        if (!Array.isArray(msg.p) || msg.p.length !== 2) return null;
        var players = [];
        for (var i = 0; i < 2; i++) {
            var p = msg.p[i];
            if (!Array.isArray(p) || p.length !== 5) return null;
            if (!isNum(p[0], -50, W + 50) || !isNum(p[1], -100, H + 50) || !isNum(p[2], 0, 100)) return null;
            if (!isNum(p[3], -3000, 3000) || !isNum(p[4], -3000, 3000)) return null;
            players.push([p[0], p[1], p[2], p[3], p[4]]);
        }
        var b = msg.b;
        if (!Array.isArray(b) || b.length !== 4) return null;
        if (!isNum(b[0], -100, W + 100) || !isNum(b[1], -200, H + 100) || !isNum(b[2], -3000, 3000) || !isNum(b[3], -3000, 3000)) return null;
        return {
            tick: msg.t, t: msg.t * 1000 / 60, ph: msg.f, cd: msg.d / 10, tm: msg.m / 10, g: msg.g,
            sc: [msg.s[0], msg.s[1]], p: players, b: [b[0], b[1], b[2], b[3]], a: msg.a, c: msg.c, ex: 0
        };
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

    // ---- İnterpolasyon / ekstrapolasyon (katılan taraf) ----
    var EXTRAPOLATE_MAX_MS = 100;

    function lerp(a, b, k) { return a + (b - a) * k; }

    function lerpPlayer(a, b, k) {
        return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), k < 0.5 ? a[2] : b[2], lerp(a[3], b[3], k), lerp(a[4], b[4], k)];
    }

    function lerpSnapshots(a, b, k) {
        k = clamp(k, 0, 1);
        return {
            tick: k < 0.5 ? a.tick : b.tick,
            t: lerp(a.t, b.t, k),
            ph: k < 0.5 ? a.ph : b.ph,
            cd: lerp(a.cd, b.cd, k),
            tm: lerp(a.tm, b.tm, k),
            g: b.g,
            sc: b.sc.slice(),
            p: [lerpPlayer(a.p[0], b.p[0], k), lerpPlayer(a.p[1], b.p[1], k)],
            b: [lerp(a.b[0], b.b[0], k), lerp(a.b[1], b.b[1], k), lerp(a.b[2], b.b[2], k), lerp(a.b[3], b.b[3], k)],
            a: b.a, c: b.c, ex: 0
        };
    }

    // Son anlık görüntüden `ms` kadar ileri tahmin (en çok EXTRAPOLATE_MAX_MS): top balistik (yerçekimi,
    // sınırlar içinde), oyuncular hız ve yerçekimiyle zemine kadar. Çarpışma hesaplanmaz; sonraki görüntü düzeltir.
    function extrapolate(last, ms) {
        var ex = clamp(ms, 0, EXTRAPOLATE_MAX_MS);
        var dt = ex / 1000;
        var bx = last.b[0] + last.b[2] * dt;
        var by = last.b[1] + last.b[3] * dt + 0.5 * BALL_GRAVITY * dt * dt;
        var bvy = last.b[3] + BALL_GRAVITY * dt;
        if (by > GROUND - BALL_R) { by = GROUND - BALL_R; bvy = 0; }
        bx = clamp(bx, BALL_R, W - BALL_R);
        by = Math.max(by, BALL_R);
        var players = last.p.map(function (p) {
            var py = p[1] + p[4] * dt + 0.5 * PLAYER_GRAVITY * dt * dt;
            var pvy = p[4] + PLAYER_GRAVITY * dt;
            if (py >= HEAD_STAND_Y) { py = HEAD_STAND_Y; pvy = 0; }
            return [clamp(p[0] + p[3] * dt, HEAD_R, W - HEAD_R), Math.max(py, HEAD_R), p[2], p[3], pvy];
        });
        return {
            tick: last.tick, t: last.t + ex, ph: last.ph, cd: last.cd, tm: last.tm, g: last.g, sc: last.sc.slice(),
            p: players, b: [bx, by, last.b[2], bvy], a: last.a, c: last.c, ex: ex
        };
    }

    // Tampondaki (t'ye göre sıralı) anlık görüntülerden renderT (ms) anındaki görünümü üretir; boşsa null.
    // renderT son görüntüden sonraysa en çok 100 ms ekstrapole edilir (görünümde `ex` = ekstrapole ms).
    function sample(buffer, renderT) {
        if (!buffer.length) return null;
        if (renderT <= buffer[0].t) return buffer[0];
        var last = buffer[buffer.length - 1];
        if (renderT >= last.t) return renderT > last.t ? extrapolate(last, renderT - last.t) : last;
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
        footPos: footPos, footPosAt: footPosAt, kickProgress: kickProgress, goalSide: goalSide,
        BALL_MAX_SPEED: BALL_MAX_SPEED,
        step: step, stepOwn: stepOwn, substepsFor: substepsFor, snapshot: snapshot, frame: frame,
        validateInput: validateInput, validateState: validateState, validateStart: validateStart,
        validateGoal: validateGoal, validateEnd: validateEnd, validateFace: validateFace,
        isEmojiFace: isEmojiFace, isJpegFace: isJpegFace,
        lerpSnapshots: lerpSnapshots, extrapolate: extrapolate, sample: sample, EXTRAPOLATE_MAX_MS: EXTRAPOLATE_MAX_MS
    };
});
