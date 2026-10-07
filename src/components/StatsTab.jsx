import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { summarize, monthBounds, tripKm, savedKmToday, ROAD_FACTOR } from "../lib/stats.js";

const today = () => new Date().toLocaleDateString("sv-SE");
const eur = (x) => (x || 0).toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const n1 = (x) => (x || 0).toLocaleString("sk-SK", { maximumFractionDigits: 1 });
const n0 = (x) => Math.round(x || 0).toLocaleString("sk-SK");
const toNum = (s) => { const v = parseFloat(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };
const hm = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${m} min` : `${m} min`; };

export default function StatsTab({ dayStreetLen, dayGeoLen, doneCount, failedCount, laterCount, needsUpdate, say, userId }) {
  const [trips, setTrips] = useState([]);
  const [fuel, setFuel] = useState([]);
  const [err, setErr] = useState(null);
  const [odoStart, setOdoStart] = useState("");
  const [odoEnd, setOdoEnd] = useState("");
  const [fl, setFl] = useState({ liters: "", total: "", odo: "" });
  const [busy, setBusy] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [priceSaved, setPriceSaved] = useState(null);
  const { fromDay, toDay, from, to } = monthBounds();
  const todayKey = today();

  const load = useCallback(async () => {
    const [t, f] = await Promise.all([
      supabase.from("trips").select("*").eq("user_id", userId).gte("day", fromDay).lt("day", toDay).order("day"),
      supabase.from("fuel").select("*").eq("user_id", userId).gte("at", from.toISOString()).lt("at", to.toISOString()).order("at", { ascending: false }),
    ]);
    if (t.error || f.error) { setErr((t.error || f.error).message); return; }
    setTrips(t.data); setFuel(f.data); setErr(null);
    const td = t.data.find((x) => x.day === todayKey);
    setOdoStart(td?.odo_start ?? ""); setOdoEnd(td?.odo_end ?? "");
  }, [fromDay, toDay]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!needsUpdate) load(); }, [load, needsUpdate]);

  // cena nafty sa ukladá k účtu kuriéra, platí na všetkých jeho zariadeniach
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const p = data.user?.user_metadata?.fuel_price;
      if (p > 0) { setPriceSaved(p); setPriceInput(String(p).replace(".", ",")); }
    });
  }, []);

  async function savePrice(e) {
    e.preventDefault();
    const p = toNum(priceInput);
    if (priceInput.trim() && !(p > 0.5 && p < 5)) { setErr("Cenu napíš v eurách za liter, napríklad 1,52."); return; }
    const value = priceInput.trim() ? p : null;
    const { error } = await supabase.auth.updateUser({ data: { fuel_price: value } });
    if (error) { setErr(error.message); return; }
    setPriceSaved(value); setErr(null);
    say(value ? "Cena nafty je uložená." : "Cena sa bude brať z posledného tankovania.");
  }

  const todaySaved = savedKmToday(dayStreetLen, dayGeoLen);
  const s = useMemo(() => summarize({ trips, fuel, todaySavedKm: todaySaved, todayKey, priceOverride: priceSaved }), [trips, fuel, todaySaved, todayKey, priceSaved]);
  const todayTrip = trips.find((t) => t.day === todayKey);
  const todayKm = todayTrip ? tripKm(todayTrip) : 0;
  const deliveredMonth = s.delivered - (todayTrip?.delivered || 0) + doneCount;

  async function saveDay(e) {
    e?.preventDefault();
    const a = toNum(odoStart), b = toNum(odoEnd);
    if (a != null && b != null && b < a) { setErr("Večerný stav tachometra musí byť vyšší ako ranný."); return; }
    setBusy(true);
    const row = { day: todayKey, odo_start: a, odo_end: b, saved_km: Math.round(todaySaved * 10) / 10,
      delivered: doneCount, failed: failedCount, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("trips").upsert(row, { onConflict: "user_id,day" });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    say("Deň je uložený."); load();
  }

  async function addFuel(e) {
    e.preventDefault();
    const liters = toNum(fl.liters), total = toNum(fl.total), odo = toNum(fl.odo);
    if (!liters || !total) { setErr("Vyplň litre aj sumu z bločku."); return; }
    setBusy(true);
    const { error } = await supabase.from("fuel").insert({ liters, total_eur: total, odo });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setFl({ liters: "", total: "", odo: "" }); say("Tankovanie je uložené."); load();
  }

  async function delFuel(id) {
    setFuel((f) => f.filter((x) => x.id !== id));
    const { error } = await supabase.from("fuel").delete().eq("id", id);
    if (error) { setErr(error.message); load(); }
  }

  if (needsUpdate) {
    return (
      <div className="stack">
        <h2>Prehľad</h2>
        <p className="card warn">Prehľad potrebuje aktualizáciu databázy. Návod je v Nastaveniach v časti „Aktualizácia databázy“.</p>
      </div>
    );
  }

  const monthName = from.toLocaleDateString("sk-SK", { month: "long" });
  const days = trips.filter((t) => tripKm(t) > 0).slice(-14);
  const maxKm = Math.max(1, ...days.map(tripKm));

  return (
    <div className="stack">
      <h2>Prehľad</h2>
      {err && <p className="err">{err}</p>}

      <section className="kpis">
        <div className="kpi accent"><span className="kv">{eur(s.savedEur)}</span><span className="kl">ušetrené na palive ({monthName})</span></div>
        <div className="kpi accent"><span className="kv">{hm(s.savedMin)}</span><span className="kl">ušetrený čas ({monthName})</span></div>
        <div className="kpi"><span className="kv">{n0(s.km)} km</span><span className="kl">najazdené ({monthName})</span></div>
        <div className="kpi"><span className="kv">{eur(s.fuelEur)}</span><span className="kl">za palivo ({monthName})</span></div>
      </section>

      <section className="card">
        <h3>Dnes</h3>
        <div className="mini">
          <span><b>{doneCount}</b> doručené</span>
          <span><b>{failedCount}</b> nedoručené</span>
          <span><b>{laterCount}</b> zavolať neskôr</span>
          <span><b>{n1(todaySaved)} km</b> ušetrené trasou</span>
          {todayKm > 0 && <span><b>{n0(todayKm)} km</b> najazdené</span>}
        </div>
        <form className="grid2" onSubmit={saveDay}>
          <label htmlFor="odo-start">Tachometer ráno</label>
          <input id="odo-start" inputMode="decimal" placeholder="napr. 154 320" value={odoStart} onChange={(e) => setOdoStart(e.target.value)} />
          <label htmlFor="odo-end">Tachometer večer</label>
          <input id="odo-end" inputMode="decimal" placeholder="po poslednom balíku" value={odoEnd} onChange={(e) => setOdoEnd(e.target.value)} />
          <button className="btn primary span2" disabled={busy}>Uložiť deň</button>
        </form>
        <p className="muted small">Ráno zapíš stav tachometra, večer znova. Uloženie zapíše aj počty balíkov a ušetrené km.</p>
      </section>

      <section className="card">
        <h3>Cena nafty</h3>
        <form className="row" onSubmit={savePrice}>
          <input id="fuel-price" aria-label="Cena nafty v eurách za liter" inputMode="decimal" placeholder="napr. 1,52"
            value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={{ maxWidth: "8rem" }} />
          <span className="muted">€/l</span>
          <button className="btn primary">Uložiť</button>
        </form>
        <p className="muted small">
          {priceSaved ? "Úspora sa počíta s touto cenou." :
            s.lastPrice ? "Kým cenu nezapíšeš, počíta sa z posledného tankovania." : "Kým cenu nezapíšeš, počíta sa s odhadom 1,55 €/l."}
        </p>
      </section>

      <section className="card">
        <h3>Tankovanie</h3>
        <form className="grid2" onSubmit={addFuel}>
          <label htmlFor="f-l">Litre</label>
          <input id="f-l" inputMode="decimal" placeholder="napr. 45,2" value={fl.liters} onChange={(e) => setFl({ ...fl, liters: e.target.value })} />
          <label htmlFor="f-t">Suma €</label>
          <input id="f-t" inputMode="decimal" placeholder="z bločku" value={fl.total} onChange={(e) => setFl({ ...fl, total: e.target.value })} />
          <label htmlFor="f-o">Tachometer</label>
          <input id="f-o" inputMode="decimal" placeholder="pre výpočet spotreby" value={fl.odo} onChange={(e) => setFl({ ...fl, odo: e.target.value })} />
          <button className="btn primary span2" disabled={busy}>Pridať tankovanie</button>
        </form>
        {fuel.length > 0 && (
          <ul className="list fuel-list">
            {fuel.map((f) => (
              <li key={f.id} className="row between">
                <span className="num">{new Date(f.at).toLocaleDateString("sk-SK")}</span>
                <span>{n1(+f.liters)} l · {eur(+f.total_eur)}{f.odo ? ` · ${n0(+f.odo)} km` : ""}</span>
                <button className="link small" onClick={() => delFuel(f.id)}>Zmazať</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Auto</h3>
        <table className="facts"><tbody>
          <tr><th>Spotreba</th><td>{n1(s.consumptionUsed)} l/100 km{!s.measured && <span className="muted"> (odhad, spresní sa po 2 tankovaniach s tachometrom)</span>}</td></tr>
          <tr><th>Cena nafty</th><td>{s.price ? `${s.price.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} €/l` : "1,55 €/l (odhad)"}
            {s.price && !s.priceManual && <span className="muted"> (z posledného tankovania)</span>}</td></tr>
          <tr><th>1 km stojí</th><td>{eur(s.costPerKm)}</td></tr>
          <tr><th>Natankované ({monthName})</th><td>{n1(s.fuelL)} l</td></tr>
          <tr><th>Doručené ({monthName})</th><td>{n0(deliveredMonth)} balíkov</td></tr>
          <tr><th>Ušetrené ({monthName})</th><td>{n1(s.savedKm)} km</td></tr>
        </tbody></table>
      </section>

      {days.length > 0 && (
        <section className="card">
          <h3>Najazdené km po dňoch</h3>
          <div className="bars">
            {days.map((t) => (
              <div className="bar-row" key={t.day}>
                <span className="num">{new Date(t.day).toLocaleDateString("sk-SK", { day: "numeric", month: "numeric" })}</span>
                <span className="bar"><span style={{ width: `${(tripKm(t) / maxKm) * 100}%` }} /></span>
                <span className="num">{n0(tripKm(t))} km</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="muted small">Ušetrené km sú odhad: rozdiel medzi trasou po uliciach a trasou podľa polohy, vzdušne × {ROAD_FACTOR}.
        Nezahŕňa návraty pre prehliadnuté balíky, takže skutočná úspora býva vyššia.</p>
    </div>
  );
}
