// Výpočty pre Prehľad: spotreba, cena za km, úspora

export const ROAD_FACTOR = 1.3;   // cesta po uliciach je zhruba o 30 % dlhšia ako vzdušná čiara
export const CITY_SPEED = 30;     // km/h v meste
export const DEFAULT_CONSUMPTION = 8;   // l/100 km, kým nie sú dáta z tankovania
export const DEFAULT_PRICE = 1.55;      // €/l, kým nie je prvé tankovanie

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// Spotreba z tankovaní: litre natankované po prvom tankovaní / km medzi prvým a posledným tankovaním
export function fuelEconomy(fuel) {
  const withOdo = fuel.filter((f) => num(f.odo) != null).sort((a, b) => num(a.odo) - num(b.odo));
  let consumption = null;
  if (withOdo.length >= 2) {
    const km = num(withOdo[withOdo.length - 1].odo) - num(withOdo[0].odo);
    const liters = withOdo.slice(1).reduce((s, f) => s + num(f.liters), 0);
    if (km > 50 && liters > 0) consumption = (liters / km) * 100;
  }
  const last = [...fuel].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  const price = last ? num(last.total_eur) / num(last.liters) : null;
  return {
    consumption, price,
    consumptionUsed: consumption ?? DEFAULT_CONSUMPTION,
    priceUsed: price ?? DEFAULT_PRICE,
    measured: consumption != null,
  };
}

export function tripKm(t) {
  const a = num(t.odo_start), b = num(t.odo_end);
  return a != null && b != null && b >= a ? b - a : 0;
}

// Odhad ušetrených km pre dnešnú trasu: rozdiel trasy "po uliciach" a "podľa polohy" (v metroch, vzdušne)
export function savedKmToday(streetLenM, geoLenM) {
  if (!(streetLenM > 0) || !(geoLenM >= 0) || geoLenM >= streetLenM) return 0;
  return ((streetLenM - geoLenM) / 1000) * ROAD_FACTOR;
}

export function summarize({ trips, fuel, todaySavedKm = 0, todayKey }) {
  const eco = fuelEconomy(fuel);
  const costPerKm = (eco.consumptionUsed / 100) * eco.priceUsed;
  // dnešný deň počítame živo, uložené dni z databázy
  const savedKm = trips.reduce((s, t) => s + (t.day === todayKey ? 0 : num(t.saved_km) || 0), 0) + todaySavedKm;
  const km = trips.reduce((s, t) => s + tripKm(t), 0);
  const fuelEur = fuel.reduce((s, f) => s + num(f.total_eur), 0);
  const fuelL = fuel.reduce((s, f) => s + num(f.liters), 0);
  const delivered = trips.reduce((s, t) => s + (num(t.delivered) || 0), 0);
  return {
    ...eco, costPerKm, km, fuelEur, fuelL, delivered,
    savedKm, savedEur: savedKm * costPerKm, savedMin: (savedKm / CITY_SPEED) * 60,
    driveCostEur: km * costPerKm,
  };
}

export function monthBounds(d = new Date()) {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const iso = (x) => x.toLocaleDateString("sv-SE");
  return { from, to, fromDay: iso(from), toDay: iso(to) };
}
