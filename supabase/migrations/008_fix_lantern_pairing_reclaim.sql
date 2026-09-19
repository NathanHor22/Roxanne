-- Qualify the session column because the function's table return type also
-- creates a PL/pgSQL output variable named device_id.
begin;

create or replace function public.claim_lantern_pairing(
  p_code_hash text,
  p_device_id uuid,
  p_hardware_id text,
  p_model text,
  p_firmware_version text,
  p_credential_hash text
)
returns table(device_id uuid, owner_id uuid, device_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.device_pairings%rowtype;
  existing public.devices%rowtype;
  claimed public.devices%rowtype;
begin
  select * into pairing
    from public.device_pairings as pairings
   where pairings.code_hash = p_code_hash
     and pairings.claimed_at is null
     and pairings.expires_at > now()
   for update;

  if not found then
    return;
  end if;

  select * into existing
    from public.devices as lantern_devices
   where lantern_devices.hardware_id = p_hardware_id
   for update;

  if found and existing.user_id <> pairing.user_id then
    raise exception 'Lantern hardware is already paired to another owner';
  end if;

  if found then
    if existing.revoked_at is null and existing.credential_hash is not null then
      raise exception 'Lantern hardware is already paired; revoke it before pairing again';
    end if;

    update public.lantern_sessions as sessions
       set ended_at = coalesce(sessions.ended_at, now()), updated_at = now()
     where sessions.device_id = existing.id and sessions.ended_at is null;

    update public.devices as lantern_devices
       set name = pairing.device_name,
           model = p_model,
           firmware_version = p_firmware_version,
           credential_hash = p_credential_hash,
           paired_at = now(),
           revoked_at = null,
           status = 'online',
           device_state = 'ready',
           state_version = 0,
           last_error = null,
           last_seen_at = now(),
           updated_at = now()
     where lantern_devices.id = existing.id
     returning * into claimed;
  else
    insert into public.devices (
      id, user_id, name, hardware_id, model, firmware_version,
      credential_hash, paired_at, status, device_state, last_seen_at
    ) values (
      p_device_id, pairing.user_id, pairing.device_name, p_hardware_id,
      p_model, p_firmware_version, p_credential_hash, now(), 'online', 'ready', now()
    ) returning * into claimed;
  end if;

  update public.device_pairings as pairings
     set claimed_at = now(), claimed_device_id = claimed.id
   where pairings.id = pairing.id;

  return query select claimed.id, claimed.user_id, claimed.name;
end;
$$;

revoke all on function public.claim_lantern_pairing(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_lantern_pairing(text, uuid, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
