# EcoPoint — işləyən prototip (web-tətbiq)

Bu qovluq EcoPoint layihəsinin **funksional prototipidir**: real server, verilənlər bazası (SQLite), istifadəçi hesabları,
QR ilə tanınma, məntəqə (kiosk) simulyatoru, EcoCoin, mükafatlar, bağışlar, reytinq, B2B paneli və admin paneli.

> Fiziki avadanlıq (sensor, çəki, bunker) **simulyasiya olunur**: kiosk ekranı real məntəqənin proqram təminatı kimi işləyir,
> amma tullantını "atmaq" düyməsi sensoru əvəz edir. Real ödəniş və ya real endirim inteqrasiyası yoxdur.

## İşə salmaq

```bash
cd app
npm install
npm start          # http://localhost:3000
```

İlk işə düşəndə baza (`app/data/ecopoint.db`) avtomatik yaranır və konsola həmçinin `app/data/ilk-melumatlar.txt` faylına yazılır:
- **admin parolu** (təsadüfi; öz parolunu vermək üçün `ADMIN_PASSWORD=... npm start`),
- **3 məntəqənin kiosk açarları**.

Demo hesablar (parol `demo1234`): `demo@ecopoint.az` (istifadəçi), `gdu@ecopoint.az` (universitet meneceri), `kafe@ecopoint.az` (mükafat tərəfdaşı).
Demo istifadəçilər olmadan başlamaq üçün: `ECOPOINT_SEED_DEMO=0 npm start` (ilk işə düşməzdən əvvəl).

## Necə sınamaq (2 pəncərə)

1. Telefon/pəncərə 1: `http://localhost:3000` → istifadəçi kimi daxil ol → **QR** səhifəsini aç.
2. Pəncərə 2: admin → **Məntəqələr** → "Kiosk açarı" → "Kiosku aç" (və ya `/kiosk.html#id=1&key=<açar>`).
3. Kioskda kameranı aç və QR-ı göstər (və ya 8 simvollu kodu əl ilə yaz) → material seç → tullantını at.
   Səs effekti, "Təşəkkürlər! +10 EcoCoin qazandınız!" və canlı yeniləmə istifadəçinin telefonunda görünür.
4. Mükafatlar → kupon al → tərəfdaş hesabı (`kafe@...`) ilə **Kuponlar** bölməsində kodu təsdiq et.

## Rollar

| Rol | Nələr edə bilir |
|---|---|
| İstifadəçi | QR, təhvil tarixçəsi, EcoCoin, səviyyə/seriya/nailiyyət, mükafat və kupon, bağış, reytinq, məntəqə doluluğu |
| Təşkilat meneceri | Universitet/şirkət paneli (material statistikası, təkrar emal faizi, CSV), kupon təsdiqi (tərəfdaşlar üçün) |
| Admin | İcmal və maliyyə, məntəqələr (boşaltma, açar), istifadəçilər, mükafatlar, layihələr, təşkilatlar, reklam, tarif parametrləri |

## Qaydalar (Parametrlər bölməsindən dəyişir)

- EcoCoin / əşya: plastik 10, kağız 6, şüşə 8, metal 12.
- Gündəlik ilk təhvil bonusu: `min(seriya, 7) × 2` EcoCoin. Seriya = ardıcıl gün sayı.
- XP = qazanılmış EcoCoin; 6 səviyyə (Yeni başlayan → Eko-lider).
- Bölmə dolduqda (tutum) həmin material qəbul edilmir; admin "boşalt" edəndə material satış tarifi ilə gəlir kimi qeyd olunur.
- Ekoloji təsir (CO₂, ağac ekvivalenti) **təxmini** əmsallarla hesablanır.

## Təhlükəsizlik

Parollar `scrypt` ilə hash olunur; sessiya cookie-si `HttpOnly` + `SameSite=Lax`; bütün yazma sorğuları JSON və eyni-origin tələb edir;
SQL sorğuları parametrlidir; məntəqə açarları yalnız hash kimi saxlanır; giriş/QR/kupon üçün sürət limiti; CSP və digər başlıqlar aktivdir.
İctimai serverə çıxarmazdan əvvəl: HTTPS arxasında işlədin (`COOKIE_SECURE=1`), `ADMIN_PASSWORD` verin, `ECOPOINT_SEED_DEMO=0` istifadə edin.

## Test

```bash
npm test     # 49 API yoxlaması (müvəqqəti baza ilə)
```

## Qeydlər

- Bu tətbiq statik sayt deyil — Node.js server tələb edir (GitHub Pages-də işləməz; Render/Railway/VPS kimi yerdə işlədin).
- Məntəqə koordinatları və demo istifadəçilər nümunəvidir.
