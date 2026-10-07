-- Aktualizácia 2: stav balíka, telefón príjemcu, jazdy (tachometer) a tankovanie
-- Skopíruj celý súbor do Supabase → SQL Editor → New query → Run. Dá sa spustiť aj opakovane.

-- Stav balíka: open = na trase, delivered = doručené, failed = nedoručené, later = zavolať neskôr
alter table public.stops add column if not exists status text not null default 'open';
alter table public.stops add column if not exists phone text;
alter table public.stops add column if not exists status_at timestamptz;
update public.stops set status = 'delivered' where delivered = true and status = 'open';
alter table public.stops drop constraint if exists stops_status_check;
alter table public.stops add constraint stops_status_check
  check (status in ('open', 'delivered', 'failed', 'later'));

-- Jazdy: stav tachometra ráno a večer, odhad ušetrených km
create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  day        date not null default current_date,
  odo_start  numeric,
  odo_end    numeric,
  saved_km   numeric not null default 0,
  delivered  int not null default 0,
  failed     int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

-- Tankovanie
create table if not exists public.fuel (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade default auth.uid(),
  at        timestamptz not null default now(),
  liters    numeric not null check (liters > 0),
  total_eur numeric not null check (total_eur > 0),
  odo       numeric
);
create index if not exists fuel_user_at_idx on public.fuel (user_id, at);

alter table public.trips enable row level security;
alter table public.fuel  enable row level security;
drop policy if exists "trips own" on public.trips;
create policy "trips own" on public.trips for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "fuel own" on public.fuel;
create policy "fuel own" on public.fuel for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
