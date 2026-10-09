import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { Alert, Header, type SharedPageProps } from '../components/Common';
import { WorkerEntriesTable } from '../components/EntriesTable';
import { errorMessage, t } from '../i18n';
import { isSunday, localToday, makeTimeOptions } from '../lib/date';
import type { Entry, Site } from '../types';

const timeOptions = makeTimeOptions();

export function WorkerPage({ lang, setLang, logout, name }: SharedPageProps) {
  const today = localToday();
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
        api<Entry[]>('/entries')
      ]);
      setSites(siteRows);
      setEntries(entryRows);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setSaving(true);

    try {
      await api('/entries', {
        method: 'POST',
        body: JSON.stringify({
          date,
          site,
          start: sunday ? null : start,
          end: sunday ? null : end
        })
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
      <Header title={t(lang, 'worker')} lang={lang} setLang={setLang} logout={logout} name={name} />

      <form className="card" onSubmit={submit}>
        <h2>{t(lang, 'newEntry')}</h2>
        <div className="form-grid">
          <div>
            <label htmlFor="entry-date">{t(lang, 'date')}</label>
            <input
              id="entry-date"
              type="date"
              max={today}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
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
              <select id="entry-start" value={start} onChange={(event) => setStart(event.target.value)}>
                {timeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="entry-end">{t(lang, 'finish')}</label>
              <select id="entry-end" value={end} onChange={(event) => setEnd(event.target.value)}>
                {timeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <Alert kind="info">{t(lang, 'sundayNote')}</Alert>
        )}

        {error && <Alert kind="error">{error}</Alert>}
        {message && <Alert kind="success">{message}</Alert>}

        <button className="primary" type="submit" disabled={saving || loading}>
          {saving ? t(lang, 'saving') : t(lang, 'submit')}
        </button>
      </form>

      <section className="card">
        <h2>{t(lang, 'recentEntries')}</h2>
        {loading
          ? <p className="muted">{t(lang, 'loading')}</p>
          : <WorkerEntriesTable entries={entries} lang={lang} />}
      </section>
    </main>
  );
}
