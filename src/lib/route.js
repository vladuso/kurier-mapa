// Zhlukovanie zastávok podľa reálnej vzdialenosti a návrh poradia

export function meters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Zastávky bližšie ako `radius` metrov (aj cez reťaz susedov) tvoria jeden zhluk.
export function cluster(points, radius = 80) {
  const parent = points.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (meters(points[i], points[j]) <= radius) parent[find(i)] = find(j);
  const groups = new Map();
  points.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });
  return [...groups.values()].map((items) => ({
    items,
    lat: items.reduce((s, p) => s + p.lat, 0) / items.length,
    lon: items.reduce((s, p) => s + p.lon, 0) / items.length,
  }));
}

function nearestOrder(nodes, start) {
  const left = [...nodes];
  const out = [];
  let cur = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((n, i) => { const d = meters(cur, n); if (d < bd) { bd = d; bi = i; } });
    cur = left.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

function pathLen(nodes, start) {
  let L = 0, cur = start;
  for (const n of nodes) { L += meters(cur, n); cur = n; }
  return L;
}

// 2-opt: prehadzuje úseky trasy, kým sa skracuje (otvorená trasa od štartu)
function twoOpt(nodes, start) {
  const p = [start, ...nodes];
  let improved = true, guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < p.length - 1; i++) {
      for (let k = i + 1; k < p.length; k++) {
        const a = p[i - 1], b = p[i], c = p[k], d = p[k + 1];
        const before = meters(a, b) + (d ? meters(c, d) : 0);
        const after = meters(a, c) + (d ? meters(b, d) : 0);
        if (after + 0.5 < before) {
          const seg = p.slice(i, k + 1).reverse();
          p.splice(i, seg.length, ...seg);
          improved = true;
        }
      }
    }
  }
  return p.slice(1);
}

// Hlavná funkcia: vráti zoradené zhluky, v každom zoradené zastávky
export function planRoute(points, start, radius = 80) {
  if (!points.length) return [];
  const groups = cluster(points, radius);
  let order = nearestOrder(groups, start);
  if (order.length <= 400) order = twoOpt(order, start);
  let cur = start;
  return order.map((g) => {
    const items = nearestOrder(g.items, cur);
    cur = items[items.length - 1];
    return { ...g, items };
  });
}

// Poradie, ako by išiel kuriér "po starom": ulice podľa abecedy, čísla vzostupne
export function streetOrder(points) {
  return [...points].sort((a, b) =>
    (a.street || "").localeCompare(b.street || "", "sk") ||
    (parseInt(a.number) || 0) - (parseInt(b.number) || 0));
}

export function routeLength(points, start) {
  return pathLen(points, start);
}
