import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from 'recharts';
import { ArrowDownUp, CalendarDays, Database, Search, WalletCards } from 'lucide-react';
import { aggregateBy, categorizeAgreement, CATEGORIES, formatPLN, monthKey, sumAmount, yearKey } from './dataUtils';
import type { Agreement, AgreementsPayload } from './types';
import './styles.css';

const COLORS = ['#2563eb', '#16a34a', '#f97316', '#dc2626', '#7c3aed', '#0891b2', '#4b5563', '#db2777', '#64748b'];
const emptyPayload: AgreementsPayload = { fetchedAt: new Date().toISOString(), source: '', filter: {}, totalElements: 0, totalVisibleElements: 0, agreements: [] };

type SortKey = 'amount-desc' | 'amount-asc' | 'date-desc' | 'date-asc' | 'name-asc';

function App() {
  const [payload, setPayload] = useState<AgreementsPayload>(emptyPayload);
  const [category, setCategory] = useState('Wszystkie');
  const [status, setStatus] = useState('Wszystkie');
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<'month' | 'year'>('month');
  const [sort, setSort] = useState<SortKey>('amount-desc');

  useEffect(() => {
    fetch('./data/agreements.json')
      .then((res) => (res.ok ? res.json() : emptyPayload))
      .then((data) => setPayload(data))
      .catch(() => setPayload(emptyPayload));
  }, []);

  const enriched = useMemo(() => payload.agreements.map((a) => ({ ...a, category: categorizeAgreement(a) })), [payload.agreements]);
  const statuses = useMemo(() => ['Wszystkie', ...Array.from(new Set(enriched.map((a) => a.statusUmowy).filter(Boolean))) as string[]], [enriched]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched
      .filter((a) => category === 'Wszystkie' || a.category === category)
      .filter((a) => status === 'Wszystkie' || a.statusUmowy === status)
      .filter((a) => !q || `${a.nazwa ?? ''} ${a.przedmiotUmowy ?? ''} ${a.regon ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const av = Number(a.wartoscPrzedmiotuUmowy ?? 0);
        const bv = Number(b.wartoscPrzedmiotuUmowy ?? 0);
        if (sort === 'amount-desc') return bv - av;
        if (sort === 'amount-asc') return av - bv;
        if (sort === 'date-desc') return (b.dataZawarciaUmowy ?? '').localeCompare(a.dataZawarciaUmowy ?? '');
        if (sort === 'date-asc') return (a.dataZawarciaUmowy ?? '').localeCompare(b.dataZawarciaUmowy ?? '');
        return (a.nazwa ?? '').localeCompare(b.nazwa ?? '', 'pl');
      });
  }, [enriched, category, status, query, sort]);

  const total = sumAmount(filtered);
  const biggest = filtered[0];
  const byTime = aggregateBy(filtered, bucket === 'month' ? monthKey : yearKey);
  const byCategory = aggregateBy(filtered, (a) => categorizeAgreement(a));

  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Centralny Rejestr Umów</p>
          <h1>Wydatki gminy Ożarów Mazowiecki</h1>
          <p>Interaktywny dashboard umów z codziennym odświeżaniem danych przez GitHub Actions.</p>
        </div>
        <div className="updated">
          <Database size={18} />
          <span>Aktualizacja: {new Date(payload.fetchedAt).toLocaleString('pl-PL')}</span>
        </div>
      </section>

      <section className="cards">
        <Metric icon={<WalletCards />} label="Suma po filtrach" value={formatPLN(total)} />
        <Metric icon={<Database />} label="Liczba umów" value={String(filtered.length)} />
        <Metric icon={<CalendarDays />} label="Średnia wartość" value={formatPLN(filtered.length ? total / filtered.length : 0)} />
        <Metric icon={<ArrowDownUp />} label="Największa umowa" value={formatPLN(Number(biggest?.wartoscPrzedmiotuUmowy ?? 0))} />
      </section>

      <section className="panel filters">
        <label><Search size={16} /> Szukaj<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="kontrahent, przedmiot, REGON…" /></label>
        <label>Kategoria<select value={category} onChange={(e) => setCategory(e.target.value)}><option>Wszystkie</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Sortowanie<select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="amount-desc">Kwota malejąco</option><option value="amount-asc">Kwota rosnąco</option><option value="date-desc">Data malejąco</option><option value="date-asc">Data rosnąco</option><option value="name-asc">Nazwa A-Z</option></select></label>
        <label>Agregacja<select value={bucket} onChange={(e) => setBucket(e.target.value as 'month' | 'year')}><option value="month">Miesiąc</option><option value="year">Rok</option></select></label>
      </section>

      <section className="grid">
        <div className="panel chart"><h2>Wydatki per {bucket === 'month' ? 'miesiąc' : 'rok'}</h2><ResponsiveContainer width="100%" height={320}><BarChart data={byTime}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="key" /><YAxis /><Tooltip formatter={(v) => formatPLN(Number(v))} /><Bar dataKey="amount" fill="#2563eb" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div>
        <div className="panel chart"><h2>Kategorie</h2><ResponsiveContainer width="100%" height={320}><PieChart><Pie data={byCategory} dataKey="amount" nameKey="key" innerRadius={65} outerRadius={115} paddingAngle={2}>{byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v) => formatPLN(Number(v))} /></PieChart></ResponsiveContainer></div>
      </section>

      <section className="panel tableWrap">
        <h2>Umowy</h2>
        <table><thead><tr><th>Data</th><th>Jednostka / kontrahent</th><th>Przedmiot</th><th>Kategoria</th><th>Status</th><th className="num">Kwota</th></tr></thead><tbody>{filtered.map((a) => <tr key={a.idUmowy}><td>{a.dataZawarciaUmowy ?? '—'}</td><td>{a.nazwa ?? '—'}<small>{a.regon ?? ''}</small></td><td>{a.przedmiotUmowy ?? '—'}</td><td><span className="pill">{categorizeAgreement(a)}</span></td><td>{a.statusUmowy ?? '—'}</td><td className="num">{formatPLN(Number(a.wartoscPrzedmiotuUmowy ?? 0))}</td></tr>)}</tbody></table>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="card"><div className="icon">{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
