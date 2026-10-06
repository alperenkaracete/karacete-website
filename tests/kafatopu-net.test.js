const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/kafatopu-rules.js');
const Net = require('../games/kafatopu-net.js');

const FRAME = 1000 / 60;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(120);

// Kurucu (H) ve katılan (G) denetleyicileri, gecikmeli ve sıralı bir "sunucu" ile bağlar.
function game(options) {
    options = options || {};
    const latency = options.latency === undefined ? 0 : options.latency;
    const jitter = options.jitter || 0;
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const lastAt = { H: 0, G: 0 };
    let clock = 1000;
    const pending = [];
    const sent = { H: [], G: [] };
    const events = { H: [], G: [] };
    const views = { H: null, G: null };
    const ctxs = {};
    const nets = {};

    function make(key, id, name, players, isHost) {
        const other = key === 'H' ? 'G' : 'H';
        const ctx = {
            me: { id, name }, room: 'FUTBOL', players,
            isHost: () => isHost && players.length > 0 && players[0].id === id,
            send: (msg) => {
                const copy = JSON.parse(JSON.stringify(msg));
                sent[key].push(copy);
                // TCP gibi sıralı teslim: gecikme dalgalansa da mesajlar sırasını korur
                const at = Math.max(lastAt[key], clock + latency + rand() * jitter);
                lastAt[key] = at;
                pending.push({ at: at, to: other, msg: copy });
            }
        };
        ctxs[key] = ctx;
        nets[key] = Net.create({
            ctx, rules: K, now: () => clock,
            predictor: options.predictor, predict: options.predict,
            matchOptions: options.matchOptions,
            onChange: (v) => { views[key] = v; },
            onEvent: (e) => events[key].push(e)
        });
        return nets[key];
    }

    const H = make('H', 'A', 'Ayse', [{ id: 'A', name: 'Ayse' }], true);
    const G = make('G', 'B', 'Bora', [], false);

    const api = {
        H, G, views, sent, events, ctxs,
        get clock() { return clock; },
        deliverDue() {
            for (let i = 0; i < pending.length;) {
                if (pending[i].at <= clock) {
                    const m = pending.splice(i, 1)[0];
                    nets[m.to].onMessage(m.msg);
                } else i++;
            }
        },
        advance(ms) {
            const end = clock + ms;
            while (clock < end - 1e-9) {
                clock += Math.min(FRAME, end - clock);
                api.deliverDue();
                nets.H.tick(clock);
                nets.G.tick(clock);
            }
        },
        // Kurucu tick atmaz (arka plan sekmesi): yalnızca saat ve katılan ilerler.
        advanceGuestOnly(ms) {
            const end = clock + ms;
            while (clock < end - 1e-9) {
                clock += Math.min(FRAME, end - clock);
                nets.G.tick(clock);
            }
        },
        // katılan odaya girer: ona room_joined, kurucuya player_joined
        join() {
            ctxs.G.players.push({ id: 'A', name: 'Ayse' }, { id: 'B', name: 'Bora' });
            ctxs.H.players.push({ id: 'B', name: 'Bora' });
            nets.H.onMessage({ type: 'player_joined', id: 'B', name: 'Bora' });
            api.deliverDue();
        },
        // Yüz seçip ikisi de hazır olur.
        readyBoth() {
            H.setFace('⚽'); G.setFace('🐱');
            api.advance(1);
            H.ready(); G.ready();
            api.advance(1);
        },
        leave(key) {
            const other = key === 'H' ? 'G' : 'H';
            const id = key === 'H' ? 'A' : 'B';
            const list = ctxs[other].players;
            list.splice(list.findIndex((p) => p.id === id), 1);
            nets[other].onMessage({ type: 'player_disconnect', id });
        }
    };
    return api;
}

function startedGame(options) {
    const g = game(options);
    g.join();
    g.readyBoth();
    return g;
}

test('rakip yokken maç başlamaz; yüz seçilmeden hazır olunamaz', () => {
    const g = game();
    assert.equal(g.H.ready(), false);                 // yüz yok
    assert.equal(g.views.H, null);
    assert.equal(g.H.setFace('⚽'), true);
    assert.equal(g.H.ready(), true);
    g.advance(2000);
    assert.equal(g.views.H.mode, 'wait');
    assert.equal(g.views.H.opponent, null);
    assert.equal(g.views.H.room, 'FUTBOL');
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_start').length, 0);
});

test('geçersiz yüz reddedilir', () => {
    const g = game();
    assert.equal(g.H.setFace(PNG), false);
    assert.equal(g.H.setFace('abc'), false);
    assert.equal(g.H.setFace(JPEG), true);
    assert.equal(g.views.H.me.face, JPEG);
});

test('katılınca iki taraf yüzlerini değiş tokuş eder; geç gelen de görür', () => {
    const g = game();
    g.H.setFace('⚽');                                  // rakip yokken: mesaj gitmez
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_profile').length, 0);
    g.join();                                          // player_joined -> kurucu profili yeniden yollar
    g.G.setFace('🐱');
    g.advance(1);
    assert.equal(g.views.G.opponent.face, '⚽');
    assert.equal(g.views.H.opponent.face, '🐱');
});

test('kurucu rakip gelmeden hazır olduysa, katılınca hazır olduğunu görür', () => {
    const g = game();
    g.H.setFace('⚽');
    g.H.ready();
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_ready' || m.type === 'kt_profile').length, 0);   // gönderilecek kimse yok
    g.join();
    g.G.setFace('🐱');
    g.advance(1);
    assert.equal(g.views.G.opponent.ready, true);
    assert.equal(g.views.G.opponent.face, '⚽');
    g.G.ready();
    g.advance(100);
    assert.equal(g.views.H.mode, 'match');
    assert.equal(g.views.G.mode, 'match');
});

test('rakipten gelen geçersiz yüz, yanlış kimlik ve HTML yok sayılır', () => {
    const g = game();
    g.join();
    g.G.setFace('🐱'); g.advance(1);
    for (const bad of [PNG, '<img src=x onerror=alert(1)>', 'a', 'data:image/jpeg;base64,/9j/<b>', 'x'.repeat(9000)]) {
        g.H.onMessage({ type: 'kt_profile', id: 'B', face: bad });
        assert.equal(g.H.getView().opponent.face, '🐱', String(bad).slice(0, 20));
    }
    g.H.onMessage({ type: 'kt_profile', id: 'Z', face: '🐶' });       // yanlış kimlik
    assert.equal(g.H.getView().opponent.face, '🐱');
    g.H.onMessage({ type: 'kt_profile', id: 'B', face: JPEG });
    assert.equal(g.H.getView().opponent.face, JPEG);
});

test('iki taraf hazır olunca kurucu başlatır; geri sayım 3-2-1 ve sonra oyun', () => {
    const g = startedGame();
    const start = g.sent.H.find((m) => m.type === 'kt_start');
    assert.deepEqual(start, { type: 'kt_start', round: 1, swap: false });
    assert.equal(g.views.H.mode, 'match');
    assert.equal(g.views.G.mode, 'match');
    g.advance(1500);
    assert.equal(g.views.H.frame.ph, 0);
    assert.ok(g.views.H.frame.cd > 1 && g.views.H.frame.cd < 2, 'cd=' + g.views.H.frame.cd);
    assert.equal(g.views.G.frame.ph, 0);
    g.advance(2500);
    assert.equal(g.views.H.frame.ph, 1);
    assert.equal(g.views.G.frame.ph, 1);
    assert.ok(g.views.H.frame.tm < 90);
});

test('yalnızca biri hazırsa başlamaz', () => {
    const g = game();
    g.join();
    g.H.setFace('⚽'); g.G.setFace('🐱');
    g.H.ready();
    g.advance(2000);
    assert.equal(g.views.H.mode, 'wait');
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_start').length, 0);
    assert.equal(g.views.G.opponent.ready, true);
    g.G.ready();
    g.advance(100);
    assert.equal(g.views.H.mode, 'match');
});

test('kurucu 60 Hz anlık görüntü yollar, mesajlar küçüktür', () => {
    const g = startedGame();
    g.advance(500);
    const before = g.sent.H.filter((m) => m.type === 'kt_state').length;
    g.advance(2000);
    const count = g.sent.H.filter((m) => m.type === 'kt_state').length - before;
    assert.ok(count >= 118 && count <= 122, '2 sn içinde ' + count + ' görüntü');
    const sizes = g.sent.H.filter((m) => m.type === 'kt_state').map((m) => JSON.stringify(m).length);
    assert.ok(Math.max(...sizes) < 200, 'en büyük ' + Math.max(...sizes));
});

test('kurucunun girdisi doğrudan simülasyona gider ve ağa kt_input yazılmaz', () => {
    const g = startedGame();
    g.advance(3200);                                   // geri sayım bitti
    const x0 = g.H.getView().frame.p[0][0];
    g.H.setInput({ right: true });
    g.advance(500);
    assert.ok(g.H.getView().frame.p[0][0] > x0 + 100);
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_input').length, 0);
});

test('katılan yalnızca değişince kt_input yollar; kurucu uygular', () => {
    const g = startedGame({ latency: 40 });
    g.advance(3300);
    const x0 = g.H.getView().frame.p[1][0];
    g.G.setInput({ left: true });
    g.G.setInput({ left: true });                      // aynı değer: tekrar gönderilmez
    g.advance(500);
    g.G.setInput({ left: false });
    g.G.setInput({ left: false });
    g.advance(100);
    const inputs = g.sent.G.filter((m) => m.type === 'kt_input');
    const firsts = [];
    inputs.forEach((m) => { if (!firsts.some((f) => f.n === m.n)) firsts.push(m); });
    const changes = firsts.filter((m) => m.n > 0);     // n=0: boşta güvence tekrarı
    assert.deepEqual(changes.map((m) => m.left), [true, false]);
    assert.deepEqual(changes.map((m) => m.n), [1, 2]);
    assert.deepEqual(changes[0], { type: 'kt_input', r: 1, n: 1, left: true, right: false, jump: false, kick: false });
    assert.ok(g.H.getView().frame.p[1][0] < x0 - 100, 'kurucu katılanı hareket ettirdi');
});

test('tuş bırakma ve odak kaybı (releaseAll) tek kt_input ile iletilir', () => {
    const g = startedGame();
    g.advance(3300);
    g.G.setInput({ right: true, jump: true });
    g.G.releaseAll();
    g.G.releaseAll();
    const inputs = g.sent.G.filter((m) => m.type === 'kt_input' && m.n > 0);
    assert.equal(inputs.length, 2);
    assert.deepEqual([inputs[1].left, inputs[1].right, inputs[1].jump, inputs[1].kick], [false, false, false, false]);
});

test('katılan, maç başlarken basılı tuşu kurucuya bildirir', () => {
    const g = game();
    g.join();
    g.H.setFace('⚽'); g.G.setFace('🐱');
    g.G.setInput({ right: true });                      // henüz maç yok: gönderilmez
    assert.equal(g.sent.G.filter((m) => m.type === 'kt_input').length, 0);
    g.H.ready(); g.G.ready();
    g.advance(50);
    assert.equal(g.sent.G.filter((m) => m.type === 'kt_input').length, 1);
});

test('roller: kurucu kt_state, katılan kt_input/kt_ready/kt_rematch kabul etmez', () => {
    const g = startedGame();
    g.advance(3300);
    g.H.onMessage(Object.assign({ type: 'kt_state' }, K.snapshot(K.createState({ countdown: 0, swap: true }))));
    g.H.onMessage({ type: 'kt_start', round: 9, swap: true });
    g.H.onMessage({ type: 'kt_goal', scorer: 1, score: [0, 1], golden: false });
    g.H.onMessage({ type: 'kt_end', winner: 1, score: [0, 5], reason: 'goals' });
    assert.equal(g.H.getView().mode, 'match');
    assert.equal(g.H.getView().round, 1);
    assert.notEqual(g.H.getView().frame, null);
    // katılan: kt_input yok sayılır
    g.G.onMessage({ type: 'kt_input', r: 1, n: 1, left: true, right: false, jump: false, kick: false });
    g.advance(300);
    assert.equal(g.sent.G.filter((m) => m.type === 'kt_state').length, 0);
});

test('geçersiz mesajlar yok sayılır (kurucu girdisi, durum, olaylar)', () => {
    const g = startedGame();
    g.advance(3300);
    const x1 = g.H.getView().frame.p[1][0];
    for (const bad of [
        { type: 'kt_input', r: 1, n: 1, left: 1, right: 0, jump: 0, kick: 0 },
        { type: 'kt_input', r: 1, n: 1, left: true },
        { type: 'kt_input', r: 1, n: 1, left: 'true', right: false, jump: false, kick: false },
        { type: 'kt_input', left: true, right: false, jump: false, kick: false },
        { type: 'kt_input' }
    ]) g.H.onMessage(bad);
    g.advance(500);
    assert.ok(Math.abs(g.H.getView().frame.p[1][0] - x1) < 1, 'geçersiz girdi hareket ettirmedi');

    const base = Object.assign({ type: 'kt_state' }, K.snapshot(K.createState({ countdown: 0 })));
    for (const patch of [{ t: 'x' }, { ph: 99 }, { sc: [0] }, { p: [[0, 0, 0]] }, { b: [1e9, 0] }, { g: 5 }, { cd: -3 }]) {
        g.G.onMessage(Object.assign({}, base, patch, { t: patch.t === undefined ? 999999 : patch.t }));
    }
    assert.notEqual(g.G.getView().frame.t, 999999);
    g.G.onMessage({ type: 'kt_goal', scorer: 7, score: [0, 0], golden: false });
    g.G.onMessage({ type: 'kt_end', winner: 0, score: [5, 0], reason: 'hile' });
    g.G.onMessage({ type: 'kt_start', round: -1, swap: true });
    assert.equal(g.events.G.length, 0);
    assert.equal(g.G.getView().mode, 'match');
    g.G.onMessage(null);
    g.G.onMessage({});
    g.G.onMessage({ type: 5 });
});

test('eski veya tekrarlanan anlık görüntüler yok sayılır', () => {
    const g = startedGame();
    g.advance(3500);
    const t = g.G.getView().frame.t;
    const snap = Object.assign({ type: 'kt_state' }, K.snapshot(K.createState({ countdown: 0 })), { t: 5 });
    g.G.onMessage(snap);
    assert.ok(g.G.getView().frame.t >= t - 1, 'eski görüntü kabul edilmedi');
});

test('katılan, anlık görüntüleri yumuşak interpolasyonla ve ~40 ms gecikmeyle çizer', () => {
    const g = startedGame({ latency: 30 });
    g.advance(3300);
    g.H.setInput({ right: true });
    g.advance(400);
    const xs = [];
    const lag = [];
    for (let i = 0; i < 60; i++) {
        g.advance(FRAME);
        xs.push(g.G.getView().frame.p[0][0]);
        lag.push(g.H.getView().frame.p[0][0] - g.G.getView().frame.p[0][0]);
    }
    for (let i = 1; i < xs.length; i++) {
        const d = xs[i] - xs[i - 1];
        assert.ok(d > 0 && d < 9, `kare ${i}: adım ${d}`);        // 340 px/s ≈ 5.7 px/kare; sıçrama yok
    }
    const avgLag = lag.reduce((a, b) => a + b, 0) / lag.length;
    assert.ok(avgLag > 10 && avgLag < 50, 'ortalama gecikme (px) ' + avgLag);   // ≈ (30 + 40) ms * 340 px/s
});

test('ağ gecikmesi dalgalansa da (jitter) katılanın çizimi sıçramaz', () => {
    const g = startedGame({ latency: 40, jitter: 40 });
    g.advance(3500);
    g.H.setInput({ right: true });
    g.advance(600);
    let prev = g.G.getView().frame.p[0][0];
    let maxStep = 0;
    let minStep = Infinity;
    for (let i = 0; i < 120; i++) {
        g.advance(FRAME);
        const x = g.G.getView().frame.p[0][0];
        maxStep = Math.max(maxStep, x - prev);
        minStep = Math.min(minStep, x - prev);
        prev = x;
    }
    assert.ok(minStep >= 0, 'geriye gitmedi: ' + minStep);
    assert.ok(maxStep < 12, 'en büyük adım ' + maxStep);
});

test('kurucudan 1 sn görüntü gelmezse katılanda "stale" uyarısı çıkar, gelince kalkar', () => {
    const g = startedGame();
    g.advance(4000);
    assert.equal(g.G.getView().stale, false);
    g.advanceGuestOnly(1500);                          // kurucunun sekmesi arka planda: görüntü gelmiyor
    assert.equal(g.G.getView().stale, true);
    assert.ok(g.G.getView().frame, 'son görüntü ekranda kalır');
    g.advance(500);                                    // kurucu geri döndü
    assert.equal(g.G.getView().stale, false);
});

test('gol: kurucudan güvenilir kt_goal gelir; her iki taraf aynı olayı alır', () => {
    const g = startedGame({ matchOptions: { countdown: 0 } });
    g.advance(200);
    const sim = g.H._getSim();
    sim.ball = { x: 700, y: 340, vx: 600, vy: 0 };
    g.advance(500);
    const goals = (e) => e.filter((x) => x.type === 'goal');
    assert.equal(goals(g.events.H).length, 1);
    assert.equal(goals(g.events.G).length, 1);
    assert.deepEqual(goals(g.events.G)[0], { type: 'goal', scorer: 0, score: [1, 0], golden: false });
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_goal').length, 1);
    assert.deepEqual(g.G.getView().frame.sc, [1, 0]);
    // kutlama sonrası pozisyonlar sıfırlanır
    g.advance(2200);
    assert.equal(g.H.getView().frame.ph, 1);
    assert.equal(g.H.getView().frame.b[0], 400);
});

test('maç sonu: kt_end gelir, iki taraf "over" olur, oturum skoru güncellenir', () => {
    const g = startedGame({ matchOptions: { countdown: 0, goalLimit: 1 } });
    g.advance(200);
    g.H._getSim().ball = { x: 700, y: 340, vx: 600, vy: 0 };
    g.advance(500);
    assert.equal(g.views.H.mode, 'over');
    assert.equal(g.views.G.mode, 'over');
    assert.deepEqual(g.views.H.result, { winner: 0, score: [1, 0], reason: 'goals' });
    assert.deepEqual(g.views.G.result, { winner: 0, score: [1, 0], reason: 'goals' });
    assert.deepEqual(g.views.H.wins, [1, 0]);           // [ben, rakip]
    assert.deepEqual(g.views.G.wins, [0, 1]);
    assert.equal(g.events.G.filter((e) => e.type === 'end').length, 1);
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_end').length, 1);
    // bittikten sonra simülasyon durur
    const gameMsgs = () => g.sent.H.filter((m) => m.type !== 'kt_ping' && m.type !== 'kt_pong').length;
    const sentBefore = gameMsgs();
    g.advance(500);
    assert.equal(gameMsgs(), sentBefore);
});

test('süre dolunca eşitlikte altın gol: maç sürer, ilk gol bitirir', () => {
    const g = startedGame({ matchOptions: { countdown: 0, matchTime: 1 } });
    g.advance(1500);
    assert.equal(g.views.H.mode, 'match');
    assert.equal(g.views.H.frame.g, 1);
    g.H._getSim().ball = { x: 100, y: 340, vx: -600, vy: 0 };
    g.advance(500);
    assert.equal(g.views.H.mode, 'over');
    assert.equal(g.views.H.result.reason, 'golden');
    assert.equal(g.views.H.result.winner, 1);
    assert.deepEqual(g.views.H.wins, [0, 1]);
});

test('rövanş: iki oy gerekir, taraflar değişir, oturum skoru korunur', () => {
    const g = startedGame({ matchOptions: { countdown: 0, goalLimit: 1 } });
    g.advance(200);
    g.H._getSim().ball = { x: 700, y: 340, vx: 600, vy: 0 };
    g.advance(500);
    assert.equal(g.views.H.mode, 'over');
    assert.equal(g.G.rematch(), true);
    assert.equal(g.G.rematch(), false);                 // iki kez oy verilmez
    g.advance(200);
    assert.equal(g.views.H.mode, 'over');               // tek oy yetmez
    assert.equal(g.views.H.opponentVoted, true);
    assert.equal(g.H.rematch(), true);
    g.advance(200);
    assert.equal(g.views.H.mode, 'match');
    assert.equal(g.views.G.mode, 'match');
    assert.equal(g.views.H.round, 2);
    assert.equal(g.views.G.round, 2);
    assert.equal(g.views.H.swap, true);
    assert.equal(g.views.G.swap, true);
    assert.equal(g.sent.H.filter((m) => m.type === 'kt_start').pop().swap, true);
    assert.deepEqual(g.views.H.wins, [1, 0]);
    assert.deepEqual(g.views.H.frame.sc, [0, 0]);
    // üçüncü maç: taraflar geri döner
    g.H._getSim().ball = { x: 100, y: 340, vx: -600, vy: 0 };      // swap: sol taraf = oyuncu 1; sol kaleye gol -> sağdaki (0) atar
    g.advance(500);
    assert.equal(g.views.H.mode, 'over');
    g.H.rematch(); g.G.rematch(); g.advance(200);
    assert.equal(g.views.H.round, 3);
    assert.equal(g.views.H.swap, false);
});

test('maç sırasında gelen kt_rematch yok sayılır', () => {
    const g = startedGame();
    g.advance(3300);
    g.H.onMessage({ type: 'kt_rematch' });
    assert.equal(g.H.getView().opponentVoted, false);
    assert.equal(g.H.getView().round, 1);
});

test('rakip ayrılınca oyun duraklar ("abandoned"); kurucu yeni rakibi bekler', () => {
    const g = startedGame();
    g.advance(3500);
    g.leave('G');
    assert.equal(g.views.H.mode, 'abandoned');
    assert.equal(g.views.H.opponent, null);
    const tick = g.H._getSim().tick;
    const sent = g.sent.H.length;
    g.advance(1000);
    assert.equal(g.H._getSim().tick, tick);              // simülasyon durdu
    assert.equal(g.sent.H.length, sent);
    // yeni bir katılan gelir: baştan yüz/hazır akışı
    const g2 = g;
    g2.ctxs.H.players.push({ id: 'B', name: 'Bora' });
    g2.ctxs.G.players.splice(0, g2.ctxs.G.players.length, { id: 'A', name: 'Ayse' }, { id: 'B', name: 'Bora' });
    g2.H.onMessage({ type: 'player_joined', id: 'B', name: 'Bora' });
    assert.equal(g2.H.getView().mode, 'wait');            // kurucu zaten hazırdı
    assert.equal(g2.H.getView().opponent.ready, false);
});

test('kurucu ayrılırsa katılan otorite olmaz; oyun biter ("abandoned")', () => {
    const g = startedGame();
    g.advance(3500);
    g.leave('H');                                         // artık G'nin players[0]'ı kendisi: ctx.isHost() true döner
    assert.equal(g.views.G.mode, 'abandoned');
    const sentBefore = g.sent.G.length;
    g.advance(1500);
    assert.equal(g.sent.G.filter((m) => m.type === 'kt_state').length, 0);
    assert.equal(g.sent.G.length, sentBefore);
    assert.equal(g.views.G.mode, 'abandoned');
    g.G.onMessage({ type: 'player_joined', id: 'C', name: 'Can' });
    assert.equal(g.G.getView().mode, 'abandoned');
});

test('hazırlık aşamasında rakip ayrılırsa kurucu beklemeye devam eder', () => {
    const g = game();
    g.join();
    g.H.setFace('⚽'); g.H.ready();
    g.leave('G');
    assert.equal(g.views.H.mode, 'wait');
    assert.equal(g.views.H.opponent, null);
});

test('zaman adımı biriktirici: büyük kare aralığı en çok 5 adım atar ve gerisi atılır', () => {
    const g = startedGame({ matchOptions: { countdown: 0 } });
    g.advance(100);
    const sim0 = g.H._getSim();
    const tick0 = sim0.tick;
    g.H.tick(g.clock + 5000);                              // 5 sn'lik kare
    assert.ok(g.H._getSim().tick - tick0 <= 5, 'adım sayısı ' + (g.H._getSim().tick - tick0));
    const tick1 = g.H._getSim().tick;
    g.H.tick(g.clock + 5000 + FRAME);                      // sonraki normal kare: yalnızca ~1 adım
    assert.ok(g.H._getSim().tick - tick1 <= 2);
});

test('sabit adım: kare hızından bağımsız aynı simülasyon süresi', () => {
    function simTime(frameMs) {
        const g = startedGame({ matchOptions: { countdown: 0 } });
        let t = g.clock;
        const startTick = g.H._getSim().tick;
        g.H.tick(t);
        for (let ms = 0; ms < 2000; ms += frameMs) { t += frameMs; g.H.tick(t); }
        return (g.H._getSim().tick - startTick) / 60;
    }
    const a = simTime(16.667);
    const b = simTime(33.333);
    const c = simTime(8);
    for (const v of [a, b, c]) assert.ok(Math.abs(v - 2) < 0.1, 'simüle edilen süre ' + v);
});

// ---- v2: ping, girdi tekrarı, sıra numarası, tahmin ----
const Predict = require('../games/kafatopu-predict.js');

function startedGameP(options) {
    const g = game(Object.assign({ predictor: Predict }, options || {}));
    g.join();
    g.readyBoth();
    return g;
}

test('ping: RTT ≈ 2 x tek yön gecikme; pong gelmezse null', () => {
    const g = startedGame({ latency: 40 });
    g.advance(3000);
    const ping = g.views.G.ping;
    assert.ok(ping > 70 && ping < 100, 'ping ' + ping);
    assert.ok(g.views.H.ping > 70 && g.views.H.ping < 100);
    g.advanceGuestOnly(4000);                           // kurucu sessiz: pong yok
    assert.equal(g.G.getView().ping, null);
});

test('geçersiz ping/pong yok sayılır; ping aynen yansıtılır', () => {
    const g = startedGame();
    const before = g.sent.H.length;
    g.H.onMessage({ type: 'kt_ping', n: 'x', t: 1 });
    g.H.onMessage({ type: 'kt_ping', n: 1, t: 'a' });
    g.H.onMessage({ type: 'kt_pong', n: 1, t: 1e15 });
    g.H.onMessage({ type: 'kt_pong', n: -1, t: 5 });
    assert.equal(g.sent.H.length, before);
    g.H.onMessage({ type: 'kt_ping', n: 7, t: 123 });
    assert.deepEqual(g.sent.H[g.sent.H.length - 1], { type: 'kt_pong', n: 7, t: 123 });
});

test('girdi tekrarı: basılıyken ~100 ms, boştayken ~1 sn; n yalnızca değişimde artar', () => {
    const g = startedGame({ latency: 20 });
    g.advance(3300);
    const count = () => g.sent.G.filter((m) => m.type === 'kt_input').length;
    g.G.setInput({ right: true });
    const c0 = count();
    g.advance(1000);
    const held = count() - c0;
    assert.ok(held >= 9 && held <= 11, 'basılıyken 1 sn: ' + held);
    const ns = new Set(g.sent.G.filter((m) => m.type === 'kt_input' && m.n > 0).map((m) => m.n));
    assert.equal(ns.size, 1);
    g.G.setInput({ right: false });
    g.advance(300);                                     // onaylanana kadar tekrar edebilir
    const c1 = count();
    g.advance(3000);
    const idle = count() - c1;
    assert.ok(idle >= 2 && idle <= 4, 'boştayken 3 sn: ' + idle);
});

test('kurucu: eski/yinelenen n ve eski tur yok sayılır; ack a/c anlık görüntüde', () => {
    const g = startedGame();
    g.advance(3300);
    const base = { type: 'kt_input', r: 1, jump: false, kick: false, left: false, right: true };
    g.H.onMessage(Object.assign({}, base, { n: 5 }));
    g.advance(100);
    let snap = g.sent.H.filter((m) => m.type === 'kt_state').pop();
    assert.equal(snap.a, 5);
    assert.ok(snap.c >= 4 && snap.c <= 8, 'c=' + snap.c);
    g.H.onMessage(Object.assign({}, base, { n: 3, right: false, left: true }));   // eski
    g.H.onMessage(Object.assign({}, base, { n: 5, right: false, left: true }));   // yinelenen
    g.H.onMessage(Object.assign({}, base, { n: 9, r: 7, right: false, left: true })); // eski/yanlış tur
    g.advance(100);
    snap = g.sent.H.filter((m) => m.type === 'kt_state').pop();
    assert.equal(snap.a, 5);
    assert.ok(g.H._state().inputs[1].right && !g.H._state().inputs[1].left);
    g.H.onMessage(Object.assign({}, base, { n: 6, right: false, left: true }));
    assert.ok(g.H._state().inputs[1].left);
});

test('tahmin: katılan kendi karakterini RTT beklemeden hemen oynatır; tahminsiz geç kalır', () => {
    const run = (predict) => {
        const g = game({ latency: 60, predictor: Predict, predict });
        g.join(); g.readyBoth();
        g.advance(3500);
        const x0 = g.G.getView().frame.p[1][0];
        g.G.setInput({ left: true });
        let steps = 0;
        while (steps < 60 && g.G.getView().frame.p[1][0] > x0 - 3) { g.advance(FRAME); steps++; }
        return steps;
    };
    const withP = run(true);
    const without = run(false);
    assert.ok(withP <= 3, 'tahminli ' + withP + ' kare');
    assert.ok(without > withP + 6, 'tahminsiz ' + without + ' kare');
});

test('tahmin: durunca katılanın tahmini ile kurucudaki konum aynı; hata küçük kalır', () => {
    const g = game({ latency: 50, jitter: 20, predictor: Predict });
    g.join(); g.readyBoth();
    g.advance(3500);
    let maxErr = 0;
    const script = [['left', 400], ['left', 0], ['jump', 300], ['jump', 0], ['right', 500], ['right', 0], ['kick', 200], ['kick', 0]];
    for (const [key, ms] of script) {
        g.G.setInput({ [key]: ms > 0 });
        g.advance(ms || 300);
        maxErr = Math.max(maxErr, g.G.getView().debug.predErrorMax);
    }
    g.advance(1200);
    const gx = g.G.getView().frame.p[1][0];
    const hx = g.H.getView().frame.p[1][0];
    assert.ok(Math.abs(gx - hx) < 1, 'katılan ' + gx + ' kurucu ' + hx);
    assert.ok(maxErr < 40, 'hata ' + maxErr);
});

test('debug: anlık görüntü hızı ~60 Hz, tampon ve ekstrapolasyon bilgisi', () => {
    const g = startedGame({ latency: 30 });
    g.advance(4000);
    const d = g.G.getView().debug;
    assert.ok(d.stateHz >= 55 && d.stateHz <= 62, 'Hz ' + d.stateHz);
    assert.equal(d.interpDelay, 40);
    assert.ok(d.bufferSize > 5);
    assert.equal(d.role, 'katilan');
    assert.ok(g.H.getView().debug.simHz >= 55);
});
