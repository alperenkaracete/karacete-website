const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../games/kafatopu-rules.js');
const P = require('../games/kafatopu-predict.js');

const DT = 1 / 60;
const EMPTY = () => K.emptyInput();

function lcg(seed) {
    let a = seed >>> 0;
    return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

// Tel biçiminden doğrulanmış görüntü (a, c kurucu ağ katmanından)
function wireOf(state, a, c) {
    return K.validateState(Object.assign({ type: 'kt_state' }, K.snapshot(state), { a, c }));
}

// Kurucu simülasyonu (rakip = oyuncu 0 boşta, katılan = oyuncu 1) ile katılan tahmincisini gecikmeli ağla bağlar.
function pipeline(opts) {
    const rnd = lcg(opts.seed || 1);
    const delay = (base, jitter) => base + (jitter ? Math.floor(rnd() * (jitter + 1)) : 0);
    let host = K.createState({ countdown: 0 });
    const pred = P.create({ rules: K, index: 1, dir: -1 });
    pred.reset(-1);

    let hostInput = EMPTY();
    let lastN = 0;
    let c = 0;
    let n = 0;
    let prev = EMPTY();
    const toHost = [];      // {at, n, input}
    const toGuest = [];     // {at, snap}
    const lastAt = { host: 0, guest: 0 };
    const records = [];
    const oracle = { own: host.players[1], opp: host.players[0] };

    for (let g = 0; g < opts.steps; g++) {
        // 1) kurucuya girdi paketleri ulaşır
        for (let i = 0; i < toHost.length;) {
            if (toHost[i].at <= g) {
                const m = toHost.splice(i, 1)[0];
                if (m.n > lastN) { lastN = m.n; hostInput = m.input; c = 0; }
            } else i++;
        }
        // 2) kurucu bir adım atar ve anlık görüntü yollar
        host = K.step(host, [EMPTY(), hostInput], DT);
        host.ball = { x: 400, y: 30, vx: 0, vy: 0 };          // top oyunculardan uzak
        c++;
        const at = Math.max(lastAt.guest, g + delay(opts.d2, opts.jitter));
        lastAt.guest = at;
        toGuest.push({ at, snap: wireOf(host, lastN, c) });
        // 3) katılana görüntüler ulaşır -> uzlaştırma
        for (let i = 0; i < toGuest.length;) {
            if (toGuest[i].at <= g) {
                const m = toGuest.splice(i, 1)[0];
                const r = pred.reconcile(m.snap);
                records.push({ g, error: r.error, teleported: r.teleported, replay: r.replay });
            } else i++;
        }
        // 4) katılanın yerel adımı
        const input = opts.script(g);
        const changed = input.left !== prev.left || input.right !== prev.right || input.jump !== prev.jump || input.kick !== prev.kick;
        if (changed) {
            n++;
            pred.pushInput(n, input);
            const a2 = Math.max(lastAt.host, g + delay(opts.d1, opts.jitter));
            lastAt.host = a2;
            toHost.push({ at: a2, n, input });
            prev = input;
        }
        pred.step(input);
        // oracle: ağsız ideal yörünge
        const r = K.stepOwn(oracle.own, oracle.opp, 1, input, DT, false);
        oracle.own = r.own;
        oracle.opp = r.opp;
        records[records.length - 1] && (records[records.length - 1].oracle = null);
        records.push({ g, view: pred.view(), oracle: [oracle.own.x, oracle.own.y], host: [host.players[1].x, host.players[1].y] });
    }
    return { host, pred, records, oracle };
}

// Girdi senaryosu: sola yürü, zıpla, vur, dur
function script(g) {
    const i = EMPTY();
    if (g >= 10 && g < 60) i.left = true;
    if (g >= 40 && g < 44) i.jump = true;
    if (g >= 70 && g < 90) i.right = true;
    if (g === 100) i.kick = true;
    if (g >= 100 && g < 104) i.kick = true;
    if (g >= 120 && g < 150) i.left = true;
    return i;
}

test('sabit gecikmede tahmin ideal (ağsız) yörüngeyle birebir aynıdır, uzlaştırma sapması ≈ 0', () => {
    const r = pipeline({ steps: 300, d1: 4, d2: 5, script });
    const recs = r.records.filter((x) => x.error !== undefined);
    assert.ok(recs.length > 200);
    // ilk uzlaştırma sonrası tüm sapmalar ihmal edilebilir (yuvarlama: 0.1 px konum, 1 px/s hız)
    const maxErr = Math.max(...recs.slice(3).map((x) => x.error));
    assert.ok(maxErr < 0.6, 'en büyük uzlaştırma sapması ' + maxErr);
    assert.ok(recs.every((x) => !x.teleported));
    // görünen konum idealdir
    for (const x of r.records.filter((q) => q.view && q.g > 20)) {
        assert.ok(Math.abs(x.view[0] - x.oracle[0]) < 0.8 && Math.abs(x.view[1] - x.oracle[1]) < 0.8, `adım ${x.g}: ${x.view[0]} vs ${x.oracle[0]}`);
    }
});

test('yeniden oynatılan tahmin, kurucunun (gecikmeli girdiyle) ulaştığı son konumla aynı çıkar', () => {
    const r = pipeline({ steps: 400, d1: 6, d2: 6, script });
    // girdiler 150'de biter; sonra durulur: kurucu da tahmin de aynı yere oturur
    assert.ok(Math.abs(r.host.players[1].x - r.pred.view()[0]) < 0.6, `kurucu ${r.host.players[1].x} tahmin ${r.pred.view()[0]}`);
    assert.ok(Math.abs(r.host.players[1].y - r.pred.view()[1]) < 0.6);
});

test('jitter (değişken gecikme) varken sapma sınırlı kalır, ışınlanma olmaz ve durunca yakınsar', () => {
    for (let seed = 1; seed <= 6; seed++) {
        const r = pipeline({ steps: 500, d1: 3, d2: 3, jitter: 4, seed, script });
        const recs = r.records.filter((x) => x.error !== undefined);
        const maxErr = Math.max(...recs.map((x) => x.error));
        assert.ok(maxErr < 40, `seed ${seed}: en büyük sapma ${maxErr}`);
        assert.ok(recs.every((x) => !x.teleported), 'ışınlanma yok');
        assert.ok(Math.abs(r.host.players[1].x - r.pred.view()[0]) < 1, `seed ${seed}: yakınsama ${r.host.players[1].x} vs ${r.pred.view()[0]}`);
        // görünen konum sıçramaz: bir adımda yer değiştirme 15 px'i aşmaz
        let prev = null;
        for (const x of r.records.filter((q) => q.view)) {
            if (prev) assert.ok(Math.abs(x.view[0] - prev[0]) < 15, `seed ${seed} adım ${x.g}: sıçrama ${Math.abs(x.view[0] - prev[0])}`);
            prev = x.view;
        }
    }
});

// ---- birim testleri ----

function init(index = 1) {
    const pred = P.create({ rules: K, index, dir: index === 1 ? -1 : 1 });
    pred.reset(index === 1 ? -1 : 1);
    const host = K.createState({ countdown: 0 });
    pred.reconcile(wireOf(host, 0, 0));
    return { pred, host };
}

test('ilk görüntü tahmini başlatır; sonra yerel adımlar hemen hareket ettirir', () => {
    const pred = P.create({ rules: K, index: 1, dir: -1 });
    pred.reset(-1);
    assert.equal(pred.view(), null);
    pred.step(EMPTY());                      // görüntü gelmeden adım atılmaz
    assert.equal(pred.view(), null);
    pred.reconcile(wireOf(K.createState({ countdown: 0 }), 0, 0));
    const v0 = pred.view();
    assert.ok(Math.abs(v0[0] - 600) < 0.1);
    pred.pushInput(1, { left: true, right: false, jump: false, kick: false });
    pred.step({ left: true, right: false, jump: false, kick: false });
    assert.ok(pred.view()[0] < v0[0] - 5, 'tuş gelmeden hemen hareket');
});

test('küçük sapma yumuşak düzelir: görünen konum süreksizlik göstermez, her adımda %20 azalır', () => {
    const { pred, host } = init();
    const L = 20;
    for (let i = 0; i < L; i++) pred.step(EMPTY());
    const before = pred.view();
    const auth = K.createState({ countdown: 0 });
    auth.players[1].x = 590;                                  // kurucuya göre 10 px solda; tahmin 600'de
    const r = pred.reconcile(wireOf(auth, 0, L));             // a=0, c=L: tüm adımlar onaylı
    assert.ok(Math.abs(r.error - 10) < 0.2, 'sapma ' + r.error);
    assert.equal(r.teleported, false);
    const after = pred.view();
    assert.ok(Math.abs(after[0] - before[0]) < 1e-9, 'görünen konum süreksiz değil');
    assert.ok(Math.abs(pred._state().own.x - 590) < 0.2, 'fizik durumu onaylı konum');
    let off = pred.stats().offset;
    assert.ok(Math.abs(off - 10) < 0.2);
    for (let i = 1; i <= 10; i++) {
        pred.step(EMPTY());
        const now = pred.stats().offset;
        assert.ok(Math.abs(now / off - P.DECAY) < 1e-6, `adım ${i}: oran ${now / off}`);
        off = now;
    }
    assert.ok(off < 1.2);
    for (let i = 0; i < 40; i++) pred.step(EMPTY());
    assert.equal(pred.stats().offset, 0);
    assert.ok(Math.abs(pred.view()[0] - 590) < 0.2, 'sonunda onaylı konum');
});

test('büyük sapma (>40 px) doğrudan ışınlanır', () => {
    const { pred } = init();
    for (let i = 0; i < 10; i++) pred.step(EMPTY());
    const auth = K.createState({ countdown: 0 });
    auth.players[1].x = 540;                                  // 60 px sapma
    const r = pred.reconcile(wireOf(auth, 0, 10));
    assert.equal(r.teleported, true);
    assert.ok(r.error > 40);
    assert.ok(Math.abs(pred.view()[0] - 540) < 0.2, 'görünen konum anında onaylı konum');
    assert.equal(pred.stats().offset, 0);
    assert.equal(pred.stats().teleports, 1);
    // eşik: tam 40 px ışınlama değil
    const { pred: p2 } = init();
    for (let i = 0; i < 10; i++) p2.step(EMPTY());
    const a2 = K.createState({ countdown: 0 });
    a2.players[1].x = 562;
    assert.equal(p2.reconcile(wireOf(a2, 0, 10)).teleported, false);
});

test('onaylanan sıra numarasından eski girdiler atılır; kayıtlı girdiyle yeniden oynatılır', () => {
    const { pred } = init();
    const L = { left: true, right: false, jump: false, kick: false };
    pred.pushInput(1, L);
    for (let i = 0; i < 5; i++) pred.step(L);
    pred.pushInput(2, EMPTY());
    for (let i = 0; i < 5; i++) pred.step(EMPTY());
    pred.pushInput(3, L);
    for (let i = 0; i < 5; i++) pred.step(L);
    assert.deepEqual(Object.keys(pred._state().seqStart).map(Number).sort(), [0, 1, 2, 3]);
    // kurucu 2. girdiyi uyguluyor (1 adımdır): 1 ve 0 atılır
    const host = K.createState({ countdown: 0 });
    pred.reconcile(wireOf(host, 2, 1));
    assert.deepEqual(Object.keys(pred._state().seqStart).map(Number).sort(), [2, 3]);
    assert.deepEqual(Object.keys(pred._state().seqInput).map(Number).sort(), [2, 3]);
    // yeniden oynatılan adım sayısı = şimdiki adım - (başlangıç[a] + c) = 15 - (5 + 1)
    const r = pred.reconcile(wireOf(host, 3, 2));
    assert.equal(r.replay, 15 - (10 + 2));
});

test('bilinmeyen/eski sıra numarası tur başı kabul edilir ve çökmez', () => {
    const { pred, host } = init();
    for (let i = 0; i < 10; i++) pred.step(EMPTY());
    assert.doesNotThrow(() => pred.reconcile(wireOf(host, 99, 3)));
    assert.doesNotThrow(() => pred.reconcile(wireOf(host, 0, 10000)));      // c > yerel adım: sınırlanır
    assert.ok(pred.view());
});

test('geri sayım / maç sonu fazında tahmin dondurulur: kurucunun durumu aynen alınır', () => {
    const { pred } = init();
    for (let i = 0; i < 10; i++) pred.step({ left: true, right: false, jump: false, kick: false });
    const frozen = K.createState();                           // geri sayım fazı
    const r = pred.reconcile(wireOf(frozen, 0, 0));
    assert.equal(r.teleported, false);
    assert.ok(Math.abs(pred.view()[0] - 600) < 0.1);
    pred.step({ left: true, right: false, jump: false, kick: false });
    assert.ok(Math.abs(pred.view()[0] - 600) < 0.1, 'dondurulmuşken girdiler yok sayılır');
});

test('vuruş durumu uzlaştırılır: onaylı vuruş sayacı ve tuş basılı bilgisi korunur', () => {
    const { pred } = init(1);
    const kick = { left: false, right: false, jump: false, kick: true };
    pred.pushInput(1, kick);
    for (let i = 0; i < 4; i++) pred.step(kick);
    const auth = K.createState({ countdown: 0 });
    let s = auth;
    for (let i = 0; i < 4; i++) s = K.step(s, [EMPTY(), kick], DT);
    const r = pred.reconcile(wireOf(s, 1, 4));
    assert.ok(r.error < 0.6);
    assert.ok(pred.view()[2] > 0, 'vuruş animasyonu sürüyor');
    // tuş hâlâ basılıyken yeni vuruş başlamaz (kh korunur): 30 adım sonra vuruş bitti, yenisi yok
    for (let i = 0; i < 30; i++) pred.step(kick);
    assert.equal(pred.view()[2], 0);
});

test('tahmin ve rakip girdilerini değiştirmez: reconcile aynı görüntüyle tekrarlanınca kararlı', () => {
    const { pred, host } = init();
    for (let i = 0; i < 15; i++) pred.step(EMPTY());
    const snap = wireOf(host, 0, 15);
    pred.reconcile(snap);
    const v = pred.view();
    for (let i = 0; i < 5; i++) pred.reconcile(snap);
    assert.ok(Math.abs(pred.view()[0] - v[0]) < 1e-9);
});
