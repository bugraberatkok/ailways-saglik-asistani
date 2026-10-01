# Reklam videoları: Gemini brief'i

PDF'teki adımlar:
1. Aşağıdaki **"Gemini'ye yapıştırılacak metin"** bölümünü Gemini'ye ver; 10 senaryo ve 10 Grok prompt'u alırsın.
2. Prompt'ları **Grok "Hayal Et"** (video) içinde kullanıp her biri için 6–7 saniyelik bir video üret.
3. Videoları `marketing/videos/ad-01.mp4 … ad-10.mp4` olarak kaydet (teslim: 10 adet MP4).

---

## Gemini'ye yapıştırılacak metin

```text
Geliştirdiğim bu sağlık asistanı için 6-7 saniyelik, çarpıcı 10 farklı reklam videosu senaryosu ve her biri için Grok'ta video üretmeye uygun bir görsel/video oluşturma promptu yaz.

ÜRÜN
Adı: Şifa (Ailways Sağlık Asistanı)
Ne: Telefonda/bilgisayarda sohbet eden, yapay zeka destekli bir sağlık asistanı.
Slogan önerisi istiyorum; örnek yön: "Seni tanıyan sağlık asistanı."

ÖNE ÇIKAN ÖZELLİKLER (her videoda bir tanesine odaklan)
1. Seni tanır: yaşını, kronik hastalıklarını, kullandığın ilaçları hatırlar; her seferinde baştan anlatmazsın.
2. Şikayetini dinler, geçmişini dikkate alarak ön değerlendirme yapar ve hangi bölüme gitmen gerektiğini söyler.
3. Randevunu ayarlar: "Yarın öğleden sonra boş var mı?" dersin, uygun saatleri sunar, tek dokunuşla randevu alır.
4. Randevudan sonra yalnız bırakmaz: evde uygulanabilecek basit öneriler verir, "Şu an nasıl hissediyorsun?" diye sorar.
5. Sadece bir bot değil, bir arkadaş: canın sıkkınken dinler, yargılamaz, destek olur.
6. Acil durumda hiç beklemez: tehlikeli bir belirtiyi fark eder ve hemen 112'yi aramanı söyler.
7. Gece yarısı da, bayramda da açık; sıra yok, bekleme yok.

HEDEF KİTLE
Kronik hastalığı olan yetişkinler ve yaşlılar, onların yakınları, yoğun çalışan gençler.

TON
Sıcak, güven veren, sade. Korku pazarlaması yok. Gerçek hayattan küçük anlar (mutfakta, otobüste, gece yatakta, parkta).

KURALLAR (çok önemli; bunlara uymayan senaryo yazma)
- Şifa doktor değildir: "teşhis koyar", "tedavi eder", "iyileştirir", "doktora gerek kalmaz" gibi iddialar YOK.
- İlaç adı, doz veya tedavi önerisi gösterme.
- "%100 doğru", "garantili" gibi kesinlik iddiaları YOK.
- Acil durum sahnelerinde mesaj: "hemen 112'yi ara"; asistan acil müdahalenin yerine geçmez.
- Gerçek bir marka, hastane veya ünlü kullanma; Türkçe metinler kısa olsun (ekranda en fazla 6-8 kelime).
- Sağlık verisi gerçekmiş gibi gösterme; ekrandaki isimler kurgusal olsun.

HER SENARYO İÇİN ŞU BİÇİMDE YAZ
- Başlık
- Odaklandığı özellik (yukarıdaki listeden numara)
- Sahne akışı (0-2 sn / 2-5 sn / 5-7 sn)
- Ekrandaki metin (Türkçe, kısa)
- Kapanış sloganı
- Grok promptu (İngilizce, tek paragraf, 6-7 saniyelik dikey 9:16 video; ışık, kamera hareketi, ortam, karakter, duygu; ekranda yazı yerine görsel anlatım; logo ve gerçek marka yok)

10 senaryo birbirinden farklı olsun: farklı karakterler (yaşlı, genç, ebeveyn, öğrenci), farklı mekanlar ve farklı özellikler.
```

---

## Sunum için hatırlatma
- Videolar ürünün **gerçek davranışını** yansıtmalı. Yukarıdaki özelliklerin hepsi sistemde çalışıyor ve testli.
- Grok çıktısında ekranda bozuk/anlamsız yazı çıkarsa prompt'a `no on-screen text` ekleyip yeniden üret; Türkçe metni videonun üstüne sonradan eklemek daha temiz olur.
- Bir videoda "tanı", "tedavi" veya ilaç izlenimi oluşuyorsa o videoyu yeniden üret; sunumda bu sorulabilir.
