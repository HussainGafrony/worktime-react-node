import { useEffect, useState, type FormEvent } from 'react';
import { api, apiDownload, ApiError } from '../api';
import { Alert, Header, Stat, StatusBadge, type SharedPageProps } from '../components/Common';
import { AdminEntriesTable } from '../components/EntriesTable';
import { errorMessage, t } from '../i18n';
import { formatHours, localToday } from '../lib/date';
import type { AdminEntriesResponse, DashboardSummary, Entry, Site, Worker } from '../types';

type AdminTab = 'timesheets' | 'workers' | 'sites';
type Filters = { workerId: string; site: string; date: string; week: string; month: string };
type SeedResult = { workersCreated: number; sitesCreated: number; entriesCreated: number };
const emptyFilters: Filters = { workerId: '', site: '', date: '', week: '', month: '' };
const seedDataEnabled = import.meta.env.VITE_ENABLE_SEED_DATA?.toLowerCase() === 'true';

function queryString(filters: Filters, extra: Record<string, string | number | boolean> = {}) {
  const params = new URLSearchParams();
  if (filters.workerId) params.set('worker', filters.workerId);
  if (filters.site) params.set('site', filters.site);
  if (filters.date) params.set('date', filters.date);
  else if (filters.week) params.set('week', filters.week);
  else if (filters.month) params.set('month', filters.month);
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return params.toString();
}

export function AdminPage({ lang, setLang, logout, name }: SharedPageProps) {
  const today = localToday();
  const [tab, setTab] = useState<AdminTab>('timesheets');
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary>({ activeWorkers: 0, submittedToday: 0, missingToday: 0 });
  const [report, setReport] = useState<AdminEntriesResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [workerDraft, setWorkerDraft] = useState<{ id?: string; name: string; pin: string }>({ name: '', pin: '' });
  const [siteDraft, setSiteDraft] = useState<{ id?: string; name: string }>({ name: '' });
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null);
  const [note, setNote] = useState('');
  const [lateReport, setLateReport] = useState<AdminEntriesResponse | null>(null);
  const [latePage, setLatePage] = useState(1);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'AUTH_REQUIRED') logout();
    setError(errorMessage(lang, err));
  };

  const loadMeta = async () => {
    try {
      const [workerRows, siteRows, summary] = await Promise.all([
        api<Worker[]>('/admin/workers'),
        api<Site[]>('/admin/sites'),
        api<DashboardSummary>('/admin/dashboard')
      ]);
      setWorkers(workerRows);
      setSites(siteRows);
      setDashboard(summary);
    } catch (err) {
      handleError(err);
    }
  };

  const loadReport = async (targetPage = page) => {
    setLoading(true);
    setError('');
    try {
      const qs = queryString(filters, { page: targetPage, pageSize: 50 });
      const response = await api<AdminEntriesResponse>(`/admin/entries?${qs}`);
      setReport(response);
      setPage(response.pagination.page);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadMeta(); }, []);
  useEffect(() => { void loadReport(page); }, [page, filters]);

  const setFilter = (patch: Partial<Filters>) => {
    setPage(1);
    setLatePage(1);
    setLateReport(null);
    setFilters((current) => ({ ...current, ...patch }));
  };

  const resetMessages = () => { setError(''); setMessage(''); };

  const saveWorker = async (event: FormEvent) => {
    event.preventDefault(); resetMessages(); setSaving(true);
    try {
      if (workerDraft.id) {
        await api(`/admin/workers/${workerDraft.id}`, { method: 'PATCH', body: JSON.stringify({ name: workerDraft.name, ...(workerDraft.pin ? { pin: workerDraft.pin } : {}) }) });
      } else {
        await api('/admin/workers', { method: 'POST', body: JSON.stringify({ name: workerDraft.name, pin: workerDraft.pin }) });
      }
      setMessage(workerDraft.id ? t(lang, 'updatedWorker') : t(lang, 'createdWorker'));
      setWorkerDraft({ name: '', pin: '' });
      await loadMeta();
      await loadReport(1);
    } catch (err) { handleError(err); } finally { setSaving(false); }
  };

  const toggleWorker = async (worker: Worker) => {
    if (worker.active && !window.confirm(t(lang, 'confirmDisableWorker'))) return;
    try {
      await api(`/admin/workers/${worker._id}`, { method: 'PATCH', body: JSON.stringify({ active: !worker.active }) });
      await loadMeta();
    } catch (err) { handleError(err); }
  };

  const saveSite = async (event: FormEvent) => {
    event.preventDefault(); resetMessages(); setSaving(true);
    try {
      if (siteDraft.id) {
        await api(`/admin/sites/${siteDraft.id}`, { method: 'PATCH', body: JSON.stringify({ name: siteDraft.name }) });
      } else {
        await api('/admin/sites', { method: 'POST', body: JSON.stringify({ name: siteDraft.name }) });
      }
      setMessage(siteDraft.id ? t(lang, 'updatedSite') : t(lang, 'createdSite'));
      setSiteDraft({ name: '' });
      await loadMeta();
    } catch (err) { handleError(err); } finally { setSaving(false); }
  };

  const toggleSite = async (site: Site) => {
    if (site.active && !window.confirm(t(lang, 'confirmDisableSite'))) return;
    try {
      await api(`/admin/sites/${site._id}`, { method: 'PATCH', body: JSON.stringify({ active: !site.active }) });
      await loadMeta();
    } catch (err) { handleError(err); }
  };

  const openNote = (entry: Entry) => { setNoteEntry(entry); setNote(entry.adminNote || ''); };

  const saveNote = async (event: FormEvent) => {
    event.preventDefault(); if (!noteEntry) return; setSaving(true);
    try {
      await api(`/admin/entries/${noteEntry._id}`, { method: 'PATCH', body: JSON.stringify({ adminNote: note }) });
      setNoteEntry(null); setNote(''); setMessage(t(lang, 'updatedEntry'));
      await loadReport(page);
      if (lateReport) await loadLateRows(latePage);
    } catch (err) { handleError(err); } finally { setSaving(false); }
  };

  const loadLateRows = async (targetPage: number) => {
    try {
      const qs = queryString(filters, { late: true, page: targetPage, pageSize: 50 });
      const response = await api<AdminEntriesResponse>(`/admin/entries?${qs}`);
      setLateReport(response);
      setLatePage(response.pagination.page);
    } catch (err) {
      handleError(err);
    }
  };

  const showLateRows = async () => {
    if (lateReport) {
      setLateReport(null);
      setLatePage(1);
      return;
    }
    await loadLateRows(1);
  };

  const seedData = async () => {
    if (!window.confirm(t(lang, 'confirmSeedData'))) return;

    resetMessages();
    setSeeding(true);
    try {
      const result = await api<SeedResult>('/admin/seed', { method: 'POST' });
      setMessage(
        `${t(lang, 'seedDataDone')} ${result.workersCreated} / ${result.sitesCreated} / ${result.entriesCreated}`
      );
      setPage(1);
      setLatePage(1);
      setLateReport(null);
      await Promise.all([loadMeta(), loadReport(1)]);
    } catch (err) {
      handleError(err);
    } finally {
      setSeeding(false);
    }
  };

  const exportRows = async (format: 'csv' | 'xlsx') => {
    try {
      const qs = queryString(filters, { format });
      await apiDownload(`/admin/entries/export?${qs}`, `worktime-${today}.${format}`);
    } catch (err) { handleError(err); }
  };

  const hours = report?.hoursByWorker || [];
  const rows = report?.items || [];
  const pagination = report?.pagination;
  const canPrevious = Boolean(pagination && pagination.page > 1);
  const canNext = Boolean(pagination && pagination.page < pagination.pages);

  return (
    <main className="shell wide admin-shell">
      <Header title={t(lang, 'dashboard')} lang={lang} setLang={setLang} logout={logout} name={name} />
      <div className="admin-toolbar">
        <nav className="nav admin-nav">
          {(['timesheets', 'workers', 'sites'] as AdminTab[]).map((item) => (
            <button type="button" key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{t(lang, item)}</button>
          ))}
        </nav>

        {seedDataEnabled && (
          <button
            type="button"
            className="seed-icon-button"
            onClick={() => void seedData()}
            disabled={seeding}
            title={t(lang, 'seedData')}
            aria-label={t(lang, 'seedData')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <ellipse cx="12" cy="5" rx="7" ry="3" />
              <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
              <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
            </svg>
          </button>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}

      {tab === 'timesheets' && (
        <section className="card">
          <div className="stats">
            <Stat value={dashboard.activeWorkers} label={t(lang, 'activeWorkers')} />
            <Stat value={dashboard.submittedToday} label={t(lang, 'submittedToday')} />
            <Stat value={dashboard.missingToday} label={t(lang, 'missingToday')} />
            <Stat value={formatHours(report?.totals.regular || 0)} label={t(lang, 'totalRegular')} />
            <Stat value={formatHours(report?.totals.overtime || 0)} label={t(lang, 'totalOvertime')} />
            <Stat value={report?.lateCount || 0} label={t(lang, 'lateSubmissions')} onClick={() => void showLateRows()} />
          </div>

          {lateReport && (
            <div className="card soft-card">
              <h3>{t(lang, 'lateList')}</h3>
              <AdminEntriesTable entries={lateReport.items} lang={lang} onNote={openNote} />
              {lateReport.pagination.total > 0 && (
                <div className="pagination">
                  <button
                    type="button"
                    disabled={lateReport.pagination.page <= 1}
                    onClick={() => void loadLateRows(Math.max(1, latePage - 1))}
                  >
                    ‹
                  </button>
                  <span>
                    {lateReport.pagination.page} / {lateReport.pagination.pages} · {lateReport.pagination.total}
                  </span>
                  <button
                    type="button"
                    disabled={lateReport.pagination.page >= lateReport.pagination.pages}
                    onClick={() => void loadLateRows(latePage + 1)}
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="section-heading">
            <h2>{t(lang, 'timesheets')}</h2>
            <div className="button-row">
              <button type="button" onClick={() => void exportRows('csv')}>{t(lang, 'exportCsv')}</button>
              <button type="button" onClick={() => void exportRows('xlsx')}>{t(lang, 'exportExcel')}</button>
            </div>
          </div>

          <div className="filters">
            <div><label>{t(lang, 'workerLabel')}</label><select value={filters.workerId} onChange={(e) => setFilter({ workerId: e.target.value })}><option value="">{t(lang, 'allWorkers')}</option>{workers.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</select></div>
            <div><label>{t(lang, 'workSite')}</label><select value={filters.site} onChange={(e) => setFilter({ site: e.target.value })}><option value="">{t(lang, 'allSites')}</option>{sites.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></div>
            <div><label>{t(lang, 'exactDate')}</label><input type="date" max={today} value={filters.date} onChange={(e) => setFilter({ date: e.target.value, week: '', month: '' })} /></div>
            <div><label>{t(lang, 'week')}</label><input type="week" value={filters.week} onChange={(e) => setFilter({ week: e.target.value, date: '', month: '' })} /></div>
            <div><label>{t(lang, 'month')}</label><input type="month" value={filters.month} onChange={(e) => setFilter({ month: e.target.value, date: '', week: '' })} /></div>
            <div className="filter-action"><button type="button" onClick={() => { setPage(1); setLatePage(1); setFilters(emptyFilters); setLateReport(null); }}>{t(lang, 'clearFilters')}</button></div>
          </div>

          <div className="card soft-card">
            <h3>{lang === 'el' ? 'Ώρες ανά εργαζόμενο' : 'Hours by worker'}</h3>
            {hours.length ? <div className="table-wrap"><table><thead><tr><th>{t(lang, 'workerName')}</th><th>{t(lang, 'regular')}</th><th>{t(lang, 'overtime')}</th><th>Total</th><th>Entries</th></tr></thead><tbody>{hours.map((row) => <tr key={row.workerId}><td><strong>{row.workerName}</strong></td><td>{formatHours(row.regular)}</td><td>{formatHours(row.overtime)}</td><td>{formatHours(row.total)}</td><td>{row.entries}</td></tr>)}</tbody></table></div> : <p className="muted">{t(lang, 'noFilteredRows')}</p>}
          </div>

          {loading ? <p className="muted">{t(lang, 'loading')}</p> : <AdminEntriesTable entries={rows} lang={lang} onNote={openNote} />}

          {pagination && pagination.total > 0 && (
            <div className="pagination">
              <button type="button" disabled={!canPrevious} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
              <span>{pagination.page} / {pagination.pages} · {pagination.total}</span>
              <button type="button" disabled={!canNext} onClick={() => setPage((p) => p + 1)}>›</button>
            </div>
          )}
        </section>
      )}

      {tab === 'workers' && (
        <section className="card">
          <h2>{t(lang, 'workers')}</h2>
          <form className="editor-form worker-editor" onSubmit={saveWorker}>
            <div><label>{t(lang, 'workerName')}</label><input value={workerDraft.name} onChange={(e) => setWorkerDraft((c) => ({ ...c, name: e.target.value }))} required /></div>
            <div><label>{workerDraft.id ? t(lang, 'newPinOptional') : t(lang, 'pin')}</label><input type="password" inputMode="numeric" value={workerDraft.pin} onChange={(e) => setWorkerDraft((c) => ({ ...c, pin: e.target.value.replace(/\D/g, '').slice(0, 12) }))} required={!workerDraft.id} /></div>
            <div className="form-actions"><button className="primary compact" type="submit" disabled={saving}>{workerDraft.id ? t(lang, 'updateWorker') : t(lang, 'addWorker')}</button>{workerDraft.id && <button type="button" onClick={() => setWorkerDraft({ name: '', pin: '' })}>{t(lang, 'cancel')}</button>}</div>
          </form>
          <div className="manage-list">{workers.map((worker) => <div className="manage-row" key={worker._id}><strong>{worker.name}</strong><StatusBadge active={worker.active} lang={lang} /><div className="button-row"><button type="button" onClick={() => setWorkerDraft({ id: worker._id, name: worker.name, pin: '' })}>{t(lang, 'edit')}</button><button type="button" className={worker.active ? 'danger-soft' : 'success-soft'} onClick={() => void toggleWorker(worker)}>{worker.active ? t(lang, 'disable') : t(lang, 'enable')}</button></div></div>)}</div>
        </section>
      )}

      {tab === 'sites' && (
        <section className="card">
          <h2>{t(lang, 'sites')}</h2>
          <form className="editor-form site-editor" onSubmit={saveSite}>
            <div><label>{t(lang, 'siteName')}</label><input value={siteDraft.name} onChange={(e) => setSiteDraft((c) => ({ ...c, name: e.target.value }))} required /></div>
            <div className="form-actions"><button className="primary compact" type="submit" disabled={saving}>{siteDraft.id ? t(lang, 'updateSite') : t(lang, 'addSite')}</button>{siteDraft.id && <button type="button" onClick={() => setSiteDraft({ name: '' })}>{t(lang, 'cancel')}</button>}</div>
          </form>
          <div className="manage-list">{sites.map((site) => <div className="manage-row" key={site._id}><strong>{site.name}</strong><StatusBadge active={site.active} lang={lang} /><div className="button-row"><button type="button" onClick={() => setSiteDraft({ id: site._id, name: site.name })}>{t(lang, 'edit')}</button><button type="button" className={site.active ? 'danger-soft' : 'success-soft'} onClick={() => void toggleSite(site)}>{site.active ? t(lang, 'disable') : t(lang, 'enable')}</button></div></div>)}</div>
        </section>
      )}

      {noteEntry && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setNoteEntry(null)}>
          <form className="modal-card" onSubmit={saveNote} onMouseDown={(e) => e.stopPropagation()}>
            <div className="section-heading"><div><h2>{t(lang, 'adminNote')}</h2><p className="muted">{noteEntry.workerName} — {noteEntry.date}</p></div><button type="button" className="icon-button" onClick={() => setNoteEntry(null)}>×</button></div>
            <Alert kind="info">{t(lang, 'noteOnly')}</Alert>
            <label>{t(lang, 'adminNote')}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={500} />
            <div className="modal-actions"><button type="button" onClick={() => setNoteEntry(null)}>{t(lang, 'cancel')}</button><button className="primary compact" type="submit" disabled={saving}>{t(lang, 'save')}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
