-- Atomic WhatsApp delivery claims. A crashed worker's claim becomes eligible
-- for retry when its renewable lease expires; completed sends remain permanent.
alter table public.whatsapp_delivery_keys
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'whatsapp_delivery_attempt_count_nonnegative'
       and conrelid = 'public.whatsapp_delivery_keys'::regclass
  ) then
    alter table public.whatsapp_delivery_keys
      add constraint whatsapp_delivery_attempt_count_nonnegative
      check (attempt_count >= 0);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'whatsapp_delivery_lease_pair'
       and conrelid = 'public.whatsapp_delivery_keys'::regclass
  ) then
    alter table public.whatsapp_delivery_keys
      add constraint whatsapp_delivery_lease_pair
      check ((lease_token is null) = (lease_expires_at is null));
  end if;
end
$$;

create index if not exists whatsapp_delivery_expired_lease_idx
  on public.whatsapp_delivery_keys (lease_expires_at)
  where provider_message_id is null;
