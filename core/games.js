// Oyun kayıt defteri. Her oyun games/<oyun>.js içinde Games.register(...) çağırır.
//
// Oyun arayüzü:
//   id, name, maxPlayers, icon (emoji), tagline (lobi kartındaki kısa açıklama)
//   init(ctx)        oyun başlar. ctx = { root, send(msg), me:{id,name}, room, players, isHost(), leave() }
//                    ctx.leave() odadan çıkıp lobiye döner.
//   onMessage(data)  odaya girdikten sonra sunucudan gelen her mesaj (player_joined / player_disconnect dahil)
//   destroy()        zamanlayıcıları, dinleyicileri ve DOM'u temizle
window.Games = (function () {
    var registry = {};
    return {
        register: function (def) { registry[def.id] = def; },
        get: function (id) { return registry[id]; },
        list: function () { return Object.keys(registry).map(function (k) { return registry[k]; }); }
    };
})();
