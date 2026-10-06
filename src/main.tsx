import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import { errorMessage, t } from './i18n';
import type { Entry, Lang, Role, Site, Worker } from './types';
import './style.css';

function localToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const today = localToday();

function isSunday(date: string) {
  return new Date(`${date}T12:00:00`).getDay() === 0;
}

function isoWeekKey(dateString: string) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function formatHours(value: number) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}h`;
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function downloadFile(content: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function App() {
  const [role, setRole] = useState<Role | ''>((localStorage.getItem('role') as Role) || '');
  const [lang, setLang] = useState<Lang>((localStorage.getItem('lang') as Lang) || 'en');

  const changeLanguage = (next: Lang) => {
    localStorage.setItem('lang', next);
    setLang(next);
  };

  const login = (nextRole: Role, token: string) => {
    localStorage.setItem('role', nextRole);
    localStorage.setItem('token', token);
    setRole(nextRole);
  };

  const logout = () => {
    localStorage.removeItem('role');
    localStorage.removeItem('token');
    setRole('');
  };

  if (!role) return <Login lang={lang} setLang={changeLanguage} onLogin={login} />;
  return role === 'admin' ? (
    <Admin lang={lang} setLang={changeLanguage} logout={logout} />
  ) : (
    <WorkerView lang={lang} setLang={changeLanguage} logout={logout} />
  );
}

type SharedProps = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  logout: () => void;
};

function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <div className="language-toggle" aria-label={t(lang, 'language')}>
      <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
      <button type="button" className={lang === 'el' ? 'active' : ''} onClick={() => setLang('el')}>ΕΛ</button>
    </div>
  );
}

function Header({ title, lang, setLang, logout }: SharedProps & { title: string }) {
  return (
    <section className="hero row">
      <div>
        <b>WorkTime</b>
        <span>{title}</span>
      </div>
      <div className="header-actions">
        <LanguageToggle lang={lang} setLang={setLang} />
        <button type="button" className="ghost-on-dark" onClick={logout}>{t(lang, 'logout')}</button>
      </div>
    </section>
  );
}

function Login({ lang, setLang, onLogin }: { lang: Lang; setLang: (lang: Lang) => void; onLogin: (role: Role, token: string) => void }) {
  const [mode, setMode] = useState<Role>('worker');
  const [workerCode, setWorkerCode] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = mode === 'worker'
        ? { role: 'worker', workerCode, pin }
        : { role: 'admin', email, password };
      const result = await api<{ role: Role; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onLogin(result.role, result.token);
    } catch (err) {
      setError(errorMessage(lang, err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="shell login-shell">
      <section className="hero login-hero">
        <div className="login-hero-top">
          <div>
            <b>WorkTime</b>
            <span>{t(lang, 'appSubtitle')}</span>
          </div>
          <LanguageToggle lang={lang} setLang={setLang} />
        </div>
      </section>
      <form className="card" onSubmit={submit}>
        <div className="tabs" role="tablist">
          <button type="button" className={mode === 'worker' ? 'active' : ''} onClick={() => { setMode('worker'); setError(''); }}>{t(lang, 'worker')}</button>
          <button type="button" className={mode === 'admin' ? 'active' : ''} onClick={() => { setMode('admin'); setError(''); }}>{t(lang, 'admin')}</button>
        </div>
        <h1>{mode === 'worker' ? t(lang, 'workerLogin') : t(lang, 'adminLogin')}</h1>
        {mode === 'worker' ? (
          <>
            <label htmlFor="worker-code">{t(lang, 'workerCode')}</label>
            <input id="worker-code" value={workerCode} autoComplete="username" onChange={(event) => setWorkerCode(event.target.value)} required />
            <label htmlFor="worker-pin">{t(lang, 'pin')}</label>
            <input id="worker-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} required />
          </>
        ) : (
          <>
            <label htmlFor="admin-email">{t(lang, 'email')}</label>
            <input id="admin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="admin-password">{t(lang, 'password')}</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <button className="primary" type="submit" disabled={loading}>{loading ? t(lang, 'loading') : t(lang, 'login')}</button>
        <p className="muted">{t(lang, 'loginHint')}</p>
      </form>
    </main>
  );
}

function WorkerView({ lang, setLang, logout }: SharedProps) {
  const [date, setDate] = useState(today);
  const [site, setSite] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('16:00');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const sunday = isSunday(date);

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'AUTH_REQUIRED') logout();
    setError(errorMessage(lang, err));
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [siteRows, entryRows] = await Promise.all([
        api<Site[]>('/sites'),
        api<Entry[]>('/entries'),
      ]);
      setSites(siteRows);
      setEntries(entryRows);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setSaving(true);
    try {
      await api('/entries', {
        method: 'POST',
        body: JSON.stringify({ date, site, start: sunday ? null : start, end: sunday ? null : end }),
      });
      setMessage(t(lang, 'submitted'));
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="shell wide">
      <Header title={t(lang, 'worker')} lang={lang} setLang={setLang} logout={logout} />
      <form className="card" onSubmit={submit}>
        <h2>{t(lang, 'newEntry')}</h2>
        <div className="form-grid">
          <div>
            <label htmlFor="entry-date">{t(lang, 'date')}</label>
            <input id="entry-date" type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} required />
          </div>
          <div>
            <label htmlFor="entry-site">{t(lang, 'workSite')}</label>
            <select id="entry-site" value={site} onChange={(event) => setSite(event.target.value)} required>
              <option value="">{t(lang, 'selectSite')}</option>
              {sites.map((row) => <option key={row._id} value={row._id}>{row.name}</option>)}
            </select>
          </div>
        </div>
        {!sunday ? (
          <div className="two">
            <div>
              <label htmlFor="entry-start">{t(lang, 'start')}</label>
              <input id="entry-start" type="time" value={start} onChange={(event) => setStart(event.target.value)} required />
            </div>
            <div>
              <label htmlFor="entry-end">{t(lang, 'finish')}</label>
              <input id="entry-end" type="time" value={end} onChange={(event) => setEnd(event.target.value)} required />
            </div>
          </div>
        ) : <Alert kind="info">{t(lang, 'sundayNote')}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {message && <Alert kind="success">{message}</Alert>}
        <button className="primary" type="submit" disabled={saving || loading}>{saving ? t(lang, 'saving') : t(lang, 'submit')}</button>
      </form>

      <section className="card">
        <h2>{t(lang, 'recentEntries')}</h2>
        {loading ? <p className="muted">{t(lang, 'loading')}</p> : <WorkerEntriesTable entries={entries} lang={lang} />}
      </section>
    </main>
  );
}

function WorkerEntriesTable({ entries, lang }: { entries: Entry[]; lang: Lang }) {
  if (!entries.length) return <p className="muted">{t(lang, 'noEntries')}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t(lang, 'date')}</th>
            <th>{t(lang, 'workSite')}</th>
            <th>{t(lang, 'start')}</th>
            <th>{t(lang, 'finish')}</th>
            <th>{t(lang, 'regular')}</th>
            <th>{t(lang, 'overtime')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry._id}>
              <td>{entry.date}</td>
              <td>{entry.siteName}</td>
              <td>{entry.start || '—'}</td>
              <td>{entry.end || '—'}</td>
              <td>{formatHours(entry.regular)}</td>
              <td>{formatHours(entry.overtime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type AdminTab = 'timesheets' | 'workers' | 'sites';
type Filters = { workerId: string; site: string; date: string; week: string; month: string };

function Admin({ lang, setLang, logout }: SharedProps) {
  const [tab, setTab] = useState<AdminTab>('timesheets');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ workerId: '', site: '', date: '', week: '', month: '' });
  const [workerDraft, setWorkerDraft] = useState<{ id?: string; name: string; workerCode: string; pin: string }>({ name: '', workerCode: '', pin: '' });
  const [siteDraft, setSiteDraft] = useState<{ id?: string; name: string }>({ name: '' });
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [entryDraft, setEntryDraft] = useState({ date: today, site: '', start: '08:00', end: '16:00' });
  const [saving, setSaving] = useState(false);

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'AUTH_REQUIRED') logout();
    setError(errorMessage(lang, err));
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [entryRows, workerRows, siteRows] = await Promise.all([
        api<Entry[]>('/entries'),
        api<Worker[]>('/admin/workers'),
        api<Site[]>('/admin/sites'),
      ]);
      setEntries(entryRows);
      setWorkers(workerRows);
      setSites(siteRows);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (filters.workerId && entry.workerId !== filters.workerId) return false;
    if (filters.site && entry.site !== filters.site) return false;
    if (filters.date && entry.date !== filters.date) return false;
    if (filters.week && isoWeekKey(entry.date) !== filters.week) return false;
    if (filters.month && entry.date.slice(0, 7) !== filters.month) return false;
    return true;
  }), [entries, filters]);

  const activeWorkers = workers.filter((worker) => worker.active);
  const activeWorkerIds = new Set(activeWorkers.map((worker) => worker._id));
  const submittedTodayIds = new Set(entries.filter((entry) => entry.date === today && activeWorkerIds.has(entry.workerId)).map((entry) => entry.workerId));

  const resetMessages = () => {
    setError('');
    setMessage('');
  };

  const saveWorker = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();
    setSaving(true);
    try {
      if (workerDraft.id) {
        await api(`/admin/workers/${workerDraft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: workerDraft.name, workerCode: workerDraft.workerCode, ...(workerDraft.pin ? { pin: workerDraft.pin } : {}) }),
        });
        setMessage(t(lang, 'updatedWorker'));
      } else {
        await api('/admin/workers', {
          method: 'POST',
          body: JSON.stringify({ name: workerDraft.name, workerCode: workerDraft.workerCode, pin: workerDraft.pin }),
        });
        setMessage(t(lang, 'createdWorker'));
      }
      setWorkerDraft({ name: '', workerCode: '', pin: '' });
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggleWorker = async (worker: Worker) => {
    if (worker.active && !window.confirm(t(lang, 'confirmDisableWorker'))) return;
    resetMessages();
    try {
      await api(`/admin/workers/${worker._id}`, { method: 'PATCH', body: JSON.stringify({ active: !worker.active }) });
      setMessage(t(lang, 'updatedWorker'));
      await load();
    } catch (err) {
      handleError(err);
    }
  };

  const saveSite = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();
    setSaving(true);
    try {
      if (siteDraft.id) {
        await api(`/admin/sites/${siteDraft.id}`, { method: 'PATCH', body: JSON.stringify({ name: siteDraft.name }) });
        setMessage(t(lang, 'updatedSite'));
      } else {
        await api('/admin/sites', { method: 'POST', body: JSON.stringify({ name: siteDraft.name }) });
        setMessage(t(lang, 'createdSite'));
      }
      setSiteDraft({ name: '' });
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggleSite = async (site: Site) => {
    if (site.active && !window.confirm(t(lang, 'confirmDisableSite'))) return;
    resetMessages();
    try {
      await api(`/admin/sites/${site._id}`, { method: 'PATCH', body: JSON.stringify({ active: !site.active }) });
      setMessage(t(lang, 'updatedSite'));
      await load();
    } catch (err) {
      handleError(err);
    }
  };

  const openEntryEdit = (entry: Entry) => {
    resetMessages();
    setEditingEntry(entry);
    setEntryDraft({ date: entry.date, site: entry.site, start: entry.start || '08:00', end: entry.end || '16:00' });
  };

  const saveEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingEntry) return;
    resetMessages();
    setSaving(true);
    try {
      const sunday = isSunday(entryDraft.date);
      await api(`/admin/entries/${editingEntry._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: entryDraft.date,
          site: entryDraft.site,
          start: sunday ? null : entryDraft.start,
          end: sunday ? null : entryDraft.end,
        }),
      });
      setEditingEntry(null);
      setMessage(t(lang, 'updatedEntry'));
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const exportRows = (format: 'csv' | 'xls') => {
    if (!filteredEntries.length) {
      setError(t(lang, 'exportNoRows'));
      return;
    }
    setError('');
    const headers = [t(lang, 'workerName'), t(lang, 'workerCode'), t(lang, 'date'), t(lang, 'workSite'), t(lang, 'start'), t(lang, 'finish'), t(lang, 'regular'), t(lang, 'overtime')];
    const rows = filteredEntries.map((entry) => [entry.workerName, entry.workerCode || '', entry.date, entry.siteName, entry.start || '', entry.end || '', entry.regular, entry.overtime]);
    if (format === 'csv') {
      const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`;
      downloadFile(csv, 'text/csv;charset=utf-8', `worktime-${today}.csv`);
      return;
    }
    const table = `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    downloadFile(`\uFEFF${table}`, 'application/vnd.ms-excel;charset=utf-8', `worktime-${today}.xls`);
  };

  return (
    <main className="shell wide admin-shell">
      <Header title={t(lang, 'dashboard')} lang={lang} setLang={setLang} logout={logout} />
      <nav className="nav admin-nav">
        {(['timesheets', 'workers', 'sites'] as AdminTab[]).map((item) => (
          <button type="button" key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); resetMessages(); }}>
            {t(lang, item)}
          </button>
        ))}
      </nav>

      {error && <Alert kind="error">{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}

      {tab === 'timesheets' && (
        <section className="card">
          <div className="stats">
            <Stat value={activeWorkers.length} label={t(lang, 'activeWorkers')} />
            <Stat value={submittedTodayIds.size} label={t(lang, 'submittedToday')} />
            <Stat value={Math.max(0, activeWorkers.length - submittedTodayIds.size)} label={t(lang, 'missingToday')} />
          </div>
          <div className="section-heading">
            <h2>{t(lang, 'timesheets')}</h2>
            <div className="button-row">
              <button type="button" onClick={() => exportRows('csv')}>{t(lang, 'exportCsv')}</button>
              <button type="button" onClick={() => exportRows('xls')}>{t(lang, 'exportExcel')}</button>
            </div>
          </div>
          <div className="filters">
            <div>
              <label>{t(lang, 'workerLabel')}</label>
              <select value={filters.workerId} onChange={(event) => setFilters((current) => ({ ...current, workerId: event.target.value }))}>
                <option value="">{t(lang, 'allWorkers')}</option>
                {workers.map((worker) => <option key={worker._id} value={worker._id}>{worker.name} ({worker.workerCode})</option>)}
              </select>
            </div>
            <div>
              <label>{t(lang, 'workSite')}</label>
              <select value={filters.site} onChange={(event) => setFilters((current) => ({ ...current, site: event.target.value }))}>
                <option value="">{t(lang, 'allSites')}</option>
                {sites.map((site) => <option key={site._id} value={site._id}>{site.name}</option>)}
              </select>
            </div>
            <div>
              <label>{t(lang, 'exactDate')}</label>
              <input type="date" max={today} value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} />
            </div>
            <div>
              <label>{t(lang, 'week')}</label>
              <input type="week" value={filters.week} onChange={(event) => setFilters((current) => ({ ...current, week: event.target.value }))} />
            </div>
            <div>
              <label>{t(lang, 'month')}</label>
              <input type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} />
            </div>
            <div className="filter-action">
              <button type="button" onClick={() => setFilters({ workerId: '', site: '', date: '', week: '', month: '' })}>{t(lang, 'clearFilters')}</button>
            </div>
          </div>
          {loading ? <p className="muted">{t(lang, 'loading')}</p> : (
            <AdminEntriesTable entries={filteredEntries} lang={lang} onEdit={openEntryEdit} />
          )}
        </section>
      )}

      {tab === 'workers' && (
        <section className="card">
          <div className="section-heading"><h2>{t(lang, 'workers')}</h2></div>
          <form className="editor-form" onSubmit={saveWorker}>
            <div>
              <label>{t(lang, 'workerName')}</label>
              <input value={workerDraft.name} onChange={(event) => setWorkerDraft((current) => ({ ...current, name: event.target.value }))} required />
            </div>
            <div>
              <label>{t(lang, 'workerCode')}</label>
              <input value={workerDraft.workerCode} placeholder={t(lang, 'workerCodeHint')} onChange={(event) => setWorkerDraft((current) => ({ ...current, workerCode: event.target.value.toUpperCase() }))} required />
            </div>
            <div>
              <label>{workerDraft.id ? t(lang, 'newPinOptional') : t(lang, 'pin')}</label>
              <input type="password" inputMode="numeric" placeholder={t(lang, 'pinHint')} value={workerDraft.pin} onChange={(event) => setWorkerDraft((current) => ({ ...current, pin: event.target.value }))} required={!workerDraft.id} />
            </div>
            <div className="form-actions">
              <button className="primary compact" type="submit" disabled={saving}>{saving ? t(lang, 'saving') : workerDraft.id ? t(lang, 'updateWorker') : t(lang, 'addWorker')}</button>
              {workerDraft.id && <button type="button" onClick={() => setWorkerDraft({ name: '', workerCode: '', pin: '' })}>{t(lang, 'cancel')}</button>}
            </div>
          </form>
          <div className="manage-list">
            {workers.map((worker) => (
              <div className="manage-row" key={worker._id}>
                <div>
                  <strong>{worker.name}</strong>
                  <span>{worker.workerCode}</span>
                </div>
                <StatusBadge active={worker.active} lang={lang} />
                <div className="button-row">
                  <button type="button" onClick={() => setWorkerDraft({ id: worker._id, name: worker.name, workerCode: worker.workerCode, pin: '' })}>{t(lang, 'edit')}</button>
                  <button type="button" className={worker.active ? 'danger-soft' : 'success-soft'} onClick={() => void toggleWorker(worker)}>{worker.active ? t(lang, 'disable') : t(lang, 'enable')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'sites' && (
        <section className="card">
          <div className="section-heading"><h2>{t(lang, 'sites')}</h2></div>
          <form className="editor-form site-editor" onSubmit={saveSite}>
            <div>
              <label>{t(lang, 'siteName')}</label>
              <input value={siteDraft.name} onChange={(event) => setSiteDraft((current) => ({ ...current, name: event.target.value }))} required />
            </div>
            <div className="form-actions">
              <button className="primary compact" type="submit" disabled={saving}>{saving ? t(lang, 'saving') : siteDraft.id ? t(lang, 'updateSite') : t(lang, 'addSite')}</button>
              {siteDraft.id && <button type="button" onClick={() => setSiteDraft({ name: '' })}>{t(lang, 'cancel')}</button>}
            </div>
          </form>
          <div className="manage-list">
            {sites.map((site) => (
              <div className="manage-row" key={site._id}>
                <div><strong>{site.name}</strong></div>
                <StatusBadge active={site.active} lang={lang} />
                <div className="button-row">
                  <button type="button" onClick={() => setSiteDraft({ id: site._id, name: site.name })}>{t(lang, 'edit')}</button>
                  <button type="button" className={site.active ? 'danger-soft' : 'success-soft'} onClick={() => void toggleSite(site)}>{site.active ? t(lang, 'disable') : t(lang, 'enable')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {editingEntry && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditingEntry(null)}>
          <form className="modal-card" onSubmit={saveEntry} onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <h2>{t(lang, 'editEntry')}</h2>
                <p className="muted">{editingEntry.workerName} · {editingEntry.workerCode}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setEditingEntry(null)}>×</button>
            </div>
            <label>{t(lang, 'date')}</label>
            <input type="date" max={today} value={entryDraft.date} onChange={(event) => setEntryDraft((current) => ({ ...current, date: event.target.value }))} required />
            <label>{t(lang, 'workSite')}</label>
            <select value={entryDraft.site} onChange={(event) => setEntryDraft((current) => ({ ...current, site: event.target.value }))} required>
              {sites.map((site) => <option key={site._id} value={site._id}>{site.name}{site.active ? '' : ` (${t(lang, 'disabled')})`}</option>)}
            </select>
            {!isSunday(entryDraft.date) ? (
              <div className="two">
                <div>
                  <label>{t(lang, 'start')}</label>
                  <input type="time" value={entryDraft.start} onChange={(event) => setEntryDraft((current) => ({ ...current, start: event.target.value }))} required />
                </div>
                <div>
                  <label>{t(lang, 'finish')}</label>
                  <input type="time" value={entryDraft.end} onChange={(event) => setEntryDraft((current) => ({ ...current, end: event.target.value }))} required />
                </div>
              </div>
            ) : <Alert kind="info">{t(lang, 'sundayNote')}</Alert>}
            <div className="modal-actions">
              <button type="button" onClick={() => setEditingEntry(null)}>{t(lang, 'cancel')}</button>
              <button className="primary compact" type="submit" disabled={saving}>{saving ? t(lang, 'saving') : t(lang, 'save')}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function AdminEntriesTable({ entries, lang, onEdit }: { entries: Entry[]; lang: Lang; onEdit: (entry: Entry) => void }) {
  if (!entries.length) return <p className="muted">{t(lang, 'noFilteredRows')}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t(lang, 'workerLabel')}</th>
            <th>{t(lang, 'date')}</th>
            <th>{t(lang, 'workSite')}</th>
            <th>{t(lang, 'start')}</th>
            <th>{t(lang, 'finish')}</th>
            <th>{t(lang, 'regular')}</th>
            <th>{t(lang, 'overtime')}</th>
            <th>{t(lang, 'actions')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry._id}>
              <td><strong>{entry.workerName}</strong><small>{entry.workerCode}</small></td>
              <td>{entry.date}</td>
              <td>{entry.siteName}</td>
              <td>{entry.start || '—'}</td>
              <td>{entry.end || '—'}</td>
              <td>{formatHours(entry.regular)}</td>
              <td>{formatHours(entry.overtime)}</td>
              <td><button type="button" onClick={() => onEdit(entry)}>{t(lang, 'edit')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div><b>{value}</b><span>{label}</span></div>;
}

function StatusBadge({ active, lang }: { active: boolean; lang: Lang }) {
  return <span className={`status-badge ${active ? 'status-active' : 'status-disabled'}`}>{active ? t(lang, 'active') : t(lang, 'disabled')}</span>;
}

function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  return <p className={`alert alert-${kind}`}>{children}</p>;
}

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
