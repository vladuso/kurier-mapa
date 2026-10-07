// Spracovanie adries: "Nitrianska 12", "ul. Nitrianska 1203/12", "Nitrianska 12a, Partizánske"

export function normText(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(ul|ulica|nam|namestie)\.?\s+/g, (m) => (m.startsWith("nam") ? "namestie " : ""))
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normNumber(n) {
  return String(n || "").replace(/\s+/g, "").toUpperCase();
}

export function makeKey(street, number) {
  return `${normText(street)}|${normNumber(number)}`;
}

// Rozloží riadok na ulicu a číslo. Vráti null, ak číslo chýba.
export function parseAddress(line) {
  let text = String(line || "").trim();
  if (!text) return null;
  // odstráni PSČ a mesto na konci: "..., 958 01 Partizánske"
  text = text.replace(/,?\s*\d{3}\s?\d{2}\s*[\p{L} .-]*$/u, "");
  text = text.replace(/,\s*partiz[aá]nske\s*$/i, "");
  text = text.split(",")[0].trim();

  const m = text.match(/^(.*?)[\s,]+(\d+)\s*(?:\/\s*(\d+)\s*([a-zA-Z])?|([a-zA-Z])?)\s*$/);
  if (!m) return null;
  const street = m[1].replace(/\s+/g, " ").trim();
  if (!street) return null;
  let number, conscription = null;
  if (m[3]) {
    // "1203/12" → súpisné 1203, orientačné 12
    conscription = m[2];
    number = m[3] + (m[4] || "");
  } else {
    number = m[2] + (m[5] || "");
  }
  return {
    street,
    number: normNumber(number),
    conscription,
    key: makeKey(street, number),
    label: `${street} ${normNumber(number)}`,
  };
}

// Rozdelí vložený text na riadky s adresami
export function splitLines(text) {
  return String(text || "")
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// Nájde ulicu v zozname známych ulíc (toleruje preklepy a skratky na začiatku)
export function matchStreet(streetInput, knownStreets) {
  const want = normText(streetInput);
  if (!want) return null;
  let exact = knownStreets.find((s) => normText(s) === want);
  if (exact) return exact;
  const prefix = knownStreets.filter((s) => normText(s).startsWith(want));
  if (prefix.length === 1) return prefix[0];
  let best = null, bestD = Infinity;
  for (const s of knownStreets) {
    const d = lev(want, normText(s));
    if (d < bestD) { bestD = d; best = s; }
  }
  const limit = want.length <= 5 ? 1 : 2;
  return bestD <= limit ? best : null;
}

function lev(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
