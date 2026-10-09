import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, LanguageToggle } from '../components/Common';
import { errorMessage, t } from '../i18n';
import type { Lang, Role } from '../types';

export function LoginPage({
  lang,
  setLang,
  portal,
  onLogin
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
  portal: Role;
  onLogin: (role: Role, token: string, name: string) => void;
}) {
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
      const payload = portal === 'worker'
        ? { role: 'worker', pin }
        : { role: 'admin', email, password };

      const result = await api<{ role: Role; token: string; name?: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      onLogin(
        result.role,
        result.token,
        result.name || (portal === 'admin' ? email : t(lang, 'worker'))
      );
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
          <div className="brand-block">
            <b>WorkTime</b>
            <span>{portal === 'worker' ? t(lang, 'workerLink') : t(lang, 'adminLink')}</span>
          </div>
          <LanguageToggle lang={lang} setLang={setLang} />
        </div>
      </section>

      <form className="card" onSubmit={submit}>
        <h1>{portal === 'worker' ? t(lang, 'workerLogin') : t(lang, 'adminLogin')}</h1>

        {portal === 'worker' ? (
          <>
            <label htmlFor="worker-pin">{t(lang, 'pin')}</label>
            <input
              id="worker-pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
              required
            />
          </>
        ) : (
          <>
            <label htmlFor="admin-email">{t(lang, 'email')}</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <label htmlFor="admin-password">{t(lang, 'password')}</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </>
        )}

        {error && <Alert kind="error">{error}</Alert>}
        <button className="primary" type="submit" disabled={loading}>
          {loading ? t(lang, 'loading') : t(lang, 'login')}
        </button>
      </form>
    </main>
  );
}
