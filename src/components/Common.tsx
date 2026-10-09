import React from 'react';
import { t } from '../i18n';
import type { Lang } from '../types';

export type SharedPageProps = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  logout: () => void;
  name: string;
};

export function LanguageToggle({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <div className="language-toggle" aria-label={t(lang, 'language')}>
      <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
      <button type="button" className={lang === 'el' ? 'active' : ''} onClick={() => setLang('el')}>ΕΛ</button>
    </div>
  );
}

export function Header({ title, lang, setLang, logout, name }: SharedPageProps & { title: string }) {
  return (
    <section className="hero row">
      <div className="brand-block">
        <b>WorkTime</b>
        <span>{title}</span>
        <span>{t(lang, 'signedInAs')}: {name || '—'}</span>
      </div>
      <div className="header-actions">
        <LanguageToggle lang={lang} setLang={setLang} />
        <button type="button" className="ghost-on-dark" onClick={logout}>{t(lang, 'logout')}</button>
      </div>
    </section>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  return <p className={`alert alert-${kind}`}>{children}</p>;
}

export function Stat({ value, label, onClick }: { value: number | string; label: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) onClick();
      }}
    >
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function StatusBadge({ active, lang }: { active: boolean; lang: Lang }) {
  return (
    <span className={`status-badge ${active ? 'status-active' : 'status-disabled'}`}>
      {active ? t(lang, 'active') : t(lang, 'disabled')}
    </span>
  );
}
