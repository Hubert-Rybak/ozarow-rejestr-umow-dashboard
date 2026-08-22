/**
 * Reguły oceny formalnej umów z Centralnego Rejestru Umów.
 *
 * Moduł jest celowo samowystarczalny (bez importów z aplikacji), dzięki czemu
 * ten sam kod działa:
 *  - w przeglądarce (fallback / natychmiastowa analiza),
 *  - w Node podczas nocnej synchronizacji (`scripts/analyze-compliance.mjs`),
 *    który jest ładowany przez Node jako plik `.ts` przez alias w `package.json`.
 */

/** Progi obowiązujące od 1.01.2026 do 31.12.2027
 *  (obwieszczenie Prezesa Urzędu Zamówień Publicznych z 12.12.2025, M.P. 2025 poz. 1247). */
export const PZP_THRESHOLD = 170_000;
export const EU_THRESHOLD_LOCAL_GOV = 930_960; // 216 000 EUR dla zamawiających poniżej szczebla centralnego
export const CRU_PUBLISH_DEADLINE_DAYS = 7; // art. 4 ust. 2 ustawy o Centralnym Rejestrze Umów

export type ComplianceSeverity = 'error' | 'warning' | 'info';

export type ComplianceFinding = {
  ruleId: string;
  severity: ComplianceSeverity;
  title: string;
  description: string;
};

export type AgreementLike = {
  idUmowy: string;
  dataZawarciaUmowy?: string | null;
  dataZakonczeniaUmowy?: string | null;
  wartoscPrzedmiotuUmowy?: number | null;
  statusUmowy?: string;
  contractors?: Array<{ nazwa?: string | null; imie?: string | null; nazwisko?: string | null }> | null;
  details?: {
    numerUmowy?: string | null;
    dataPublikacji?: string | null;
    finansowanaZeSrodkow?: boolean | null;
  } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SPLIT_WINDOW_DAYS = 365;

const nf = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });

function parsePolishDate(value?: string | null): Date | null {
  if (!value) return null;
  const [day, month, year] = value.split(/[.\-/]/).map(Number);
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function partyName(party?: { nazwa?: string | null; imie?: string | null; nazwisko?: string | null } | null): string {
  if (!party) return '';
  return party.nazwa?.trim()
    || [party.imie, party.nazwisko].filter(Boolean).join(' ').trim()
    || '';
}

function contractValue(a: AgreementLike): number {
  return Number(a.wartoscPrzedmiotuUmowy ?? 0);
}

function isActive(a: AgreementLike): boolean {
  return (a.statusUmowy ?? '').toLowerCase() === 'aktywna';
}

function contractorKey(a: AgreementLike): string {
  const names = (a.contractors ?? []).map(partyName).filter(Boolean);
  return names.join(' | ').toLowerCase();
}

function primaryContractorLabel(a: AgreementLike): string {
  return partyName(a.contractors?.[0]) || 'tego wykonawcy';
}

/** Krótkie etykiety reguł do plakietek w tabeli i podsumowań. */
export const FINDING_LABELS: Record<string, string> = {
  'kwota-nieokreslona': 'Brak kwoty',
  'prog-unijny': 'Próg unijny',
  'prog-pzp': 'Tryb Pzp',
  'mozliwy-podzial': 'Możliwy podział zamówienia',
  'publikacja-opozniona': 'Opóźniona publikacja w CRU',
  'niespojnosc-dat': 'Niespójne daty',
  'status-po-terminie': 'Aktywna po terminie',
  'brak-terminu': 'Brak terminu wykonania',
  'srodki-zewnetrzne': 'Środki zewnętrzne',
  'numer-duplikat': 'Duplikat numeru umowy',
  'powiazanie-osobiste': 'Powiązanie z funkcją publiczną',
};

/** Reguły punktowe sprawdzane indywidualnie dla każdej umowy. */
export function checkAgreement(a: AgreementLike, today = new Date()): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const value = contractValue(a);

  // R1 — wartość przedmiotu umowy (art. 4 ust. 1 pkt 2 ustawy o CRU)
  if (!(value > 0)) {
    findings.push({
      ruleId: 'kwota-nieokreslona',
      severity: 'warning',
      title: 'Brak określonej wartości umowy',
      description:
        'Rejestr nie podaje wartości przedmiotu umowy, mimo że jest to element obowiązkowy wpisu (art. 4 ust. 1 pkt 2 ustawy o CRU). Bez wartości nie można ocenić, jakim trybem powinno być udzielone zamówienie.',
    });
  } else if (value >= EU_THRESHOLD_LOCAL_GOV) {
    // R2 — próg unijny dla zamawiających samorządowych, lata 2026–2027
    findings.push({
      ruleId: 'prog-unijny',
      severity: 'warning',
      title: `Wartość ${nf.format(value)} zł — powyżej progu unijnego`,
      description:
        'Umowa przekracza próg unijny dla dostaw i usług zamawiających poniżej szczebla centralnego (216 000 € = 930 960 zł w latach 2026–2027). Zamówienie musiało zostać udzielone w trybie unijnym Pzp (art. 11 ust. 1 pkt 8 Pzp) i trafić do Dziennika Urzędowego UE — warto zweryfikować ogłoszenie.',
    });
  } else if (value >= PZP_THRESHOLD) {
    // R3 — krajowy próg stosowania Pzp
    findings.push({
      ruleId: 'prog-pzp',
      severity: 'info',
      title: `Wartość ${nf.format(value)} zł — objęta ustawą Pzp`,
      description:
        'Od 1.01.2026 próg stosowania Prawa zamówień publicznych wynosi 170 000 zł. Zobowiązanie tej wielkości co do zasady wymaga udzielenia w trybie Pzp — w CRU nie ma jednak pola z trybem, więc zgodność wymaga ręcznej weryfikacji dokumentacji.',
    });
  }

  // R4 — termin publikacji w CRU (art. 4 ust. 2 ustawy o CRU: 7 dni)
  const published = parsePolishDate(a.details?.dataPublikacji ?? null);
  const concluded = parsePolishDate(a.dataZawarciaUmowy ?? null);
  if (published && concluded) {
    const days = Math.round((published.getTime() - concluded.getTime()) / DAY_MS);
    if (days < 0) {
      findings.push({
        ruleId: 'niespojnosc-dat',
        severity: 'error',
        title: 'Data publikacji wcześniejsza niż data zawarcia',
        description:
          'Wpis zawiera datę publikacji w CRU sprzed daty zawarcia umowy — to błąd danych, który utrudnia kontrolę terminowości opisu (art. 4 ust. 2 ustawy o CRU).',
      });
    } else if (days > CRU_PUBLISH_DEADLINE_DAYS) {
      findings.push({
        ruleId: 'publikacja-opozniona',
        severity: 'warning',
        title: `Opublikowano po ${days} dniach od zawarcia`,
        description:
          'Umowę trzeba opisać w Centralnym Rejestrze Umów nie później niż w ciągu 7 dni od jej zawarcia lub zmiany (art. 4 ust. 2 ustawy o CRU). Opóźnienie może skutkować odpowiedzialnością za naruszenie dyscypliny finansów publicznych.',
      });
    }
  }

  // R5 — spójność statusu z terminem wykonania
  const endDate = parsePolishDate(a.dataZakonczeniaUmowy ?? null);
  if (isActive(a)) {
    if (endDate && endDate.getTime() < today.getTime()) {
      findings.push({
        ruleId: 'status-po-terminie',
        severity: 'warning',
        title: 'Status „aktywna” mimo upływu terminu wykonania',
        description:
          'Umowa jest oznaczona jako aktywna, choć minęła jej data zakończenia. Może to oznaczać brak formalnego rozliczenia, odbioru albo nieaktualizację rejestru — obie sytuacje wymagają wyjaśnienia.',
      });
    } else if (!endDate) {
      findings.push({
        ruleId: 'brak-terminu',
        severity: 'info',
        title: 'Brak terminu zakończenia przy statusie aktywnym',
        description:
          'Rejestr nie podaje daty zakończenia umowy oznaczonej jako aktywna, więc nie można ocenić, czy realizacja mieści się w terminie (art. 4 ust. 1 pkt 3 ustawy o CRU przewiduje taki element wpisu dla umów terminowych).',
      });
    }
  }

  // R6 — finansowanie ze środków zewnętrznych
  if (a.details?.finansowanaZeSrodkow) {
    findings.push({
      ruleId: 'srodki-zewnetrzne',
      severity: 'info',
      title: 'Finansowana ze środków zewnętrznych',
      description:
        'Umowa korzysta ze środków pochodzących spoza budżetu zamawiającego (np. dotacje UE). Rozliczenie takich środków niezgodnie z przeznaczeniem lub ich nieudokumentowanie to odrębne kategorie naruszeń dyscypliny finansów publicznych (art. 5 ust. 1 pkt 5 i 6 u.o.n.d.f.p.).',
    });
  }

  return findings;
}

/**
 * Pełna analiza zbioru umów: reguły punktowe + reguły krzyżowe
 * (duplikaty numerów, kumulacja umów u jednego wykonawcy = możliwy podział zamówienia).
 */
export function analyzeAgreements(agreements: AgreementLike[], today = new Date()): Map<string, ComplianceFinding[]> {
  const result = new Map<string, ComplianceFinding[]>();
  for (const a of agreements) result.set(a.idUmowy, checkAgreement(a, today));

  // RX3 — wykonawcy mogący być powiązani z osobami pełniącymi funkcje publiczne
  for (const [id, findings] of checkConflictsOfInterest(agreements)) {
    result.set(id, [...(result.get(id) ?? []), ...findings]);
  }

  // RX1 — ten sam numer umowy w kilku wpisach (możliwa zdublowana rejestracja zobowiązania)
  const byNumber = new Map<string, AgreementLike[]>();
  for (const a of agreements) {
    const num = a.details?.numerUmowy?.trim();
    if (!num || num.toLowerCase() === 'brak') continue;
    const group = byNumber.get(num) ?? [];
    group.push(a);
    byNumber.set(num, group);
  }
  for (const [num, group] of byNumber) {
    if (group.length < 2) continue;
    for (const a of group) {
      result.get(a.idUmowy)?.push({
        ruleId: 'numer-duplikat',
        severity: 'error',
        title: `Numer umowy ${num} występuje w ${group.length} wpisach`,
        description:
          'Ten sam numer umowy przypisano do odrębnych rekordów rejestru. Możliwe dublowanie tego samego zobowiązania albo błąd ewidencji — oba przypadki zaburzają rzetelność rejestru (art. 4 ust. 1 ustawy o CRU).',
      });
    }
  }

  // RX2 — kumulacja umów poniżej progu u jednego wykonawcy w oknie ~12 miesięcy
  const byContractor = new Map<string, AgreementLike[]>();
  for (const a of agreements) {
    const value = contractValue(a);
    if (!(value > 0) || value >= PZP_THRESHOLD) continue;
    const key = contractorKey(a);
    if (!key) continue;
    const group = byContractor.get(key) ?? [];
    group.push(a);
    byContractor.set(key, group);
  }
  for (const [, group] of byContractor) {
    const dated = group
      .map((a) => ({ a, date: parsePolishDate(a.dataZawarciaUmowy ?? null) }))
      .filter((x): x is { a: AgreementLike; date: Date } => Boolean(x.date))
      .sort((x, y) => x.date.getTime() - y.date.getTime());
    if (dated.length < 2) continue;

    for (let start = 0; start < dated.length - 1; start += 1) {
      let sum = 0;
      let end = start;
      while (end < dated.length && dated[end].date.getTime() - dated[start].date.getTime() <= SPLIT_WINDOW_DAYS * DAY_MS) {
        sum += contractValue(dated[end].a);
        end += 1;
      }
      const count = end - start;
      if (sum >= PZP_THRESHOLD && count > 1) {
        result.get(dated[end - 1].a.idUmowy)?.push({
          ruleId: 'mozliwy-podzial',
          severity: 'warning',
          title: `Możliwy podział zamówienia — ${count} umowy łącznie ${nf.format(Math.round(sum))} zł`,
          description:
            `W ciągu ok. 12 miesięcy zawarto ${count} umowy z wykonawcą ${primaryContractorLabel(dated[end - 1].a)}, każda poniżej progu Pzp, ale łącznie przekraczają ${nf.format(PZP_THRESHOLD)} zł. Dzielenie zamówienia na części w celu uniknięcia trybu ustawowego jest niedopuszczalne, chyba że wynika z obiektywnych przesłanek (art. 6 ust. 1 pkt 3 Pzp).`,
        });
        break;
      }
    }
  }

  return result;
}

/** Wynik analizy w formie gotowej do zapisu jako statyczny JSON. */
export type ComplianceSummary = {
  total: number;
  flagged: number;
  errors: number;
  clean: number;
  byRule: Record<string, number>;
};

export type CompliancePayload = {
  analyzedAt: string;
  thresholds: { pzp: number; euLocalGov: number; cruPublishDeadlineDays: number };
  summary: ComplianceSummary;
  findings: Record<string, ComplianceFinding[]>;
};

export function buildCompliancePayload(agreements: AgreementLike[], now = new Date()): CompliancePayload {
  const analysis = analyzeAgreements(agreements, now);
  const byRule: Record<string, number> = {};
  let flagged = 0;
  let errors = 0;
  const findings: Record<string, ComplianceFinding[]> = {};
  for (const [id, list] of analysis) {
    if (list.length > 0) {
      findings[id] = list;
      flagged += 1;
      if (list.some((f) => f.severity === 'error')) errors += 1;
      for (const finding of list) byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
    }
  }
  return {
    analyzedAt: now.toISOString(),
    thresholds: { pzp: PZP_THRESHOLD, euLocalGov: EU_THRESHOLD_LOCAL_GOV, cruPublishDeadlineDays: CRU_PUBLISH_DEADLINE_DAYS },
    summary: { total: agreements.length, flagged, errors, clean: agreements.length - flagged, byRule },
    findings,
  };
}

export const SEVERITY_ORDER: Record<ComplianceSeverity, number> = { error: 0, warning: 1, info: 2 };

/* ─────────── Analiza powiązań wykonawców z osobami pełniącymi funkcje publiczne ─────────── */

import { OFFICIALS } from './officials.ts';
import type { PublicOfficial } from './officials.ts';

/** Usuwa diakrytyki i sprowadza do małych liter (porównywanie nazwisk). */
function foldName(value: string): string {
  return value
    .toLowerCase()
    // eslint-disable-next-line no-control-regex
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

/**
 * Wyciąga osobę fizyczna z wpisu strony umowy:
 *  - pola imie/nazwisko (CRU podaje je wprost dla osób fizycznych),
 *  - nazwa typu „Jan Kowalski \"Firma\"" lub „Jan Kowalski" (JDG często zapisywana tak w CRU).
 * Zwraca null, gdy wpis wygląda wyłącznie na spółkę/institucję.
 */
export function extractPerson(party: {
  nazwa?: string | null;
  imie?: string | null;
  nazwisko?: string | null;
}): { firstName?: string; lastName: string } | null {
  if (party.nazwisko && party.nazwisko.trim()) {
    return { firstName: party.imie?.trim() || undefined, lastName: party.nazwisko.trim() };
  }
  const name = (party.nazwa ?? '').trim();
  if (!name) return null;
  const m = /^"?([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{1,20})\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{2,20})(?:\b|")/.exec(name);
  if (!m) return null;
  const corporate = /sp[óo]łka|s\.?\s?a\.?\.?|z\s*o\.?\s?o\.?|s\.?\s?a\.?\s?j\.?|sp[jj]|inwestycje|holdings?|grupa|firma|usługi|serwis|budownictwo|deweloper|technik|systemy|trade|group|biuro|przedsiębiorstwo|zakład|studio|pracownia|agencja|kancelaria|fundacja|stowarzyszenie|instytut|centrum|ośrodek/i;
  // Filtr korporacyjny stosujemy tylko do samej pary imię–nazwisko,
  // żeby dopiski typu „Firma Handlowa” nie unieważniały osoby.
  if (corporate.test(`${m[1]} ${m[2]}`)) return null;
  return { firstName: m[1], lastName: m[2] };
}

export type ConflictMatch = {
  officialFirstName: string;
  officialLastName: string;
  role: string;
  body: string;
  /** 'exact' — zgodne imię i nazwisko; 'lastName' — tylko nazwisko (wymaga ręcznej weryfikacji). */
  matchType: 'exact' | 'lastName';
};

const OFFICIALS_BY_LASTNAME = new Map<string, PublicOfficial[]>();
for (const person of OFFICIALS) {
  const key = foldName(person.lastName);
  OFFICIALS_BY_LASTNAME.set(key, [...(OFFICIALS_BY_LASTNAME.get(key) ?? []), person]);
}

/** Dopasowuje osobę z umowy do listy osób pełniących funkcje publiczne. */
export function matchOfficials(person: { firstName?: string; lastName: string }): ConflictMatch[] {
  const candidates = OFFICIALS_BY_LASTNAME.get(foldName(person.lastName)) ?? [];
  return candidates.map((candidate) => ({
    officialFirstName: candidate.firstName,
    officialLastName: candidate.lastName,
    role: candidate.role,
    body: candidate.body,
    matchType: person.firstName && foldName(person.firstName) === foldName(candidate.firstName) ? 'exact' : 'lastName',
  }));
}

/**
 * RX3 — powiązania wykonawców z osobami pełniącymi funkcje publiczne
 * (konflikt interesu / art. 397 Pzp o wyłączeniu wykonawcy).
 */
export function checkConflictsOfInterest(agreements: AgreementLike[]): Map<string, ComplianceFinding[]> {
  const result = new Map<string, ComplianceFinding[]>();
  for (const a of agreements) {
    const findings: ComplianceFinding[] = [];
    for (const party of a.contractors ?? []) {
      const person = extractPerson(party);
      if (!person) continue;
      for (const match of matchOfficials(person)) {
        const who = match.officialFirstName ? `${match.officialFirstName} ${match.officialLastName}` : match.officialLastName;
        const exactText = match.matchType === 'exact'
          ? `imię i nazwisko są tożsame`
          : `nazwisko jest identyczne, ale imię w rejestrze (${person.firstName ?? 'brak'}) wymaga weryfikacji`;
        findings.push({
          ruleId: 'powiazanie-osobiste',
          severity: match.matchType === 'exact' ? 'warning' : 'info',
          title: `${match.body}: ${who} (${match.role})`,
          description:
            `Wykonawca może być osobą powiązaną z osobą pełniącą funkcję publiczną w ${match.body} — ${exactText} `
            + `(${who}, ${match.role}). Zbieżność danych rejestru nie przesądza o konflikcie interesów ani o naruszeniu prawa, `
            + `ale przy zawieraniu umów z jednostką samorządową warto zweryfikować stosunki rodzinne/gospodarcze oraz `
            + `wyłączenie wykonawcy, jeśli dotyczy (art. 5 i 74 ust. 2 pkt 4 ustawy o samorządzie gminnym, art. 397 Pzp).`,
        });
      }
    }
    if (findings.length) result.set(a.idUmowy, findings);
  }
  return result;
}

