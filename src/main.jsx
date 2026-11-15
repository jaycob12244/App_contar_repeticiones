import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dumbbell, Moon, Sun } from 'lucide-react';
import { allowed, apiForSession, supabase } from './backend.js';
import { TrainingApp } from './ui.jsx';
import './styles.css';

const profileKey = 'entreno:last-account';

function cachedProfile() {
  try {
    return JSON.parse(localStorage.getItem(profileKey));
  } catch {
    return null;
  }
}

function linkBack() {
  return `${window.location.origin}/${window.location.search}`;
}

function ThemeButton() {
  const [dark, setDark] = useState(() => localStorage.getItem('entreno:theme') === 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#141414' : '#f7f7f5';
    localStorage.setItem('entreno:theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <button className="icon-button" onClick={() => setDark(!dark)} aria-label={dark ? 'Activar modo claro' : 'Activar modo oscuro'}>
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}

function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand"><span className="brand-icon"><Dumbbell size={21} /></span>Entreno</div>
        <ThemeButton />
      </div>
    </header>
  );
}

function AuthForm({ initialMode = 'login', onPasswordUpdated }) {
  const [mode, setMode] = useState(initialMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = form.get('email')?.trim();
    const password = form.get('password');
    setPending(true);
    setError('');
    setNotice('');
    try {
      let response;
      if (mode === 'register') {
        response = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: form.get('name').trim() }, emailRedirectTo: linkBack() },
        });
      } else if (mode === 'reset') {
        response = await supabase.auth.resetPasswordForEmail(email, { redirectTo: linkBack() });
      } else if (mode === 'password') {
        response = await supabase.auth.updateUser({ password });
      } else {
        response = await supabase.auth.signInWithPassword({ email, password });
      }
      if (response.error) throw response.error;
      if (mode === 'register') setNotice('Revisa tu correo para confirmar la cuenta.');
      if (mode === 'reset') setNotice('Si hay una cuenta asociada, recibirás el enlace por correo.');
      if (mode === 'password') onPasswordUpdated();
    } catch (error) {
      if (error.status === 403 || error.code === 'hook_rejected') {
        setError('Este correo no está autorizado.');
      } else if (error.code === 'invalid_credentials') {
        setError('Revisa el correo y la contraseña.');
      } else if (error.code === 'email_not_confirmed') {
        setError('Confirma el correo antes de iniciar sesión.');
      } else if (error.code === 'weak_password') {
        setError('Elige una contraseña más segura.');
      } else {
        setError('No se pudo completar la solicitud. Revisa la conexión e intenta de nuevo.');
      }
    } finally {
      setPending(false);
    }
  }

  const titles = { login: 'Inicia sesión', register: 'Crea tu cuenta', reset: 'Recupera tu contraseña', password: 'Cambia tu contraseña' };
  const actions = { login: 'Entrar', register: 'Crear cuenta', reset: 'Enviar enlace', password: 'Guardar contraseña' };
  function switchMode(next) {
    setError('');
    setNotice('');
    setMode(next);
  }
  return (
    <main className="page auth-page">
      <section className="card auth-card">
        <h1>{titles[mode]}</h1>
        {mode === 'register' && <p>Usa el correo autorizado para tu cuenta.</p>}
        <form key={mode} className="stack" onSubmit={submit}>
          {mode === 'register' && <label>Nombre visible<input name="name" autoComplete="nickname" required maxLength={60} /></label>}
          {mode !== 'password' && <label>Correo<input type="email" name="email" autoComplete="email" required /></label>}
          {mode !== 'reset' && (
            <label>Contraseña<input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? undefined : 8} /></label>
          )}
          {notice && <p role="status" className="notice">{notice}</p>}
          {error && <p role="alert" className="notice">{error}</p>}
          <button className="primary" disabled={pending}>{pending ? 'Un momento…' : actions[mode]}</button>
        </form>
        {mode === 'login' && (
          <div className="auth-links">
            <button className="text-button" onClick={() => switchMode('register')}>Crear cuenta</button>
            <button className="text-button" onClick={() => switchMode('reset')}>Olvidé mi contraseña</button>
          </div>
        )}
        {['register', 'reset'].includes(mode) && <button className="text-button" onClick={() => switchMode('login')}>Volver a iniciar sesión</button>}
      </section>
    </main>
  );
}

function App() {
  const [auth, setAuth] = useState(null);
  const [profile, setProfile] = useState(cachedProfile);
  const [verifiedSession, setVerifiedSession] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [status, setStatus] = useState('loading');
  const authId = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      authId.current = session?.user.id ?? null;
      setVerifiedSession(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem(profileKey);
        setProfile(null);
      }
      setAuth({ session });
    });
    return () => subscription.unsubscribe();
  }, []);

  const denyAccess = useCallback(userId => {
    if (authId.current !== userId) return;
    localStorage.removeItem(profileKey);
    setProfile(null);
    setVerifiedSession(false);
    setStatus('denied');
  }, []);

  useEffect(() => {
    if (!auth) return;
    let current = true;
    const session = auth.session;
    async function verify() {
      setVerifiedSession(false);
      const stored = cachedProfile();
      if (!session) {
        setProfile(!navigator.onLine ? stored : null);
        setStatus('ready');
        return;
      }
      if (!navigator.onLine) {
        setProfile(stored?.id === session.user.id ? stored : null);
        setStatus('network');
        return;
      }
      if (stored?.id !== session.user.id) setProfile(null);
      try {
        if (!await allowed(apiForSession(session))) {
          if (current) denyAccess(session.user.id);
          return;
        }
        if (!current || authId.current !== session.user.id) return;
        const next = { id: session.user.id, name: session.user.user_metadata?.display_name || 'Usuario' };
        localStorage.setItem(profileKey, JSON.stringify(next));
        setProfile(next);
        setVerifiedSession(true);
        setStatus('ready');
      } catch {
        if (!current || authId.current !== session.user.id) return;
        setProfile(stored?.id === session.user.id ? stored : null);
        setStatus('network');
      }
    }
    const reconnect = () => void verify();
    void verify();
    window.addEventListener('online', reconnect);
    return () => {
      current = false;
      window.removeEventListener('online', reconnect);
    };
  }, [auth, denyAccess]);

  async function logout() {
    authId.current = null;
    localStorage.removeItem(profileKey);
    setProfile(null);
    setStatus('ready');
    setVerifiedSession(false);
    await supabase.auth.signOut({ scope: 'local' });
  }

  let screen;
  if (!supabase) {
    screen = <main className="page"><section className="card"><h1>Configura Entreno</h1><p>Agrega la URL y la clave pública de Supabase para conectar la aplicación.</p></section></main>;
  } else if (recovery) {
    screen = <AuthForm key="password" initialMode="password" onPasswordUpdated={() => setRecovery(false)} />;
  } else if (profile) {
    screen = <TrainingApp key={profile.id} profile={profile} sessionReady={verifiedSession} onAccessDenied={denyAccess} onLogout={logout} />;
  } else if (status === 'loading') {
    screen = <main className="page"><p role="status">Abriendo Entreno…</p></main>;
  } else if (status === 'denied') {
    screen = <main className="page"><section className="card"><h1>Correo sin acceso</h1><p>Usa una cuenta con un correo autorizado.</p><button className="primary" onClick={logout}>Volver a iniciar sesión</button></section></main>;
  } else {
    screen = <AuthForm />;
  }
  return <><Header />{screen}</>;
}

createRoot(document.getElementById('root')).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(error => console.error('No se pudo preparar la caché sin conexión.', error));
}
