import { useState } from 'react';
import { api } from './api';
import { Alert, LanguageToggle } from './components/Common';
import { t } from './i18n';
import { AdminPage } from './pages/AdminPage';
import { LoginPage } from './pages/LoginPage';
import { WorkerPage } from './pages/WorkerPage';
import type { Lang, Role } from './types';

function currentPortal(): Role {
  return window.location.pathname === '/admin' ? 'admin' : 'worker';
}

export function App() {
  const portal = currentPortal();
  const [role, setRole] = useState<Role | ''>((localStorage.getItem('role') as Role) || '');
  const [name, setName] = useState(localStorage.getItem('displayName') || '');
  const [lang, setLang] = useState<Lang>((localStorage.getItem('lang') as Lang) || 'en');

  const changeLanguage = (next: Lang) => {
    localStorage.setItem('lang', next);
    setLang(next);
  };

  const login = (nextRole: Role, token: string, displayName: string) => {
    localStorage.setItem('role', nextRole);
    localStorage.setItem('token', token);
    localStorage.setItem('displayName', displayName);
    setRole(nextRole);
    setName(displayName);
  };

  const logout = () => {
    void api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    localStorage.removeItem('role');
    localStorage.removeItem('token');
    localStorage.removeItem('displayName');
    setRole('');
    setName('');
  };

  if (role && role !== portal) {
    return (
      <main className="shell login-shell">
        <section className="hero login-hero"><div className="login-hero-top"><div className="brand-block"><b>WorkTime</b><span>{t(lang, 'authRequired')}</span></div><LanguageToggle lang={lang} setLang={changeLanguage} /></div></section>
        <section className="card"><Alert kind="info">{lang === 'el' ? 'Αποσυνδεθείτε πρώτα και ανοίξτε τον σωστό σύνδεσμο.' : 'Logout first, then open the correct link.'}</Alert><button className="primary" type="button" onClick={logout}>{t(lang, 'logout')}</button></section>
      </main>
    );
  }

  if (!role) return <LoginPage lang={lang} setLang={changeLanguage} portal={portal} onLogin={login} />;

  return role === 'admin'
    ? <AdminPage lang={lang} setLang={changeLanguage} logout={logout} name={name} />
    : <WorkerPage lang={lang} setLang={changeLanguage} logout={logout} name={name} />;
}
