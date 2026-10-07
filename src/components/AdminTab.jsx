import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { monthBounds } from "../lib/stats.js";
import { STATUS_LIST, adminRows, depotTotals } from "../lib/admin.js";

const today = () => new Date().toLocaleDateString("sv-SE");
const eur = (x) => (x || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const n0 = (x) => Math.round(x || 0).toLocaleString("sk-SK");
const n1 = (x) => (x || 0).toLocaleString("sk-SK", { maximumFractionDigits: 1 });
const nameOf = (email) => (email || "").split("@")[0];
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : "–");

export default function AdminTab({ say }) {
  const [day, setDay] = useState(today());
  const [couriers, setCouriers] = useState([]);
  const [stops, setStops] = useState([]);
  const [trips, setTrips] = useState([]);
  const [fuel, setFuel] = useState([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("problem");
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const { fromDay, toDay, from, to } = monthBounds(new Date(day));

  const load = useCallback(async () => {
    setLoading(true);
    const [c, s, t, f] = await Promise.all([
      supabase.rpc("admin_couriers"),
      supabase.from("stops").select("*").eq("day", day).order("created_at"),
      supabase.from("trips").select("*").gte("day", fromDay).lt("day", toDay),
      supabase.from("fuel").select("*").gte("at", from.toISOString()).lt("at", to.toISOString()).order("at", { ascending: false }),
    ]);
    const e = c.error || s.error || t.error || f.error;
    if (e) setErr("Nepodarilo sa načítať: " + e.message);
    else { setCouriers(c.data); setStops(s.data); setTrips(t.data); setFuel(f.data); setErr(null); }
    setLoading(false);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => adminRows({ couriers, stops, trips, fuel, day }), [couriers, stops, trips, fuel, day]);
  const totals = useMemo(() => depotTotals(rows), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => !needle || r.email.toLowerCase().includes(needle));
    const by = {
      problem: (a, b) => (b.failed + b.later) - (a.failed + a.later) || a.pct - b.pct,
      progress: (a, b) => a.pct - b.pct,
      name: (a, b) => a.email.localeCompare(b.email, "sk"),
      saved: (a, b) => b.month.savedEur - a.month.savedEur,
    }[sort];
    return [...list].sort(by);
  }, [rows, q, sort]);

  async function changeStatus(stop, status) {
    const patch = { status, delivered: status === "delivered", status_at: new Date().toISOString() };
    setStops((s) => s.map((x) => (x.id === stop.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("stops").update(patch).eq("id", stop.id);
    if (error) { setErr(error.message); load(); } else say("Stav je zmenený.");
  }
  async function removeStop(stop) {
    setStops((s) => s.filter((x) => x.id !== stop.id));
    const { error } = await supabase.from("stops").delete().eq("id", stop.id);
    if (error) { setErr(error.message); load(); } else say("Balík je odstránený.");
  }

  const current = rows.find((r) => r.id === openId);
  if (current) {
    const list = stops.filter((s) => s.user_id === current.id);
    const myFuel = fuel.filter((f) => f.user_id === current.id);
    return (
      <div className="stack">
        <button className="btn small back" onClick={() => setOpenId(null)}>← Všetci kuriéri</button>
        <h2>{nameOf(current.email)}</h2>
        <p className="muted">{current.email} · posledná aktivita {time(current.lastAt)}</p>
        {err && <p className="err">{err}</p>}
        <Progress r={current} big />
        <section className="kpis">
          <div className="kpi"><span className="kv">{n0(current.todayKm)} km</span><span className="kl">najazdené {day === today() ? "dnes" : day}</span></div>
          <div className="kpi"><span className="kv">{n0(current.month.km)} km</span><span className="kl">najazdené za mesiac</span></div>
          <div className="kpi"><span className="kv">{eur(current.month.fuelEur)}</span><span className="kl">palivo za mesiac</span></div>
          <div className="kpi accent"><span className="kv">{eur(current.month.savedEur)}</span><span className="kl">ušetrené za mesiac</span></div>
        </section>
        <section className="card">
          <h3>Balíky ({list.length})</h3>
          {list.length === 0 && <p className="muted">V tento deň nemá žiadne balíky.</p>}
          <ul className="admin-stops">
            {list.map((s) => (
              <li key={s.id}>
                <span className="addr">{s.label}</span>
                <select aria-label={`Stav balíka ${s.label}`} value={s.status || (s.delivered ? "delivered" : "open")}
                  onChange={(e) => changeStatus(s, e.target.value)}>
                  {STATUS_LIST.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <span className="muted small">{s.status_at ? time(s.status_at) : ""}{s.phone ? ` · ${s.phone}` : ""}</span>
                <ConfirmDelete onConfirm={() => removeStop(s)} />
              </li>
            ))}
          </ul>
        </section>
        {myFuel.length > 0 && (
          <section className="card">
            <h3>Tankovania za mesiac</h3>
            <ul className="list fuel-list">
              {myFuel.map((f) => (
                <li key={f.id} className="row between">
                  <span className="num">{new Date(f.at).toLocaleDateString("sk-SK")}</span>
                  <span>{n1(+f.liters)} l · {eur(+f.total_eur)}{f.odo ? ` · ${n0(+f.odo)} km` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <h2>Správca</h2>
        <div className="row">
          <input type="date" id="admin-day" aria-label="Deň" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} />
          <button className="btn small" onClick={load} disabled={loading}>{loading ? "…" : "Obnoviť"}</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}

      <section className="kpis">
        <div className="kpi"><span className="kv">{totals.active} / {rows.length}</span><span className="kl">kuriérov jazdí {day === today() ? "dnes" : ""}</span></div>
        <div className="kpi"><span className="kv">{n0(totals.pct)} %</span><span className="kl">balíkov vybavených ({totals.done} z {totals.total})</span></div>
        <div className="kpi"><span className="kv">{totals.failed + totals.later}</span><span className="kl">nedoručené alebo čakajú na zavolanie</span></div>
        <div className="kpi accent"><span className="kv">{eur(totals.savedEur)}</span><span className="kl">ušetrené za mesiac (celé depo)</span></div>
      </section>
      <p className="muted small">Mesiac spolu: {n0(totals.km)} km, palivo {eur(totals.fuelEur)}, ušetrené {n0(totals.savedKm)} km.</p>

      <div className="row wrap admin-tools">
        <input type="search" id="admin-q" placeholder="Hľadať kuriéra" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Hľadať kuriéra" />
        <select id="admin-sort" aria-label="Zoradiť" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="problem">Najviac problémov</option>
          <option value="progress">Najmenej hotovo</option>
          <option value="saved">Najviac ušetrené</option>
          <option value="name">Podľa mena</option>
        </select>
      </div>

      {!loading && rows.length === 0 && <p className="muted">Zatiaľ sa neprihlásil žiadny kuriér.</p>}
      <ul className="admin-list">
        {shown.map((r) => (
          <li key={r.id}>
            <button className="admin-row" onClick={() => setOpenId(r.id)}>
              <span className="who">
                <b>{nameOf(r.email)}</b>
                <span className="muted small">{r.total ? `${r.done} z ${r.total} · ${time(r.lastAt)}` : "dnes bez balíkov"}</span>
              </span>
              <Progress r={r} />
              <span className="flags">
                {r.failed > 0 && <span className="pill bad">✕ {r.failed}</span>}
                {r.later > 0 && <span className="pill later">☎ {r.later}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Progress({ r, big }) {
  const t = r.total || 1;
  return (
    <span className={"progress" + (big ? " big" : "")} aria-label={`Doručené ${r.delivered}, nedoručené ${r.failed}, zavolať ${r.later}, na trase ${r.open}`}>
      <span className="seg delivered" style={{ width: `${(r.delivered / t) * 100}%` }} />
      <span className="seg failed" style={{ width: `${(r.failed / t) * 100}%` }} />
      <span className="seg later" style={{ width: `${(r.later / t) * 100}%` }} />
    </span>
  );
}

function ConfirmDelete({ onConfirm }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (!ask) return; const t = setTimeout(() => setAsk(false), 4000); return () => clearTimeout(t); }, [ask]);
  return ask
    ? <button className="btn small danger confirm" onClick={onConfirm}>Naozaj?</button>
    : <button className="btn small danger" onClick={() => setAsk(true)} aria-label="Odstrániť balík">✕</button>;
}
