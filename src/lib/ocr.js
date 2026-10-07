// Čítanie adresy príjemcu z fotky štítku
import { parseAddress, matchStreet, makeKey, normText } from "./address.js";

let workerPromise = null;

// OCR beží priamo v telefóne. Prvé spustenie stiahne slovenský jazyk (pár MB), potom je v pamäti.
async function getWorker(onStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      onStatus?.("Pripravujem čítanie štítkov (prvýkrát to trvá dlhšie)…");
      const { createWorker } = await import("tesseract.js");
      return createWorker("slk");
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// Zmenší fotku a prevedie ju na čiernobielu, aby čítanie bolo rýchlejšie a presnejšie
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const max = 1800;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c;
}

export async function readLabel(file, ctx, onStatus) {
  const worker = await getWorker(onStatus);
  const canvas = await prepare(file);
  const { data } = await worker.recognize(canvas);
  return { ...extractFromText(data.text || "", ctx), raw: data.text || "" };
}

const PHONE = /(?:\+|00)?421[\s/-]?9\d{2}[\s/-]?\d{3}[\s/-]?\d{3}|\b09\d{2}[\s/-]?\d{3}[\s/-]?\d{3}\b/g;

export function normPhone(p) {
  let d = String(p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("0")) d = "+421" + d.slice(1);
  if (d.startsWith("421")) d = "+" + d;
  return d;
}

// Z textu štítku vyberie adresu v meste. ctx = { streets: [názvy ulíc], keys: Set kľúčov adries }
export function extractFromText(text, { streets = [], keys = new Set() } = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[|_~]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const candidates = [];
  lines.forEach((line, i) => {
    // riadok môže obsahovať aj meno alebo firmu pred adresou, skúšame od rôznych slov
    const words = line.split(" ");
    for (let s = 0; s < Math.min(words.length - 1, 4); s++) {
      const part = words.slice(s).join(" ");
      const p = parseAddress(part);
      if (!p) continue;
      const st = matchStreet(p.street, streets);
      if (!st) continue;
      const key = makeKey(st, p.number);
      const near = lines.slice(i, i + 3).join(" ");
      let score = 1;
      if (keys.has(key)) score += 3;                         // dom naozaj existuje
      if (/958\s?0\d|partiz/i.test(normText(near))) score += 2; // PSČ alebo mesto pod adresou
      if (normText(st) === normText(p.street)) score += 1;     // ulica bez preklepu
      candidates.push({ label: `${st} ${p.number}`, key, score, line });
      break;
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  // ak je na štítku aj odosielateľ, beriem adresu s najvyšším skóre (príjemca býva v meste)
  const best = candidates[0] || null;
  const phones = [...text.matchAll(PHONE)].map((m) => normPhone(m[0]));
  return {
    address: best ? best.label : "",
    confident: !!best && best.score >= 4,
    phone: phones[phones.length - 1] || "", // telefón príjemcu býva nižšie na štítku
    candidates: candidates.slice(0, 3).map((c) => c.label),
  };
}
