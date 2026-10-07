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
| 🎲 **Parti** | 2–8 | tahta/parti oyunu (zar, silahlar, yıldız toplama; botlar, takım modu) |

Oyun lobide kartlardan seçilir; oda kurulurken seçilen oyun sunucuya `game` alanı olarak gider
(`bomberman`, `xox`, `connect4`, `catdog`, `kafatopu`, `parti`).

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
core/fullscreen.js   genel tam ekran yardımcısı (Android Fullscreen API + yatay kilit, iPhone sahte tam ekran; DOM'suz çekirdek)
manifest.webmanifest ana ekrana ekle (servis çalışanı yok)   assets/icons/  yer tutucu simgeler (192, 512, apple-touch)
games/bomberman.js   Bomberman
games/bomberman-joystick.js  mobil joystick yön/adım kararı (saf, DOM'suz; Node'da test edilir)
games/bomberman-smooth.js    görsel konum yumuşatması + harita imzası (saf, DOM'suz; Node'da test edilir)
games/xox.js         XOX tahtası (çizim)          games/xox-rules.js       XOX kuralları (saf)
games/connect4.js    Dörtlü Bağla tahtası (çizim) games/connect4-rules.js  Dörtlü Bağla kuralları (saf)
games/catdog.js      Kedi - Köpek sahnesi (çizim) games/catdog-rules.js    Kedi - Köpek kuralları ve atış hesabı (saf)
games/kafatopu.js    Kafa Topu arayüzü (canvas, yüz seçimi, girdi)
games/kafatopu-rules.js  fizik adımı, anlık görüntü, interpolasyon, doğrulayıcılar (saf)
games/kafatopu-predict.js  katılanda tahmin + uzlaştırma (saf)
games/kafatopu-net.js    kurucu-otorite ağ/maç denetleyicisi (DOM'suz)
games/parti/config.js    Parti ayarları: silahlar, olaylar, ödüller, süreler
games/parti/graph.js     tahta grafı: yürüme, en kısa adım mesafesi, harita doğrulayıcı (saf)
games/parti/maps/*.js    harita verisi (pirate.js, space.js) - düğümler + dekor
games/parti/rules.js     oyun kuralları: tur akışı, silahlar, ölüm, takım, ödüller, bot (saf, deterministik)
games/parti/minigame.js  startMinigame sözleşmesi + yedek "Şans Çarkı"
games/parti/mini/duel-adapter.js  XOX/Dörtlü Bağla'yı iki oyunculu sahte ctx ile Parti düellosu olarak çalıştırır
games/parti/mini/duel-referee.js  düello mesajlarını kurallarla yeniden oynayıp sonucu bulur (saf)
games/parti/mini/duel-watch.js    oynamayanlar için kompakt canlı tahta anlık görüntüsü + salt-okunur çizici (saf çekirdek)
games/parti/machine.js   lider/takipçi ağ durum makinesi: pt_state, lider devri, kopma bekleme (DOM'suz)
games/parti/ui.js        Parti arayüzü (canvas tahta, lobi/ayarlar, paneller)
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
- **Nişan:** kaydırıcılarla ya da sahnede sürükleyerek (sürüklediğin yön = açı, uzaklık = güç). Sırası gelen oyuncu seçili açı/güçle
  atışın yolunun **ilk ~%30'unu noktalı iz** olarak görür (güç gerektirmez, rüzgâr dahil; `CatDogRules.aimPath`, fizikle aynı hesap,
  `TRAIL_FRACTION`). İz yalnızca kendi ekranındadır (nişan ağda gitmez).
- **Özel güçler** (kullanımdan sonra o oyuncunun sonraki turlarında kapalı, buton gri ve kalan tur yazar; bekleme `COOLDOWNS` tablosunda:
  can iksiri 3, rüzgârsız **1**, çift atış 3, büyük patlama 3, nişan rehberi **4** tur):
  - 🧪 **Can iksiri:** +25 can (en fazla 100). Atış yapılmaz, sıra otomatik rakibe geçer.
  - 🎯 **Rüzgârsız atış:** o atışta rüzgâr 0.
  - ✌️ **Çift atış:** aynı açı ve güçle iki kez art arda atılır (ilk atış öldürürse ikincisi yapılmaz).
  - 💥 **Büyük patlama:** hasar alanı yarıçapı 2 katı.
  - 🧭 **Nişan rehberi:** seçilince yolun **tamamı** (çarpma noktası ✕ ile) çizilir; atış fiziği ve hasar normal atışla birebir aynıdır
    (`simulateShot` `null` ile aynı sonucu verir). Atış gücü olarak sayılır; bu atışta başka güçle birlikte kullanılamaz.
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

## Parti (2–8 kişilik tahta oyunu)

**Kurallar.** Tur = herkesin sırayla bir hamlesi: (isteğe bağlı) bir silah → 🎲 zar (1-6) → zar kadar adım yürü (dallanmada yön seç; seçim
sırasında her yönün bitiş kutucuğu kırmızı halkayla, yoldaki sandıklar sarı/beyaz halkayla önizlenir) → durduğun kutucuğun etkisi →
tur kendiliğinden biter. Süreler: silah + zar aşaması **20 sn**, yön seçimi **8 sn**; dolunca otomatik oynanır (zar atılır, yön
rastgele, silah kullanılmaz). Herkes oynayınca tur biter: minioyun → ödüller → yeni sandıklar. Tur başı sırası her turda bir kayar
(ilk oynayan sona geçer), böylece sabit ilk sıra avantajı olmaz; kartlarda "⏳ N sıra sonra" ve "N sıra sonra sen" görünür.
- **Başlangıç:** herkes **tek ortak başlangıç düğümünden** başlar (en az 2 çıkış: ilk hamlede yön seçilir); ölünce de buraya dönülür.
  Başlangıç **güvenli bölgedir**: orada duran hasar almaz, hedef olarak sunulmaz; hiçbir silah/bomba oradakileri etkilemez.
- **Kutucuklar:** başlangıç 🏁, hazine ✨ (sandık çıkar), silah bölgesi ⚔️ (rastgele silah), olay ❓ (rastgele küçük olay; olasılıklar ⓘ
  yardımında): +1 ⭐, tuzak −15 can, başlangıca ışınlanma, hediye silah (🎁), bir tur dinlenme. 🎁 yalnızca silah sandığı/ödül içindir.
- **Sandıklar:** her tur başında boş hazine noktalarına `ceil(oyuncu/2)+1` yıldız sandığı 🧰 (1 ya da 2 ⭐, %70/%30) ve 1 silah sandığı 🎁 çıkar.
  Üzerinden geçen ya da orada duran alır.
- **Envanter:** sınırsız ama sayaçlı: her silah türünden en çok **3**, toplam en çok **6**, kalkan en çok **1**; sığmayan öğe "kaçtı"
  (seçim ekranı yok). Kartlarda `×N` görünür; oyuncu kartına dokununca ayrıntı açılır.
- **Silahlar** (tek atımlık, can 100; menzil = tahtadaki en kısa adım sayısı): 👊 Yumruk menzil 0–1 (aynı ya da komşu kutucuk), tek
  vuruş 100 hasar · 🔫 Pompalı menzil 0–3, 1/2/3 adımda 45/30/15 · 🏹 Yay menzil 0–5 / 20 · 💣 Bomba menzil 4, seçilen kutucuktaki
  herkese (kendine de) 30 · 🛡️ Kalkan bir saldırıyı engeller. **Silah yalnızca zardan önce kullanılır ve turda tek saldırı hakkı vardır**
  (silah turu bitirmez, ardından zar atılır); menzilde hedef ya da kullanılabilir silah yoksa silah satırı hiç görünmez. Yürüyüşte/olayda
  bulunan silah sonraki turun başında kullanılabilir. Kalkan kurmak da o turun saldırı hakkını harcar; **3 kendi tur** sonra düşer,
  kırılırsa **2 kendi tur** yeniden kurulamaz. Takım arkadaşına saldırılamaz; bomba arkadaşa vurmaz ama kendine vurur.
- **Ölüm:** can 0 olunca `min(3, yıldız/2 aşağı)` yıldız saldırana (çoklu hedefte en çok hasar verene) gider; başlangıca dönülür,
  can dolar, envanter korunur; tur atlatılmaz.
- **Kazanma:** hedef lobide "Otomatik" (2-3 oyuncuda 15, 4-8 oyuncuda 10) ya da 5-25 arası seçilir; bireyselde hedef yıldıza ilk ulaşan; takımda (2'şerli) takımın toplam ⭐'ı hedefe ulaşınca takım anında kazanır.
- **Minioyun ödülü:** 1.: 1 ⭐ + rastgele silah, 2.: rastgele silah, 3.: +25 ❤️ (üst sınır 100) (düelloda kazanan 1., kaybeden 2.;
  beraberlikte ikisi de 2.). **Düelloda olmayanlar** (sıralamada yer almayanlar) ödül değil **teselli** alır: +25 ❤️ (üst sınır 100,
  `MINI_CONSOLATION`); sıralamadakiler teselli almaz, 3. derece ödülüyle çakışmaz (düello sıralamasında 3. derece yoktur).
  Envanter doluysa silah ödülü kaybolur.
- **Son Çılgınlık:** biri (takımda takımın toplamı) hedefe 3 ⭐ ya da daha az kalınca (tur başında) tahta kızıla döner, ekranda uyarı çıkar
  ve oyun boyunca sandık sayıları ×2 olur (bir kez tetiklenir; hazine noktaları yettiği kadar).
- **Emoji tepkileri:** 😂 😱 👏 🤡 (`pt_emote {id, e}`): oyun durumuna yazılmaz, yalnızca iletilir; oyuncu başına en çok saniyede 1;
  tahtada oyuncunun jetonunun üstünde ~2 sn baloncuk olarak görünür. Yalnızca koltuktaki insanlar atabilir.
- **Silah düşme ağırlıkları:** yumruk 1, pompalı 3, yay 3, bomba 2, kalkan 2.
- **Lobi:** lider mod (Bireysel / 2'şerli Takım), harita (Korsan Adası / Uzay), hedef ⭐ (5-25), bot ekleme/çıkarma ve oyuncu
  atma işlemlerini yapar; herkes benzersiz bir emoji avatar seçer. Takım modunda sayı çift ve her takımda tam 2 kişi olmalıdır.

**Mimari.** Oda kurucusu **lider**dir: durumu hesaplar ve her kabul edilen eylemden sonra **tam** `pt_state` görüntüsünü
yayınlar (≈2-6 KB; testle 20 KB altı doğrulanır). Diğer oyuncular `pt_action {id, a}` yollar, lider sırayı/geçerliliği
doğrular. Rastgelelik yalnızca liderde ve durumdaki tohumdan (`rs`) üretilir; kurallar (`rules.js`) saf ve deterministiktir.
- **Lider devri:** lider `players[0]`'dan değil durumdan (`ld`) türetilir, çünkü backend yeniden katılanı listenin sonuna ekler.
  Lider düşerse bağlı insan koltuklar arasında koltuk sırasına göre ilk kişi lider olur (herkes aynı kuralı yerelde uygular),
  `ep` (devir sayısı) artar ve saklı son durumdan devam eder. Eski epoch'tan gelen görüntüler yok sayılır; kopup dönen eski lider
  lider olmaz, durumu alır.
- **Kopma/yeniden bağlanma:** çekirdek (`core/main.js`) `reconnect: true` ilan eden oyunlarda kopunca oyun ekranını kapatmaz,
  aynı kimlik ve oda koduyla `join_room`u yeniden dener (1-2-3-5-8 sn…, en çok 3 dk; backend eski oturumu devralır) ve oyuna `_connection`/`_reconnected`
  mesajı verir. Kimlik **sekme başına** `sessionStorage`'da saklanır (yenileme sonrası aynı kimlikle otomatik katılım; farklı
  sekmeler farklı kimlik alır, aynı tarayıcıda çoklu sekmeyle test edilebilir). Diğer oyunların davranışı değişmez.
  Bir oyuncu koptuğunda sırası geldiğinde oyun bekler: "X bağlantısı koptu, kalan süre M:SS"; lider **Bekle / Turu geç / At**
  seçebilir; 3 dk dolunca tur geçilir ve koltuk boşalır. Dönen oyuncu tam durumu alır (`pt_sync`). Minioyun sırasında kopan
  en sona yazılır. Oyun sürerken gelen tanınmayan oyuncu izleyici olur.
- **Botlar** lider tarafından oynanır: zardan önce menzilde rakip varken %50 olasılıkla saldırır, kalkanı varsa ve yakında (≤3 adım) rakip varsa
  kurar; sonra zar atar, yönü rastgele seçer. Düelloya seçilmez. Kopan insanın sırası gelince 30 sn sonra, 2 AFK turdan sonra (3 sn
  bekleyip) bot oynar; insan "🙋 Ben buradayım" ya da herhangi bir eylemle turu geri alır.
- **Oyun revizyonu `rv`:** `pt_action`lar istemcinin gördüğü oyun revizyonunu (`g.rev`, yalnızca kabul edilen kural adımlarında artar)
  taşır; eşleşmezse lider eylemi reddeder (çift dokunuş koruması). Makine seviyesindeki `rv` (her yayında artar) bu iş için kullanılmaz,
  alakasız yayınlar meşru eylemi engellerdi. `rv` yoksa eski davranış.
- **Eski anlık görüntü göçü:** gelen durumda `p.w` dizisi → sayaç nesnesi, `act`/`swap` aşaması → `roll`, haritada olmayan konum
  (eski 8 başlangıç düğümü) → ortak başlangıç, `shield: true` → 3 tur sayacı; sonlu olmayan/geçersiz can-yıldız-konum içeren durum reddedilir.
- **Elle deneme/test:** `?debug=1` ile `window.__partiDebug.machine` (durum makinesi, `_state()`/`_publish()`) ve `tickerMode()` açılır.
- **Lider saati:** `games/parti/ticker.js` tick'i bir Web Worker'dan (Blob URL) 250 ms'lik mesajla tetikler; arka plandaki sekmelerde
  `requestAnimationFrame` durur ve `setInterval` kısılır, worker zamanlayıcıları kısılmaz. Worker kurulamazsa, hata verirse ya da 2 sn
  sessiz kalırsa `setInterval`'a düşülür; sekme görünür olunca ve gelen her mesajda da ayrıca tick atılır.

**Minioyun sözleşmesi** (`games/parti/minigame.js`) - tur sonunda her istemcide çağrılır (düello); gerçek minioyunlar çarkın yerini alır:

```js
startMinigame({
  type: 'ffa' | 'duel', players: [id, ...], seed,          // zorunlu (eski çağrı biçimi aynen çalışır)
  game, me: {id, name}, isLeader, leader, root,            // düello: oyun, bu istemci, lider mi / kimliği, çizim düğümü
  net: { send(m), on(fn(from, m)) -> off }, names,         // ağ: makine pt_mg zarfına sarar, gönderen kimliğini ekler
  deadlineMs, signal                                        // toplam süre (düello 90 sn, Kedi-Köpek 120 sn); AbortSignal
}) -> Promise<{ ranking: [[id, ...], [id, ...], ...] }>
```

- `ranking` en iyiden en kötüye gruplardır; aynı gruptaki kimlikler eşit derecededir (`[[a, b], [c]]` → a=1., b=1., c=3.).
  Düello `[[kazanan], [kaybeden]]`, beraberlikte `[[a, b]]` döner. Eksik alan ya da bilinmeyen oyun → seed'den çark sonucu (asla takılmaz).
- **normalizeRanking** (`machine.js`): `players` dışı kimlikler ve tekrarlar atılır; sıralamada olmayan oyuncular **son gruba** (eşit derece)
  eklenir; boş/geçersiz sonuç = hepsi tek grup (eşit). Sonuç `MINI_HOLD_MS` (5 sn) gösterilir, sonra `REWARDS` dereceye göre uygulanır.
  Kopmuş insanlar en sona yazılır.
- **Ağ:** `{ type:'pt_mg', mg: <ep:tohum:oyun:çiftNo>, from, m }`. `pt_mg` durum **değildir** (`pt_state`'e girmez, `rv` artmaz). Makine yalnızca
  bir oturumun `mg` jetonunu taşıyan ve gönderen o maçın oyuncusu olan (ya da lider olan: `reset`/`catchup`/`result`) mesajları iletir.
  Gönderen kimliği mesajın içindedir (backend eklemez); arkadaş grubu için güvenilir kabul edilir.
- **Düello (XOX, Dörtlü Bağla, Kedi - Köpek):** `mini/duel-adapter.js` oyunun kendi `init/onMessage/destroy`'unu iki oyunculu sahte `ctx` ile çalıştırır
  (`players` = ikili, `isHost()` = ilk oyuncu, `send` = pt_mg, `leave` boş); `core/duel*.js` ve `*-rules.js` değişmez. Rövanş kapalıdır
  (düğmeler gizli, `*_rematch` mesajları gitmez/iletilmez). Gelen oyun mesajı yalnız maçtaki rakipten iletilir; gönderen her mesaja artan `ps` ekler
  (aynı mesaj hem doğrudan hem `catchup` ile gelirse yinelenen atılır). Sonucu **lider** `mini/duel-referee.js` ile hesaplar (oyuncu da olsa,
  izleyici de olsa); kendi maçında oynamayan lider başsız (`observer: true`, kök yok) oturum açar.
- **Çoklu düello (herkes herkesle):** düello turunda `minigameSpec` botlar hariç TÜM insanları tohumlu karıştırıp ardışık çiftlere böler
  (`pairs`); hepsi aynı oyunu (tohumdan; `?mini=duel:<oyun>` ile sabitlenir) AYNI ANDA oynar. Spec: `{type:'duel', game, pairs, extra, players: <ilk çift>, seed}`;
  1 insan → çark; 2 insanda eski tek çift akışı. Her çiftin ayrı oturumu/jetonu (`ep:tohum:oyun:çiftNo`) vardır; istemci yalnız KENDİ maçını oynar
  (oyun dosyaları tek örnek tutar), oynamayanlar tüm maçların durumunu "A ⚔️ B · kalan 1:12 / 🏆 A kazandı" kartında görür.
  Lider tüm çiftlerin hakemini çalıştırır, sonuçları `mn.pm[i].out` içinde birleştirir (`pt_state.mn`: `pm` çiftler+sonuçlar, `ex` extra, `nf` ilk tur çift sayısı,
  `oc` sonuç; `pm` olmayan eski tek çiftli görüntü okunur). Her çift kendi süresinde biter (süre dolunca beraberlik/kısmi), kopan oyuncu 25 sn
  sonra o maçı kaybeder, sigorta: çift süresi + 5 sn. Lider devrinde biten çiftlerin sonucu korunur, bitmeyenler aynı tohumla yeniden başlar.
- **İkinci şans (tek sayıda insan):** sondaki `extra` oyuncu ilk biten maçın kaybedeniyle (beraberlikse tohumlu rastgele biriyle) yeni bir çiftte
  oynar; yeni maç, önceki maçın banner gecikmesi + sonuç tutması (`hAt`) bitince başlar, böylece kaybeden kendi son atışını ve bannerı görür. Rakip bağlantısızsa maç hükmen: bağlı olan kazanır (ikisi de yoksa beraberlik).
- **Çoklu düello ödülü:** sıralama/derece hesabı yoktur (`applyMinigame({ duelOutcome: {win, lose, draw} })`): kazananlar `REWARDS[1]`, kaybedenler
  `REWARDS[2]`, beraberlikte ikisi de `REWARDS[2]` (kazanan yok); her oyuncunun **son maçı** belirler (ilk maçı kaybeden ikinci şansı kazanırsa `REWARDS[1]` alır).
  Düello dışındakiler (bot, kopan) `MINI_CONSOLATION` alır; 3 kazanan + 3 kaybeden "4. derece" üretmez. Tek çiftli akışta kazanan/kaybeden ve çark
  eskisi gibi `ranking` yoluyla uygulanır; tek çiftte beraberlik de `duelOutcome` yoluyla (ikisi 2.) uygulanır.
- **Kedi - Köpek atış kuralı:** oyuncu başına en çok **5 atış** (`DUEL_CATDOG_SHOTS`). Sayılan eylem `cd_shot` (`kind: 'shot'`, rüzgârsız/çift atış/büyük patlama
  gibi güçlendirmeli atışlar dahil — hasar verirler); `cd_heal` (can iksiri) atış **sayılmaz** (kural modülünde başka eylem türü yoktur).
  Biri canı 0'a düşürürse oyun normal biter (kazanan 1., kaybeden 2.). İki oyuncunun da 5 atışı bitince ya da 120 sn dolunca **kalan cana**
  göre sıralanır; can eşitse beraberlik `[[a, b]]`. Sınır hakemdedir (`catdog-rules.js` değişmez; `duel-adapter.js` `GAMES.catdog` +
  `partial`): kural modülü sınırı bilmediği için oyunun kendi arayüzü bitmez. Sınır dolunca tahta **kilitlenir** (görünür kalır, fazladan atış
  girmez) ve oyunu kapatmayan **ince üst şerit** "Atışlar bitti, sonuç hesaplanıyor…" son atışın animasyonu bitince belirir (gecikme `bm`, aşağıda;
  süre bilinmezse yedek olarak `DUEL_LIMIT_STRIP_MS` = 2,5 sn). Şerit ve sonuç bannerı **tek eleman**dır: sonuç şeritten önce gelirse
  "hesaplanıyor" hiç görünmez, sonra gelirse aynı eleman "Atışlar bitti · 🏆 …" olur — sonuç hakemden anında kaydedilir, yalnız gösterim gecikmelidir. Animasyon (rAF) arka plan
  sekmesinde dursa da sonuç etkilenmez. Kenar durum: heal sırayı tüketir; 5 atışını bitiren oyuncunun sırası rakip bitirmeden gelebilir, bu
  fazladan atışlar uygulanır ama sayılmaz.
- **Sonuç tutma (hold):** sonuç belli olunca (kazanma/beraberlik/süre/atış sınırı) lider sonucu **hemen** kaydeder (lider devri/zaman aşımı
  sonucu kaybettirmez) ve oyuncular şeritte "🏆 A kazandı" / "🤝 Beraberlik"i, oyunun kendi kazanan çizgisini ve son hamleyi görür. Oyun ekranı
  banner göründükten sonra `DUEL_RESULT_HOLD_MS` kadar açık kalır (XOX 2,5 sn, Dörtlü 3 sn, Kedi-Köpek 4 sn), ardından
  sıralama kartı `MINI_HOLD_MS` (5 sn) görünür. Kopma (forfeit) ve sigorta sonuçlarında hold yoktur.
- **Banner gecikmesi (Kedi-Köpek):** sonuç kaydı ve ödül hemen yazılır; banner (🏆/🤝) ve oyun alanının kapanışı son atışın **gerçek animasyon
  süresi** kadar gecikir: `bm = animMs + ANIM_NET_PAD_MS` (500 ms ağ payı). `animMs` (`duel-adapter.js`, saf) hakemdeki son `board.last.shots`
  üzerinden `catdog.js` ile aynı sayıları kullanır: mermi başına `clamp(frames·DT·1000, 500, 2600)`, mermiler arası 650 ms, son mermiden sonra
  700 ms (×2 atışta iki mermi; ilk mermi öldürürse tek). En kötü durum ×2 ≈ 6,55 sn (+ pad). `hAt = bAt + sonuç tutma`; ödül zamanı `applyAt ≥ hAt`.
  Makine `bd` (bağıl ms) alanını eşler; eski görüntüde yoksa gecikmesizdir. XOX/Dörtlü, süre dolumu, forfeit ve sigorta `bm = 0` (pad eklenmez).
  Sonuç bannerı gelene kadar `getView().mini.pairs[i].done/winner/draw` ve sıralama gizlidir. Testler: `tests/parti-duel-banner.test.js`
  (`catdog.js` sayılarıyla ayrışmayı da yakalar). Hold sırasında lider devri oturumu yeniden
  başlatmaz. Lider sonucu `{k:'result'}` yüküyle oyunculara bildirir (yalnız lider kabul edilir).
- **Canlı izleme:** düelloda olmayanlar (ikinci şans bekleyen, botlar dışındaki herkes) ve maçı biten oyuncular, süren **tüm maçların** salt-okunur
  canlı tahtasını görür (`duelPairsCard`: XOX 3×3, Dörtlü 7×6, Kedi-Köpek can çubukları + son atış özeti; canvas/animasyon yok). Yeni yük ya da oturum
  yoktur: lider zaten çalışan hakemlerinden her kabul edilen hamlede (`referee.onUpdate`) kompakt bir **anlık görüntü** üretir (`mini/duel-watch.js`
  `snapshot`), `pm[i].wb` olarak `pt_state` ile yayınlar (değişmediyse yayınlamaz); alıcı `sanitize` ile doğrular (geçersiz = `null`, oyunu bozmaz).
  Geç katılan/yeniden bağlanan istemci anlık görüntüyü hazır alır; ikinci şans maçı boş başlar. `getView().mini.pairs[i].watch` arayüze verilir.
- **Süre/takılma:** süre dolunca (XOX/Dörtlü 90 sn, Kedi-Köpek 120 sn: `DUEL_MS_BY_GAME`) bitmemiş oyun beraberlik sayılır. Lider ayrıca `süre + 5 sn` içinde sonuç gelmezse çark sonucunu uygular.
  Düello oyuncusu koparsa lider **25 sn** bekler; dönmezse kopan kaybeder (`[[kalan], [kopan]]`), dönerse aynı sayfa kaldığı yerden sürer
  (lider kaçan rakip hamlelerini `catchup` ile yeniden gönderir). Sayfası yenilenen oyuncu için durum kurtarılamaz: düello iki tarafta
  `reset` ile baştan başlar (süre dolmadan).
- **Lider devri:** `ep` değişir → tüm istemciler oturumu **aynı tohumla** yeniden başlatır (düello baştan; süre 90 sn'den yeniden); yeni lider
  sonucu o oturumdan alır.
- **İptal/temizlik:** `signal.abort()` oyunu yıkar (`destroy`), kökü temizler, Promise `{ ranking: null, aborted: true }` ile biter.

**Test bayrağı `?mini=`:** adreste `?mini=duel` (rastgele düello oyunu) ya da `?mini=duel:xox` / `duel:connect4` / `duel:catdog` varsa ve
odada en az 2 insan varsa her tur sonunda düello seçilir (geçersiz değer yok sayılır). Minioyunu **lider** seçtiği için bayrak **lider
tarayıcısında** okunur (diğer sekmelerde etkisizdir); `PartiRules.parseMiniFlag` / `minigameSpec(state, { mini })`. Bayrak yokken davranış
(%30 ihtimal, tohumdan oyun) ve rng çekim sırası aynıdır.

**Yeni düello minioyunu eklemek** (iki kişilik, sıra tabanlı oyun `core/duel.js` ile yazılmış olmalı; çoklu düelloda otomatik çalışır, ek adım yok):

1. Oyun `Games.register` ile kayıtlı olsun ve kural modülü (`*-rules.js`) `initial/parse/toMessage/validate/apply/result` arayüzünü sağlasın.
2. `games/parti/mini/duel-adapter.js` içindeki `GAMES`'a satır ekle: `{ prefix: <Duel öneki>, title: <Türkçe ad>, rules: ... }`.
3. `games/parti/ui.js` içindeki `DUEL_TITLES`'a ad ekle ve `games/parti/config.js` `DUEL_GAMES` listesine oyun kimliğini yaz
   (`rules.minigameSpec` buradan, tohumla deterministik seçer; botlar düelloya seçilmez). Kedi - Köpek gibi sınırlı oyunlar için
   `GAMES` girdisine `limit: { shots, counts(move) }` ekle: sınır dolunca hakem biter, "Atışlar bitti" katmanı çıkar.
4. Süre sınırı gerekiyorsa (ör. atış sayısı) kural modülüne isteğe bağlı `partial(board, order) -> ranking | null` ekle: süre dolunca hakem bunu kullanır.
5. `tests/parti-duel-flow.test.js` içindeki `RULES`'a ekleyip akış testlerini çalıştır; Tarayıcıda: 3 sekmeyle (iki oyuncu + izleyici) deneme.

**Yeni harita eklemek:** `games/parti/maps/<ad>.js` oluştur (aynı UMD kalıbı, `PartiMaps[<id>]`'ye kaydolur) ve `index.html`'e
`games/parti/graph.js`'ten sonra, `ui.js`'ten önce ekle. Biçim (1000×700 mantıksal alan):

```js
{ id, name, palette: { bgTop, bgBottom, path, pathEdge, label, wave, fx: 'waves' | 'stars' },
  nodes: [{ id, x, y, type: 'normal'|'start'|'treasure'|'weapon'|'event', next: [id, ...] }],   // 35-50 düğüm, TEK start (≥2 çıkış)
  decor: [{ e: '🌴', x, y, s: boyutPx, a: 'float'|'bob'|'twinkle'|'none' }] }
```

`tests/parti-graph.test.js` haritayı doğrular (düğüm sayısı, çıkışsız düğüm, döngüsellik, başlangıçtan erişim, ≥2 dallanma,
tek başlangıç ve ≥2 çıkışı, başlangıç kenarı ≤200 birim, çakışma); yeni haritayı oradaki listeye ekle. **Yeni silah eklemek:** `games/parti/config.js` içindeki `WEAPONS`'a ekle
(`kind: 'target'` + `range`/`dmg` tablosu (mesafe 0 dahil), `'area'` + `damage` ya da `'shield'`), `WEAPON_IDS`'e ve `WEAPON_WEIGHTS`'e yaz;
kurallar, arayüz ve ⓘ yardımı tabloyu okur (`C.legend()`). Olaylar (`EVENTS`, olasılıklar ağırlıklardan üretilir), ödüller (`REWARDS`),
süreler ve sandık sayıları da aynı dosyadadır.

### Mobil tam ekran (⛶)

Parti çubuğundaki **⛶** düğmesi (yalnız dokunmatik cihazda ve destek varsa görünür) `core/fullscreen.js` ile çalışır; yardımcı oyuna
özgü değildir (`Fullscreen.create({ target, onChange })`: `mode()`, `toggle()`, `hint()`, `destroy()`).

- **Android (Chrome vb.):** `requestFullscreen({ navigationUI: 'hide' })` + `screen.orientation.lock('landscape')` (kilit desteklenmezse
  sessizce atlanır). Geri hareketi/Esc ile çıkış dinlenir ve düğme eşitlenir.
- **iPhone/iPod Safari:** element tam ekranı yoktur → **sahte tam ekran**: `<html>`e `fs-active fs-fake` sınıfları eklenir (`100dvh`, güvenli alan
  dolguları). Adres çubuğu koddan gizlenemez; ilk girişte ipucu çıkar: **Paylaş → Ana Ekrana Ekle** ile açılırsa uygulama gerçekten tam ekrandır.
- **Ana ekrandan açılmış uygulama** (`display-mode: standalone|fullscreen` / `navigator.standalone`): zaten tam ekran, düğme gizlenir.
- **Ana ekrana ekle:** `manifest.webmanifest` (`display: fullscreen`, yönelim kilitsiz) + iOS meta etiketleri (`apple-mobile-web-app-capable`,
  `status-bar-style: black`) ve `assets/icons/` (yer tutucu "K" simgeleri; istenirse aynı adlarla değiştirilebilir). **Servis çalışanı yoktur.**

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

- Parti: backend aynı kimlikle gelen yeni oturumu eskisinin yerine koyar (sıra korunur, `player_disconnect` yayınlanmaz), boş odayı
  120 sn tutar ve 15 sn'de bir ping atar (45 sn sessizlik = kopma). Bu yüzden yenilenen/yeniden bağlanan lider için durum
  makinesi `player_joined`'ı "lider düştü" gibi işler (sıradaki oyuncu devralır, dönen oyuncu durumu ondan alır). Herkes aynı
  anda 2 dk'dan uzun düşerse oda ve oyun kaybolur (durum yalnızca istemcilerdedir).
- Parti: gönderen kimliği sunucuca doğrulanmaz (mesajda taşınır) ve backend kimlik devralmaya izin verir; kötü niyetli bir oyuncu
  başkası adına eylem gönderebilir ya da onun oturumunu düşürebilir. Arkadaşlarla oynamak için kabul edilmiştir.
- Parti: gelen `pt_state` hafifçe doğrulanır (`ep` en çok +1 ilerler, lider koltuklarda oturan bir insan olmalı) ve kural tarafı
  düğüm/hedef kimliklerini yalnızca kendi özellikleriyle eşler. Gönderen kimliği hâlâ mesajdaki `id`'dir; `pt_action`'da `from`
  alanı varsa `id` ile aynı olmak zorundadır. **Backend gönderen kimliğini (`from`) kendisi eklemeli** (sunucunun bildiği oturum
  kimliği); o zaman sahte `id` ile eylem göndermek mümkün olmaz. Şu an backend'e dokunulmadı.
- Parti: Worker'lı lider saati arka plandaki sekmede oyunun ilerlemesini sağlar, ama mobil tarayıcılar ekran kilitlenince ya da uygulama
  uzun süre arka planda kalınca sayfayı tamamen dondurabilir; bu durumda lider olan oyuncunun cihazı oyunu durdurur (diğerlerinde
  "lider sessiz" gibi görünür, kopma/lider devri süreci devreye girmez çünkü bağlantı hâlâ açıktır). Test ortamında yalnızca
  `requestAnimationFrame` durdurma + `document.hidden` taklidi doğrulanabildi.
- Parti: düello minioyunu XOX, Dörtlü Bağla ve Kedi - Köpek; düello sırasında
  lider devrinde ya da oyuncunun sayfası yenilenince düello baştan başlar. Tam oyunu tek sayfada iki örnek olarak çalıştırmak mümkün değildir
  (oyun dosyaları modül düzeyinde tek örnek tutar): iki oyuncu için iki ayrı sekme gerekir. Sürerken gelen yeni oyuncu yalnızca izleyici
  olur; kopmuş oyuncunun koltuğu 3 dk sonra düşer.
- Bomberman mobil joystick: tek hareket döngüsü (50 ms) ve `bomberman-joystick.js` denetleyicisi: adımlar arası **en az 150 ms** (yön değişimi, ölü bölgeye
  girip çıkma bu sınırı atlayamaz), çapraz sınırda **histerezis** (mevcut yönün ekseninden diğer eksene geçmek için baskın/diğer oranı ≥ 1,3), 15 px ölü bölge.
  Parmak joystick'teyken (ve 700 ms sonrasına kadar) sentetik mouse olayları yok sayılır. Klavye okları değişmedi. Testler: `tests/bomberman-joystick.test.js`.
- Bomberman akıcılığı: oyun mantığı 32 px'lik ızgara adımlarıyla (adım başına ≥150 ms) aynı kaldı; ekranda gösterilen konum ise `bomberman-smooth.js` ile
  mantıksal konumu üstel yaklaşmayla (τ≈50 ms, kare süresinden bağımsız) izler: ~7 adım/sn'lik zıplama yerine ekran hızında kayma, yürüme karesi görsel
  mesafeye bağlı, uzak sıçrama (yeniden doğma) anında. Uzak oyuncular da yumuşatılır (durum kimlikte tutulur: `sendPosition` oyuncu nesnesini ağa yollar).
  Statik harita çevrim dışı katmana önbelleklenir (`mapSignature` değişince yenilenir), sprite'lar keskin ölçeklenir (`image-rendering: pixelated`).
  Testler: `tests/bomberman-smooth.test.js`.
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
