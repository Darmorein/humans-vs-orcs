# Prompt pack — Humans vs Orcs

## Master prompt stylu

Stwórz oryginalny asset do webowej gry RTS 2D w stałym rzucie izometrycznym 2:1. Kierunek: czytelne militarne fantasy połączone z uproszczonym, zwartym urokiem małej dioramy świata; bez kopiowania żadnej konkretnej gry. Styl ręcznie malowany low-detail z delikatnym soft-pixel feel, kompaktowymi bryłami, kontrolowanym nasyceniem i natychmiast czytelną sylwetką. Jedno światło z góry-lewej: jasne górne płaszczyzny, ciemniejsze boki, subtelne ambient occlusion i krótki miękki cień w dół-prawo. Bez fotorealizmu, PBR, mikrodetalu, ciemnego concept-artowego haze, błyszczącego mobile-looku, tekstu, logo i watermarku. Asset w całości widoczny, odseparowany, na prawdziwie przezroczystym tle RGBA.

Frakcje: Humans — jasny kamień, ciepłe drewno, stal, niebieskie tkaniny, uporządkowane formy. Orcs — ciężkie ciemne drewno, czarne żelazo, kość, przygaszona czerwień, zieleń skóry, nieregularne agresywne formy.

## Szablon produkcyjny

> Użyj master promptu. Wygeneruj `[NAZWA]` dla `[GRUPA/FRAKCJA]`. Funkcja gameplayowa: `[FUNKCJA]`. Najważniejszy znak rozpoznawczy: `[SILHOUETTE HOOK]`. Footprint/skala: `[ROZMIAR]`. Orientacja: ta sama co w master frame. Zachowaj wolny margines, prawdziwą przezroczystość i czytelność w `[DOCELOWY ROZMIAR]`.

## Budynki Humans

### Town Hall

Centralny ludzki ratusz 3×3 lub 4×4: jasny kamienny fundament, ciepłe drewniane dobudówki, warstwowe niebieskie dachy, jedna dominująca wieża z proporcem, bardzo czytelne główne wejście. Największy i najbardziej monumentalny budynek frakcji, ale nadal zwarty.

### Barracks

Ludzkie koszary 3×2: prostsza, niższa bryła niż Town Hall; szerokie wejście, stojak z bronią i mała tarcza jako sygnał funkcji. Kamień, drewno, niebieski dach. Militarny, solidny, bez pałacowej dekoracji.

### Farm

Ludzka farma 2×2: mały domek gospodarczy, ogrodzone złote zboże, komin i jedno narzędzie. Szybko rozpoznawalna jako ekonomia/żywność, przyjazna i prosta.

### Watchtower

Smukła wieża obronna 1×1 lub 1×2: kamienna podstawa, drewniany pomost, niebieski daszek i czyste pole obserwacji. Nie może przypominać ratusza.

## Jednostki Humans

### Worker

Mały nieopancerzony robotnik, prosta tunika w beżach i błękicie, duży kilof czytelny w miniaturze, użytkowa postawa i lekko pochylona sylwetka. Bez tarczy i ciężkiego pancerza.

### Swordsman

Zwarta jednostka frontowa: stalowy hełm i napierśnik, duży prosty miecz, mała niebieska tarcza. Stabilna szeroka postawa; miecz i tarcza nie mogą zlewać się z tułowiem.

### Archer

Lekka smukła sylwetka: duży łuk o wyraźnym łuku, kołczan, niebieski kaptur i mało pancerza. Broń dystansowa czytelna natychmiast.

### Mage

Smukły mag wspierający: niebieska szata, krótka laska z kryształem, mała chłodnoniebieska iskra; detal magiczny wyrazisty, ale VFX nie zasłania postaci.

## Budynki Orcs

### Stronghold

Orczy Stronghold 3×3 lub 4×4: dominująca ciężka brama, warstwy ciemnego drewna i czarnego żelaza, czerwony dach/tkaniny, kilka dużych kłów i jedna czaszka jako akcent. Największa bryła frakcji, groźna i stabilna.

### Orc Barracks

Orcze koszary 3×2: niski wojenny warsztat, szerokie wejście, stojaki z toporami/włóczniami, palenisko, żelazne płyty i czerwone płótno. Funkcja bojowa ma być oczywista.

### War Hut

Orcza chata wsparcia 2×2: surowy dach z czerwonej skóry/płótna, skrzynie lub wózek zasobów, małe palenisko, mniej kolców niż koszary. Czytelna jako ekonomia/support.

### Spike Tower

Smukła drewniana wieża obronna 1×1 lub 1×2: wysoki pomost, czarne żelazne obejmy, czerwony proporzec i kilka dużych kolców. Prosty obrys, nie mini-Stronghold.

## Jednostki Orcs

### Grunt

Bardzo szeroki, ciężki wojownik, duże ramiona, powiększony tasak, czerwono-czarny naramiennik i niski środek ciężkości. Wyraźnie masywniejszy od ludzkiego Swordsmena.

### Spear Orc

Smuklejszy od Grunta, długa włócznia prowadzona po przekątnej, lżejszy pancerz i czytelna postawa dystansowa/skirmisher. Brutalny, ale szybki.

### Shaman

Orczy szaman: kościana laska, asymetryczne czerwone skóry, jeden mały zielony efekt magiczny i rytualne akcenty. Magia nie może zasłaniać sylwetki.

### Peon

Mniejszy robotnik z prostą siekierą i pakunkiem drewna/kamienia; mało pancerza, pochylona użytkowa postawa, nadal czytelna orcza masa twarzy i dłoni.

## Teren

Generuj osobno na wspólnym footprintcie 2:1: grass, dirt, path straight, corner, T-junction, cross, rocks, deciduous tree, pine, stump, gold deposit, water, straight shore, inner shore corner, outer shore corner, bush, flowers, pebbles i battlefield remains. Szwy kafli muszą łączyć się bez widocznych zmian skali i światła.

## UI i VFX

Ikony: jeden symbol, czytelny w 24–48 px, ograniczona liczba płaszczyzn, bez tekstu. Zestaw: food, lumber, gold, population, attack, armor, speed, build, gather, select, enemy alert, crossed swords. VFX: hit spark, impact flash, dust, heal, magic, damage slash, arrow, death wisp; każdy krótki i mniejszy niż sylwetka standardowej jednostki.

## Szablon animacji

> Wygeneruj poziomy sprite sheet jednostki `[NAZWA]` w tym samym stałym rzucie izometrycznym i tej samej skali co obraz referencyjny. Stan `[IDLE/WALK/ATTACK/HIT/DEATH/GATHER/BUILD]`, `[LICZBA]` równych klatek, stały pivot stóp, identyczne proporcje i kolory w każdej klatce, prawdziwa przezroczystość. Ruch z lekkim bounce, krótkim anticipation i czytelnym impactem; bez przesuwania kamery, zmiany stroju, morphingu broni i dodatkowych kończyn.

## Negatywny prompt wspólny

Photorealism, realistic PBR, cinematic fog, dark horror, gore, glossy mobile rendering, chibi comedy, full retro pixel art, noisy textures, micro-detail, inconsistent camera, inconsistent light, floating feet, cropped weapon, merged limbs, unreadable silhouette, text, labels, logos, watermark, painted checkerboard background, copied copyrighted design.

