const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../games/parti/ticker.js');

// Sahte tarayıcı ortamı: Worker, URL/Blob, zamanlayıcılar
function env(opts) {
    opts = opts || {};
    const log = { created: [], revoked: [], terminated: 0, posted: [], intervals: [], cleared: [], timeouts: [] };
    class FakeWorker {
        constructor(url) {
            if (opts.workerThrows) throw new Error('CSP');
            log.created.push(url);
            this.onmessage = null;
            this.onerror = null;
            FakeWorker.last = this;
        }
        postMessage(m) { log.posted.push(m); }
        terminate() { log.terminated++; }
    }
    class FakeBlob { constructor(parts, o) { this.parts = parts; this.type = o && o.type; FakeBlob.last = this; } }
    const URLfake = {
        createObjectURL: (b) => { if (opts.noBlobUrl) throw new Error('yok'); return 'blob:fake/' + log.created.length; },
        revokeObjectURL: (u) => log.revoked.push(u)
    };
    const deps = {
        Worker: opts.noWorker ? undefined : FakeWorker, URL: URLfake, Blob: FakeBlob,
        setInterval: (f, ms) => { log.intervals.push({ f, ms }); return log.intervals.length; },
        clearInterval: (h) => log.cleared.push(h),
        setTimeout: (f, ms) => { log.timeouts.push({ f, ms, cancelled: false }); return log.timeouts.length; },
        clearTimeout: (h) => { if (log.timeouts[h - 1]) log.timeouts[h - 1].cancelled = true; }
    };
    return { deps, log, FakeWorker, FakeBlob };
}

test('worker kurulursa mod "worker": worker mesajı tick tetikler, setInterval kullanılmaz', () => {
    const e = env();
    let n = 0;
    const t = T.createTicker(() => n++, 250, e.deps);
    assert.equal(t.mode(), 'worker');
    assert.equal(e.log.created.length, 1);
    assert.equal(e.log.intervals.length, 0);
    e.FakeWorker.last.onmessage({ data: 1 });
    e.FakeWorker.last.onmessage({ data: 1 });
    assert.equal(n, 2);
    t.stop();
});

test('worker kaynağı istenen aralığı içerir ve "stop" mesajını dinler', () => {
    const e = env();
    T.createTicker(() => {}, 250, e.deps);
    const src = e.FakeBlob.last.parts[0];
    assert.match(src, /setInterval\(function\(\)\{postMessage\(1\)\},250\)/);
    assert.match(src, /e\.data==='stop'/);
    assert.equal(e.FakeBlob.last.type, 'text/javascript');
    assert.match(T.workerSource(40), /,40\)/);
    assert.match(T.workerSource(1), /,10\)/, 'çok küçük aralık 10 ms\'ye yükseltilir');
});

test('stop: worker durdurulur/sonlandırılır, blob adresi serbest bırakılır, sonra tick gelmez; stop tekrar çağrılabilir', () => {
    const e = env();
    let n = 0;
    const t = T.createTicker(() => n++, 250, e.deps);
    const w = e.FakeWorker.last;
    w.onmessage({ data: 1 });
    t.stop();
    assert.equal(t.mode(), 'stopped');
    assert.ok(e.log.posted.includes('stop'));
    assert.equal(e.log.terminated, 1);
    assert.equal(e.log.revoked.length, 1);
    assert.equal(w.onmessage, null);
    assert.ok(e.log.timeouts[0].cancelled, 'watchdog iptal');
    t.stop();
    assert.equal(e.log.terminated, 1, 'ikinci stop etkisiz');
    assert.equal(n, 1);
});

test('Worker oluşturucusu hata verirse (CSP vb.) setInterval\'a düşer; aralık çalışır, stop temizler', () => {
    const e = env({ workerThrows: true });
    let n = 0;
    const t = T.createTicker(() => n++, 250, e.deps);
    assert.equal(t.mode(), 'interval');
    assert.equal(e.log.intervals.length, 1);
    assert.equal(e.log.intervals[0].ms, 250);
    e.log.intervals[0].f();
    e.log.intervals[0].f();
    assert.equal(n, 2);
    t.stop();
    assert.deepEqual(e.log.cleared, [1]);
    e.log.intervals[0].f();
    assert.equal(n, 2, 'stop sonrası tick yok');
});

test('Worker, Blob/URL ya da createObjectURL yoksa setInterval\'a düşer', () => {
    for (const o of [{ noWorker: true }, { noBlobUrl: true }]) {
        const e = env(o);
        const t = T.createTicker(() => {}, 250, e.deps);
        assert.equal(t.mode(), 'interval', JSON.stringify(o));
        t.stop();
    }
    const e2 = env();
    e2.deps.Blob = undefined;
    assert.equal(T.createTicker(() => {}, 250, e2.deps).mode(), 'interval');
});

test('worker çalışırken hata (onerror) olursa setInterval\'a düşer ve worker kapatılır', () => {
    const e = env();
    let n = 0;
    const t = T.createTicker(() => n++, 250, e.deps);
    e.FakeWorker.last.onerror({});
    assert.equal(t.mode(), 'interval');
    assert.equal(e.log.terminated, 1);
    assert.equal(e.log.intervals.length, 1);
    e.log.intervals[0].f();
    assert.equal(n, 1);
    t.stop();
});

test('bekçi: worker 2 sn içinde hiç mesaj atmazsa setInterval\'a düşülür; mesaj gelirse düşülmez', () => {
    const silent = env();
    const t1 = T.createTicker(() => {}, 250, silent.deps);
    assert.equal(silent.log.timeouts[0].ms, T.WATCHDOG_MS);
    silent.log.timeouts[0].f();
    assert.equal(t1.mode(), 'interval');
    t1.stop();
    const alive = env();
    const t2 = T.createTicker(() => {}, 250, alive.deps);
    alive.FakeWorker.last.onmessage({ data: 1 });
    alive.log.timeouts[0].f();
    assert.equal(t2.mode(), 'worker', 'mesaj geldiyse worker sürer');
    assert.equal(alive.log.intervals.length, 0);
    t2.stop();
});

test('stop sonrası gelen gecikmiş worker mesajı ya da onerror tick/fallback üretmez', () => {
    const e = env();
    let n = 0;
    const t = T.createTicker(() => n++, 250, e.deps);
    const w = e.FakeWorker.last;
    const onmsg = w.onmessage, onerr = w.onerror;
    t.stop();
    onmsg({ data: 1 });
    onerr({});
    assert.equal(n, 0);
    assert.equal(t.mode(), 'stopped');
    assert.equal(e.log.intervals.length, 0);
});
