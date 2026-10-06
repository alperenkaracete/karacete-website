// Akış: lobi -> bağlantı -> oda -> oyun. Oyun mantığı bilmez, yalnızca mesajı oyuna iletir.
(function () {
    var config = window.KARACETE_CONFIG;
    var root = document.getElementById('game-root');
    var session = null;

    // Oyuncu kimliği sekme başına saklanır (sessionStorage): aynı sekmede yenileme/kopma sonrası aynı kimlikle odaya dönülebilir,
    // farklı sekmeler ayrı kimlik alır (aynı tarayıcıda çoklu sekmeyle test).
    var ID_KEY = 'karacete.pid';
    var SESSION_KEY = 'karacete.sess';
    function store(key, value) {
        try {
            if (value === undefined) return sessionStorage.getItem(key);
            if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
        } catch (e) { /* depolama yok: kimlik yalnızca bu sayfa için */ }
        return null;
    }
    var myId = store(ID_KEY);
    if (!myId || !/^oyuncu_[a-z0-9]{6}$/.test(myId)) {
        myId = 'oyuncu_' + Math.random().toString(36).slice(2, 8).padEnd(6, '0');
        store(ID_KEY, myId);
    }

    // Yeniden bağlanma (yalnızca def.reconnect === true olan oyunlar): kopunca oyun ekranı kapanmaz, aynı kimlik ve
    // oda koduyla join_room birkaç kez denenir. Başarılırsa oyuna { type: '_reconnected' } gider.
    var RECONNECT_DELAYS = [1000, 2000, 3000, 5000, 8000];
    var RECONNECT_WINDOW_MS = 180000;

    var ERRORS = {
        ROOM_NOT_FOUND: 'Oda bulunamadı, kodu kontrol et.',
        ROOM_FULL: 'Oda dolu.',
        NOT_IN_ROOM: 'Önce bir odaya katılmalısın.',
        BAD_REQUEST: 'Geçersiz istek, bilgilerini kontrol et.'
    };

    function closeSession() {
        var s = session;
        if (!s) return;
        session = null;
        if (s.timer) clearTimeout(s.timer);
        if (s.conn) s.conn.close();
        store(SESSION_KEY, null);
        if (s.state === 'playing') s.def.destroy();
        root.innerHTML = '';
        Lobby.hideRoom();
    }

    function startGame(s, def, room, players) {
        s.state = 'playing';
        s.def = def;
        s.room = room;
        s.players = players;
        if (def.reconnect) store(SESSION_KEY, JSON.stringify({ room: room, name: s.me.name }));
        Lobby.hide();
        Lobby.showRoom(room, function () {
            closeSession();
            Lobby.show();
        });
        def.init({
            root: root,
            send: function (msg) { if (s.conn) s.conn.send(msg); },
            me: s.me,
            room: room,
            players: s.players,
            isHost: function () { return s.players.length > 0 && s.players[0].id === s.me.id; },
            leave: function () {
                closeSession();
                Lobby.show();
            }
        });
    }

    function onMessage(s, data) {
        if (session !== s) return;

        if (s.state === 'connecting') {
            if (data.type === 'room_created') {
                startGame(s, s.requestedDef, data.room, [{ id: s.me.id, name: s.me.name }]);
            } else if (data.type === 'room_joined') {
                var def = Games.get(data.game);
                if (!def) {
                    closeSession();
                    Lobby.show();
                    Lobby.showError('Bu oyun desteklenmiyor.');
                    return;
                }
                startGame(s, def, data.room, data.players || []);
            } else if (data.type === 'error') {
                var req = s.request;
                if (req.resume && data.code === 'BAD_REQUEST' && (req.tries || 0) < 6) {
                    // yenileme sonrası: eski soket sunucuca henüz kapanmamış olabilir, kısa aralıkla yeniden dene
                    closeSession();
                    setTimeout(function () {
                        if (!session) begin({ name: req.name, room: req.room, resume: true, tries: (req.tries || 0) + 1 });
                    }, 1500);
                    return;
                }
                closeSession();
                Lobby.show();
                Lobby.showError(ERRORS[data.code] || 'Bir hata oluştu.');
            }
            return;
        }

        if (s.state === 'reconnecting') {
            if (data.type === 'room_joined') {
                s.state = 'playing';
                s.attempt = 0;
                s.players.splice.apply(s.players, [0, s.players.length].concat(data.players || []));
                s.def.onMessage({ type: '_connection', state: 'back' });
                s.def.onMessage({ type: '_reconnected' });
            } else if (data.type === 'error') {
                if (data.code === 'ROOM_NOT_FOUND') giveUp(s, 'Oda artık yok.');
                else retryReconnect(s);      // BAD_REQUEST: eski bağlantı sunucuca henüz kapanmamış olabilir
            }
            return;
        }

        if (data.type === 'player_joined') {
            s.players.push({ id: data.id, name: data.name });
        } else if (data.type === 'player_disconnect') {
            for (var i = s.players.length - 1; i >= 0; i--) {
                if (s.players[i].id === data.id) s.players.splice(i, 1);
            }
        }
        s.def.onMessage(data);
    }

    function giveUp(s, message) {
        if (session !== s) return;
        closeSession();
        Lobby.show();
        Lobby.showError(message);
    }

    function startReconnect(s) {
        s.state = 'reconnecting';
        s.attempt = 0;
        s.reconnectSince = Date.now();
        if (s.conn) { s.conn.close(); s.conn = null; }
        s.def.onMessage({ type: '_connection', state: 'lost' });
        retryReconnect(s);
    }

    function retryReconnect(s) {
        if (session !== s || s.state !== 'reconnecting') return;
        if (s.conn) { s.conn.close(); s.conn = null; }
        if (Date.now() - s.reconnectSince > RECONNECT_WINDOW_MS) { giveUp(s, 'Sunucuyla bağlantı koptu.'); return; }
        var delay = RECONNECT_DELAYS[Math.min(s.attempt, RECONNECT_DELAYS.length - 1)];
        s.attempt++;
        s.timer = setTimeout(function () {
            if (session !== s || s.state !== 'reconnecting') return;
            s.conn = Connection.open(config.SERVER_URL, {
                onOpen: function () { s.conn.send({ type: 'join_room', room: s.room, id: s.me.id, name: s.me.name }); },
                onMessage: function (data) { onMessage(s, data); },
                onClose: function () { if (session === s && s.state === 'reconnecting') retryReconnect(s); }
            });
            if (!s.conn) retryReconnect(s);
        }, delay);
    }

    // request: { name, gameId } (oda kur) veya { name, room } (odaya katıl)
    function begin(request) {
        closeSession();
        Lobby.showError('');
        var s = {
            state: 'connecting',
            me: { id: myId, name: request.name },
            players: [],
            request: request,
            requestedDef: request.room ? null : Games.get(request.gameId),
            conn: null,
            def: null
        };
        session = s;

        var first = request.room
            ? { type: 'join_room', room: request.room, id: s.me.id, name: s.me.name }
            : {
                type: 'create_room', id: s.me.id, name: s.me.name,
                game: s.requestedDef.id, maxPlayers: s.requestedDef.maxPlayers
            };

        function failed() {
            if (session !== s) return;
            if (s.state === 'playing' && s.def.reconnect) { startReconnect(s); return; }
            if (s.state === 'reconnecting') { retryReconnect(s); return; }
            var wasPlaying = s.state === 'playing';
            closeSession();
            Lobby.show();
            Lobby.showError(wasPlaying ? 'Sunucuyla bağlantı koptu.' : 'Sunucuya bağlanılamadı.');
        }

        s.conn = Connection.open(config.SERVER_URL, {
            onOpen: function () { s.conn.send(first); },
            onMessage: function (data) { onMessage(s, data); },
            onClose: failed
        });
        if (!s.conn) failed();
    }

    Lobby.init({
        onCreate: function (name, gameId) { begin({ name: name, gameId: gameId }); },
        onJoin: function (name, room) { begin({ name: name, room: room }); }
    });

    // Sayfa yenilendiyse ve yeniden bağlanmayı destekleyen bir odadaydık: aynı kimlikle odaya dön.
    if (!session) {
        var saved = null;
        try { saved = JSON.parse(store(SESSION_KEY) || 'null'); } catch (e) { saved = null; }
        if (saved && /^[A-Z0-9]{6}$/.test(saved.room) && typeof saved.name === 'string' && saved.name) {
            begin({ name: saved.name, room: saved.room, resume: true });
        }
    }
})();
