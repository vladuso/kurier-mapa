import { createClient } from "@supabase/supabase-js";

// Verejné údaje projektu (publishable kľúč je určený do prehliadača, nie je tajný).
// Premenné vo Verceli majú prednosť, ak sú nastavené.
const url = import.meta.env.VITE_SUPABASE_URL || "https://qjmsmfvejneouznrrlba.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_pGzsn7kzEq1_uWIj3mo--A_ZyPl9sG-";

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

// Načíta celú tabuľku po stránkach (Supabase vracia max. 1000 riadkov naraz)
export async function fetchAll(table, columns = "*") {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

export async function upsertInBatches(table, rows, onProgress, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + size), { onConflict: "key", ignoreDuplicates: true });
    if (error) throw error;
    onProgress?.(Math.min(rows.length, i + size), rows.length);
  }
}
