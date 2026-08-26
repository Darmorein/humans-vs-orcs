# Humans vs Orcs — Living World Art Kit v2

Dokumentacja konwersji wizualnej obecnego zestawu gry do kierunku Living World.
Znormalizowane grafiki wykorzystywane przez grę znajdują się w `public/assets`.
Pełne plansze i master PNG pozostają w osobnej, pobieralnej paczce produkcyjnej,
aby nie dublować dużych plików binarnych w historii repozytorium.

## Zawartość

- 56 podmienionych PNG zgodnych z istniejącymi ścieżkami `public/assets`;
- 8 nowych assetów świata: wzgórze, most, fundament posterunku, posterunki obu
  frakcji, wóz, płot i stragan;
- 64 wpisy w runtime Manifest v2;
- mapa integracji z repozytorium;
- style guide;
- kontrakt i kolejka produkcji animacji dla wszystkich 8 jednostek;
- prompty do dalszego rozwijania zestawu.

Wszystkie wycięte assety mają prawdziwy kanał alfa. Grafiki są celowo oznaczone
jako `prototype-generated`: nadają się do przeglądu w grze i dalszej obróbki,
ale nie udają ręcznie dopracowanych finalnych atlasów produkcyjnych.

## Stan integracji w repozytorium

- 56 grafik zastąpiło odpowiadające im pliki w `public/assets`;
- wszystkie 64 pozycje są zarejestrowane w Manifest v2;
- nowe grafiki posterunków są używane przez budynki `Outpost`;
- wzgórza i mosty korzystają z nowych assetów świata;
- fundament posterunku, wóz, płot i stragan są zarejestrowane jako prototypowe
  zasoby następnego etapu, ale nie są jeszcze automatycznie rozmieszczane.
- runtime korzysta z wersji znormalizowanych do dotychczasowej wysokości
  ekranowej; pełne źródła pozostają w osobnej paczce produkcyjnej.

## Najważniejsze katalogi

```text
public/assets/humans/   budynki i jednostki Humans
public/assets/orcs/     budynki i jednostki Orcs
public/assets/terrain/  teren, drogi, brzegi, zasoby i dekoracje
public/assets/world/    nowe elementy ekspansji i posterunków
public/assets/ui/       12 ikon interfejsu
public/assets/vfx/      8 efektów
```

## Zalecana kolejność wdrożenia

1. Sprawdzić skalę przy 100%, 75% i 50% zoomu.
2. Skorygować pivoty Manifestu v2 na rzeczywistym ekranie gry.
3. Zatwierdzić jedną jednostkę — Human Swordsman — jako wzorzec animacji.
4. Dopiero potem produkować pozostałe atlasy według `ANIMATION-PRODUCTION.md`.

Grafiki wygenerowano przy użyciu wbudowanego generatora obrazów, a kanały alfa
i kompletność plików zweryfikowano narzędziowo.
