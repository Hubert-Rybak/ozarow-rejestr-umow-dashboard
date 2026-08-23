import type { Agreement, ContractParty } from './types';

export const CATEGORIES = [
  'Drogi i transport', 'Budownictwo i remonty', 'Edukacja', 'Zdrowie i pomoc społeczna',
  'IT i cyfryzacja', 'Energia i media', 'Administracja', 'Kultura i sport', 'Pozostałe',
] as const;

export function parsePolishDate(value?: string | null): Date | null {
  if (!value) return null;
  const [day, month, year] = value.split(/[.\/-]/).map(Number);
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function monthKey(agreement: Agreement): string {
  const date = parsePolishDate(agreement.dataZawarciaUmowy);
  return date ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` : 'brak daty';
}

export function yearKey(agreement: Agreement): string {
  const date = parsePolishDate(agreement.dataZawarciaUmowy);
  return date ? String(date.getUTCFullYear()) : 'brak daty';
}

export function categorizeAgreement(agreement: Agreement): string {
  if (agreement.category) return agreement.category;
  const text = `${agreement.przedmiotUmowy ?? ''} ${agreement.nazwa ?? ''}`.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ['Drogi i transport', /dro[gż]|chodnik|nawierzch|transport|komunikac|parking|ulic|most/],
    ['Budownictwo i remonty', /remont|budow|moderniz|projekt|instalac|konserwac|roboty/],
    ['Edukacja', /szkoł|przedszkol|uczni|edukac|podręcznik|kolonie/],
    ['Zdrowie i pomoc społeczna', /zdrow|medycz|opieka|pomoc społecz|ratownict|rehabilit/],
    ['IT i cyfryzacja', /oprogramow|informat|komputer|licenc|serwer|cyber|hosting/],
    ['Energia i media', /energia|gaz|wod|ściek|odpady|prąd|ciepł|media/],
    ['Administracja', /obsług|doradzt|prawn|audyt|ubezpiecze|poczt|biur/],
    ['Kultura i sport', /sport|kultur|wydarzen|promocj|rekreac|boisko/],
  ];
  return rules.find(([, regex]) => regex.test(text))?.[0] ?? 'Pozostałe';
}

/** Próg stosowania ustawy Pzp dla zamówień klasycznych (od 1.01.2026: 170 tys. zł netto; wcześniej 130 tys. zł). */
export const PZP_THRESHOLD_2026 = 170_000;
const PZP_THRESHOLD_BEFORE_2026 = 130_000;

export type ProcurementMode =
  | 'poza Pzp'
  | 'poniżej progu (tryb swobodny)'
  | 'tuż pod progiem (kontrola art. 11 ust. 2)'
  | 'reżim Pzp (przetarg + BZP)';

/**
 * Tryb prawny wydatku wnioskowany z kwoty netto i charakteru umowy.
 * „Poza Pzp" obejmuje zdarzenia niebędące dostawą/usługą/robotami budowlanymi
 * (dzierżawa nieruchomości, opłaty urzędowe, bilety, współfinansowanie), których Pzp nie reguluje.
 */
export function procurementMode(agreement: Agreement): ProcurementMode {
  const amount = Number(agreement.wartoscPrzedmiotuUmowy ?? 0);
  const date = parsePolishDate(agreement.dataZawarciaUmowy);
  const threshold = date && date.getUTCFullYear() >= 2026 ? PZP_THRESHOLD_2026 : PZP_THRESHOLD_BEFORE_2026;
  const text = `${agreement.przedmiotUmowy ?? ''} ${agreement.nazwa ?? ''}`.toLowerCase();
  const outsideRules: Array<[string, RegExp]> = [
    ['dzierżawa/najem nieruchomości', /(umowa )?dzierżaw(y|a)|czynsz najmu|najem( u)? (lokalu|pomieszczeń)/],
    ['opłata/opinia urzędowa', /opłat(a|y) za wydanie|opinia na zabezpieczenie|opłata eksploatacyjna/],
    ['współfinansowanie/wkład', /zasad(y|ach) współfinansowania|wkład własny/],
    ['bilet/karnet', /\bbilet|\bkarnet/],
  ];
  if (outsideRules.some(([, regex]) => regex.test(text))) return 'poza Pzp';
  if (amount < threshold - 40_000 && threshold === PZP_THRESHOLD_2026) return 'poniżej progu (tryb swobodny)';
  if (amount < threshold && amount >= threshold - 40_000) return 'tuż pod progiem (kontrola art. 11 ust. 2)';
  return 'reżim Pzp (przetarg + BZP)';
}

export function getAgreementUrl(agreement: Pick<Agreement, 'idUmowy' | 'sourceUrl'>): string {
  return agreement.sourceUrl ?? `https://rejestrumow.gov.pl/umowa/${encodeURIComponent(agreement.idUmowy)}`;
}

export function getPartyDisplayName(party: ContractParty): string {
  return party.nazwa?.trim() || [party.imie, party.nazwisko].filter(Boolean).join(' ').trim() || 'Nieznany wykonawca';
}

export function extractContractors(detail: { stronyUmowy?: ContractParty[] }): ContractParty[] {
  const parties = detail.stronyUmowy ?? [];
  const nonJsfp = parties.filter((party) => party.rodzaj?.toUpperCase() !== 'JSFP');
  return nonJsfp.length > 0 ? nonJsfp : parties;
}

export function extractProcurers(detail: { stronyUmowy?: ContractParty[] }): ContractParty[] {
  return (detail.stronyUmowy ?? []).filter((party) => party.rodzaj?.toUpperCase() === 'JSFP');
}

export function getContractorNames(agreement: Pick<Agreement, 'contractors'>): string[] {
  return (agreement.contractors ?? []).map(getPartyDisplayName).filter(Boolean);
}

export function getContractorSearchText(agreement: Pick<Agreement, 'contractors'>): string {
  return (agreement.contractors ?? [])
    .flatMap((party) => [getPartyDisplayName(party), party.nip, party.regon, party.rodzaj, party.daneAdresowe?.miejscowosc])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function sumAmount(items: Agreement[]): number {
  return items.reduce((sum, item) => sum + Number(item.wartoscPrzedmiotuUmowy ?? 0), 0);
}

export function aggregateBy(items: Agreement[], keyFn: (item: Agreement) => string) {
  const map = new Map<string, { key: string; count: number; amount: number }>();
  for (const item of items) {
    const key = keyFn(item);
    const current = map.get(key) ?? { key, count: 0, amount: 0 };
    current.count += 1;
    current.amount += Number(item.wartoscPrzedmiotuUmowy ?? 0);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key, 'pl'));
}

export function formatPLN(amount: number): string {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(amount);
}
