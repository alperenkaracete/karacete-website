// WebSocket sarmalayıcı: JSON gönderir/alır, oyun bilgisi içermez.
window.Connection = {
    open: function (url, handlers) {
        var ws;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            return null;
        }
        ws.onopen = function () { if (handlers.onOpen) handlers.onOpen(); };
        ws.onmessage = function (event) {
            var data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            handlers.onMessage(data);
        };
        ws.onclose = function () { if (handlers.onClose) handlers.onClose(); };
        return {
            send: function (msg) {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
            },
            close: function () {
                ws.onclose = null;
                ws.close();
            }
        };
    }
};
