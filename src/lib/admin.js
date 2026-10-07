// Výpočty pre obrazovku Správca
import { summarize, tripKm } from "./stats.js";

export const STATUS_LIST = [
  { key: "open", label: "Na trase" },
  { key: "delivered", label: "Doručené" },
  { key: "failed", label: "Nedoručené" },
  { key: "later", label: "Zavolať neskôr" },
];

const statusOf = (s) => s.status || (s.delivered ? "delivered" : "open");

// Jeden riadok na kuriéra: dnešné balíky, km a mesačná úspora
export function adminRows({ couriers, stops, trips, fuel, day }) {
  return couriers.map((c) => {
    const mine = stops.filter((s) => s.user_id === c.id);
    const count = (st) => mine.filter((s) => statusOf(s) === st).length;
    const delivered = count("delivered"), failed = count("failed"), later = count("later"), open = count("open");
    const total = mine.length;
    const myTrips = trips.filter((t) => t.user_id === c.id);
    const myFuel = fuel.filter((f) => f.user_id === c.id);
    const todayTrip = myTrips.find((t) => t.day === day);
    const month = summarize({ trips: myTrips, fuel: myFuel, todayKey: "" });
    const lastAt = mine.reduce((m, s) => { const t = s.status_at || s.created_at; return t && (!m || t > m) ? t : m; }, null);
    return {
      id: c.id, email: c.email || "", total, delivered, failed, later, open,
      done: delivered + failed, pct: total ? ((delivered + failed) / total) * 100 : 100,
      todayKm: todayTrip ? tripKm(todayTrip) : 0, month, lastAt,
    };
  });
}

export function depotTotals(rows) {
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const total = sum((r) => r.total), done = sum((r) => r.done);
  return {
    active: rows.filter((r) => r.total > 0).length,
    total, done, pct: total ? (done / total) * 100 : 0,
    failed: sum((r) => r.failed), later: sum((r) => r.later),
    km: sum((r) => r.month.km), fuelEur: sum((r) => r.month.fuelEur),
    savedKm: sum((r) => r.month.savedKm), savedEur: sum((r) => r.month.savedEur),
  };
}
