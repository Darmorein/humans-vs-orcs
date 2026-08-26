# Wytyczne stylu graficznego

Chcemy stworzyć **izometryczny styl graficzny 2D** do webowej gry RTS **Humans vs Orcs**, który daje wrażenie czegoś **pomiędzy klasycznym Warcraftowym fantasy RTS a WorldBoxem**.

To nie ma być kopia żadnej istniejącej gry. Styl ma być **inspirowany**:

- czytelnością i militarnym fantasy RTS,
- prostotą, urokiem i modularnością świata budowanego z małych elementów,
- lekkim, przyjaznym, lekko kreskówkowym charakterem.

## 1. Główne założenia stylu

Styl powinien być:

- **izometryczny**
- **2D**
- **czytelny w małej skali**
- **lekko stylizowany**
- **kolorowy, ale nie krzykliwy**
- **fantasy**
- **łatwy do produkcji i rozszerzania**
- **dobry do renderowania w przeglądarce**

Najważniejsze cele wizualne:

1. gracz ma od razu rozpoznawać:
   - teren,
   - jednostki,
   - budynki,
   - surowce,
   - frakcje;
2. styl ma być spójny i prosty do rozwijania o nowe assety;
3. grafika ma wyglądać dobrze zarówno z bliska, jak i przy standardowym oddaleniu kamery.

---

## 2. Charakter wizualny

## Ogólny kierunek

Grafika powinna łączyć:

- **czytelność klasycznych RTS-ów fantasy**
- **uproszczone, kompaktowe formy**
- **miękką, przyjemną stylizację**
- **lekko zabawkowy / makietowy charakter świata**
- **małe, zwarte bryły i wyraźne kontury form**

Świat ma przypominać:

- ręcznie zbudowaną planszę fantasy,
- małe izometryczne dioramy,
- estetyczny, uproszczony battlefield.

## Ton

- bardziej **przygodowy** niż mroczny,
- bardziej **czytelny i grywalny** niż realistyczny,
- bardziej **uroczy i zwarty** niż brutalny.

---

## 3. Kamera i perspektywa

- widok **izometryczny 2D**
- stały kąt kamery
- brak pełnego 3D
- jednostki i budynki projektowane pod tę jedną perspektywę

Rekomendacja:

- klasyczny rzut izometryczny z lekko podniesioną kamerą,
- teren i obiekty czytelne z jednego ujęcia,
- wszystkie assety przygotowane z myślą o tej samej orientacji światła i kącie widzenia.

---

## 4. Kształty i sylwetki

## Form language

### Humans

- bardziej uporządkowane kształty,
- prostsze bryły,
- czytelne dachy, wieże, drewniano-kamienne konstrukcje,
- kolory bardziej cywilizowane: błękity, stal, beże, brązy.

### Orcs

- bardziej ciężkie, agresywne sylwetki,
- ciemniejsze drewno, kolce, surowa konstrukcja,
- większa masa wizualna,
- kolory: czerwienie, ciemne brązy, zielenie, kość, żelazo.

### Jednostki

- małe, ale z bardzo czytelną sylwetką,
- wyraźnie rozróżnialna broń,
- przesadzone proporcje tam, gdzie pomaga to w czytelności:
  - większy miecz,
  - większy łuk,
  - większy hełm,
  - większe ramiona u orków.

---

## 5. Pixel density i poziom detalu

Styl powinien być **pomiędzy pixel-artem a stylizowaną ilustracją low-detail**.

To znaczy:

- assety nie powinny być ultra-detaliczne,
- detale mają być selektywne,
- tekstury raczej sugerowane niż realistyczne,
- ważniejsza jest bryła, kolor i kontrast niż drobiazgowość.

Rekomendacja:

- średni poziom detalu,
- miękkie, ręcznie malowane uproszczenie,
- bez fotograficznych tekstur,
- bez realizmu materiałowego.

---

## 6. Kolorystyka

## Ogólna paleta

Paleta powinna być:

- ciepła,
- nasycona umiarkowanie,
- czytelna,
- fantasy,
- naturalna, ale lekko podbita.

### Teren

- trawa: średnia zieleń, lekko ciepła
- ziemia: ciepłe brązy
- skały: chłodne szarości
- woda: nasycony niebieski / turkus
- lasy: ciemniejsza zieleń z wyraźnymi highlightami

### Humans

- niebieski, biały, stalowy, złamane beże, drewno, szarości

### Orcs

- czerwony, ciemnozielony, brunatny, kościany, czarne żelazo

### Surowce

- złoto powinno być jasne, kontrastowe i od razu rozpoznawalne

---

## 7. Światło i shading

Światło powinno być:

- proste,
- spójne,
- czytelne.

Rekomendacje:

- jedno główne źródło światła,
- delikatny highlight na górnych płaszczyznach,
- ciemniejsze boki,
- lekki ambient occlusion pod budynkami i jednostkami,
- miękkie, krótkie cienie.

Nie idziemy w:

- realistyczny PBR,
- skomplikowane odbicia,
- dramatyczne filmowe oświetlenie.

---

## 8. Teren i tile-set

Teren powinien być modułowy i łatwy do składania.

Potrzebne typy kafli / elementów:

- trawa
- ziemia
- ścieżka
- skały
- drzewa
- pieńki
- złoża złota
- woda / brzeg wody
- delikatne dekoracje:
  - krzaki
  - kwiaty
  - kamienie
  - czaszki / resztki pola bitwy opcjonalnie

Teren ma być:

- czytelny,
- lekko dekoracyjny,
- nieprzeładowany.

---

## 9. Budynki

Budynki muszą być:

- zwarte,
- wyraźne,
- łatwe do odróżnienia po funkcji,
- łatwe do odróżnienia po frakcji.

## Humans

Przykładowe cechy:

- kamienne fundamenty,
- drewniane ściany,
- niebieskie dachy,
- proporcje „solidne, ale przyjazne”,
- wyraźne wejście,
- lekko bajkowy charakter.

### Town Hall

- centralny, największy,
- ważny wizualnie,
- bardziej monumentalny niż pozostałe budynki.

### Barracks

- militarny charakter,
- czytelne elementy wojskowe,
- prostsza bryła niż Town Hall.

### Farm

- mała,
- prosta,
- szybko rozpoznawalna,
- bardziej ekonomiczna niż bojowa.

## Orcs

Przykładowe cechy:

- ciężkie drewno,
- palisady,
- kości,
- kolce,
- surowy, brutalny wygląd.

### Orc Stronghold

- największa orcza konstrukcja,
- ciężka, dominująca,
- wygląda groźnie.

### Orc Barracks

- bardziej bojowy, agresywny kształt,
- wizualnie „warsztat wojenny”.

---

## 10. Jednostki

Jednostki muszą być czytelne w ruchu i z dystansu.

## Humans

### Worker

- mały,
- prosty,
- narzędzie w ręku,
- mniej opancerzony,
- sylwetka pokojowo-użytkowa.

### Swordsman

- zwarta sylwetka,
- wyraźny miecz,
- średni pancerz,
- prosty hełm lub tarcza.

### Archer

- lekka sylwetka,
- duży łuk,
- czytelna pozycja dystansowa,
- mniej pancerza.

## Orcs

### Grunt

- szeroka, ciężka sylwetka,
- duża broń melee,
- bardziej masywny od ludzkiego Swordsmana.

### Spear Orc

- smuklejszy od Grunta,
- wyraźna włócznia / broń dystansowa,
- nadal brutalny i surowy.

---

## 11. Animacja

Animacje powinny być:

- krótkie,
- czytelne,
- lekko przesadzone.

Potrzebne podstawowe stany:

- idle
- walk
- attack
- hit
- death
- gather
- build

Zasada:

- lepiej mniej klatek, ale czytelnych,
- niż dużo klatek o mało wyraźnym ruchu.

Ruch ma mieć:

- lekki bounce,
- prosty follow-through,
- wyraźny moment uderzenia.

---

## 12. Efekty i feedback

Efekty powinny być lekkie i stylizowane.

Przykłady:

- mały błysk przy trafieniu,
- prosta strzała / pocisk dla łucznika,
- krótkie liczby damage,
- subtelny pył przy ruchu,
- mały efekt zanikania przy śmierci,
- wyraźne zaznaczenie wybranych jednostek.

Nie przesadzamy z VFX.

---

## 13. UI w zgodzie ze stylem

UI powinno wspierać klimat fantasy RTS, ale być uproszczone.

Cechy:

- czytelne ramki,
- lekko drewniano-kamienne lub parchment-fantasy akcenty,
- proste ikony,
- wysoki kontrast,
- mało ozdobników.

UI nie powinno konkurować z mapą.

---

## 14. Zasady spójności

Każdy asset musi spełniać te same zasady:

1. ten sam kąt izometrii,
2. to samo źródło światła,
3. podobny poziom stylizacji,
4. podobny poziom detalu,
5. czytelna funkcja gameplayowa,
6. wyraźne rozróżnienie frakcji.

Jeśli jakiś element jest ładny, ale mniej czytelny w grze, wybieramy **czytelność**.

---

## 15. Czego unikać

Nie chcemy:

- realizmu,
- zbyt ciemnej, ponurej palety,
- zbyt małych i nieczytelnych jednostek,
- przesadnie szczegółowych tekstur,
- pełnego pixel-artu retro 1:1,
- nowoczesnego, gładkiego mobile-looku,
- generycznego high-fantasy concept artu,
- przesadnie śmiesznego stylu,
- zbyt „dziecięcego” wyglądu.

Styl ma być:

- prosty,
- uroczy,
- strategiczny,
- fantasy,
- grywalny.

---

# Wzór promptu

Poniżej wzór promptu, którego można używać do generowania assetów lub do kierowania AI / grafika.

## Uniwersalny wzór

Stwórz asset do webowej gry RTS 2D w stylu izometrycznym fantasy.
Styl ma być inspirowany klasycznymi RTS-ami fantasy oraz prostotą i urokiem małych symulatorów świata, ale bez kopiowania konkretnych gier.
Kierunek wizualny: coś pomiędzy czytelnym klasycznym fantasy RTS a uproszczonym, zwartym, uroczym światem zbudowanym z małych brył.

Wymagania stylu:

- izometryczny widok 2D,
- czytelna sylwetka,
- lekko stylizowany, pół-cartoony charakter,
- umiarkowany detal,
- ręcznie malowany low-detail / soft pixel feel,
- wyraźny podział na światło i cień,
- krótki, miękki cień pod obiektem,
- kolorowa, ale kontrolowana paleta,
- bardzo dobra czytelność w grze RTS,
- spójność z fantasy Humans vs Orcs.

Frakcje:

- Humans: drewno, kamień, niebieskie akcenty, bardziej uporządkowany design,
- Orcs: ciężkie drewno, kolce, kości, czerwono-zielone akcenty, bardziej brutalny design.

Unikaj:

- fotorealizmu,
- przesadnego detalu,
- zbyt ciemnej palety,
- nowoczesnego mobilowego połysku,
- kopiowania konkretnych assetów z istniejących gier.

---

## Wzór promptu dla budynku

Stwórz izometryczny asset 2D przedstawiający **[NAZWA BUDYNKU]** dla frakcji **[Humans / Orcs]** do webowej gry RTS fantasy.
Styl: pomiędzy klasycznym fantasy RTS a uproszczonym, uroczym world-simulatorem.
Budowla ma być mała, zwarta, czytelna i dobrze rozpoznawalna z oddalenia.
Zachowaj spójny rzut izometryczny, uproszczone bryły, umiarkowany detal, czytelne materiały i wyraźną funkcję gameplayową.
Dla Humans użyj drewna, kamienia i niebieskich akcentów. Dla Orcs użyj ciemnego drewna, kolców, kości i agresywniejszych kształtów.
Dodaj subtelny cień pod budynkiem. Tło neutralne lub transparentne.

---

## Wzór promptu dla jednostki

Stwórz izometryczny asset 2D przedstawiający jednostkę **[NAZWA JEDNOSTKI]** dla frakcji **[Humans / Orcs]** do webowej gry RTS fantasy.
Styl: coś pomiędzy klasycznym fantasy RTS a uproszczonym, zwartym, uroczym world-simulatorem.
Jednostka ma mieć bardzo czytelną sylwetkę, lekko przesadzone proporcje broni lub ekwipunku oraz wyraźne odróżnienie od innych klas.
Forma ma być prosta, zwarta, lekko kreskówkowa, ale nadal strategiczna i bojowa.
Użyj spójnego światła, umiarkowanego detalu i kolorystyki zgodnej z frakcją.
Dodaj subtelny cień pod postacią. Tło neutralne lub transparentne.

---

## Wzór promptu dla tile-setu terenu

Stwórz zestaw izometrycznych assetów 2D terenu do webowej gry RTS fantasy.
Styl: pomiędzy klasycznym fantasy RTS a uproszczonym, uroczym world-simulatorem.
Przygotuj spójne wizualnie kafle i dekoracje:

- trawa,
- ziemia,
- ścieżka,
- skały,
- drzewa,
- złoża złota,
- woda i brzegi wody.

Wszystkie elementy mają być:

- czytelne,
- kolorowe, ale nieprzesadzone,
- modularne,
- spójne izometrycznie,
- umiarkowanie detaliczne,
- łatwe do wykorzystania w RTS.

---

## Krótki prompt zbiorczy

Zaprojektuj styl graficzny dla izometrycznej gry RTS 2D Humans vs Orcs działającej w przeglądarce.
Kierunek wizualny: stylizowane fantasy, coś pomiędzy klasycznym Warcraftowym RTS-em a uproszczonym urokiem WorldBoxa, ale bez kopiowania istniejących gier.
Grafika ma być czytelna, zwarta, kolorowa, modularna i łatwa do rozwijania.
Świat powinien wyglądać jak mała fantasy diorama: uproszczone bryły, wyraźne sylwetki, miękkie cieniowanie, umiarkowany detal, lekko zabawkowy charakter i bardzo dobra czytelność gameplayowa.

# Rekomendacja praktyczna

Najlepiej dalej pracować w tej kolejności:

1. ustalić **1 master prompt stylu**,
2. przygotować **1 moodboard kierunku**,
3. wygenerować kolejno:
   - terrain,
   - buildings Humans,
   - buildings Orcs,
   - units Humans,
   - units Orcs,
   - UI icons,
4. po pierwszej paczce doprecyzować:
   - poziom detalu,
   - nasycenie kolorów,
   - stopień „uroku” vs „surowości”,
   - proporcje jednostek.

Jeśli chcesz, w następnym kroku mogę od razu zrobić:
**1 master prompt stylu**,
albo
**pełny zestaw promptów asset-by-asset** dla:

- Town Hall
- Barracks
- Farm
- Worker
- Swordsman
- Archer
- Orc Stronghold
- Grunt
- Spear Orc.