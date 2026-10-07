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
