// Tek yapılandırma noktası: sunucu adresi burada değişir.
(function () {
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    window.KARACETE_CONFIG = {
        SERVER_URL: local
            ? 'ws://localhost:8080/oyun-odasi'
            : 'wss://compassionate-alignment-production-165c.up.railway.app/oyun-odasi'
    };
})();
