// Akış: lobi -> bağlantı -> oda -> oyun. Oyun mantığı bilmez, yalnızca mesajı oyuna iletir.
(function () {
    var config = window.KARACETE_CONFIG;
    var root = document.getElementById('game-root');
    var myId = 'oyuncu_' + Math.random().toString(36).slice(2, 8);
    var session = null;

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
        if (s.conn) s.conn.close();
        if (s.state === 'playing') s.def.destroy();
        root.innerHTML = '';
        Lobby.hideRoom();
    }

    function startGame(s, def, room, players) {
        s.state = 'playing';
        s.def = def;
        s.room = room;
        s.players = players;
        Lobby.hide();
        Lobby.showRoom(room, function () {
            closeSession();
            Lobby.show();
        });
        def.init({
            root: root,
            send: function (msg) { s.conn.send(msg); },
            me: s.me,
            room: room,
            players: s.players,
            isHost: function () { return s.players.length > 0 && s.players[0].id === s.me.id; }
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
                closeSession();
                Lobby.show();
                Lobby.showError(ERRORS[data.code] || 'Bir hata oluştu.');
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

    // request: { name, gameId } (oda kur) veya { name, room } (odaya katıl)
    function begin(request) {
        closeSession();
        Lobby.showError('');
        var s = {
            state: 'connecting',
            me: { id: myId, name: request.name },
            players: [],
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
})();
