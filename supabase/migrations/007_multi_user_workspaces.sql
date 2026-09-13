-- Give every authenticated Google user an isolated Lantern workspace.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(excluded.name, public.profiles.name),
        updated_at = now();
  return new;
end;
$$;

-- The former owner-only trigger skipped other test users. Backfill them before
-- their first Lantern write needs a profile foreign-key target.
insert into public.profiles (id, email, name)
select
  user_row.id,
  coalesce(user_row.email, ''),
  coalesce(
    user_row.raw_user_meta_data->>'full_name',
    user_row.raw_user_meta_data->>'name'
  )
from auth.users as user_row
on conflict (id) do update
  set email = excluded.email,
      name = coalesce(excluded.name, public.profiles.name),
      updated_at = now();

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
using (id = auth.uid())
with check (id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'contacts',
    'recordings',
    'meetings',
    'transcripts',
    'meeting_insights',
    'commitments',
    'follow_ups',
    'actions',
    'devices'
  ]
  loop
    execute format('drop policy if exists "own %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "own %1$s" on public.%1$I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      table_name
    );
  end loop;
end
$$;

-- Earlier migrations used readable policy names for these tables instead of
-- the generated names above. Remove them so no owner-email restriction remains.
drop policy if exists "own provider connections" on public.provider_connections;
create policy "own provider connections" on public.provider_connections for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own device pairings" on public.device_pairings;
create policy "own device pairings" on public.device_pairings for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own lantern sessions" on public.lantern_sessions;
create policy "own lantern sessions" on public.lantern_sessions for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own lantern device events" on public.lantern_device_events;
create policy "own lantern device events" on public.lantern_device_events for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own relay matches" on public.relay_matches;
create policy "own relay matches" on public.relay_matches for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own meeting contacts" on public.meeting_contacts;
create policy "own meeting contacts" on public.meeting_contacts for all to authenticated
using (
  exists (
    select 1 from public.meetings as meeting
    where meeting.id = meeting_id and meeting.user_id = auth.uid()
  )
  and exists (
    select 1 from public.contacts as contact
    where contact.id = contact_id and contact.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.meetings as meeting
    where meeting.id = meeting_id and meeting.user_id = auth.uid()
  )
  and exists (
    select 1 from public.contacts as contact
    where contact.id = contact_id and contact.user_id = auth.uid()
  )
);

drop policy if exists "users upload own recordings" on storage.objects;
create policy "users upload own recordings" on storage.objects for insert to authenticated
with check (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users read own recordings" on storage.objects;
create policy "users read own recordings" on storage.objects for select to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users delete own recordings" on storage.objects;
create policy "users delete own recordings" on storage.objects for delete to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
