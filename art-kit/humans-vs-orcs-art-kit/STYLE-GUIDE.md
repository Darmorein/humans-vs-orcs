# Style guide — Humans vs Orcs

## North star

Świat ma wyglądać jak mała, ręcznie zbudowana diorama fantasy: łatwa do odczytania jak RTS, zwarta jak plansza i przyjazna bez popadania w dziecięcość. W razie konfliktu estetyki z gameplayem wygrywa czytelność.

## Kamera i geometria

- Rzut: stałe izometryczne 2:1.
- Proponowany kafel bazowy: 128×64 px; wersja robocza high-res: 256×128 px.
- Światło: zawsze z góry-lewej.
- Górne płaszczyzny są jaśniejsze, prawe/dolne boki ciemniejsze.
- Cienie krótkie, miękkie i skierowane w dół-prawo.
- Jednostki mają stać na wspólnej linii stóp; budynki mają pivot przy środku dolnej krawędzi footprintu.

## Język formy

| Grupa | Kształt | Materiały | Akcent |
| --- | --- | --- | --- |
| Humans | uporządkowany, prosty, solidny | jasny kamień, ciepłe drewno, stal | niebieski i kość słoniowa |
| Orcs | ciężki, nieregularny, agresywny | ciemne drewno, czarne żelazo, kość | przygaszona czerwień i zieleń |
| Teren | miękkie, modułowe bryły | sugerowane tekstury, mało szumu | naturalne, lekko podbite barwy |
| UI/VFX | pojedynczy czytelny symbol | uproszczony metal/drewno/magia | wysoki kontrast funkcjonalny |

## Paleta startowa

Kolory są punktami startowymi, nie twardym profilem druku.

| Rola | HEX |
| --- | --- |
| Grass mid | `#82913B` |
| Grass shadow | `#4F632E` |
| Warm earth | `#A97843` |
| Path highlight | `#C69B62` |
| Cool rock | `#737A78` |
| Water | `#159AA3` |
| Gold | `#F4B51E` |
| Human blue | `#1E4F9A` |
| Human ivory | `#D7CFB7` |
| Human steel | `#7E8992` |
| Orc red | `#A33425` |
| Orc green | `#55742E` |
| Orc iron | `#33383A` |
| Bone | `#D4B77E` |

## Skala i czytelność

- Worker/Archer: około 0,75 wysokości Swordsmena.
- Swordsman: jednostka odniesienia 1,0.
- Grunt: 1,15–1,25 masy wizualnej Swordsmena.
- Broń może być powiększona o 15–30%, jeśli poprawia rozpoznawalność.
- Town Hall i Stronghold: 3×3 lub 4×4 kafle.
- Barracks: 3×2 albo 3×3 kafle.
- Farm/War Hut: 2×2 kafle.
- Tower: 1×1 lub 1×2 kafle.

## Detal i materiały

- Najpierw sylwetka, potem duże podziały koloru, na końcu 2–4 detale funkcyjne.
- Tekstura nie może tworzyć drobnego szumu przy zmniejszeniu.
- Metal dostaje jeden jasny highlight; drewno 2–3 szerokie smugi; kamień duże nieregularne bloki.
- Krawędzie są miękkie i malarskie, ale nie rozmyte.

## Animacja

| Stan | Klatki startowe | Zasada |
| --- | ---: | --- |
| idle | 4–6 | lekki oddech/bounce |
| walk | 6–8 | mocny kontakt stopy, czytelna broń |
| attack | 6–8 | wyraźny anticipation, impact i follow-through |
| hit | 3–4 | szybki snap, bez przesadnego odrzutu |
| death | 6–10 | prosta, czytelna sylwetka końcowa |
| gather | 6–8 | narzędzie prowadzi ruch |
| build | 6–8 | młot/narzędzie z czytelnym momentem kontaktu |

## UI i VFX

- Ikony muszą działać w 24, 32 i 48 px.
- Ramka jest opcjonalna; symbol musi działać bez niej.
- Zaznaczenie gracza: niebiesko-cyjanowy pierścień.
- Ostrzeżenie wroga: czerwień, ale bez dużych zasłon ekranu.
- VFX mają być krótsze i mniejsze niż sylwetka jednostki, z wyjątkiem efektów ultimate/boss.

## Kontrola jakości

Każdy nowy asset przechodzi test: ten sam kąt, to samo światło, zgodny detal, odczyt funkcji w 1 sekundę, poprawna frakcja, czytelność w 50% skali i brak kolizji sylwetki z podłożem.

