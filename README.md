# Kuriérska mapa

Webová appka pre kuriérov. Balíky zoskupuje podľa toho, kde reálne stoja domy, nie podľa názvu ulice.
Kuriéri si navzájom zdieľajú opravené vchody.

## Čo vie prvá verzia

- prihlásenie kuriéra (e-mail a heslo)
- vloženie adries (jedna na riadok), automatické nájdenie na mape
- zoskupenie blízkych domov do jednej zastávky a návrh poradia od štartu
- porovnanie „po uliciach“ a „podľa polohy“ s percentom úspory
- oprava vchodu, ktorú vidia všetci kuriéri
- ručné označenie adresy, ktorú appka nepozná (zapamätá si ju)
- Doručené, navigácia cez Google Maps alebo Waze
- import všetkých adries Partizánskeho z OpenStreetMap

## Spustenie (raz)

1. **Supabase → SQL Editor → New query**: vlož celý súbor `supabase/schema.sql` a klikni **Run**.
2. **Supabase → Authentication → Sign In / Providers → Email**: vypni **Confirm email**, aby sa kuriéri vedeli hneď prihlásiť.
3. **Supabase → Project Settings → API**: skopíruj **Project URL** a kľúč **anon public**.
4. **Vercel → Add New → Project**: vyber GitHub repozitár `kurier-mapa`, framework sa nastaví na Vite.
   V časti **Environment Variables** pridaj:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public kľúč
   a klikni **Deploy**.
5. Otvor appku, vytvor si účet a v **Nastaveniach** klikni **Načítať adresy (Partizánske)**.
6. V mobile: v prehliadači menu → **Pridať na plochu**.

## Pre vývojára

```
npm install
cp .env.example .env.local   # doplň hodnoty zo Supabase
npm run dev
npm test                     # test spracovania adries a trasy
```

Mapa: OpenFreeMap (OpenStreetMap). Hľadanie chýbajúcich adries: Nominatim (max. 1 dotaz za sekundu).
