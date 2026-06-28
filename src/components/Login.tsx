import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('Supabase non configuré (.env.local manquant).');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) setError(traduire(error.message));
        // En cas de succès, onAuthStateChange bascule l'app automatiquement.
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) setError(traduire(error.message));
        else
          setInfo(
            'Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.',
          );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-warm-deep p-4">
      {/* Fond peint (Hall d'Askr) + voile */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/feh/bg/askr-hall.png')" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 0%, rgba(10,14,24,.4), rgba(8,11,20,.82) 82%)',
        }}
      />

      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-gold/30 bg-[rgba(20,15,9,.82)] p-7 font-feh shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-sm">
        <img
          src="/feh/ui/logo.png"
          alt="Fire Emblem Heroes"
          className="mx-auto mb-4 h-12 w-auto drop-shadow-[0_2px_3px_rgba(0,0,0,0.6)]"
        />
        <h1 className="mb-1 text-center font-feh text-[20px] font-bold text-gold-text">
          {mode === 'signin' ? 'Connexion' : 'Créer un compte'}
        </h1>
        <p className="mb-5 text-center text-[12.5px] text-warm-dim">
          Catalogue & collection Fire Emblem Heroes
        </p>

        <form onSubmit={submit} className="space-y-3">
          <Field
            label="E-mail"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="ton@email.fr"
            autoComplete="email"
          />
          <Field
            label="Mot de passe"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />

          {error ? (
            <p className="rounded-lg bg-red-500/15 px-3 py-2 text-[12.5px] text-red-200">
              {error}
            </p>
          ) : null}
          {info ? (
            <p className="rounded-lg bg-emerald-500/15 px-3 py-2 text-[12.5px] text-emerald-200">
              {info}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="feh-tab w-full font-feh text-[14px] font-bold tracking-wide text-[#3a2a08] transition hover:brightness-110 disabled:opacity-60"
          >
            {busy
              ? '…'
              : mode === 'signin'
                ? 'Se connecter'
                : "S'inscrire"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setInfo(null);
          }}
          className="mt-4 w-full text-center text-[12.5px] text-warm-dim underline-offset-2 transition hover:text-gold-light hover:underline"
        >
          {mode === 'signin'
            ? 'Pas encore de compte ? S’inscrire'
            : 'Déjà un compte ? Se connecter'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-warm-dim">
        {label}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-warm-text outline-none transition focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
      />
    </label>
  );
}

// Quelques messages d'erreur Supabase traduits.
function traduire(msg: string): string {
  if (/invalid login credentials/i.test(msg))
    return 'E-mail ou mot de passe incorrect.';
  if (/email not confirmed/i.test(msg))
    return 'E-mail non confirmé : vérifie ta boîte mail.';
  if (/user already registered/i.test(msg))
    return 'Un compte existe déjà avec cet e-mail.';
  if (/password should be at least/i.test(msg))
    return 'Mot de passe trop court (6 caractères minimum).';
  return msg;
}
