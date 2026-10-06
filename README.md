# Karacete Oyunlar (frontend)

[karacete.com](https://karacete.com) için düz HTML/CSS/JS ile yazılmış, çok oyunculu mini oyunlar sitesi
(GitHub Pages). Framework ve derleme adımı yok. Oyuncular bir **oda** kurar ya da bir oda koduyla katılır;
oyun mantığı tarayıcıdadır, sunucu ([bomberman-backend](https://github.com/alperenkaracete/bomberman-backend))
yalnızca odaları yönetir ve mesajları aynı odadaki oyunculara iletir.

Oyunlar:

| Oyun | Oyuncu | Tür |
|------|--------|-----|
| 💣 **Bomberman** | 2–4 | gerçek zamanlı |
| ⭕ **XOX** | 2 | sıra tabanlı |
| 🔴 **Dörtlü Bağla** | 2 | sıra tabanlı |
| 🐱 **Kedi - Köpek** | 2 | sıra tabanlı atış düellosu |

Oyun lobide kartlardan seçilir; oda kurulurken seçilen oyun sunucuya `game` alanı olarak gider
(`bomberman`, `xox`, `connect4`, `catdog`).

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
core/duel.js         sıra tabanlı iki kişilik oyunlar için ortak protokol/durum makinesi (DOM'suz)
core/duel-ui.js      aynı oyunlar için ortak arayüz kabuğu (skor, sıra, bekleme, rövanş)
games/bomberman.js   Bomberman
games/xox.js         XOX tahtası (çizim)          games/xox-rules.js       XOX kuralları (saf)
games/connect4.js    Dörtlü Bağla tahtası (çizim) games/connect4-rules.js  Dörtlü Bağla kuralları (saf)
games/catdog.js      Kedi - Köpek sahnesi (çizim) games/catdog-rules.js    Kedi - Köpek kuralları ve atış hesabı (saf)
tests/               node:test ile birim testleri
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

## Kedi - Köpek (atış düellosu)

İki oyuncu sırayla, rüzgârı hesaba katarak açı ve güç seçip atış yapar (Gorillas / Worms tarzı).
**Oda kurucusu 🐱 Kedi (🐟 atar, solda), katılan 🐶 Köpek (🦴 atar, sağda)**; ikisi de 100 canla başlar.

- **Sahne:** iki yanda düz platform, ortada rastgele tepeler; oda kurucusunun gönderdiği tohumdan (seed) her iki
  tarafta da aynı üretilir. **Rüzgâr** her tur değişir (−10…+10, ekranda ok + sayı), tohum ve tur numarasından üretilir.
- **Atış:** açı 0–180° (0 = sağ, 90 = yukarı), güç 0–100. Mermi araziye çarparsa ya da sahne dışına çıkarsa pas geçer.
  Rakibe doğrudan isabet **30** hasar; yakına düşerse mesafeyle doğrusal azalan alan hasarı (yarıçap 40 px).
  Kendine hasar yoktur. Can 0 olunca oyun biter, rövanşta başlayan taraf değişir ve yeni sahne gelir.
- **Nişan:** kaydırıcılarla ya da sahnede sürükleyerek (sürüklediğin yön = açı, uzaklık = güç).
- **Özel güçler** (kullanımdan sonra o oyuncunun sonraki **3 turunda** kapalı, buton gri ve kalan tur yazar):
  - 🧪 **Can iksiri:** +25 can (en fazla 100). Atış yapılmaz, sıra otomatik rakibe geçer.
  - 🎯 **Rüzgârsız atış:** o atışta rüzgâr 0.
  - ✌️ **Çift atış:** aynı açı ve güçle iki kez art arda atılır (ilk atış öldürürse ikincisi yapılmaz).
  - 💥 **Büyük patlama:** hasar alanı yarıçapı 2 katı.
  Atışla kullanılan güçlerden turda en fazla biri seçilir; seçim iptal edilebilir.

**Senkronizasyon:** ağda yalnızca `cd_start` (host: tohum + kedi + ilk sıra), `cd_shot { turn, angle, power, powerUp }`
ve `cd_heal { turn }` gider. Atış sonucu iki tarafta da `simulateShot` ile (sabit 1/60 sn adım, tam sayı açı/güç,
yuvarlanmış trigonometri) aynı bulunur. Gelen her hamle doğrulanır: sıra, tur numarası, açı/güç sınırları, güç
bekleme süresi; geçersizler yok sayılır.

## Testler

Kazanma/beraberlik kuralları ve ortak sıra tabanlı protokol saf fonksiyonlardır; Node'un yerleşik
test çalıştırıcısıyla çalışır (paket kurulumu gerekmez, Node 20+):

```bash
node --test
```

## İki sekmeyle deneme

1. Yerel backend'i çalıştır (`mvn spring-boot:run`) ve siteyi statik sunucuyla aç (yukarıdaki komut).
2. Sekme 1: takma ad gir, **XOX** ya da **Dörtlü Bağla** kartını seç, **Oda Kur**. Bekleme ekranında oda kodu görünür.
3. Sekme 2 (ya da gizli pencere): `http://localhost:5173/?oda=KOD` adresini aç, takma ad gir, **Oda Koduna Katıl**.
4. Sırası gelen oyuncu "Sıra sende!" görür; oyun bitince **Rövanş** için iki taraf da oy verir, başlayan taraf değişir.
5. Bir sekmeyi kapat: diğer tarafta "Rakip ayrıldı" ve **Lobiye Dön** çıkar.

## Yeni oyun ekleme

1. `games/<oyun>.js` oluştur ve kendini kaydet:

   ```js
   (function () {
       Games.register({
           id: 'yilan',            // sunucuya `game` olarak gider
           name: 'Yılan',          // lobideki oyun kartında görünür
           icon: '🐍',             // kartın ikonu (emoji)
           tagline: '2 oyuncu',    // kartın alt yazısı
           maxPlayers: 2,
           init(ctx) {
               // ctx.root       oyunun DOM'unu kuracağı eleman
               // ctx.send(msg)  odadaki diğerlerine JSON mesaj gönder
               // ctx.me         { id, name }
               // ctx.room       oda kodu
               // ctx.players    odadaki oyuncular [{ id, name }] (katılış sırasıyla, canlı güncellenir)
               // ctx.isHost()   ilk sıradaki oyuncu mu (ortak başlangıç durumunu o üretir)
               // ctx.leave()    odadan çıkıp lobiye döner
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
3. Oyun lobide otomatik olarak yeni bir kart olur. Sunucu tarafında değişiklik gerekmez.

`games/bomberman.js` gerçek zamanlı bir oyun için örnektir.

### Sıra tabanlı iki kişilik oyun eklemek

Sıra, başlangıç oyuncusu, hamle doğrulama, rövanş, skor ve "rakip ayrıldı" mantığı ortaktır; yeni oyun
yalnızca kurallarını ve tahtasını yazar:

1. `games/<oyun>-rules.js`: saf kurallar. `initial()`, `parse(mesaj)`, `toMessage(hamle)`,
   `validate(tahta, hamle, oyuncuIndeksi)`, `apply(tahta, hamle, oyuncuIndeksi)` → `{ board, cell }`,
   `result(tahta)` → `null | { status:'win', winner, line } | { status:'draw' }`. XOX/Dörtlü Bağla'daki
   gibi hem tarayıcıda hem Node'da yüklenecek şekilde yaz ve `tests/` altında test et.
2. `games/<oyun>.js`: `DuelUI.mount(ctx.root, ...)` ile ortak kabuğu kur, tahtayı `ui.boardEl` içine çiz,
   `Duel.create({ prefix, rules, ctx, onChange })` ile protokolü bağla; tıklamada `duel.move(hamle)`,
   `onMessage` içinde `duel.onMessage(data)` çağır. `games/xox.js` en kısa örnektir.
3. Script etiketlerini `index.html`'e ekle (kurallar, sonra oyun).

Başlangıçta oyuna özel veri (tohum, karakter dağılımı gibi) gerekiyorsa kurallara isteğe bağlı kancalar eklenebilir:
`createStart(info)` (host'un start mesajına alan ekler), `parseStart(data, info)` (gelen start'ı doğrular, `null` = reddet),
`initial(start)` (başlangıç tahtası start verisini alır) ve `messageTypes` (hamle mesajı türleri, varsayılan
`<prefix>_move`). Bu kancaları `games/catdog-rules.js` kullanır.

Mesajlar `<prefix>_start`, `<prefix>_move`, `<prefix>_rematch` biçimindedir. Gelen hamleler her iki
tarafta da doğrulanır (tur numarası, sıra, kurallara uygunluk); geçersizler yok sayılır.

## Bilinen sınırlamalar

- Bomberman: oyuncular köşelere rastgele yerleşir; aynı köşeye denk gelebilirler.
- Bomberman: oyun sürerken odaya giren oyuncu haritayı alır ama o ana kadarki bomba durumunu görmez.
- XOX / Dörtlü Bağla / Kedi - Köpek: skor yalnızca açık oturum boyunca tutulur (sayfa yenilenirse sıfırlanır).
- Kedi - Köpek: atış hesabı tam sayı açı/güç ve yuvarlanmış trigonometri kullanır; çok farklı tarayıcı motorlarında
  1 ulp'lik farklar teoride sınırda atışlarda ayrışma yaratabilir, pratikte beklenmez.
- Alçak ekranlarda (laptop) Kedi - Köpek kontrolleri sahnenin altındadır; sayfayı kaydırmak gerekebilir.
- Sunucu yalnızca `https://karacete.com` ve yerel adreslerden gelen bağlantılara izin verir. Farklı bir
  adresten (örn. `www.karacete.com`) yayın yapılacaksa backend'in `ALLOWED_ORIGINS` ortam değişkenine eklenmelidir.

## Yayın

Site GitHub Pages ile `main` dalından yayınlanır (özel alan adı: `CNAME`). Backend Railway'de çalışır;
izinli origin listesi Railway'deki `ALLOWED_ORIGINS` değişkenindedir ve en az
`https://karacete.com` ile `https://www.karacete.com` adreslerini içermelidir.
