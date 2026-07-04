import { describe, expect, it } from 'vitest';
import { aggregateBy, categorizeAgreement, extractContractors, getAgreementUrl, getContractorNames, monthKey, sumAmount, yearKey } from './dataUtils';
import type { Agreement } from './types';

const sample: Agreement[] = [
  { idUmowy: '1', dataZawarciaUmowy: '03.07.2026', wartoscPrzedmiotuUmowy: 1000, przedmiotUmowy: 'Remont drogi gminnej' },
  { idUmowy: '2', dataZawarciaUmowy: '10.07.2026', wartoscPrzedmiotuUmowy: 2500, przedmiotUmowy: 'Licencja na oprogramowanie' },
  { idUmowy: '3', dataZawarciaUmowy: '01.01.2025', wartoscPrzedmiotuUmowy: 500, przedmiotUmowy: 'Zakup materiałów biurowych' },
];

describe('data utils', () => {
  it('agreguje wydatki po miesiącu i roku', () => {
    expect(monthKey(sample[0])).toBe('2026-07');
    expect(yearKey(sample[2])).toBe('2025');
    expect(aggregateBy(sample, monthKey)).toEqual([
      { key: '2025-01', count: 1, amount: 500 },
      { key: '2026-07', count: 2, amount: 3500 },
    ]);
  });

  it('sumuje kwoty oraz klasyfikuje kategorie heurystycznie', () => {
    expect(sumAmount(sample)).toBe(4000);
    expect(categorizeAgreement(sample[0])).toBe('Drogi i transport');
    expect(categorizeAgreement(sample[1])).toBe('IT i cyfryzacja');
    expect(categorizeAgreement(sample[2])).toBe('Administracja');
  });

  it('buduje link do oryginalnej strony umowy w CRU', () => {
    expect(getAgreementUrl({ idUmowy: 'abc-123' })).toBe('https://rejestrumow.gov.pl/umowa/abc-123');
    expect(getAgreementUrl({ idUmowy: 'id ze spacją' })).toBe('https://rejestrumow.gov.pl/umowa/id%20ze%20spacj%C4%85');
  });

  it('wyciąga wykonawców ze szczegółów umowy i pomija stronę JSFP', () => {
    const detail = {
      stronyUmowy: [
        { rodzaj: 'JSFP', nazwa: 'ZARZĄD DRÓG POWIATOWYCH', regon: '014900974' },
        { rodzaj: 'Przedsiębiorca', nazwa: 'GOOD BRUK SP. Z O.O.', nip: '8371872980', regon: '521339494' },
      ],
    };
    expect(extractContractors(detail)).toEqual([
      { rodzaj: 'Przedsiębiorca', nazwa: 'GOOD BRUK SP. Z O.O.', nip: '8371872980', regon: '521339494' },
    ]);
  });

  it('zwraca nazwy wykonawców do filtrowania i wyszukiwania', () => {
    expect(getContractorNames({ contractors: [{ nazwa: 'GOOD BRUK SP. Z O.O.' }, { imie: 'Jan', nazwisko: 'Kowalski' }] })).toEqual([
      'GOOD BRUK SP. Z O.O.',
      'Jan Kowalski',
    ]);
  });
});
