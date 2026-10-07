// Adresy z OpenStreetMap: hromadný import mesta a dohľadanie jednej adresy
import { makeKey, normNumber } from "./address.js";

// Partizánske vrátane častí (Šimonovany, Veľké a Malé Bielice, Návojovce, Luhy)
export const CITY = {
  name: "Partizánske",
  center: { lat: 48.6275, lon: 18.3755 },
  bbox: { south: 48.585, west: 18.320, north: 48.665, east: 18.450 },
};

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// Stiahne všetky adresné body v okolí mesta. Vráti zoznam riadkov pre tabuľku addresses.
export async function fetchCityAddresses(bbox = CITY.bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:90];
(
  node["addr:housenumber"](${b});
  way["addr:housenumber"](${b});
  node["addr:streetnumber"](${b});
  way["addr:streetnumber"](${b});
);
out center tags;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!res.ok) throw new Error("Server máp odpovedal chybou " + res.status);
      const json = await res.json();
      return toRows(json.elements || []);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Server máp je nedostupný");
}

export function toRows(elements) {
  const rows = new Map();
  for (const el of elements) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const street = t["addr:street"] || t["addr:place"];
    if (!street) continue;
    // Na Slovensku: addr:housenumber = "súpisné/orientačné", addr:streetnumber = orientačné
    let number = t["addr:streetnumber"];
    let conscription = t["addr:conscriptionnumber"] || null;
    const hn = t["addr:housenumber"];
    if (!number && hn) {
      const parts = hn.split("/");
      if (parts.length === 2) { conscription = conscription || parts[0].trim(); number = parts[1].trim(); }
      else number = hn.trim();
    }
    if (!number) continue;
    const add = (num) => {
      const key = makeKey(street, num);
      if (!rows.has(key)) rows.set(key, { key, street, number: normNumber(num), conscription, lat, lon, source: "osm" });
    };
    add(number);
    // ak je známe aj súpisné číslo, adresa sa nájde aj podľa neho
    if (conscription && t["addr:street"]) {
      const k2 = makeKey(street, conscription);
      if (!rows.has(k2)) rows.set(k2, { key: k2, street, number: normNumber(conscription), conscription, lat, lon, source: "osm-supisne" });
    }
  }
  return [...rows.values()];
}

// Dohľadá jednu adresu cez Nominatim (pomalšie, 1 dotaz za sekundu)
let lastCall = 0;
export async function geocodeOne(street, number) {
  const wait = Math.max(0, lastCall + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const { south, west, north, east } = CITY.bbox;
  const params = new URLSearchParams({
    street: `${number} ${street}`, city: CITY.name, country: "Slovensko",
    format: "jsonv2", limit: "1", countrycodes: "sk", addressdetails: "1",
    viewbox: `${west},${north},${east},${south}`, bounded: "1",
  });
  const res = await fetch("https://nominatim.openstreetmap.org/search?" + params);
  if (!res.ok) return null;
  const [hit] = await res.json();
  if (!hit) return null;
  // ak Nominatim nájde len ulicu, nie konkrétny dom, berieme to ako nepresné
  const exact = !!hit.address?.house_number;
  return { lat: +hit.lat, lon: +hit.lon, exact };
}
