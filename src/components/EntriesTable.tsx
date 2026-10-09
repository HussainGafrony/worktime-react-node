import { t } from '../i18n';
import { formatHours, formatSubmittedAt } from '../lib/date';
import type { Entry, Lang } from '../types';

export function WorkerEntriesTable({ entries, lang }: { entries: Entry[]; lang: Lang }) {
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
            <th>{t(lang, 'status')}</th>
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
              <td>{entry.isLate ? t(lang, 'late') : t(lang, 'onTime')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminEntriesTable({
  entries,
  lang,
  onNote
}: {
  entries: Entry[];
  lang: Lang;
  onNote: (entry: Entry) => void;
}) {
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
            <th>{t(lang, 'status')}</th>
            <th>{t(lang, 'submittedAt')}</th>
            <th>{t(lang, 'adminNote')}</th>
            <th>{t(lang, 'actions')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry._id}>
              <td><strong>{entry.workerName}</strong></td>
              <td>{entry.date}</td>
              <td>{entry.siteName}</td>
              <td>{entry.start || '—'}</td>
              <td>{entry.end || '—'}</td>
              <td>{formatHours(entry.regular)}</td>
              <td>{formatHours(entry.overtime)}</td>
              <td>
                <span className={`status-badge ${entry.isLate ? 'status-disabled' : 'status-active'}`}>
                  {entry.isLate ? t(lang, 'late') : t(lang, 'onTime')}
                </span>
              </td>
              <td>{formatSubmittedAt(entry.submittedAt)}</td>
              <td>{entry.adminNote || '—'}</td>
              <td><button type="button" onClick={() => onNote(entry)}>{t(lang, 'editNote')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
