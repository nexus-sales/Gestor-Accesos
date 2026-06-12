-- Endurece vaults_ga para que la bóveda solo sea accesible tras 2FA real.
-- Ejecutar en Supabase SQL Editor. Revisa nombres si tu tabla/columnas difieren.

alter table public.vaults_ga enable row level security;

drop policy if exists "vaults_ga_select_own_aal2" on public.vaults_ga;
drop policy if exists "vaults_ga_insert_own_aal2" on public.vaults_ga;
drop policy if exists "vaults_ga_update_own_aal2" on public.vaults_ga;
drop policy if exists "vaults_ga_delete_own_aal2" on public.vaults_ga;

create policy "vaults_ga_select_own_aal2"
on public.vaults_ga
for select
to authenticated
using (
  auth.uid() = user_id
  and auth.jwt()->>'aal' = 'aal2'
);

create policy "vaults_ga_insert_own_aal2"
on public.vaults_ga
for insert
to authenticated
with check (
  auth.uid() = user_id
  and auth.jwt()->>'aal' = 'aal2'
);

create policy "vaults_ga_update_own_aal2"
on public.vaults_ga
for update
to authenticated
using (
  auth.uid() = user_id
  and auth.jwt()->>'aal' = 'aal2'
)
with check (
  auth.uid() = user_id
  and auth.jwt()->>'aal' = 'aal2'
);

create policy "vaults_ga_delete_own_aal2"
on public.vaults_ga
for delete
to authenticated
using (
  auth.uid() = user_id
  and auth.jwt()->>'aal' = 'aal2'
);
