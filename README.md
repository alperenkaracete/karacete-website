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
| ⚽ **Kafa Topu** | 2 | gerçek zamanlı, yandan görünüşlü futbol (kendi yüzünle) |

Oyun lobide kartlardan seçilir; oda kurulurken seçilen oyun sunucuya `game` alanı olarak gider
(`bomberman`, `xox`, `connect4`, `catdog`, `kafatopu`).

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
games/kafatopu.js    Kafa Topu arayüzü (canvas, yüz seçimi, girdi)
games/kafatopu-rules.js  fizik adımı, anlık görüntü, interpolasyon, doğrulayıcılar (saf)
games/kafatopu-predict.js  katılanda tahmin + uzlaştırma (saf)
games/kafatopu-net.js    kurucu-otorite ağ/maç denetleyicisi (DOM'suz)
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

## Kafa Topu (gerçek zamanlı futbol)

İki oyuncu yandan görünüşlü sahada kafa-top oynar; kafa olarak **kendi yüzünü** (fotoğraf/kamera) ya da bir emoji kullanır.
Maç **90 sn ya da ilk 5 gol** (hangisi önce olursa); süre dolunca skor eşitse **altın gol**. Oda kurucusu ile katılan hazır olunca
3-2-1 geri sayımla başlar; maç sonunda **Rövanş** (taraflar yer değiştirir) ve oturum skoru vardır. Rakip ayrılırsa oyun durur,
"Rakip ayrıldı" ve **Lobiye Dön** çıkar. Tek ekrana sığar (kaydırma yok); dikey telefonda "Telefonu yatay çevir" uyarısı çıkar.

**Kontroller:** ← / → veya A / D hareket, ↑ veya W zıpla, Boşluk veya Z vur. Dokunmatik ekranda sol/sağ/zıpla/vur butonları
(çoklu dokunma çalışır). Vuruş: ayak öne doğru kısa bir yay çizer, topa değerse top güçlü hızlanır; kafayla da top sektirilir.

**Yüz (gizlilik):** başta "Fotoğraf yükle", "Kamera ile çek" ya da emoji seçilir. Fotoğraf tarayıcıda ortadan kare kırpılıp
64×64'e (gerekirse 48/40 px, düşük kalite) küçültülür, yuvarlak maskelenir ve JPEG data URL'ye çevrilir (~2–3 KB; üst sınır 8 KB,
sunucu mesaj sınırı 64 KB). Repoya ya da sunucuya **kaydedilmez**; yalnızca `kt_profile` mesajıyla rakibe gider ve sayfa
yenilenince gider. Gelen yüz doğrulanır (tek emoji ya da `data:image/jpeg;base64,/9j/…` ve ≤ 8192 karakter), yalnızca `Image` +
canvas ile çizilir, HTML'e yazılmaz. Kamera izni verilmezse ya da kamera yoksa emoji seçimine dönülür.

**Ağ mimarisi (kurucu = otorite):**
- Fizik yalnızca **oda kurucusunun** tarayıcısında çalışır: `requestAnimationFrame` üstünde biriktirmeli sabit zaman adımı
  (1/60 sn; kare başına en çok 5 adım, gerisi atılır). `step(state, inputs, dt)` saf bir fonksiyondur (`games/kafatopu-rules.js`).
- Kurucu her fizik adımında (**60 Hz**) küçük bir `kt_state` yollar (≈190 bayt ≈ 11 KB/sn): `{t, f, d, m, g, s, p:[[x,y,k,vx,vy],…], b:[x,y,vx,vy], a, c}`
  (kısa alan adları, yuvarlanmış sayılar; hızlar kısa ekstrapolasyon içindir).
- Katılan oyuncu `kt_input {r, n, left,right,jump,kick}` yollar: `r` maç turu, `n` her tuş değişiminde artan **sıra numarası**.
  Girdi yalnızca değişince gider, ayrıca mevcut durum **~100 ms'de bir tekrarlanır** (tuş basılıyken ya da henüz onaylanmamışken;
  boştayken 1 sn'de bir) — kaybolan/geç gelen paket bir sonrakiyle telafi olur. Kurucu eski/yinelenen `n` ve eski turu yok sayar,
  uyguladığı son `n`'yi (`a`) ve o girdinin kaç adımdır uygulandığını (`c`) anlık görüntüye koyar.
- **Tahmin (client-side prediction):** katılan, kendi karakterini kurucuyla **aynı saf fonksiyonla** (`stepOwn`) yerelde hemen
  ilerletir. Her anlık görüntüde kurucunun onayladığı durumdan başlayıp onaylanmamış girdileri yeniden oynatır
  (`games/kafatopu-predict.js`); küçük sapma her adımda %20 azalarak yumuşatılır, 40 px'ten büyük sapma ışınlanır.
- Rakip ve top kurucudan gelir; görüntüler kurucunun zaman damgasıyla tamponlanır ve **~40 ms (≈2 aralık)** gecikmeyle iki
  görüntü arasında interpolasyonla çizilir, tampon biterse hızla **≤100 ms ekstrapole** edilir (kurucu saati farkı yavaşça ayarlanır).
- **Top çarpışmaları:** her adım topun hızına göre 2–8 alt adıma bölünür (hiçbir alt adımda top yarıçapın yarısından fazla gitmez),
  top hız sınırı 1200 px/sn, çarpışma sonrası top oyuncu/direk/duvardan dışarı itilir; gol yalnızca top çizgiyi tamamen
  geçince ve çözüm sonrası sayılır.
- **Ölçüm:** köşede `Ping: N ms` görünür (`kt_ping`/`kt_pong`, saniyede bir). `?debug=1` ek olarak gelen anlık görüntü hızını (Hz),
  interpolasyon gecikmesini, ekstrapole süreyi, tahmin hatasını (px), yeniden oynatılan adımı ve ışınlanma sayısını gösterir;
  `?debug=1&notahmin=1` tahmini kapatır (A/B karşılaştırması). `window.__ktDebug` aynı değerleri açar.
- Olaylar anlık görüntüden ayrı, güvenilir mesajlardır: `kt_start {round, swap}`, `kt_ping/kt_pong`, `kt_goal {scorer, score, golden}`,
  `kt_end {winner, score, reason}`; ayrıca `kt_ready`, `kt_rematch`, `kt_profile`. Gelen her mesaj (tip, sayı aralıkları, dizi
  uzunlukları) doğrulanır, geçersizler yok sayılır; kurucu yalnızca `kt_input/kt_ready/kt_rematch`, katılan yalnızca
  `kt_state/kt_start/kt_goal/kt_end` kabul eder. Kurucu ayrılırsa kalan oyuncu otorite olmaz, oyun biter.
- Yalnızca testler için: `window.KAFATOPU_OPTIONS = { countdown, matchTime, goalLimit, ball }` kısa maç / başlangıç topu verir.

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
- XOX / Dörtlü Bağla / Kedi - Köpek / Kafa Topu: skor yalnızca açık oturum boyunca tutulur (sayfa yenilenirse sıfırlanır).
- Kafa Topu: katılanın **kendi** karakteri tahminle anında tepki verir, ama kurucunun ekranında katılanın karakteri girdi
  ulaşana kadar (≈ tek yön gecikme) geç görünür; rakip/top her zaman ağ gecikmesi + ~40 ms geriden gelir. Ağ gecikmesini
  kapatmak mümkün değildir: yalnızca gizlenir. Katılanın tahmini, topa/rakibe çarpmayı kurucuyla aynı bilmez (rakip duruyor
  varsayılır); bu durumda kısa bir düzeltme (≤ 40 px yumuşak, fazlası ışınlanma) görülebilir. Kurucunun sekmesi arka plana
  alınırsa (`requestAnimationFrame` durur) oyun donar ve katılanda "Rakipten veri gelmiyor" uyarısı çıkar; kurucu çok yavaş
  bir cihazdaysa oyun yavaşlar (adım sınırı). Eski önbellekli JS ile açılan sekme yeni protokolü anlamaz (sert yenile).
- Kafa Topu: fotoğraf rakibe WebSocket üzerinden gider (sunucu saklamaz ama aktarır); kamera yalnızca HTTPS ya da localhost'ta çalışır.
- Kafa Topu: dokunmatik düğmeler küçük telefonlarda sahnenin alt köşelerini kısmen örter.
- Kedi - Köpek: atış hesabı tam sayı açı/güç ve yuvarlanmış trigonometri kullanır; çok farklı tarayıcı motorlarında
  1 ulp'lik farklar teoride sınırda atışlarda ayrışma yaratabilir, pratikte beklenmez.
- Alçak ekranlarda (laptop) Kedi - Köpek kontrolleri sahnenin altındadır; sayfayı kaydırmak gerekebilir.
- Sunucu yalnızca `https://karacete.com` ve yerel adreslerden gelen bağlantılara izin verir. Farklı bir
  adresten (örn. `www.karacete.com`) yayın yapılacaksa backend'in `ALLOWED_ORIGINS` ortam değişkenine eklenmelidir.

## Yayın

Site GitHub Pages ile `main` dalından yayınlanır (özel alan adı: `CNAME`). Backend Railway'de çalışır;
izinli origin listesi Railway'deki `ALLOWED_ORIGINS` değişkenindedir ve en az
`https://karacete.com` ile `https://www.karacete.com` adreslerini içermelidir.
