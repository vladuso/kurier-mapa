import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, configured, fetchAll, upsertInBatches } from "./lib/supabase.js";
import { parseAddress, splitLines, matchStreet, makeKey } from "./lib/address.js";
import { planRoute, streetOrder, routeLength } from "./lib/route.js";
import { CITY, fetchCityAddresses, geocodeOne } from "./lib/geodata.js";
import MapView, { PALETTE } from "./components/MapView.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import StatsTab from "./components/StatsTab.jsx";
import updateSql from "../supabase/update-2-stavy.sql?raw";

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD v miestnom čase
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez úložiska */ } };

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!configured) return <NotConfigured />;
  if (session === undefined) return <div className="center muted">Načítavam…</div>;
  if (!session) return <AuthScreen />;
  return <Courier session={session} />;
}

function NotConfigured() {
  return (
    <div className="auth"><div className="auth-card">
      <div className="brand">Kuriérska mapa</div>
      <p>Appka ešte nie je prepojená s databázou. Vo Verceli doplň premenné
        <code> VITE_SUPABASE_URL</code> a <code>VITE_SUPABASE_ANON_KEY</code> a nasaď ju znova.</p>
    </div></div>
  );
}

function Courier({ session }) {
  const [tab, setTab] = useState("route");
  const [addresses, setAddresses] = useState(new Map());
  const [entrances, setEntrances] = useState(new Map());
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [picking, setPicking] = useState(null); // {kind:'entrance'|'place'|'start', stop?}
  const [mode, setMode] = useState("geo");
  const [start, setStart] = useState(() => load("kurier-start", CITY.center));
  const [radius, setRadius] = useState(() => load("kurier-radius", 80));
  const [focus, setFocus] = useState(null);
  const [needsUpdate, setNeedsUpdate] = useState(false); // databáza ešte nemá stĺpec status

  const say =useCallback((text) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? null : t)), 2200); }, []);

  // načítanie dát
  const reload = useCallback(async () => {
    try {
      const [addr, ent, st] = await Promise.all([
        fetchAll("addresses", "key,street,number,lat,lon"),
        fetchAll("entrances", "key,lat,lon,note"),
        supabase.from("stops").select("*").eq("day", today()).order("created_at"),
      ]);
      if (st.error) throw st.error;
      const probe = await supabase.from("stops").select("status,phone").limit(1);
      setNeedsUpdate(!!probe.error);
      setAddresses(new Map(addr.map((a) => [a.key, a])));
      setEntrances(new Map(ent.map((e) => [e.key, e])));
      setStops(st.data);
      setError(null);
    } catch (e) {
      setError("Nepodarilo sa načítať dáta: " + e.message + ". Skontroluj, či je v Supabase spustený súbor schema.sql.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const streets = useMemo(() => [...new Set([...addresses.values()].map((a) => a.street))], [addresses]);
  const ocrCtx = useMemo(() => ({ streets, keys: new Set(addresses.keys()) }), [streets, addresses]);

  // poloha každej zastávky: naučený vchod má prednosť
  const located = useMemo(() => stops.map((s) => {
    const ent = s.address_key && entrances.get(s.address_key);
    const addr = s.address_key && addresses.get(s.address_key);
    const p = parseAddress(s.label);
    return {
      ...s,
      street: addr?.street || p?.street, number: addr?.number || p?.number,
      lat: ent ? ent.lat : s.lat, lon: ent ? ent.lon : s.lon,
      fixed: !!ent, note: ent?.note,
      status: s.status || (s.delivered ? "delivered" : "open"),
    };
  }), [stops, entrances, addresses]);

  const open = useMemo(() => located.filter((s) => s.status === "open" && s.lat != null), [located]);
  const missing = useMemo(() => located.filter((s) => s.status === "open" && s.lat == null), [located]);
  const done = useMemo(() => located.filter((s) => s.status === "delivered"), [located]);
  const failed = useMemo(() => located.filter((s) => s.status === "failed"), [located]);
  const later = useMemo(() => located.filter((s) => s.status === "later"), [located]);

  const plan = useMemo(() => {
    if (mode === "geo") return planRoute(open, start, radius);
    // po starom: každá ulica je jedna skupina
    const groups = new Map();
    for (const s of streetOrder(open)) {
      if (!groups.has(s.street)) groups.set(s.street, []);
      groups.get(s.street).push(s);
    }
    return [...groups.values()].map((items) => ({ items }));
  }, [open, start, radius, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = useMemo(() => plan.flatMap((g) => g.items), [plan]);
  const geoLen = useMemo(() => routeLength(planRoute(open, start, radius).flatMap((g) => g.items), start), [open, start, radius]); // eslint-disable-line react-hooks/exhaustive-deps
  const streetLen = useMemo(() => routeLength(streetOrder(open), start), [open, start]); // eslint-disable-line react-hooks/exhaustive-deps
  // úspora za celý deň (všetky dnešné balíky, aj doručené), aby neklesala počas rozvozu
  const dayPts = useMemo(() => located.filter((s) => s.lat != null), [located]);
  const dayGeoLen = useMemo(() => routeLength(planRoute(dayPts, start, radius).flatMap((g) => g.items), start), [dayPts, start, radius]);
  const dayStreetLen = useMemo(() => routeLength(streetOrder(dayPts), start), [dayPts, start]);

  const mapStops = useMemo(() => {
    const out = [];
    let n = 0;
    plan.forEach((g, gi) => g.items.forEach((s) => out.push({ ...s, n: ++n, color: PALETTE[gi % PALETTE.length] })));
    later.forEach((s) => s.lat != null && out.push({ ...s, n: "☎", color: STATUS.later.color }));
    failed.forEach((s) => s.lat != null && out.push({ ...s, n: "✕", color: STATUS.failed.color }));
    done.forEach((s) => s.lat != null && out.push({ ...s, n: "✓", color: STATUS.delivered.color }));
    return out;
  }, [plan, done, failed, later]);
  const routeLine = useMemo(() => [start, ...ordered].map((p) => [p.lon, p.lat]), [ordered, start]);

  // --- akcie ---------------------------------------------------------------

  async function ensureAddress(parsed, lat, lon, source) {
    const row = { key: parsed.key, street: parsed.street, number: parsed.number, conscription: parsed.conscription, lat, lon, source };
    const { error } = await supabase.from("addresses").upsert(row, { onConflict: "key", ignoreDuplicates: true });
    if (error) throw error;
    setAddresses((m) => new Map(m).set(row.key, row));
  }

  // items: text (jedna adresa na riadok) alebo pole {line, phone} z fotiek štítkov
  async function addStops(items, onProgress) {
    const list = typeof items === "string" ? splitLines(items).map((line) => ({ line })) : items;
    const results = { found: 0, approx: 0, missing: [] };
    let i = 0;
    for (const { line, phone } of list) {
      onProgress?.(++i, list.length);
      let p = parseAddress(line);
      let lat = null, lon = null, key = null;
      if (p) {
        const st = matchStreet(p.street, streets);
        if (st) p = { ...p, street: st, key: makeKey(st, p.number), label: `${st} ${p.number}` };
        const known = addresses.get(p.key);
        if (known) { lat = known.lat; lon = known.lon; key = p.key; results.found++; }
        else {
          try {
            const g = await geocodeOne(p.street, p.number);
            if (g?.exact) { await ensureAddress(p, g.lat, g.lon, "nominatim"); lat = g.lat; lon = g.lon; key = p.key; results.found++; }
            else results.missing.push(line);
          } catch { results.missing.push(line); }
        }
      } else results.missing.push(line);
      const row = { day: today(), label: p ? p.label : line, address_key: key, lat, lon };
      if (phone && !needsUpdate) row.phone = phone;
      const { data, error } = await supabase.from("stops").insert(row).select().single();
      if (error) throw error;
      setStops((s) => [...s, data]);
    }
    setFocus({ type: "all", t: Date.now() });
    return results;
  }

  async function patchStop(id, patch) {
    setStops((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("stops").update(patch).eq("id", id);
    if (error) { say("Zmena sa neuložila: " + error.message); reload(); }
  }

  // Doručené / Nedoručené / Zavolať neskôr / späť na trasu
  async function setStatus(stop, status) {
    if (needsUpdate && (status === "failed" || status === "later")) {
      say("Najprv treba aktualizovať databázu (návod je v Nastaveniach).");
      return;
    }
    const patch = needsUpdate
      ? { delivered: status === "delivered" }
      : { status, delivered: status === "delivered", status_at: new Date().toISOString() };
    // ďalšia zastávka v poradí, aby kuriér nemusel hľadať
    const idx = ordered.findIndex((s) => s.id === stop.id);
    const next = idx >= 0 ? ordered[idx + 1] || ordered[idx - 1] : ordered[0];
    await patchStop(stop.id, patch);
    say(STATUS[status].done);
    if (status !== "open" && next && next.id !== stop.id) select(next.id);
    else setSelectedId(status === "open" ? stop.id : null);
  }

  async function deleteStop(id) {
    setStops((s) => s.filter((x) => x.id !== id));
    setSelectedId(null);
    const { error } = await supabase.from("stops").delete().eq("id", id);
    if (error) { say("Nepodarilo sa zmazať: " + error.message); reload(); }
  }

  async function onPick(pt) {
    const job = picking;
    setPicking(null);
    if (!job) return;
    if (job.kind === "start") {
      setStart(pt); save("kurier-start", pt); say("Štart trasy je uložený."); return;
    }
    const s = job.stop;
    try {
      if (job.kind === "place") {
        const p = parseAddress(s.label);
        if (p) {
          const st = matchStreet(p.street, streets) || p.street;
          const pp = { ...p, street: st, key: makeKey(st, p.number) };
          await ensureAddress(pp, pt.lat, pt.lon, "manual");
          await patchStop(s.id, { lat: pt.lat, lon: pt.lon, address_key: pp.key });
          say("Adresa je uložená. Nabudúce ju appka nájde sama.");
        } else {
          await patchStop(s.id, { lat: pt.lat, lon: pt.lon });
          say("Poloha zastávky je uložená.");
        }
      }
      if (job.kind === "entrance") {
        const row = { key: s.address_key, lat: pt.lat, lon: pt.lon, note: job.note || null, updated_at: new Date().toISOString() };
        const { error } = await supabase.from("entrances").upsert(row, { onConflict: "key" });
        if (error) throw error;
        setEntrances((m) => new Map(m).set(row.key, row));
        say("Vchod je uložený pre všetkých kuriérov.");
      }
    } catch (e) { say("Neuložilo sa: " + e.message); }
  }

  async function forgetEntrance(key) {
    setEntrances((m) => { const n = new Map(m); n.delete(key); return n; });
    const { error } = await supabase.from("entrances").delete().eq("key", key);
    if (error) { say("Nepodarilo sa: " + error.message); reload(); } else say("Oprava vchodu je zrušená.");
  }

  async function clearDelivered() {
    const ids = done.map((s) => s.id);
    if (!ids.length) return;
    setStops((s) => s.filter((x) => !ids.includes(x.id)));
    const { error } = await supabase.from("stops").delete().in("id", ids);
    if (error) { say("Nepodarilo sa: " + error.message); reload(); }
  }

  async function importCity(onStatus) {
    onStatus("Sťahujem adresy z OpenStreetMap… (môže to trvať minútu)");
    const rows = await fetchCityAddresses();
    onStatus(`Našiel som ${rows.length} adries. Ukladám…`);
    await upsertInBatches("addresses", rows, (d, t) => onStatus(`Ukladám ${d} / ${t}…`));
    await reload();
    onStatus(`Hotovo. V databáze je ${rows.length} adries z mapy.`);
  }

  const selected = located.find((s) => s.id === selectedId);
  const selN = mapStops.find((s) => s.id === selectedId)?.n;

  function select(id) {
    setSelectedId(id);
    const s = located.find((x) => x.id === id);
    if (s?.lat != null) setFocus({ type: "point", lat: s.lat, lon: s.lon, t: Date.now() });
    setTab("route");
  }

  return (
    <div className={"app" + (tab === "route" || picking ? "" : " no-map")}>
      <header className="top">
        <div className="brand">Kuriérska mapa</div>
        <div className="stat">
          <b>{open.length}</b> na doručenie · <b>{done.length}</b> doručené
          {open.length > 1 && streetLen > 0 && mode === "geo" && geoLen < streetLen &&
            <> · o <b>{Math.round((1 - geoLen / streetLen) * 100)} %</b> kratšie</>}
        </div>
      </header>

      <div className="map-wrap">
        {picking && (
          <div className="banner">
            <span>{picking.kind === "start" ? "Ťukni na mapu, odkiaľ ráno vyrážaš." :
              picking.kind === "entrance" ? `Ťukni na skutočný vchod pre ${picking.stop.label}.` :
              `Ťukni na mapu, kde je ${picking.stop.label}.`}</span>
            <button className="btn small" onClick={() => setPicking(null)}>Zrušiť</button>
          </div>
        )}
        <MapView stops={mapStops} route={routeLine} start={start} selectedId={selectedId}
          picking={!!picking} onSelect={select} onPick={onPick} focus={focus} />
      </div>

      <main className="sheet">
        {error && <p className="err">{error}</p>}
        {loading && <p className="muted">Načítavam…</p>}
        {needsUpdate && tab !== "settings" && !loading && (
          <p className="card warn">Nové funkcie (nedoručené, zavolať neskôr, prehľad) potrebujú jednu aktualizáciu databázy.{" "}
            <button className="link" onClick={() => setTab("settings")}>Ukáž mi ako</button></p>
        )}

        {tab === "route" && !loading && (
          <RouteTab {...{ plan, mode, setMode, missing, done, failed, later, selected, selN, selectedId, select, setStatus, deleteStop,
            setPicking, forgetEntrance, clearDelivered, setTab, setFocus, start }} />
        )}
        {tab === "add" && !loading && <AddTab addStops={addStops} hasAddresses={addresses.size > 0} setTab={setTab} ocrCtx={ocrCtx} />}
        {tab === "stats" && !loading && (
          <StatsTab {...{ dayGeoLen, dayStreetLen, needsUpdate, say,
            doneCount: done.length, failedCount: failed.length, laterCount: later.length }} />
        )}
        {tab === "settings" && (
          <SettingsTab {...{ session, addresses, entrances, importCity, setPicking, radius, needsUpdate, reload,
            setStartPoint: (pt) => { setStart(pt); save("kurier-start", pt); say("Štart trasy je uložený."); },
            setRadius: (r) => { setRadius(r); save("kurier-radius", r); }, setTab }} />
        )}
      </main>

      <nav className="tabs">
        <button aria-pressed={tab === "route"} onClick={() => setTab("route")}>Trasa</button>
        <button aria-pressed={tab === "add"} onClick={() => setTab("add")}>Pridať</button>
        <button aria-pressed={tab === "stats"} onClick={() => setTab("stats")}>Prehľad</button>
        <button aria-pressed={tab === "settings"} onClick={() => setTab("settings")}>Nastavenia</button>
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// +421905123456 → 0905 123 456
export function prettyPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  const local = d.startsWith("421") ? "0" + d.slice(3) : d;
  return local.length === 10 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : p;
}

// Odstránenie na dva ťuky, aby sa balík nezmazal omylom
function DeleteButton({ onConfirm }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (!ask) return; const t = setTimeout(() => setAsk(false), 4000); return () => clearTimeout(t); }, [ask]);
  return ask
    ? <button className="btn danger confirm" onClick={onConfirm}>Naozaj odstrániť?</button>
    : <button className="btn danger" onClick={() => setAsk(true)}>Odstrániť</button>;
}

function navLinks(s) {
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${s.lat},${s.lon}&navigate=yes`,
  };
}

function RouteTab({ plan, mode, setMode, missing, done, failed, later, selected, selN, selectedId, select, setStatus, deleteStop,
  setPicking, forgetEntrance, clearDelivered, setTab, setFocus, start }) {
  const total = plan.reduce((s, g) => s + g.items.length, 0);
  const firstOpen = plan[0]?.items[0];
  return (
    <div className="stack">
      {selected && (
        <section className="card sel">
          <div className="row between">
            <div><span className="num">{selN}</span> <span className="addr big-addr">{selected.label}</span></div>
            <button className="btn small ghost" onClick={() => select(null)} aria-label="Zavrieť">✕</button>
          </div>
          {selected.fixed && <p className="muted">Naučený vchod{selected.note ? `: ${selected.note}` : ""}.</p>}
          {selected.lat == null && <p className="muted">Adresu sa nepodarilo nájsť. Označ ju na mape a appka si ju zapamätá.</p>}
          {selected.status !== "open" && (
            <p className="status-line" style={{ color: STATUS[selected.status].color }}>{STATUS[selected.status].label}</p>
          )}
          {selected.status === "open" ? (
            <div className="status-btns">
              <button className="sbtn ok" onClick={() => setStatus(selected, "delivered")}>✓<span>Doručené</span></button>
              <button className="sbtn bad" onClick={() => setStatus(selected, "failed")}>✕<span>Nedoručené</span></button>
              <button className="sbtn later" onClick={() => setStatus(selected, "later")}>☎<span>Zavolať neskôr</span></button>
            </div>
          ) : (
            <div className="row wrap">
              <button className="btn" onClick={() => setStatus(selected, "open")}>Vrátiť na trasu</button>
            </div>
          )}
          <div className="row wrap">
            {selected.phone && <a className="btn primary" href={`tel:${selected.phone}`}>Zavolať {prettyPhone(selected.phone)}</a>}
            {selected.lat != null && (
              <>
                <a className="btn" href={navLinks(selected).google} target="_blank" rel="noreferrer">Google Maps</a>
                <a className="btn" href={navLinks(selected).waze} target="_blank" rel="noreferrer">Waze</a>
              </>
            )}
          </div>
          <div className="row wrap">
            {selected.lat == null && <button className="btn primary" onClick={() => setPicking({ kind: "place", stop: selected })}>Označiť na mape</button>}
            {selected.address_key && selected.lat != null && (
              <button className="btn" onClick={() => {
                const note = window.prompt?.("Poznámka k vchodu (nepovinné), napr. „vchod z Horskej“") ?? "";
                setPicking({ kind: "entrance", stop: selected, note: note || null });
              }}>{selected.fixed ? "Posunúť vchod" : "Opraviť vchod"}</button>
            )}
            {selected.fixed && <button className="btn" onClick={() => forgetEntrance(selected.address_key)}>Zrušiť opravu vchodu</button>}
            <DeleteButton onConfirm={() => deleteStop(selected.id)} />
          </div>
        </section>
      )}

      <div className="row between wrap">
        <div className="seg" role="group" aria-label="Spôsob zoradenia">
          <button aria-pressed={mode === "street"} onClick={() => setMode("street")}>Po uliciach</button>
          <button aria-pressed={mode === "geo"} onClick={() => setMode("geo")}>Podľa polohy</button>
        </div>
        <button className="btn small" onClick={() => setFocus({ type: "all", t: Date.now() })}>Celá trasa</button>
      </div>

      {total === 0 && missing.length === 0 && done.length === 0 && failed.length === 0 && later.length === 0 && (
        <section className="empty">
          <h2>Dnes zatiaľ žiadne balíky</h2>
          <p className="muted">Vlož adresy z dnešnej trasy a appka ich zoskupí podľa toho, kde domy reálne stoja.</p>
          <button className="btn primary big" onClick={() => setTab("add")}>Pridať balíky</button>
        </section>
      )}

      {firstOpen && !selected && (
        <button className="next" onClick={() => select(firstOpen.id)}>
          <span className="muted">Ďalšia zastávka</span>
          <span className="addr big-addr">{firstOpen.label}</span>
        </button>
      )}

      {missing.length > 0 && (
        <section className="card warn">
          <h3>Nenájdené adresy ({missing.length})</h3>
          <p className="muted">Ťukni na adresu a označ ju na mape. Appka si ju zapamätá.</p>
          <ul className="list">
            {missing.map((s) => (
              <li key={s.id}><button className={"item" + (s.id === selectedId ? " cur" : "")} onClick={() => select(s.id)}>
                <span className="num">?</span><span className="addr">{s.label}</span></button></li>
            ))}
          </ul>
        </section>
      )}

      {plan.map((g, gi) => {
        const streets = [...new Set(g.items.map((s) => s.street).filter(Boolean))];
        const main = streets[0];
        let n0 = plan.slice(0, gi).reduce((a, x) => a + x.items.length, 0);
        return (
          <section className="group" key={gi}>
            <div className="ghead">
              <span className="dot" style={{ background: PALETTE[gi % PALETTE.length] }} />
              <span>{mode === "geo" ? `Zastávka ${gi + 1}` : main} {mode === "geo" && <span className="muted">· {streets.join(" + ")}</span>}</span>
              <span className="count">{g.items.length} ks</span>
            </div>
            <ul className="list">
              {g.items.map((s) => {
                const cross = mode === "geo" && s.street !== mostCommon(g.items.map((x) => x.street));
                return (
                  <li key={s.id}><button className={"item" + (s.id === selectedId ? " cur" : "")} onClick={() => select(s.id)}>
                    <span className="num">{String(++n0).padStart(2, "0")}</span>
                    <span className="addr">{s.label}</span>
                    {s.fixed ? <span className="tag">naučený vchod</span> : cross ? <span className="tag cross">iná ulica</span> : null}
                  </button></li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {[["later", later], ["failed", failed], ["delivered", done]].map(([st, list]) => list.length > 0 && (
        <section className="group" key={st}>
          <div className="ghead"><span className="dot" style={{ background: STATUS[st].color }} /><span>{STATUS[st].title}</span><span className="count">{list.length} ks</span></div>
          <ul className="list">
            {list.map((s) => (
              <li key={s.id}><button className={"item " + st + (s.id === selectedId ? " cur" : "")} onClick={() => select(s.id)}>
                <span className="num">{STATUS[st].icon}</span><span className="addr">{s.label}</span>
                {s.phone && st === "later" ? <span className="tag cross">{prettyPhone(s.phone)}</span> : null}</button></li>
            ))}
          </ul>
          {st === "delivered" && <button className="btn small" onClick={clearDelivered}>Vymazať doručené zo zoznamu</button>}
        </section>
      ))}
      {start && total > 0 && <p className="muted small">Trasa začína v bode ŠTART. Zmeníš ho v Nastaveniach.</p>}
    </div>
  );
}

export const STATUS = {
  open: { label: "Na trase", title: "Na trase", icon: "•", color: "#2f6fb5", done: "Balík je späť na trase." },
  delivered: { label: "Doručené", title: "Doručené", icon: "✓", color: "#2e8b57", done: "Doručené ✓" },
  failed: { label: "Nedoručené – nikto doma", title: "Nedoručené", icon: "✕", color: "#c0392b", done: "Označené ako nedoručené." },
  later: { label: "Zavolať neskôr", title: "Zavolať neskôr", icon: "☎", color: "#c7861d", done: "Odložené, zavoláš neskôr." },
};

function mostCommon(a) {
  const c = {};
  a.forEach((x) => (c[x] = (c[x] || 0) + 1));
  return Object.keys(c).sort((x, y) => c[y] - c[x])[0];
}

function AddTab({ addStops, hasAddresses, setTab, ocrCtx }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [scans, setScans] = useState([]); // [{id, address, phone, confident, candidates}]
  const [reading, setReading] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) { setErr("Napíš aspoň jednu adresu, napríklad Nitrianska 12."); return; }
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await addStops(text, (i, n) => setProgress(`${i} / ${n}`));
      setResult(r); setText("");
    } catch (e2) { setErr("Nepodarilo sa uložiť: " + e2.message); }
    finally { setBusy(false); setProgress(null); }
  }

  async function onPhotos(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setErr(null); setResult(null);
    const { readLabel } = await import("./lib/ocr.js");
    for (let i = 0; i < files.length; i++) {
      setReading(files.length > 1 ? `Čítam štítok ${i + 1} / ${files.length}…` : "Čítam štítok…");
      try {
        const r = await readLabel(files[i], ocrCtx, setReading);
        setScans((s) => [{ id: crypto.randomUUID?.() || String(Date.now() + i), ...r }, ...s]);
      } catch (e2) {
        setErr("Štítok sa nepodarilo prečítať: " + e2.message);
      }
    }
    setReading(null);
  }

  const editScan = (id, patch) => setScans((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const ready = scans.filter((s) => s.address.trim());

  async function addScans() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await addStops(ready.map((s) => ({ line: s.address, phone: s.phone || null })), (i, n) => setProgress(`${i} / ${n}`));
      setResult(r); setScans([]);
    } catch (e2) { setErr("Nepodarilo sa uložiť: " + e2.message); }
    finally { setBusy(false); setProgress(null); }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h2>Pridať balíky</h2>
      {!hasAddresses && (
        <p className="card warn">Databáza ešte nemá adresy mesta. Najprv ich načítaj v <button type="button" className="link" onClick={() => setTab("settings")}>Nastaveniach</button>, inak bude hľadanie pomalé.</p>
      )}

      <section className="card">
        <h3>Odfotiť štítky</h3>
        <p className="muted">Odfoť štítok tak, aby bola adresa príjemcu čitateľná. Appka nájde adresu aj telefón, ty len skontroluješ.</p>
        <div className="row wrap">
          <label className="btn primary big file-btn">
            Odfotiť štítok
            <input type="file" accept="image/*" capture="environment" onChange={onPhotos} disabled={!!reading} />
          </label>
          <label className="btn file-btn">
            Vybrať fotky
            <input type="file" accept="image/*" multiple onChange={onPhotos} disabled={!!reading} />
          </label>
        </div>
        {reading && <p className="muted" role="status">{reading}</p>}
        {scans.length > 0 && (
          <>
            <ul className="scan-list">
              {scans.map((s) => (
                <li key={s.id} className={"scan" + (s.address ? (s.confident ? "" : " unsure") : " empty")}>
                  <input aria-label="Adresa" value={s.address} placeholder="Adresu som neprečítal, dopíš ju"
                    onChange={(e) => editScan(s.id, { address: e.target.value })} />
                  <input aria-label="Telefón" value={s.phone} placeholder="Telefón (nepovinné)" inputMode="tel"
                    onChange={(e) => editScan(s.id, { phone: e.target.value })} />
                  {s.candidates.length > 1 && (
                    <div className="row wrap">
                      <span className="muted small">Alebo:</span>
                      {s.candidates.filter((c) => c !== s.address).map((c) => (
                        <button type="button" key={c} className="btn small" onClick={() => editScan(s.id, { address: c })}>{c}</button>
                      ))}
                    </div>
                  )}
                  <button type="button" className="link small" onClick={() => setScans((x) => x.filter((y) => y.id !== s.id))}>Zahodiť</button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn primary big" disabled={busy || !ready.length} onClick={addScans}>
              {busy ? `Pridávam… ${progress || ""}` : `Pridať ${ready.length} na trasu`}</button>
          </>
        )}
      </section>

      <label htmlFor="addrs">Alebo napíš adresy ručne, jednu na riadok.</label>
      <textarea id="addrs" rows={5} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"Nitrianska 12\nHorská 8\nR. Jašíka 1203/5"} />
      <button className="btn primary big" disabled={busy}>{busy ? `Hľadám adresy… ${progress || ""}` : "Pridať na trasu"}</button>
      {err && <p className="err">{err}</p>}
      {result && (
        <div className="card">
          <p><b>{result.found}</b> adries je na mape.</p>
          {result.missing.length > 0 && <p>{result.missing.length} sa nenašlo. Nájdeš ich hore v zozname Trasa a označíš na mape.</p>}
          <button type="button" className="btn" onClick={() => setTab("route")}>Ukázať trasu</button>
        </div>
      )}
    </form>
  );
}

function SettingsTab({ session, addresses, entrances, importCity, setPicking, setStartPoint, radius, setRadius, needsUpdate, reload }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function runImport() {
    setBusy(true);
    try { await importCity(setStatus); } catch (e) { setStatus("Nepodarilo sa: " + e.message + ". Skús to o chvíľu znova."); }
    finally { setBusy(false); }
  }
  async function copySql() {
    try { await navigator.clipboard.writeText(updateSql); setCopied(true); }
    catch { document.getElementById("sql-box")?.select(); }
  }
  return (
    <div className="stack">
      <h2>Nastavenia</h2>
      {needsUpdate && (
        <section className="card warn">
          <h3>Aktualizácia databázy</h3>
          <p>Pre stavy balíkov, telefóny, tachometer a tankovanie treba raz aktualizovať databázu:</p>
          <ol className="steps">
            <li>Klikni <b>Kopírovať</b>.</li>
            <li>V Supabase otvor <b>SQL Editor → New query</b>, vlož text a klikni <b>Run</b>.</li>
            <li>Vráť sa sem a klikni <b>Hotovo, skontrolovať</b>.</li>
          </ol>
          <textarea id="sql-box" readOnly rows={4} value={updateSql} aria-label="Príkaz pre databázu" />
          <div className="row wrap">
            <button className="btn primary" onClick={copySql}>{copied ? "Skopírované ✓" : "Kopírovať"}</button>
            <button className="btn" onClick={reload}>Hotovo, skontrolovať</button>
          </div>
        </section>
      )}
      <section className="card">
        <h3>Štart trasy</h3>
        <p className="muted">Odkiaľ ráno vyrážaš, napríklad depo. Od tohto bodu sa počíta poradie zastávok.</p>
        <div className="row wrap">
          <button className="btn" onClick={() => setPicking({ kind: "start" })}>Označiť na mape</button>
          <button className="btn" onClick={() => {
            if (!navigator.geolocation) { setStatus("Tento prehliadač nevie zistiť polohu. Označ štart na mape."); return; }
            navigator.geolocation.getCurrentPosition(
              (p) => setStartPoint({ lat: p.coords.latitude, lon: p.coords.longitude }),
              () => setStatus("Poloha nie je povolená. Označ štart na mape."),
              { enableHighAccuracy: true, timeout: 15000 });
          }}>Použiť moju polohu</button>
        </div>
      </section>
      <section className="card">
        <h3>Čo je jedna zastávka</h3>
        <p className="muted">Domy bližšie ako {radius} m od seba appka spojí do jednej zastávky.</p>
        <input type="range" id="radius" min={30} max={200} step={10} value={radius} onChange={(e) => setRadius(+e.target.value)} aria-label="Vzdialenosť v metroch" />
      </section>
      <section className="card">
        <h3>Adresy mesta</h3>
        <p className="muted">V databáze je <b>{addresses.size}</b> adries a <b>{entrances.size}</b> naučených vchodov.
          Adresy stačí načítať raz. Pri zmenách na mape ich môžeš načítať znova, naučené vchody zostanú.</p>
        <button className="btn primary" disabled={busy} onClick={runImport}>{busy ? "Načítavam…" : `Načítať adresy (${CITY.name})`}</button>
        {status && <p className="muted">{status}</p>}
      </section>
      <section className="card">
        <h3>Účet</h3>
        <p className="muted">Prihlásený ako {session.user.email}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Odhlásiť sa</button>
      </section>
      <p className="muted small">Mapové dáta © prispievatelia OpenStreetMap.</p>
    </div>
  );
}
