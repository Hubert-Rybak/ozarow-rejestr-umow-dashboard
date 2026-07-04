# Wydatki gminy Ożarów Mazowiecki — dashboard CRU

Ładny, statyczny dashboard pokazujący umowy/wydatki związane z Ożarowem Mazowieckim pobierane z [Centralnego Rejestru Umów](https://rejestrumow.gov.pl).

## Funkcje

- codzienne pobieranie danych przez GitHub Actions,
- zapis surowych danych do `public/data/agreements.json`,
- dashboard ze statystykami: suma, liczba umów, średnia, największa umowa,
- agregacja per miesiąc i per rok,
- filtrowanie po kategoriach, statusie i tekście,
- sortowanie po kwotach, dacie i nazwie kontrahenta/przedmiotu,
- eksport/hosting jako GitHub Pages.

## Dane i dopasowanie jednostki

Domyślny filtr CRU używa pola `jsfp.gmina = "Ożarów Mazowiecki"`. Możesz go zmienić bez edycji kodu przez zmienną `CRU_FILTER_JSON`, np. dokładny REGON lub nazwa jednostki, gdy CRU zacznie zwracać właściwą jednostkę:

```bash
CRU_FILTER_JSON='{"jsfp":{"gmina":"Ożarów Mazowiecki"}}' npm run fetch
```

Endpoint odkryty z aplikacji CRU: `POST https://rejestrumow.gov.pl/api-dp/v1/agreements/search?offset=0&limit=100`.

## Lokalnie

```bash
npm install
npm run fetch
npm run test
npm run build
npm run dev
```

## GitHub Actions

Workflow `.github/workflows/update-data.yml` uruchamia się codziennie o 05:17 UTC oraz ręcznie (`workflow_dispatch`):

1. instaluje zależności,
2. pobiera dane z CRU,
3. uruchamia testy i build,
4. commituje zmieniony `public/data/agreements.json`,
5. publikuje `dist/` na GitHub Pages.

Po pierwszym pushu włącz Pages w ustawieniach repo: **Settings → Pages → Build and deployment → GitHub Actions**.
