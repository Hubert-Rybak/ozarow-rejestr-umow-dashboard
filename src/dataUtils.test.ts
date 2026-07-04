import { describe, expect, it } from 'vitest';
import { aggregateBy, categorizeAgreement, monthKey, sumAmount, yearKey } from './dataUtils';
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
});
