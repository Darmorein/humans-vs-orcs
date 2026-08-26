# Humans vs Orcs — isometric RTS art kit

Komplet startowy do webowej gry RTS 2D. Kierunek jest oryginalny: czytelne militarne fantasy, zwarta makietowa forma i miękkie, ręcznie malowane uproszczenie — bez kopiowania konkretnej gry.

## Zawartość

- `boards/` — 6 plansz: master frame, teren, Humans, Orcs, UI/VFX i zbiorczy przegląd assetów.
- `assets/terrain/` — 20 osobnych PNG.
- `assets/humans/` — 4 budynki i 4 jednostki.
- `assets/orcs/` — 4 budynki i 4 jednostki.
- `assets/ui/` — 12 ikon.
- `assets/vfx/` — 8 lekkich efektów.
- `STYLE-GUIDE.md` — reguły kamery, światła, koloru, skali i eksportu.
- `PROMPT-PACK.md` — master prompt oraz prompty produkcyjne asset-by-asset.
- `manifest.json` — lista assetów i sugerowane parametry integracji.
- `SOURCE-BRIEF.md` — oryginalne wytyczne wejściowe.

Łącznie: 56 osobnych PNG assetów + 6 plansz referencyjnych.

## Szybki start

1. Przyjmij `boards/00-master-style-frame.png` jako wizualny punkt odniesienia.
2. W prototypie użyj osobnych plików z `assets/`.
3. Dla kolejnych wariantów używaj promptów z `PROMPT-PACK.md` razem z master frame jako obrazem referencyjnym.
4. Przed produkcją zamroź docelowy rozmiar kafla i pivoty; proponowany start to diamond 128×64 px.
5. Jednostki animuj w siedmiu stanach: idle, walk, attack, hit, death, gather, build.

## Ważne

To jest spójny concept/prototype kit, nie finalny atlas silnikowy. Przed wysyłką do gry warto ręcznie wyrównać pivoty, ujednolicić footprinty, przeskalować sprite'y do docelowej rozdzielczości i przetestować czytelność przy zoomie 100%, 75% i 50%.
