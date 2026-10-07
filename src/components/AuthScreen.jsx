import { useState } from "react";
import { supabase } from "../lib/supabase.js";

export default function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setMsg({ ok: true, text: "Účet je vytvorený. Potvrď ho cez odkaz v e-maile a potom sa prihlás." });
      }
    } catch (err) {
      setMsg({ ok: false, text: translate(err.message) });
    } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">Kuriérska mapa</div>
        <p className="muted">Balíky zoskupené podľa toho, kde reálne stoja domy.</p>
        <div className="seg" role="group" aria-label="Prihlásenie alebo registrácia">
          <button type="button" aria-pressed={mode === "login"} onClick={() => setMode("login")}>Prihlásiť sa</button>
          <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>Nový účet</button>
        </div>
        <form onSubmit={submit} className="stack">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="password">Heslo</label>
          <input id="password" type="password" minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"}
            required value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn primary big" disabled={busy}>{busy ? "Chvíľu…" : mode === "login" ? "Prihlásiť sa" : "Vytvoriť účet"}</button>
        </form>
        {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
      </div>
    </div>
  );
}

function translate(m) {
  if (/Invalid login/i.test(m)) return "Nesprávny e-mail alebo heslo.";
  if (/already registered/i.test(m)) return "Tento e-mail už má účet. Prihlás sa.";
  if (/Email not confirmed/i.test(m)) return "E-mail ešte nie je potvrdený. Klikni na odkaz v e-maile.";
  if (/Password should be/i.test(m)) return "Heslo musí mať aspoň 6 znakov.";
  return m;
}
