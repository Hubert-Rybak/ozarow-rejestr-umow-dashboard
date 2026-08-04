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

Endpoint używany przez oficjalną aplikację CRU:

- wyszukiwanie: `POST https://rejestrumow.gov.pl/api-dp/v1/agreements/search?offset=0&limit=50`,
- szczegóły umowy: `GET https://rejestrumow.gov.pl/api-dp/v1/agreement/{idUmowy}`.

Odpowiedź wyszukiwania zawiera `content`, `totalElements`, `totalMatchingElements`, `offset` i `limit`. CRU ogranicza pojedynczą stronę do 50 rekordów także wtedy, gdy klient zażąda większej liczby. Fetcher przesuwa więc `offset` o rzeczywistą długość zwróconej strony i kończy dopiero po pobraniu dokładnie `totalMatchingElements`; odrzuca zmienne liczniki, błędne offsety, duplikaty i niepełne strony. Szczegóły są pobierane sekwencyjnie z odstępem; przejściowe `429`, wybrane `5xx`, błędy sieci i przerwane odpowiedzi są ponawiane z ograniczonym exponential backoff.

### Konfiguracja fetchera

| Zmienna | Domyślnie | Dozwolone wartości |
|---|---:|---|
| `CRU_FILTER_JSON` | filtr gminy Ożarów Mazowiecki | poprawny obiekt JSON zgodny z filtrem CRU |
| `CRU_PAGE_SIZE` | `50` | liczba całkowita `1–50` |
| `CRU_DETAIL_DELAY_MS` | `500` | liczba całkowita `0–2147483647` ms |
| `CRU_RETRY_ATTEMPTS` | `7` | liczba całkowita `1–10` |
| `CRU_RETRY_BASE_DELAY_MS` | `2000` | liczba całkowita `0–2147483647` ms |
| `CRU_RETRY_MAX_DELAY_MS` | `60000` | liczba całkowita `0–2147483647` ms |
| `CRU_REQUEST_TIMEOUT_MS` | `30000` | liczba całkowita `0–2147483647` ms; `0` wyłącza timeout |

Wartości spoza zakresu przerywają aktualizację przed opublikowaniem danych.

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
