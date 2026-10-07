-- Aktualizácia 3: správca vidí a upravuje dáta všetkých kuriérov
-- Skopíruj celý súbor do Supabase → SQL Editor → New query → Run. Dá sa spustiť aj opakovane.

-- Zoznam správcov
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "admins self" on public.admins;
create policy "admins self" on public.admins for select to authenticated using (user_id = auth.uid());

-- Je prihlásený používateľ správca?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Zoznam kuriérov s e-mailom (len pre správcu)
create or replace function public.admin_couriers()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Len pre správcu'; end if;
  return query select u.id, u.email::text, u.created_at, u.last_sign_in_at from auth.users u order by u.email;
end $$;

-- Správca smie čítať a meniť balíky, jazdy a tankovania všetkých kuriérov
drop policy if exists "stops admin" on public.stops;
create policy "stops admin" on public.stops for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "trips admin" on public.trips;
create policy "trips admin" on public.trips for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "fuel admin" on public.fuel;
create policy "fuel admin" on public.fuel for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Prvý správca (zmeň e-mail, ak sa prihlasuješ iným)
insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('vlado@closian.com')
on conflict do nothing;
