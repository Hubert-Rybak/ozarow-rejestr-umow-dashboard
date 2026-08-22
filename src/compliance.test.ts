import { describe, expect, it } from 'vitest';
import { analyzeAgreements, checkAgreement, CRU_PUBLISH_DEADLINE_DAYS, EU_THRESHOLD_LOCAL_GOV, PZP_THRESHOLD } from './compliance';
import type { Agreement } from './types';

const TODAY = new Date('2026-08-22T12:00:00Z');

function make(overrides: Partial<Agreement>): Agreement {
  return {
    idUmowy: 'test-1',
    dataZawarciaUmowy: '01.06.2026',
    wartoscPrzedmiotuUmowy: 50_000,
    statusUmowy: 'Aktywna',
    contractors: [{ rodzaj: 'P', nazwa: 'Firma Test Sp. z o.o.' }],
    details: {},
    ...overrides,
  };
}

describe('checkAgreement', () => {
  it('nie zgłasza uwag dla typowej umowy poniżej progów', () => {
    const findings = checkAgreement(make({ statusUmowy: 'Nieaktywna' }), TODAY);
    expect(findings).toHaveLength(0);
  });

  it('flaguje brak wartości umowy', () => {
    const findings = checkAgreement(make({ wartoscPrzedmiotuUmowy: null }), TODAY);
    expect(findings.map((f) => f.ruleId)).toContain('kwota-nieokreslona');
  });

  it('flaguje próg unijny (>=930 960 zł) zamiast progu Pzp', () => {
    const findings = checkAgreement(make({ wartoscPrzedmiotuUmowy: EU_THRESHOLD_LOCAL_GOV }), TODAY);
    expect(findings.map((f) => f.ruleId)).toContain('prog-unijny');
    expect(findings.map((f) => f.ruleId)).not.toContain('prog-pzp');
  });

  it('flaguje krajowy próg Pzp (170 000 zł)', () => {
    const findings = checkAgreement(make({ wartoscPrzedmiotuUmowy: PZP_THRESHOLD }), TODAY);
    expect(findings.map((f) => f.ruleId)).toContain('prog-pzp');
  });

  it('flaguje publikację w CRU po terminie 7 dni', () => {
    const findings = checkAgreement(make({ details: { dataPublikacji: '15.06.2026' } }), TODAY);
    expect(findings.map((f) => f.ruleId)).toContain('publikacja-opozniona');
  });

  it('akceptuje publikację w ciągu 7 dni', () => {
    const within = `0${1 + CRU_PUBLISH_DEADLINE_DAYS}.06.2026`;
    const findings = checkAgreement(make({ details: { dataPublikacji: within } }), TODAY);
    expect(findings.filter((f) => f.ruleId === 'publikacja-opozniona')).toHaveLength(0);
  });

  it('flaguje datę publikacji sprzed zawarcia jako błąd', () => {
    const findings = checkAgreement(make({ details: { dataPublikacji: '01.05.2026' } }), TODAY);
    const f = findings.find((x) => x.ruleId === 'niespojnosc-dat');
    expect(f?.severity).toBe('error');
  });

  it('flaguje aktywną umowę po upływie terminu', () => {
    const findings = checkAgreement(make({ dataZakonczeniaUmowy: '01.07.2026' }), TODAY);
    expect(findings.map((f) => f.ruleId)).toContain('status-po-terminie');
  });

  it('flaguje brak terminu wykonania dla aktywnej umowy', () => {
    const findings = checkAgreement(make({}), TODAY);
    expect(findings.map((f) => f.ruleId)).toContain('brak-terminu');
  });

  it('nie flaguje terminu dla umowy nieaktywnej', () => {
    const findings = checkAgreement(make({ statusUmowy: 'Nieaktywna', dataZakonczeniaUmowy: '01.07.2026' }), TODAY);
    expect(findings.filter((f) => ['status-po-terminie', 'brak-terminu'].includes(f.ruleId))).toHaveLength(0);
  });

  it('oznacza finansowanie ze środków zewnętrznych', () => {
    const findings = checkAgreement(make({ details: { finansowanaZeSrodkow: true } }), TODAY);
    expect(findings.map((f) => f.ruleId)).toContain('srodki-zewnetrzne');
  });
});

describe('analyzeAgreements (reguły krzyżowe)', () => {
  it('wykrywa duplikat numeru umowy', () => {
    const findings = analyzeAgreements([
      make({ idUmowy: 'a', details: { numerUmowy: 'WA.100.2026' } }),
      make({ idUmowy: 'b', details: { numerUmowy: 'WA.100.2026' } }),
    ], TODAY);
    expect(findings.get('a')?.map((f) => f.ruleId)).toContain('numer-duplikat');
    expect(findings.get('b')?.map((f) => f.ruleId)).toContain('numer-duplikat');
  });

  it('wykrywa kumulację umów poniżej progu u jednego wykonawcy', () => {
    const findings = analyzeAgreements([
      make({ idUmowy: 'a', dataZawarciaUmowy: '10.01.2026', wartoscPrzedmiotuUmowy: 90_000 }),
      make({ idUmowy: 'b', dataZawarciaUmowy: '20.03.2026', wartoscPrzedmiotuUmowy: 95_000 }),
    ], TODAY);
    expect(findings.get('b')?.map((f) => f.ruleId)).toContain('mozliwy-podzial');
  });

  it('nie flaguje umów do różnych wykonawców ani rozłożonych w czasie >12 mies.', () => {
    const findings = analyzeAgreements([
      make({ idUmowy: 'a', contractors: [{ nazwa: 'A s.c.' }], dataZawarciaUmowy: '10.01.2026', wartoscPrzedmiotuUmowy: 90_000 }),
      make({ idUmowy: 'b', contractors: [{ nazwa: 'B s.c.' }], dataZawarciaUmowy: '20.03.2026', wartoscPrzedmiotuUmowy: 95_000 }),
      make({ idUmowy: 'c', contractors: [{ nazwa: 'C s.c.' }], dataZawarciaUmowy: '10.01.2025', wartoscPrzedmiotuUmowy: 90_000 }),
      make({ idUmowy: 'd', contractors: [{ nazwa: 'C s.c.' }], dataZawarciaUmowy: '20.03.2026', wartoscPrzedmiotuUmowy: 95_000 }),
    ], TODAY);
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(findings.get(id)?.map((f) => f.ruleId)).not.toContain('mozliwy-podzial');
    }
  });
});
