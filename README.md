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
games/parti/mini/registry.js      minioyun kaydı: { id, name, icon, kind: ffa|duel|grup, min, max, weight }; seçim, config ve arayüz buradan okur
games/parti/mini/ffa-drivers.js    ffa oyun sürücüleri (machine.js oyuna özel kuralı bilmez): rep şeması, rapor denetimi, bitiş, sıralama, izleyici satırı
games/parti/mini/kurbaga-rules.js   Kurbağa saf kurallar: tohumlu araçlar f(t), çarpışma, makullük denetimi, bot ilerleme, sıralama
games/parti/mini/kurbaga-session.js Kurbağa oyuncu oturumu (DOM'suz): sıçrama sınırı, çarpışma, ağ raporu birleştirme, kalp atışı
games/parti/mini/kurbaga-ui.js      Kurbağa arayüzü: kanvas, 4 ok düğmesi, klavye, akran yumuşatması
games/parti/mini/dusenzemin-rules.js   Düşen Zemin saf kurallar: takvim, fizik, it, makullük/out/staleOut, botlar, sıralama
games/parti/mini/dusenzemin-session.js Düşen Zemin oyuncu oturumu (DOM'suz): sabit adım fizik, rapor birleştirme, it, out, resume
games/parti/mini/dusenzemin-ui.js      Düşen Zemin arayüzü: üstten kanvas, analog joystick + Zıpla/İt, klavye, çoklu dokunma
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
  Atışla kullanılan güçlerden turda en fazla biri seçilir. **Seçim bağlanır:** güç seçildikten sonra o tur iptal edilemez ve başka güç seçilemez
  (yalnız Fırlat! kalır); böylece 🧭 gibi güçlerle bedava önizleme/açı ayarı yapılamaz (`CatDogRules.controlState`). Canvas'taki emojiler
  `core/emoji.js` ile düz `fillStyle` ile çizilir: iPhone Safari degrade `fillStyle` varken emojiyi o renkle boyar (kahverengi leke).

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
- **Gövde çarpışması:** oyuncunun kafası ile zemin arasında her zaman bir gövde (kafadan zemindeki dinlenme ayağına dikey kapsül, yarıçap 12) vardır. Vuruşta ayak havaya
  kalksa da kafa–zemin boşluğu (~31 px, top 32 px) açılmaz; zemine yakın gelen top oyuncunun altından geçmez. Zıplayan oyuncunun altından top geçebilir. Testler: `tests/kafatopu-govde.test.js`.
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
- **Kazanma:** hedef lobide "Otomatik" (2-3 oyuncuda 15, 4-8 oyuncuda 10) ya da 5-25 arası seçilir; bireyselde hedef yıldıza ilk ulaşan; takımda hedef **kişi başıdır**: etkin hedef = hedef × gerçek takım büyüklüğü (`state.ts`; `rules.effectiveGoal`, örn. 2'şerli takımda 10 → 20, 4+4'te 10 → 40) ve takımın toplam ⭐'ı buna ulaşınca takım anında kazanır. Tur çubuğu ve takım çipleri etkin hedefi gösterir.
- **Minioyun ödülü:** 1.: 1 ⭐ + rastgele silah, 2.: rastgele silah, 3.: +25 ❤️ (üst sınır 100) (düelloda kazanan 1., kaybeden 2.;
  beraberlikte ikisi de 2.). **Düelloda olmayanlar** (sıralamada yer almayanlar) ödül değil **teselli** alır: +25 ❤️ (üst sınır 100,
  `MINI_CONSOLATION`); sıralamadakiler teselli almaz, 3. derece ödülüyle çakışmaz (düello sıralamasında 3. derece yoktur).
  Envanter doluysa silah ödülü kaybolur.
- **Son Çılgınlık:** biri (takımda takımın toplamı, etkin hedefe göre) hedefe 3 ⭐ ya da daha az kalınca (tur başında) tahta kızıla döner, ekranda uyarı çıkar
  ve oyun boyunca sandık sayıları ×2 olur (bir kez tetiklenir; hazine noktaları yettiği kadar).
- **Emoji tepkileri:** 😂 😱 👏 🤡 (`pt_emote {id, e}`): oyun durumuna yazılmaz, yalnızca iletilir; oyuncu başına en çok saniyede 1;
  tahtada oyuncunun jetonunun üstünde ~2 sn baloncuk olarak görünür. Yalnızca koltuktaki insanlar atabilir.
- **Silah düşme ağırlıkları:** yumruk 1, pompalı 3, yay 3, bomba 2, kalkan 2.
- **Takım sayısı:** takım modunda lider takım sayısını seçer (Otomatik = 2'şerli, en çok 4 takım; ya da 2 / 3 / 4). Takımlar **eşit** olmalıdır:
  oyuncu sayısı takım sayısına tam bölünmeli, takım başına en az 2 oyuncu, en az 2 takım (8 kişi 4+4 ya da 2+2+2+2, 6 kişi 3+3 ya da 2+2+2; 8 kişi 3 takıma
  bölünmez). Bölünmeyen seçenekler pasif görünür, `startBlock` nedenini yazar. Takım sayısı değişince takımlar yeniden karıştırılır; sonradan giren/bot en az dolu
  takıma yerleşir. `cf.tc` (0 = otomatik) `pt_state` ile taşınır; eski yayında yoksa otomatiktir. 2 oyuncuyla takım modu artık başlamaz (en az 2 takım).
- **Lobi:** lider mod (Bireysel / Takım), harita (Korsan Adası / Uzay), hedef ⭐ (5-25), bot ekleme/çıkarma ve oyuncu
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
  deadlineMs, signal                                        // isteğe bağlı toplam süre (Parti düellosu 0 = süre yok); AbortSignal
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
  `oc` sonuç; `pm` olmayan eski tek çiftli görüntü okunur). Her çift kendi hızında biter (toplam süre yok), kopan oyuncu 25 sn
  sonra o maçı kaybeder, sigorta: çift süresi + 5 sn. Lider devrinde biten çiftlerin sonucu korunur, bitmeyenler aynı tohumla yeniden başlar.
- **İkinci şans (tek sayıda insan):** sondaki `extra` oyuncu ilk biten maçın kaybedeniyle (beraberlikse tohumlu rastgele biriyle) yeni bir çiftte
  oynar; yeni maç, önceki maçın banner gecikmesi + sonuç tutması (`hAt`) bitince başlar, böylece kaybeden kendi son atışını ve bannerı görür. Rakip bağlantısızsa maç hükmen: bağlı olan kazanır (ikisi de yoksa beraberlik).
- **Çoklu düello ödülü:** sıralama/derece hesabı yoktur (`applyMinigame({ duelOutcome: {win, lose, draw} })`): kazananlar `REWARDS[1]`, kaybedenler
  `REWARDS[2]`, beraberlikte ikisi de `REWARDS[2]` (kazanan yok); her oyuncunun **son maçı** belirler (ilk maçı kaybeden ikinci şansı kazanırsa `REWARDS[1]` alır).
  Düello dışındakiler (bot, kopan) `MINI_CONSOLATION` alır; 3 kazanan + 3 kaybeden "4. derece" üretmez. Tek çiftli akışta kazanan/kaybeden ve çark
  eskisi gibi `ranking` yoluyla uygulanır; tek çiftte beraberlik de `duelOutcome` yoluyla (ikisi 2.) uygulanır.
  **Gösterim ödülle aynıdır:** sıralama kartı ve günlük satırı beraberlik/kaybedeni 🥈 yazar (`getView().mini.medals`: kazanan varsa `[0, 1]`, yoksa `[1]`),
  kimse yanlışlıkla "1.lik" görmez.
- **Kedi - Köpek atış kuralı:** oyuncu başına en çok **5 atış** (`DUEL_CATDOG_SHOTS`). Sayılan eylem `cd_shot` (`kind: 'shot'`, rüzgârsız/çift atış/büyük patlama
  gibi güçlendirmeli atışlar dahil — hasar verirler); `cd_heal` (can iksiri) atış **sayılmaz** (kural modülünde başka eylem türü yoktur).
  Biri canı 0'a düşürürse oyun normal biter (kazanan 1., kaybeden 2.). İki oyuncunun da 5 atışı bitince **kalan cana**
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
  canlı tahtasını görür (`duelPairsCard`: XOX 3×3, Dörtlü 7×6, Kedi-Köpek **canlı sahne**: tohumdan çizilen arazi, kedi/köpek, can çubukları ve son atışın yörüngesi izleyicide yeniden oynatılır). Yeni yük ya da oturum
  yoktur: lider zaten çalışan hakemlerinden her kabul edilen hamlede (`referee.onUpdate`) kompakt bir **anlık görüntü** üretir (`mini/duel-watch.js`
  `snapshot`), `pm[i].wb` olarak `pt_state` ile yayınlar (değişmediyse yayınlamaz); alıcı `sanitize` ile doğrular (geçersiz = `null`, oyunu bozmaz).
  Geç katılan/yeniden bağlanan istemci anlık görüntüyü hazır alır; ikinci şans maçı boş başlar. `getView().mini.pairs[i].watch` arayüze verilir.
  **Kedi-Köpek sahnesi:** anlık görüntü ayrıca `sd` (tohum), `tn` (hamle no) ve son atışın yörüngelerini (`shots`: ≤80 tamsayı nokta, kare sayısı, çarpma noktası, hasar,
  atış sonrası can) taşır (tek atış ~2-3 KB). İzleyicide `PartiDuelWatch.createScene` (kalıcı kanvas; `ui.js` çift başına bir denetleyici, her karede `tick`) sahneyi
  `CatDogRules.generateScene(sd)` ile çizer ve yeni `tn` gelince atışı `catdog.js` ile **aynı sürelerle** oynatır (uçuş `clamp(kare/60 sn, 0,5–2,6 sn)`, mermiler arası 650 ms,
  son 700 ms); can çubuğu **çarpma anında** düşer, hamleler kuyruğa girer, yeni tohum (yeni maç) ya da ilk görüşte animasyon oynatılmaz. Eski lider (`sd` yok) için
  eski can çubuklu görünüm. **Tıklanamama düzeltmesi:** `pt-duel-locked` (sonuçta/atış sınırında tahtayı tıklamaya kapatır) kalıcı kök düğümde kalıp sonraki düelloyu
  kilitli bırakıyordu; adaptör artık oturum başında ve kapanışta temizler.
- **Süre/takılma:** düelloda **toplam süre sınırı yoktur**, oyunlar yarıda kesilmez. Takılmaya karşı yalnız **boşta sınırı**: sırası gelen oyuncu
  `DUEL_IDLE_MS` (3 dk) hiç hamle yapmazsa (lider her hakem güncellemesinde sayacı sıfırlar) o maçı kaybeder (`r: 'idle'`, hükmen: banner/tutma yok);
  oyun hiç başlamadıysa tohumdan çark sonucu. Kedi-Köpek'in 5 atış sınırı süre değil atış kuralıdır, kalır.
  Düello oyuncusu koparsa lider **25 sn** bekler; dönmezse kopan kaybeder (`[[kalan], [kopan]]`), dönerse aynı sayfa kaldığı yerden sürer
  (lider kaçan rakip hamlelerini `catchup` ile yeniden gönderir). Sayfası yenilenen oyuncu için durum kurtarılamaz: düello iki tarafta
  `reset` ile baştan başlar (süre dolmadan).
- **Lider devri:** `ep` değişir → tüm istemciler oturumu **aynı tohumla** yeniden başlatır (düello baştan; boşta sayacı sıfırlanır); yeni lider
  sonucu o oturumdan alır.
- **İptal/temizlik:** `signal.abort()` oyunu yıkar (`destroy`), kökü temizler, Promise `{ ranking: null, aborted: true }` ile biter.

### Minioyun havuzu

Seçim `games/parti/mini/registry.js` kaydından yapılır (`rules.minigameSpec`; eski "%30 düello / kalan çark" kuralı kalktı):

- **Uygunluk:** düello (`xox`, `connect4`, `catdog`) en az **2 İNSAN** ister (botlar düelloya girmez; tek insanda havuzdan düşer); ffa (`kurbaga`)
  en az 1 insanla, botlarla birlikte oynanır. `grup` türü yalnız şemada tanımlıdır, uygulaması yok: hiçbir zaman seçilmez.
- **Seçim:** uygun oyunlar arasında eşit ağırlık (`weight: 1`), tohumlu (herkes aynı sonucu görür). Havuz **2'den büyükse bir önceki oyun hariç**
  tutulur (`state.lm`: son OYNANAN oyunun kimliği; `applyMinigame` ödülü uygularken yazar, `pt_state` ile taşınır, lider devrinde kaybolmaz;
  `minigameSpec` saf kalır, `lm` yazmaz; çark yedeği `lm`'yi değiştirmez).
- **Şans Çarkı yalnız acil yedektir:** uygun oyun yok (`game: null`), Kurbağa'da hiç rapor gelmedi ya da oyun kurulamadı.

| Odadaki durum | xox | connect4 | catdog | kurbaga | dusenzemin |
|---|---|---|---|---|---|
| 2+ insan (bot olsun olmasın) | %20 | %20 | %20 | %20 | %20 |
| 1 insan + botlar | - | - | - | %50 | %50 |

(Oranlar `tests/parti-mini-registry.test.js` içinde 10000 çekilişlik süpürmeyle doğrulanır; "bir önceki hariç" kuralı uzun vadede oranı
değiştirmez, yalnız üst üste tekrarı önler. Havuz ≤ 2 ise hariç tutma yoktur.)

**Test bayrağı `?mini=<oyun-id>`** (`xox` | `connect4` | `catdog` | `kurbaga`): havuzu o oyuna indirir. `?mini=duel` rastgele düello,
eski `?mini=duel:<oyun>` aynen çalışır. Uygun değilse (ör. tek insanda düello) bayrak **yok sayılır**, normal havuz kullanılır. Minioyunu
**lider** seçtiği için bayrak yalnız **lider tarayıcısında** okunur (diğer sekmelerde etkisizdir); `PartiRules.parseMiniFlag` /
`minigameSpec(state, { mini })`.

### Kurbağa (ffa)

8 kişiye kadar **aynı anda** oynanır; `mini/registry.js` kind `ffa`. Izgara 9 sütun × 10 satır: satır 0 başlangıç (güvenli), 1-8 araç şeritleri,
9 hedef. Oyuncular birbirine çarpmaz. Tek dokunuş = tek sıçrama (`HOP_MS` = 150 ms bekleme; `event.repeat`/basılı tutma yok). Mobil: 4 büyük ok
düğmesi; klavye: oklar / WASD. Çarpınca başlangıç satırına dönülür (ölüm sayacı artar).

- **Araçlar ağda yok:** şerit başına yön, hız (1,4-3,4 hücre/sn), uzunluk (1-2) ve boşluk (≥ 2,6 hücre) tohumdan; konum saf `f(t)`
  (`kurbaga-rules.js`). Geri sayım (3-2-1, `KURBAGA_COUNTDOWN_MS` = 4 sn) lider yayınından hizalanır; her istemci kendi saatinde oynar
  (birkaç yüz ms kayma kabul).
- **Ağ (`pt_mg`, `mg: f:<tohum>:kurbaga`):** `{ k:'pos', r, c, d, n, e? }` (`n` artan sıra no, `e` varışta istemcinin ölçtüğü süre). Sıçrama
  raporları en çok 250 ms'de bir **birleştirilir** (ölüm/varış anında hemen), değişiklik olmasa da 2 sn'de bir kalp atışı gider (lider devri/kayıp
  mesaj). Herkes katılımcıların mesajlarını **görüntü** için de oturumuna besler (`tau` ≈ 90 ms yumuşatma); güven ve sonuç yalnız liderdedir.
- **Lider denetimi:** gönderen o maçın insan katılımcısı olmalı; `n` artmalı; iki rapor arası **zaman bütçesi** (`⌊dt/150⌋+1` hücre; birleşik/kayıp
  mesaj için) aşılırsa yok sayılır; ölüm başlangıç satırına dönüşle (`d` artar) tutarlı olmalı; varış süresi ≥ 9×150 ms ve liderin
  saatinden en çok 1,5 sn ileri. Varınca rapor donar.
- **Bitiş:** süre 120 sn (`KURBAGA_MS`). İlk (insan) varıştan sonra kalan süre 20 sn'ye düşer (`KURBAGA_LAST_CALL_MS`; sonraki varışlar uzatmaz).
  Bağlı **tüm insanlar** varınca erken biter (kopanlar sayımdan çıkar). Hiç rapor yoksa çark.
- **Sıralama:** varanlar varış süresine göre (eşit ms eşit derece), kalanlar ANLIK satıra göre azalan (eşit satır eşit derece); varan her zaman önde.
  Kopan insanlar en sona yazılır. Ödül `REWARDS` derecesine göre: 1. ⭐+silah, 2. silah, 3. +25 ❤️; **4. ve sonrası ödülsüz** (mevcut tablo).
- **Botlar:** `botProgress(tohum, id, t)` / `botFinish` saf ve tohumlu; ağda yok. Aynı fonksiyonlar hem hayalet kurbağayı çizer hem sıralamaya girer.
  Zayıf-orta oyuncu gibi ayarlıdır (çoğu bot 120 sn dolmadan varamaz; `tests/parti-kurbaga-rules.test.js` dağılımı sabitler). Bot varışı
  son çağrı sayacını tetiklemez.
- **Lider devri:** raporlar `pt_state.mn.ff` içinde (küçük: ≈ 20 B/oyuncu) taşınır; oturum anahtarı `ep` içermez → oyuncunun ilerlemesi sıfırlanmaz;
  istemciler kalp atışıyla son durumu yeniden gönderir. Yeniden bağlanan (yeni sayfa) raporlanan satırdan devam eder.
- **İzleyici / sonradan katılan / oynamayan:** liderin yayınından (≤ 500 ms'de bir; varışta hemen) ilerleme çubukları; botlar tohumdan.

### Düşen Zemin (ffa)

8 kişiye kadar **aynı anda**; son ayakta kalan kazanır. Arena 8×8 kare (kare 64 birim, oyuncu yarıçapı 14); herkes orta halkada başlar (koltuk sırası, tohumlu kaydırma).

- **Takvim (tohumdan saf f, ağda yok):** tur sayısı hedef süreden türetilir (≈ 34 tur): son yıkılış ≈ **85 sn**'de **tek güvenli kareye** iner (son turlarda 2×2 → 1),
  sonra o kare kalıcıdır; toplam süre 120 sn (`DUSENZEMIN_MS`), dolunca hayatta kalanlar eşit 1. Tur: uyarı `W_k` (2,4 → 1,1 sn) + yıkılma + 0,7 sn ara.
  Uyarıda **güvenli kareler yanıp söner**, yanmayanlar yıkılır ve kalıcıdır (`UYARI_MODU = 'guvenli-yanar'`, ters çevirmek tek satır). Güvenli kümeler 45 kareden (%70) tek kareye,
  azalmayan **alt küme zinciri** ve hep **bitişik** (izole kare yok); oyuncu tabanı `floor(n/2)+1` zamanın %75'ine dek korunur, son %25'te 1'e düşer.
  Başlangıç halkası ilk güvenli kümededir; durağan duran oyuncu ilk 15 sn dolmadan düşer (testle sabit).
- **Fizik:** sabit adım 1/60 sn, ivme + sürtünme, azami hız 240; **ZIPLA** 0,55 sn havada, 1,4 sn bekleme (havadayken zemin yıkılsa da düşülmez, iniş karesine bakılır);
  **İT** ≈ 40 birim menzil, ±60° koni, 1,2 sn bekleme, hedefe 560'lık hız darbesi (sürtünmeyle söner); gövde temasında hafif karşılıklı itme.
  **Düşme:** yerdeyken alt kare yıkıldıktan 120 ms sonra elenir; kenardan dışarı da düşer. Elenen **hayalet izleyici** olur (arenayı görür, hareket edemez).
- **Kontroller:** mobil — sol altta analog joystick (ölü bölge + histerezis) + sağ altta 🦘 Zıpla / 👊 İt; her biri kendi `pointerId`'siyle izlenir (joystick ve düğme AYNI ANDA),
  `touch-action: none`. Masaüstü — WASD/oklar + Boşluk (zıpla) + E/Shift (it); zıpla/it kenar tetiklidir (basılı tutma gerekmez, `event.repeat` yok sayılır).
- **Ağ (`pt_mg`, mg `f:<tohum>:dusenzemin`):** her istemci KENDİ oyuncusunun fiziğini koşturur. `{k:'pos', n, x, y, z, vx, vy, a}` ≤ ~8 Hz birleştirilmiş (zıplama/it anında hemen,
  2 sn kalp atışı); `{k:'push', to, dx, dy, n}` yalnız `to` (kurban) kendi üzerine uygular (menzil/bekleme kurbanın yerelinde denetlenir); `{k:'out', t, n}` elenme, kurban
  kendi bildirir; kaybolursa diye `DUSENZEMIN_HEARTBEAT_MS` aralığında **tekrarlanır** (lider ilkini kabul eder, tekrarları yok sayar; yenilemeden gelen hayalet hiç göndermez). Herkes pos/out'u GÖRÜNTÜ için dinler (≈ 120 ms yumuşatma); güven ve sonuç yalnız liderde. `n` oyun saatinden başlar (yenileme çözümü, Kurbağa gibi).
- **Lider denetimi:** konum arena sınırı içinde, hız üst sınırı, zaman bütçeli adım (⌊dt/150⌋+1); `out.t` ancak son bilinen karenin yıkılışından sonra (pencere: yıkılış … + 120 ms düşme + 550 ms havada kalma + saat payı)
  ya da **kenar düşmesi** için son konum kenara (hız payı kadar) yakınsa kabul edilir; saçma olan yok sayılır. **Sıralama:** geç elenen iyi; aynı yıkılış turunda düşenler **eşit derece**
  (anahtar yıkılış anı); kenardan itilerek düşenler kendi ms'siyle sıralanır; süre sonunda hayatta olanlar eşit 1.
- **Donan/kopan telefon:** `DUSENZEMIN_STALE_MS` = 5 sn rapor gelmeyen oyuncu, **yalnız son bilinen karenin yıkılış anı geçmişse** elenmiş sayılır (anahtar = yıkılış anı); güvenli kareye basan
  sessiz oyuncu elenmez. Kopan insan `finishMini`'de zaten sona yazılır. Arka plana atılan sekme dönüşte ≤ 2 sn ileri sarar (sabit adım yakalama).
- **Erken bitiş:** bağlı hayatta insan kalmadı ya da hayatta (insan + bot) ≤ 1. **Botlar:** `botFall(tohum, id)` elenme anı (ham 14-109 sn, çoğu 70 sn'den önce, yıkılış anına oturur,
  son yıkılışı geçmez; ortalama ≈ 50 sn), `botPosition` güvenli karede gezinti (hayalet); botlar hiç itilmez/itmez, sıralamaya girer. Dağılım testle sabit.
- **Yenileme / lider devri:** `resume = {x,y,z,vx,vy,out}`; elenmiş oyuncu **elenmiş kalır** (hayalet, tekrar oynamaz, ikinci out raporu YOK); hayattaki oyuncu son raporlanan konumdan devam eder.
  `ff.rep` pt_state'te taşınır (7 tamsayı/oyuncu; 8 oyuncuda ≤ 20 KB); lider devrinde sessizlik sayacı yeni liderde sıfırdan başlar (haksız eleme olmasın).
- **ffa sürücü arayüzü:** `mini/ffa-drivers.js` — `machine.js` oyuna özel kuralı bilmez; her ffa oyunu `newRep/packRep/unpackRep/accept/watch/allDone/rank/resume/onTakeover/summaryRow` sağlar.
  Kurbağa bu arayüze taşındı (davranış aynı, testler değişmedi).

**Yeni minioyun eklemek:**

1. `games/parti/mini/registry.js`'e satır ekle: `{ id, name, icon, kind: 'duel' | 'ffa', min, max, weight: 1 }`. Seçim, `Config.DUEL_GAMES` ve oranlar
   otomatik güncellenir; `tests/parti-mini-registry.test.js` dağılımını (≈ %100/oyun sayısı) ve şemayı doğrular.
2. **Düello** ise aşağıdaki "Yeni düello minioyunu eklemek" adımlarını izle. **ffa** ise: saf kural + oturum modülü yaz (`kurbaga-*` örnek), `minigame.js`
   içindeki `FFA` tablosuna oturumu ekle ve `mini/ffa-drivers.js`'e sürücü ekle (rep şeması, `accept`, `allDone`, `rank`, `summaryRow` ...); `machine.js`
   ve `ui.js` değişmez (başlık registry'den, izleyici satırı sürücüden).
3. Bayrakla (`?mini=<id>`) uçtan uca dene; 3 sekmeyle (iki oyuncu + izleyici) deneme.

**Yeni düello minioyunu eklemek** (iki kişilik, sıra tabanlı oyun `core/duel.js` ile yazılmış olmalı; çoklu düelloda otomatik çalışır, ek adım yok):

1. Oyun `Games.register` ile kayıtlı olsun ve kural modülü (`*-rules.js`) `initial/parse/toMessage/validate/apply/result` arayüzünü sağlasın.
2. `games/parti/mini/duel-adapter.js` içindeki `GAMES`'a satır ekle: `{ prefix: <Duel öneki>, title: <Türkçe ad>, rules: ... }`.
3. `games/parti/ui.js` içindeki `DUEL_TITLES`'a ad ekle; oyun kimliğini `mini/registry.js`'e `kind: 'duel'` olarak yaz (`Config.DUEL_GAMES` oradan türer;
   `rules.minigameSpec` tohumla deterministik seçer; botlar düelloya seçilmez). Kedi - Köpek gibi sınırlı oyunlar için
   `GAMES` girdisine `limit: { shots, counts(move) }` ekle: sınır dolunca hakem biter, "Atışlar bitti" katmanı çıkar.
4. Atış sayısı gibi bir sınır gerekiyorsa kural modülüne isteğe bağlı `partial(board, order) -> ranking | null` ekle: sınır dolunca hakem bunu kullanır.
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

Oda çubuğundaki **⛶** düğmesi (yalnız dokunmatik cihazda ve destek varsa görünür) **tüm oyunlarda** çalışır; `core/main.js` oyun başlayınca
`core/fullscreen.js` denetleyicisini kurar, oyundan çıkınca yıkar. Yardımcı oyuna özgü değildir (`Fullscreen.create({ target, onChange })`:
`mode()`, `toggle()`, `hint()`, `destroy()`). Etkinken `<html>`e `fs-active` (iPhone'da ayrıca `fs-fake`) sınıfı eklenir; düzen `style.css`'te:
başlık gizlenir, `#game-container` dolgu/kenarlık/gölge olmadan `100dvh` doldurur (güvenli alan dolgularıyla), mobilde Bomberman tuvali ekranın
tamamına yayılır. Parti ve Kafa Topu zaten tam sayfa düzen kullanır.

- **Android (Chrome vb.):** `requestFullscreen({ navigationUI: 'hide' })` + `screen.orientation.lock('landscape')` (kilit desteklenmezse
  sessizce atlanır). Geri hareketi/Esc ile çıkış dinlenir ve düğme eşitlenir.
- **iPhone/iPod Safari:** element tam ekranı yoktur → **sahte tam ekran**: yukarıdaki düzen uygulanır ve eldeki alan en çok açılır. **Safari'nin
  adres çubuğu koddan gizlenemez** (iOS kısıtı); tam ekran için **Paylaş → Ana Ekrana Ekle** ile açılmalıdır. İlk girişte bu ipucu gösterilir.
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
- Parti: minioyunlar XOX, Dörtlü Bağla, Kedi - Köpek (düello) ve Kurbağa (ffa); düello sırasında
  lider devrinde ya da oyuncunun sayfası yenilenince düello baştan başlar (Kurbağa'da ilerleme korunur).
  **Eski önbellekli JS ile açılan sekme yeni `pt_state`'i (`mn.ff`, `lm`) anlamaz: sert yenile** (Ctrl+F5 / sayfayı yeniden yükle), aksi halde Kurbağa turunda
  o sekme takılı görünür. Kurbağa ağ yükü (8 oyuncu ≈ 4 mesaj/sn/oyuncu, herkese yayın) gerçek odada ölçülmedi.
  **Düşen Zemin:** ağ yükü (8 oyuncu × ~8 mesaj/sn, tüm istemcilere; üst sınır ≤ 10 Hz, `DUSENZEMIN_SEND_MS`) ve backend sınırı ölçülmedi; **itme gecikmesi ≈ ağ gecikmesi**
  (kurban kendi üzerine uyguladığı için itici darbeyi hemen görmez); itme kurban yetkili olduğundan hile için açık bir kapıdır (menzil/bekleme kurbanın bildiği akran konumuyla denetlenir ama
  kesin değildir); yıkılış anları istemciler arası birkaç yüz ms kayabilir (out denetiminde pay var); fizik hissi ve joystick gerçek telefonda doğrulanmadı. Tam oyunu tek sayfada iki örnek olarak çalıştırmak mümkün değildir
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
