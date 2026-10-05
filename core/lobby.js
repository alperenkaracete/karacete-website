// Lobi arayüzü: takma ad, oyun seçimi, oda kur / odaya katıl, oda çubuğu ve paylaşım bağlantısı.
window.Lobby = (function () {
    var NICK_KEY = 'karacete.nick';
    var ROOM_CODE = /^[A-Z0-9]{6}$/;

    var screen = document.getElementById('welcome-screen');
    var nickInput = document.getElementById('nickname-input');
    var gameCards = document.getElementById('game-cards');
    var createBtn = document.getElementById('create-room-btn');
    var codeInput = document.getElementById('room-code-input');
    var joinBtn = document.getElementById('join-room-btn');
    var errorBox = document.getElementById('lobby-error');
    var roomBar = document.getElementById('room-bar');
    var roomCodeEl = document.getElementById('room-code');
    var copyCodeBtn = document.getElementById('copy-code-btn');
    var shareBtn = document.getElementById('share-link-btn');
    var leaveBtn = document.getElementById('leave-room-btn');

    var selectedGame = null;
    var currentRoom = null;
    var onLeave = null;

    function readNick() {
        try { return localStorage.getItem(NICK_KEY) || ''; } catch (e) { return ''; }
    }

    function saveNick(nick) {
        try { localStorage.setItem(NICK_KEY, nick); } catch (e) { /* yoksay */ }
    }

    function showError(message) {
        errorBox.textContent = message;
        errorBox.style.display = message ? 'block' : 'none';
    }

    function roomLink(code) {
        return location.origin + location.pathname + '?oda=' + code;
    }

    function copyText(text, button, doneLabel) {
        var original = button.textContent;
        function done() {
            button.textContent = doneLabel;
            setTimeout(function () { button.textContent = original; }, 1500);
        }
        function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { /* yoksay */ }
            document.body.removeChild(ta);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, fallback);
        } else {
            fallback();
        }
    }

    function populateGames() {
        var games = Games.list();
        gameCards.textContent = '';
        games.forEach(function (g) {
            var card = document.createElement('button');
            card.type = 'button';
            card.className = 'game-card';
            card.dataset.game = g.id;
            card.setAttribute('role', 'radio');

            var icon = document.createElement('span');
            icon.className = 'game-card-icon';
            icon.textContent = g.icon || '🎮';
            var text = document.createElement('span');
            text.className = 'game-card-text';
            var name = document.createElement('strong');
            name.textContent = g.name;
            var info = document.createElement('small');
            info.textContent = g.tagline || '';
            text.append(name, info);
            card.append(icon, text);

            card.addEventListener('click', function () { selectGame(g.id); });
            gameCards.appendChild(card);
        });
        if (games.length) selectGame(games[0].id);
    }

    function selectGame(id) {
        selectedGame = id;
        Array.prototype.forEach.call(gameCards.children, function (card) {
            var on = card.dataset.game === id;
            card.classList.toggle('selected', on);
            card.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    }

    function init(handlers) {
        populateGames();
        nickInput.value = readNick();

        function nickname() {
            var name = nickInput.value.trim();
            if (!name) {
                showError('Lütfen önce bir takma ad gir.');
                nickInput.focus();
                return null;
            }
            saveNick(name);
            showError('');
            return name;
        }

        function create() {
            var name = nickname();
            if (name) handlers.onCreate(name, selectedGame);
        }

        function join() {
            var name = nickname();
            if (!name) return;
            var code = codeInput.value.trim().toUpperCase();
            if (!ROOM_CODE.test(code)) {
                showError('Oda kodu 6 karakter olmalı (harf ve rakam).');
                codeInput.focus();
                return;
            }
            handlers.onJoin(name, code);
        }

        createBtn.addEventListener('click', create);
        joinBtn.addEventListener('click', join);
        nickInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') (codeInput.value.trim() ? join : create)();
        });
        codeInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') join();
        });

        copyCodeBtn.addEventListener('click', function () {
            if (currentRoom) copyText(currentRoom, copyCodeBtn, 'Kopyalandı ✓');
        });
        shareBtn.addEventListener('click', function () {
            if (!currentRoom) return;
            var link = roomLink(currentRoom);
            if (navigator.share) {
                navigator.share({ title: 'Karacete Oyunlar', text: 'Odaya katıl: ' + currentRoom, url: link })
                    .catch(function () { /* kullanıcı vazgeçti */ });
            } else {
                copyText(link, shareBtn, 'Bağlantı kopyalandı ✓');
            }
        });
        leaveBtn.addEventListener('click', function () {
            if (onLeave) onLeave();
        });

        // ?oda=ABC123 ile açıldıysa kodu doldur; takma ad biliniyorsa otomatik katıl.
        var param = new URLSearchParams(location.search).get('oda');
        var code = param ? param.trim().toUpperCase() : '';
        if (ROOM_CODE.test(code)) {
            codeInput.value = code;
            if (nickInput.value.trim()) {
                handlers.onJoin(nickInput.value.trim(), code);
            } else {
                showError('Odaya katılmak için bir takma ad gir.');
                nickInput.focus();
            }
        }
    }

    return {
        init: init,
        show: function () { screen.style.display = ''; },
        hide: function () { screen.style.display = 'none'; },
        showError: showError,
        showRoom: function (code, leaveHandler) {
            currentRoom = code;
            onLeave = leaveHandler;
            roomCodeEl.textContent = code;
            roomBar.style.display = 'flex';
        },
        hideRoom: function () {
            currentRoom = null;
            onLeave = null;
            roomBar.style.display = 'none';
        }
    };
})();
