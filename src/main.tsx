import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  CircleCheck,
  Database,
  FileText,
  FilterX,
  Landmark,
  Search,
  WalletCards,
} from 'lucide-react';
import {
  aggregateBy,
  categorizeAgreement,
  CATEGORIES,
  formatPLN,
  getAgreementUrl,
  getContractorNames,
  getContractorSearchText,
  getPartyDisplayName,
  monthKey,
  sumAmount,
  yearKey,
} from './dataUtils';
import type { Agreement, AgreementsPayload, ContractParty } from './types';
import './styles.css';

const COLORS = ['#5b5cf0', '#20b486', '#f59e0b', '#ef5b5b', '#8b5cf6', '#06a6c7', '#64748b', '#ec4899', '#84a617'];
const emptyPayload: AgreementsPayload = {
  fetchedAt: new Date().toISOString(),
  source: '',
  filter: {},
  totalElements: 0,
  totalVisibleElements: 0,
  agreements: [],
};

type SortKey = 'amount-desc' | 'amount-asc' | 'date-desc' | 'date-asc' | 'name-asc';

function compactPLN(amount: number) {
  return new Intl.NumberFormat('pl-PL', {
    notation: amount >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: amount >= 10_000 ? 1 : 0,
  }).format(amount) + ' zł';
}

function App() {
  const [payload, setPayload] = useState<AgreementsPayload>(emptyPayload);
  const [category, setCategory] = useState('Wszystkie');
  const [status, setStatus] = useState('Wszystkie');
  const [contractor, setContractor] = useState('Wszyscy');
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<'month' | 'year'>('month');
  const [sort, setSort] = useState<SortKey>('amount-desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`./data/agreements.json?v=${Date.now()}`)
      .then((res) => (res.ok ? res.json() : emptyPayload))
      .then((data) => setPayload(data))
      .catch(() => setPayload(emptyPayload))
      .finally(() => setLoading(false));
  }, []);

  const enriched = useMemo(
    () => payload.agreements.map((agreement) => ({ ...agreement, category: categorizeAgreement(agreement) })),
    [payload.agreements],
  );
  const statuses = useMemo(
    () => ['Wszystkie', ...Array.from(new Set(enriched.map((agreement) => agreement.statusUmowy).filter(Boolean))) as string[]],
    [enriched],
  );
  const contractors = useMemo(() => {
    const names = enriched.flatMap(getContractorNames).filter(Boolean);
    return ['Wszyscy', ...Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'pl'))];
  }, [enriched]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return enriched
      .filter((agreement) => category === 'Wszystkie' || agreement.category === category)
      .filter((agreement) => status === 'Wszystkie' || agreement.statusUmowy === status)
      .filter((agreement) => contractor === 'Wszyscy' || getContractorNames(agreement).includes(contractor))
      .filter((agreement) => !normalizedQuery || `${agreement.nazwa ?? ''} ${agreement.przedmiotUmowy ?? ''} ${agreement.regon ?? ''} ${getContractorSearchText(agreement)} ${agreement.details?.numerUmowy ?? ''}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        const aValue = Number(a.wartoscPrzedmiotuUmowy ?? 0);
        const bValue = Number(b.wartoscPrzedmiotuUmowy ?? 0);
        if (sort === 'amount-desc') return bValue - aValue;
        if (sort === 'amount-asc') return aValue - bValue;
        if (sort === 'date-desc') return (b.dataZawarciaUmowy ?? '').localeCompare(a.dataZawarciaUmowy ?? '');
        if (sort === 'date-asc') return (a.dataZawarciaUmowy ?? '').localeCompare(b.dataZawarciaUmowy ?? '');
        return (a.nazwa ?? '').localeCompare(b.nazwa ?? '', 'pl');
      });
  }, [enriched, category, status, contractor, query, sort]);

  const total = sumAmount(filtered);
  const average = filtered.length ? total / filtered.length : 0;
  const biggest = filtered.reduce<Agreement | undefined>((current, agreement) => (
    !current || Number(agreement.wartoscPrzedmiotuUmowy ?? 0) > Number(current.wartoscPrzedmiotuUmowy ?? 0) ? agreement : current
  ), undefined);
  const byTime = aggregateBy(filtered, bucket === 'month' ? monthKey : yearKey);
  const byCategory = aggregateBy(filtered, (agreement) => categorizeAgreement(agreement)).sort((a, b) => b.amount - a.amount);
  const activeFilters = Number(Boolean(query)) + Number(category !== 'Wszystkie') + Number(status !== 'Wszystkie') + Number(contractor !== 'Wszyscy');

  const resetFilters = () => {
    setQuery('');
    setCategory('Wszystkie');
    setStatus('Wszystkie');
    setContractor('Wszyscy');
  };

  return (
    <div className="appShell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Ożarów — strona główna">
          <span className="brandMark"><Landmark size={19} /></span>
          <span><strong>Ożarów</strong><small>Finanse publiczne</small></span>
        </a>
        <div className="dataStatus"><span className="statusDot" /> Dane aktualne na {new Date(payload.fetchedAt).toLocaleDateString('pl-PL')}</div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="heroCopy">
            <div className="eyebrow"><Database size={14} /> Centralny Rejestr Umów</div>
            <h1>Wydatki gminy<br /><span>pod pełną kontrolą.</span></h1>
            <p>Przeglądaj umowy, analizuj wydatki i sprawdzaj wykonawców gminy Ożarów Mazowiecki w jednym, przejrzystym miejscu.</p>
            <div className="heroMeta">
              <span><CircleCheck size={16} /> Dane ze źródła publicznego</span>
              <span><CalendarDays size={16} /> Aktualizacja {new Date(payload.fetchedAt).toLocaleString('pl-PL')}</span>
            </div>
          </div>
          <div className="heroVisual" aria-hidden="true">
            <div className="heroOrb heroOrbOne" />
            <div className="heroOrb heroOrbTwo" />
            <div className="heroMiniCard heroMiniCardTotal">
              <span>Łączna wartość</span>
              <strong>{compactPLN(sumAmount(enriched))}</strong>
              <small>{enriched.length} {enriched.length === 1 ? 'umowa' : 'umowy'}</small>
            </div>
            <div className="heroMiniCard heroMiniCardSource"><Database size={18} /><span>CRU</span><small>oficjalne dane</small></div>
            <div className="heroBars"><i /><i /><i /><i /><i /></div>
          </div>
        </section>

        <section className="metrics" aria-label="Najważniejsze statystyki">
          <Metric icon={<WalletCards />} tone="violet" label="Suma po filtrach" value={formatPLN(total)} note={`${filtered.length} z ${enriched.length} umów`} />
          <Metric icon={<FileText />} tone="cyan" label="Liczba umów" value={String(filtered.length)} note={activeFilters ? `Aktywne filtry: ${activeFilters}` : 'Wszystkie dostępne rekordy'} />
          <Metric icon={<ChartNoAxesCombined />} tone="amber" label="Średnia wartość" value={formatPLN(average)} note="na jedną umowę" />
          <Metric icon={<Building2 />} tone="green" label="Największa umowa" value={formatPLN(Number(biggest?.wartoscPrzedmiotuUmowy ?? 0))} note={getContractorNames(biggest ?? {})[0] ?? 'Brak danych'} />
        </section>

        <section className="sectionBlock" aria-labelledby="analysis-title">
          <div className="sectionHeading">
            <div><span className="sectionKicker">Eksploruj dane</span><h2 id="analysis-title">Analiza wydatków</h2></div>
            {activeFilters > 0 && <button className="resetButton" type="button" onClick={resetFilters}><FilterX size={16} /> Wyczyść filtry <b>{activeFilters}</b></button>}
          </div>

          <div className="filterPanel">
            <label className="searchField"><span>Szukaj w rejestrze</span><div><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Wykonawca, przedmiot, numer umowy…" /></div></label>
            <SelectField label="Kategoria" value={category} onChange={setCategory} options={['Wszystkie', ...CATEGORIES]} />
            <SelectField label="Wykonawca" value={contractor} onChange={setContractor} options={contractors} />
            <SelectField label="Status" value={status} onChange={setStatus} options={statuses} />
            <SelectField label="Sortowanie" value={sort} onChange={(value) => setSort(value as SortKey)} options={[
              ['amount-desc', 'Kwota: od najwyższej'], ['amount-asc', 'Kwota: od najniższej'], ['date-desc', 'Data: od najnowszej'], ['date-asc', 'Data: od najstarszej'], ['name-asc', 'Nazwa: A–Z'],
            ]} />
          </div>

          <div className="chartsGrid">
            <article className="dataCard trendCard">
              <div className="cardHeading">
                <div><span>Rozkład w czasie</span><h3>Wartość zawartych umów</h3></div>
                <div className="segmented" aria-label="Sposób agregacji">
                  <button className={bucket === 'month' ? 'active' : ''} onClick={() => setBucket('month')}>Miesiąc</button>
                  <button className={bucket === 'year' ? 'active' : ''} onClick={() => setBucket('year')}>Rok</button>
                </div>
              </div>
              {byTime.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={byTime} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6d6df4" /><stop offset="100%" stopColor="#5556df" /></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke="#e9eaf2" />
                    <XAxis dataKey="key" axisLine={false} tickLine={false} tick={{ fill: '#7a7f93', fontSize: 12 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} width={68} tick={{ fill: '#7a7f93', fontSize: 12 }} tickFormatter={(value) => compactPLN(Number(value)).replace(' zł', '')} />
                    <Tooltip cursor={{ fill: '#f1f1ff' }} contentStyle={{ border: '0', borderRadius: 14, boxShadow: '0 12px 35px rgba(33,35,62,.14)' }} formatter={(value) => [formatPLN(Number(value)), 'Wartość']} />
                    <Bar dataKey="amount" fill="url(#barGradient)" radius={[8, 8, 3, 3]} maxBarSize={54} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState />}
            </article>

            <article className="dataCard categoryCard">
              <div className="cardHeading"><div><span>Struktura wydatków</span><h3>Kategorie</h3></div></div>
              {byCategory.length ? (
                <div className="categoryContent">
                  <div className="donutWrap">
                    <ResponsiveContainer width="100%" height={232}>
                      <PieChart>
                        <Pie data={byCategory} dataKey="amount" nameKey="key" innerRadius={70} outerRadius={96} paddingAngle={3} stroke="none">
                          {byCategory.map((item, index) => <Cell key={item.key} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ border: '0', borderRadius: 14, boxShadow: '0 12px 35px rgba(33,35,62,.14)' }} formatter={(value) => formatPLN(Number(value))} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donutCenter"><strong>{byCategory.length}</strong><span>{byCategory.length === 1 ? 'kategoria' : 'kategorie'}</span></div>
                  </div>
                  <div className="legend">
                    {byCategory.slice(0, 5).map((item, index) => (
                      <div className="legendItem" key={item.key}>
                        <i style={{ background: COLORS[index % COLORS.length] }} /><span>{item.key}</span><strong>{total ? Math.round((item.amount / total) * 100) : 0}%</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <EmptyState />}
            </article>
          </div>
        </section>

        <section className="sectionBlock registrySection" aria-labelledby="registry-title">
          <div className="sectionHeading registryHeading">
            <div><span className="sectionKicker">Rejestr</span><h2 id="registry-title">Umowy i wykonawcy</h2></div>
            <div className="resultsCount"><strong>{filtered.length}</strong> {filtered.length === 1 ? 'wynik' : 'wyniki'}</div>
          </div>
          <div className="tableCard">
            <div className="tableToolbar">
              <span>Widok szczegółowy</span>
              <label>Sortuj <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="amount-desc">Kwota malejąco</option><option value="amount-asc">Kwota rosnąco</option><option value="date-desc">Data malejąco</option><option value="date-asc">Data rosnąco</option><option value="name-asc">Nazwa A–Z</option></select><ChevronDown size={14} /></label>
            </div>
            <div className="tableScroll">
              <table>
                <thead><tr><th>Data</th><th>Wykonawca</th><th>Przedmiot umowy</th><th>Kategoria</th><th>Status</th><th className="num">Kwota</th><th><span className="srOnly">Źródło</span></th></tr></thead>
                <tbody>{filtered.map((agreement) => <AgreementRow key={agreement.idUmowy} agreement={agreement} />)}</tbody>
              </table>
              {!loading && filtered.length === 0 && <EmptyState message="Nie znaleziono umów pasujących do filtrów." />}
              {loading && <div className="loadingState">Ładowanie aktualnych danych…</div>}
            </div>
          </div>
        </section>

        <footer><span>Ożarów · Finanse publiczne</span><span>Dane: <a href="https://rejestrumow.gov.pl" target="_blank" rel="noreferrer">Centralny Rejestr Umów <ArrowUpRight size={13} /></a></span></footer>
      </main>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<string | [string, string]> }) {
  return <label className="selectField"><span>{label}</span><div><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => {
    const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
    return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
  })}</select><ChevronDown size={16} /></div></label>;
}

function AgreementRow({ agreement }: { agreement: Agreement }) {
  const amount = Number(agreement.wartoscPrzedmiotuUmowy ?? 0);
  return (
    <tr>
      <td className="dateCell"><strong>{agreement.dataZawarciaUmowy ?? '—'}</strong><small>{agreement.details?.numerUmowy ?? 'Bez numeru'}</small></td>
      <td className="contractorCell"><PartyList parties={agreement.contractors ?? []} empty="—" /></td>
      <td className="subjectCell">
        <strong>{agreement.przedmiotUmowy ?? '—'}</strong>
        <small>{agreement.nazwa ?? '—'}</small>
        <details className="detailsBox">
          <summary>Szczegóły umowy</summary>
          <dl>
            <div><dt>Numer umowy</dt><dd>{agreement.details?.numerUmowy ?? '—'}</dd></div>
            <div><dt>Okres</dt><dd>{agreement.details?.okres ?? '—'}</dd></div>
            <div><dt>Zamawiający</dt><dd><PartyList parties={agreement.procurers ?? []} empty={agreement.nazwa ?? '—'} /></dd></div>
            <div><dt>Publikacja</dt><dd>{agreement.details?.dataPublikacji ?? '—'}</dd></div>
          </dl>
        </details>
      </td>
      <td><span className="categoryPill">{categorizeAgreement(agreement)}</span></td>
      <td><span className={`statusPill ${(agreement.statusUmowy ?? '').toLowerCase() === 'aktywna' ? 'active' : ''}`}><i />{agreement.statusUmowy ?? '—'}</span></td>
      <td className="num amountCell"><strong>{formatPLN(amount)}</strong></td>
      <td className="linkCell"><a className="sourceLink" href={getAgreementUrl(agreement)} target="_blank" rel="noreferrer" aria-label="Otwórz umowę w Centralnym Rejestrze Umów"><ArrowUpRight size={17} /></a></td>
    </tr>
  );
}

function PartyList({ parties, empty }: { parties: ContractParty[]; empty: string }) {
  if (parties.length === 0) return <>{empty}</>;
  return <div className="partyList">{parties.map((party, index) => <div key={`${getPartyDisplayName(party)}-${party.nip ?? party.regon ?? index}`}><strong>{getPartyDisplayName(party)}</strong><small>{[party.rodzaj, party.nip && `NIP ${party.nip}`, party.regon && `REGON ${party.regon}`].filter(Boolean).join(' · ')}</small></div>)}</div>;
}

function Metric({ icon, tone, label, value, note }: { icon: React.ReactNode; tone: string; label: string; value: string; note: string }) {
  return <article className="metricCard"><div className={`metricIcon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small title={note}>{note}</small></div></article>;
}

function EmptyState({ message = 'Brak danych do wyświetlenia.' }: { message?: string }) {
  return <div className="emptyState"><ChartNoAxesCombined size={24} /><span>{message}</span></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
