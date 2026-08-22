# Wydatki gminy Ożarów Mazowiecki — dashboard CRU

Ładny, statyczny dashboard pokazujący umowy/wydatki związane z Ożarowem Mazowieckim pobierane z [Centralnego Rejestru Umów](https://rejestrumow.gov.pl).

## Funkcje

- codzienne pobieranie danych przez GitHub Actions,
- zapis surowych danych do `public/data/agreements.json`,
- codzienna analiza zgodności z prawem (ustawa o CRU, Pzp, dyscyplina finansów publicznych);
  reguły terminowe obejmują tylko umowy zawarte od 1.07.2026, bo od tej daty obowiązuje
  publikacja w CRU (wcześniejsze umowy nie istnieją w rejestrze — potwierdzone API i MF),
- wykrywanie potencjalnych powiązań wykonawców (osób fizycznych/JDG) z osobami pełniącymi
  funkcje publiczne w gminie Ożarów Mazowiecki i powiecie warszawskim zachodnim
  (lista w `src/officials.ts`, źródła: BIP gminy oraz pwz.pl; wymaga odświeżenia po wyborach),
- dodatkowe sprawdzenie KRS przez NIP: Biała Lista VAT (MF) podaje numer KRS, a publiczne
  API KRS (MS) — zanonimizowany skład zarządu i wspólników (`scripts/krs-enrich.mjs`,
  cache 30 dni); maska KRS zachowuje pierwszą literę i długość imienia/nazwiska, co daje
  bardzo selektywne dopasowanie do listy urzędników,
- dashboard ze statystykami: suma, liczba umów, średnia, największa umowa,
- agregacja per miesiąc i per rok,
- filtrowanie po kategoriach, statusie, tekście i wyniku analizy zgodności,
- sortowanie po kwotach, dacie i nazwie kontrahenta/przedmiotu,
- eksport/hosting jako GitHub Pages.

## Analiza zgodności

Każda umowa jest automatycznie oceniana pod kątem wymogów formalnych (`src/compliance.ts`):

| Reguła | Podstawa |
|---|---|
| brak wartości przedmiotu umowy | art. 4 ust. 1 pkt 2 ustawy o CRU |
| publikacja wpisu w CRU później niż 7 dni od zawarcia | art. 4 ust. 2 ustawy o CRU |
| data publikacji wcześniejsza niż data zawarcia | spójność danych rejestru |
| wartość ≥ 170 000 zł (próg stosowania Pzp od 2026) | ustawa Pzp |
| wartość ≥ 930 960 zł (próg unijny 216 000 €, lata 2026–27) | art. 11 ust. 1 pkt 8 Pzp |
| kumulacja umów poniżej progu u jednego wykonawcy w ~12 miesięcy | art. 6 ust. 1 pkt 3 Pzp (zakaz dzielenia zamówienia) |
| duplikat numeru umowy między wpisami | rzetelność rejestru |
| status „aktywna" po terminie / brak terminu wykonania | art. 4 ust. 1 pkt 3 ustawy o CRU |
| finansowanie środkami zewnętrznymi (kontekst kontroli) | art. 5 u.o.n.d.f.p. |

Analiza uruchamia się **raz dziennie podczas synchronizacji**: `npm run fetch` pobiera dane z CRU, po czym `scripts/analyze-compliance.mjs` przepuszcza je przez te same reguły co aplikacja i zapisuje statyczny `public/data/compliance.json` (commitowany razem z danymi). Dashboard wczytuje gotowy raport; jeśli go nie ma (np. lokalny dev bez fetcha), przelicza reguły w przeglądarce.

Wyniki mają charakter sygnału do weryfikacji, a nie stwierdzenia naruszenia prawa.

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
