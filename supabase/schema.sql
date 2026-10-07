-- Kuriérska mapa – databáza
-- Celý tento súbor skopíruj do Supabase → SQL Editor → New query a klikni Run.
-- Dá sa spustiť aj opakovane, nič sa nezmaže.

-- 1) Adresy mesta (spoločné pre všetkých kuriérov)
create table if not exists public.addresses (
  key         text primary key,          -- napr. "nitrianska|12"
  street      text not null,             -- "Nitrianska"
  number      text not null,             -- "12" alebo "12A"
  conscription text,                     -- súpisné číslo, ak je známe
  lat         double precision not null,
  lon         double precision not null,
  source      text not null default 'osm',
  created_at  timestamptz not null default now()
);
create index if not exists addresses_street_idx on public.addresses (street);

-- 2) Naučené vchody (spoločná pamäť kuriérov)
create table if not exists public.entrances (
  key         text primary key references public.addresses(key) on delete cascade,
  lat         double precision not null,
  lon         double precision not null,
  note        text,
  updated_by  uuid references auth.users(id) default auth.uid(),
  updated_at  timestamptz not null default now()
);

-- 3) Zastávky kuriéra na daný deň (vidí ich len on sám)
create table if not exists public.stops (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  day         date not null default current_date,
  label       text not null,             -- ako to kuriér napísal
  address_key text references public.addresses(key) on delete set null,
  lat         double precision,
  lon         double precision,
  delivered   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists stops_user_day_idx on public.stops (user_id, day);

-- Prístupové pravidlá
alter table public.addresses enable row level security;
alter table public.entrances enable row level security;
alter table public.stops     enable row level security;

drop policy if exists "addresses read"   on public.addresses;
drop policy if exists "addresses insert" on public.addresses;
drop policy if exists "addresses update" on public.addresses;
create policy "addresses read"   on public.addresses for select to authenticated using (true);
create policy "addresses insert" on public.addresses for insert to authenticated with check (true);
create policy "addresses update" on public.addresses for update to authenticated using (true);

drop policy if exists "entrances read"   on public.entrances;
drop policy if exists "entrances write"  on public.entrances;
drop policy if exists "entrances update" on public.entrances;
drop policy if exists "entrances delete" on public.entrances;
create policy "entrances read"   on public.entrances for select to authenticated using (true);
create policy "entrances write"  on public.entrances for insert to authenticated with check (true);
create policy "entrances update" on public.entrances for update to authenticated using (true);
create policy "entrances delete" on public.entrances for delete to authenticated using (true);

drop policy if exists "stops own" on public.stops;
create policy "stops own" on public.stops for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
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
