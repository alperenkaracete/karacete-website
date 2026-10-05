# Karacete Oyunlar (frontend)

[karacete.com](https://karacete.com) için düz HTML/CSS/JS ile yazılmış, çok oyunculu mini oyunlar sitesi
(GitHub Pages). Framework ve derleme adımı yok. Oyuncular bir **oda** kurar ya da bir oda koduyla katılır;
oyun mantığı tarayıcıdadır, sunucu ([bomberman-backend](https://github.com/alperenkaracete/bomberman-backend))
yalnızca odaları yönetir ve mesajları aynı odadaki oyunculara iletir.

Şu an tek oyun: **Bomberman** (2–4 oyuncu).

## Yerelde çalıştırma

```bash
python3 -m http.server 5173     # veya herhangi bir statik sunucu
# http://localhost:5173 adresini aç
```

`localhost` / `127.0.0.1` üzerinden açıldığında istemci otomatik olarak yerel sunucuya
(`ws://localhost:8080/oyun-odasi`) bağlanır. Yerel sunucu için backend reposundaki README'ye bak
(`mvn spring-boot:run`). İkinci oyuncuyu denemek için aynı odaya başka bir sekmeden
`?oda=KOD` bağlantısıyla gir.

## Yapı

```
index.html           lobi + oda çubuğu + oyunun kurulacağı #game-root
style.css            tüm stiller
config.js            sunucu adresi (tek yapılandırma noktası)
core/games.js        oyun kayıt defteri (Games.register / Games.get / Games.list)
core/connection.js   WebSocket sarmalayıcı (JSON gönder/al)
core/lobby.js        takma ad, oyun seçimi, oda kur/katıl, paylaşım bağlantısı
core/main.js         akış: lobi → bağlantı → oda → oyun; oyuncu listesi ve host takibi
games/bomberman.js   Bomberman
assets/              sprite'lar
```

Sunucu adresini değiştirmek için yalnızca `config.js` düzenlenir.

## Oda akışı

1. Lobide takma ad girilir; **Oda Kur** ya da **Oda Koduna Katıl**.
2. Oda kurulunca oda çubuğunda kod görünür; **Kodu Kopyala** ve **Bağlantıyı Paylaş** ile
   `https://karacete.com/?oda=ABC123` gibi bir bağlantı paylaşılır. Bu bağlantı açılınca (takma ad
   kayıtlıysa) otomatik katılır, değilse takma ad istenir.
3. Odaya girildikten sonra oyunun gönderdiği her mesaj sunucu tarafından değiştirilmeden aynı odadaki
   diğer oyunculara iletilir.

İstemci–sunucu mesaj protokolü backend reposunun README'sinde anlatılır
(`create_room`, `join_room`, `room_created`, `room_joined`, `player_joined`, `player_disconnect`, `error`).

## Yeni oyun ekleme

1. `games/<oyun>.js` oluştur ve kendini kaydet:

   ```js
   (function () {
       Games.register({
           id: 'yilan',            // sunucuya `game` olarak gider
           name: 'Yılan',          // lobideki oyun listesinde görünür
           maxPlayers: 2,
           init(ctx) {
               // ctx.root       oyunun DOM'unu kuracağı eleman
               // ctx.send(msg)  odadaki diğerlerine JSON mesaj gönder
               // ctx.me         { id, name }
               // ctx.room       oda kodu
               // ctx.players    odadaki oyuncular [{ id, name }] (katılış sırasıyla, canlı güncellenir)
               // ctx.isHost()   ilk sıradaki oyuncu mu (ortak başlangıç durumunu o üretir)
           },
           onMessage(data) {
               // Odaya girdikten sonra gelen her mesaj (player_joined / player_disconnect dahil)
           },
           destroy() {
               // Zamanlayıcıları, dinleyicileri, requestAnimationFrame'i temizle; ctx.root'u boşalt
           }
       });
   })();
   ```

2. `index.html` içine, `core/main.js`'den **önce** script etiketini ekle:
   `<script src="games/yilan.js"></script>`
3. Birden fazla oyun olunca lobide oyun seçimi kendiliğinden görünür. Sunucu tarafında değişiklik gerekmez.

`games/bomberman.js` örnek olarak kullanılabilir.

## Bilinen sınırlamalar

- Oyuncular köşelere rastgele yerleşir; aynı köşeye denk gelebilirler.
- Oyun sürerken odaya giren oyuncu haritayı alır ama o ana kadarki bomba durumunu görmez.
- Sunucu yalnızca `https://karacete.com` ve yerel adreslerden gelen bağlantılara izin verir. Farklı bir
  adresten (örn. `www.karacete.com`) yayın yapılacaksa backend'in `ALLOWED_ORIGINS` ortam değişkenine eklenmelidir.
