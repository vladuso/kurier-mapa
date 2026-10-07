import assert from "node:assert/strict";
import { parseAddress, matchStreet, makeKey } from "../src/lib/address.js";
import { toRows } from "../src/lib/geodata.js";
import { planRoute, streetOrder, routeLength, cluster } from "../src/lib/route.js";

// parsovanie
assert.deepEqual(parseAddress("Nitrianska 12").key, "nitrianska|12");
assert.equal(parseAddress("ul. Nitrianska 12a").key, "nitrianska|12A");
assert.equal(parseAddress("Nitrianska 1203/12, 958 01 Partizánske").number, "12");
assert.equal(parseAddress("Nitrianska 1203/12").conscription, "1203");
assert.equal(parseAddress("R. Jašíka 5, Partizánske").street, "R. Jašíka");
assert.equal(parseAddress("Nám. SNP 3").key, "namestie snp|3");
assert.equal(parseAddress("Nitrianska"), null);
// ulice
const streets = ["Nitrianska", "Horská", "Novomeská", "Námestie SNP"];
assert.equal(matchStreet("nitrianska", streets), "Nitrianska");
assert.equal(matchStreet("Nitrianka", streets), "Nitrianska");
assert.equal(matchStreet("Novo", streets), "Novomeská");
assert.equal(matchStreet("Bratislavská", streets), null);
// OSM slovenské adresy
const rows = toRows([
  { type: "node", lat: 48.62, lon: 18.37, tags: { "addr:street": "Horská", "addr:housenumber": "1203/8", "addr:conscriptionnumber": "1203", "addr:streetnumber": "8" } },
  { type: "way", center: { lat: 48.63, lon: 18.38 }, tags: { "addr:street": "Novomeská", "addr:housenumber": "2" } },
  { type: "node", lat: 48.6, lon: 18.4, tags: { "addr:place": "Návojovce", "addr:housenumber": "45" } },
]);
const keys = rows.map((r) => r.key).sort();
assert.deepEqual(keys, ["horska|1203", "horska|8", "navojovce|45", "novomeska|2"]);
assert.equal(makeKey("Horská", "8"), "horska|8");
// zhluky: dom na rohu Novomeskej padne k Horskej
const pts = [
  { id: 1, street: "Horská", number: "8", lat: 48.6300, lon: 18.3700 },
  { id: 2, street: "Horská", number: "10", lat: 48.6302, lon: 18.3705 },
  { id: 3, street: "Novomeská", number: "2", lat: 48.6304, lon: 18.3710 },   // ~50 m od Horskej 10
  { id: 4, street: "Novomeská", number: "60", lat: 48.6400, lon: 18.3710 },  // ~1,1 km ďalej
  { id: 5, street: "Agátová", number: "1", lat: 48.6250, lon: 18.3650 },
];
const g = cluster(pts, 80);
const corner = g.find((c) => c.items.some((p) => p.id === 3));
assert.ok(corner.items.some((p) => p.id === 1) && corner.items.some((p) => p.id === 2), "roh sa nespojil s Horskou");
const start = { lat: 48.6200, lon: 18.3600 };
const plan = planRoute(pts, start, 80).flatMap((c) => c.items);
assert.equal(plan.length, 5);
assert.ok(routeLength(plan, start) <= routeLength(streetOrder(pts), start));
// výkon: 250 zastávok
const many = Array.from({ length: 250 }, (_, i) => ({ id: i, street: "S" + (i % 30), number: String(i), lat: 48.60 + Math.random() * 0.05, lon: 18.33 + Math.random() * 0.1 }));
const t0 = Date.now(); planRoute(many, start, 80); const ms = Date.now() - t0;
console.log("250 zastávok naplánovaných za", ms, "ms; mestská trasa skrátená o",
  Math.round((1 - routeLength(planRoute(many, start).flatMap((c) => c.items), start) / routeLength(streetOrder(many), start)) * 100), "%");
console.log("Všetky testy prešli.");

// --- čítanie štítku ---
const { extractFromText, normPhone } = await import("../src/lib/ocr.js");
const ctx = { streets: ["Nitrianska", "Horská", "Februárová", "R. Jašíka"], keys: new Set(["nitrianska|12", "februarova|5"]) };
const label = `Odosielateľ: Alza.sk s.r.o.
Jankovcova 1522/53
170 00 Praha 7
Príjemca: Ján Novák
Nitrianska 1203/12
958 01 Partizánske
Tel: +421 905 123 456`;
let r = extractFromText(label, ctx);
assert.equal(r.address, "Nitrianska 12");
assert.equal(r.confident, true);
assert.equal(r.phone, "+421905123456");
r = extractFromText("JAN NOVAK\nFebruarova 5\n95801 PARTIZANSKE\n0908 111 222", ctx);
assert.equal(r.address, "Februárová 5");
assert.equal(r.phone, "+421908111222");
r = extractFromText("nečitateľný text bez adresy", ctx);
assert.equal(r.address, "");
assert.equal(normPhone("0905/123 456"), "+421905123456");

// --- prehľad ---
const { summarize, fuelEconomy, savedKmToday, tripKm } = await import("../src/lib/stats.js");
const fuel = [
  { at: "2026-10-01T08:00:00Z", liters: 40, total_eur: 62, odo: 10000 },
  { at: "2026-10-08T08:00:00Z", liters: 48, total_eur: 72, odo: 10600 },
];
const eco = fuelEconomy(fuel);
assert.equal(Math.round(eco.consumption * 10) / 10, 8);          // 48 l / 600 km
assert.equal(eco.price, 1.5);                                     // posledné tankovanie 72 € / 48 l
assert.equal(tripKm({ odo_start: 10000, odo_end: 10120 }), 120);
assert.equal(Math.round(savedKmToday(10000, 7000) * 10) / 10, 3.9);                     // 3 km vzdušne × 1,3
const sum = summarize({ trips: [{ day: "2026-10-02", odo_start: 1, odo_end: 121, saved_km: 4, delivered: 150 }], fuel, todaySavedKm: 2, todayKey: "2026-10-07" });
assert.equal(sum.km, 120);
assert.equal(sum.savedKm, 6);
assert.equal(Math.round(sum.savedEur * 100) / 100, 0.72);         // 6 km × 0,08 l × 1,5 €
console.log("Testy štítkov a prehľadu prešli.");
assert.equal(fuelEconomy(fuel, 1.62).price, 1.62);               // ručne zapísaná cena má prednosť
assert.equal(fuelEconomy(fuel, null).price, 1.5);
console.log("Test ručnej ceny nafty prešiel.");
