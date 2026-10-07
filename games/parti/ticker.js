// Parti: lider saati. Tarayıcı arka plandaki sekmelerde requestAnimationFrame'i durdurur ve setInterval'ı kısar;
// bu yüzden tick, bir Web Worker'dan gelen 250 ms'lik mesajlarla tetiklenir (worker zamanlayıcıları kısılmaz).
// Worker kurulamazsa (CSP, eski tarayıcı, Blob URL yok ya da worker hata verirse/sessiz kalırsa) setInterval'a düşülür.
// Bağımlılıklar enjekte edilebilir (Node'da test edilir).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiTicker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var WATCHDOG_MS = 2000;     // worker'dan bu sürede hiç mesaj gelmezse setInterval'a düş

    function workerSource(ms) {
        return 'var t=setInterval(function(){postMessage(1)},' + Math.max(10, Math.floor(ms)) + ');' +
            'onmessage=function(e){if(e.data===\'stop\'){clearInterval(t);close()}};';
    }

    // cb: her tick'te çağrılır; ms: aralık; deps (hepsi isteğe bağlı): { Worker, URL, Blob, setInterval, clearInterval, setTimeout, clearTimeout }
    // Dönen: { stop(), mode() } — mode(): 'worker' | 'interval' | 'stopped'
    function createTicker(cb, ms, deps) {
        deps = deps || {};
        var g = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});
        function dep(name) { return Object.prototype.hasOwnProperty.call(deps, name) ? deps[name] : g[name]; }   // açıkça undefined verilen bağımlılık "yok" demektir
        var W = dep('Worker');
        var U = dep('URL');
        var B = dep('Blob');
        var setI = deps.setInterval || function (f, t) { return g.setInterval(f, t); };
        var clearI = deps.clearInterval || function (h) { return g.clearInterval(h); };
        var setT = deps.setTimeout || function (f, t) { return g.setTimeout(f, t); };
        var clearT = deps.clearTimeout || function (h) { return g.clearTimeout(h); };

        var state = 'stopped';
        var worker = null;
        var blobUrl = null;
        var intervalHandle = null;
        var watchdog = null;
        var gotMessage = false;

        function fire() { if (state !== 'stopped') cb(); }

        function releaseWorker() {
            if (watchdog !== null) { clearT(watchdog); watchdog = null; }
            if (worker) {
                try { worker.postMessage('stop'); } catch (e) { /* kapanmış olabilir */ }
                try { worker.terminate(); } catch (e) { /* yok say */ }
                worker.onmessage = null;
                worker.onerror = null;
                worker = null;
            }
            if (blobUrl && U && U.revokeObjectURL) { try { U.revokeObjectURL(blobUrl); } catch (e) { /* yok say */ } }
            blobUrl = null;
        }

        function fallback() {
            if (state === 'stopped' || state === 'interval') return;
            releaseWorker();
            state = 'interval';
            intervalHandle = setI(fire, ms);
        }

        function start() {
            state = 'worker';
            try {
                if (!W || !U || !B || !U.createObjectURL) throw new Error('worker desteklenmiyor');
                blobUrl = U.createObjectURL(new B([workerSource(ms)], { type: 'text/javascript' }));
                worker = new W(blobUrl);
                worker.onmessage = function () { gotMessage = true; fire(); };
                worker.onerror = function () { fallback(); };
                watchdog = setT(function () { watchdog = null; if (!gotMessage) fallback(); }, WATCHDOG_MS);
            } catch (e) {
                releaseWorker();
                state = 'worker';
                fallback();
            }
        }

        function stop() {
            if (state === 'stopped') return;
            releaseWorker();
            if (intervalHandle !== null) { clearI(intervalHandle); intervalHandle = null; }
            state = 'stopped';
        }

        start();
        return { stop: stop, mode: function () { return state; } };
    }

    return { createTicker: createTicker, workerSource: workerSource, WATCHDOG_MS: WATCHDOG_MS };
});
