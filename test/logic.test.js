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
