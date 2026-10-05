// Lobi arayüzü (şimdilik: takma ad + "Oda Kur").
window.Lobby = (function () {
    var screen = document.getElementById('welcome-screen');
    var nickInput = document.getElementById('nickname-input');
    var createBtn = document.getElementById('start-game-btn');

    function init(handlers) {
        function create(e) {
            if (e) e.preventDefault();
            var name = nickInput.value.trim();
            if (!name) {
                alert('Lütfen oyuna başlamadan önce bir takma ad girin!');
                return;
            }
            handlers.onCreate(name);
        }
        createBtn.addEventListener('click', create);
        nickInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') create();
        });
    }

    return {
        init: init,
        show: function () { screen.style.display = ''; },
        hide: function () { screen.style.display = 'none'; },
        showError: function (message) { alert(message); },
        showRoom: function () {},
        hideRoom: function () {}
    };
})();
