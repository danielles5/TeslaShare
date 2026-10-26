-- Additive notification infrastructure only. No writes, triggers, or foreign keys
-- on business tables. In particular, events are deleted/reinserted by the existing
-- save RPC: a delivery -> events FK would break that flow or erase deduplication.
begin;
create table public.drive_reminder_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 activated_at timestamptz
);
insert into public.drive_reminder_settings(singleton) values(true);

create table public.drive_push_devices (
 id uuid primary key,
 household_id uuid not null,
 participant text not null check(participant in ('danielle','maya')),
 endpoint text not null unique check(length(endpoint) <= 4096 and endpoint ~ '^https://'),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87}$'),
 auth_key text not null check(auth_key ~ '^[A-Za-z0-9_-]{22}$'),
 enabled boolean not null default true,
 expiration_time timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_test_at timestamptz
);
create index drive_push_household on public.drive_push_devices(household_id) where enabled;

create table public.drive_reminder_deliveries (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null,
 drive_id uuid not null,
 device_id uuid not null,
 participant text not null check(participant in ('danielle','maya')),
 status text not null default 'claimed' check(status in ('claimed','accepted','failed','uncertain','expired','skipped')),
 claimed_at timestamptz not null default now(),
 finished_at timestamptz,
 http_status integer,
 unique(drive_id,device_id)
);
alter table public.drive_reminder_settings enable row level security;
alter table public.drive_push_devices enable row level security;
alter table public.drive_reminder_deliveries enable row level security;
revoke all on public.drive_reminder_settings,public.drive_push_devices,public.drive_reminder_deliveries from public,anon,authenticated;
grant all on public.drive_reminder_settings,public.drive_push_devices,public.drive_reminder_deliveries to service_role;
-- Authenticated access is restricted to capability-scoped RPCs below: no listing
-- of another device's subscription keys even within the shared household login.
create policy push_device_household on public.drive_push_devices for select to authenticated using(household_id in (select id from public.households where owner_user_id=(select auth.uid())));
create policy reminder_delivery_household on public.drive_reminder_deliveries for select to authenticated using(household_id in (select id from public.households where owner_user_id=(select auth.uid())));

create function public.drive_push_device(action text, device_id uuid default null, subscription jsonb default null, person text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid; d public.drive_push_devices; endpoint_value text := subscription->>'endpoint';
begin
 select id into h from public.households where owner_user_id=auth.uid();
 if h is null then raise exception 'Household authentication required'; end if;
 if endpoint_value is null then raise exception 'Current browser subscription required'; end if;
 -- This lock only serializes notification registration; it is not the drive lock.
 perform pg_advisory_xact_lock(hashtextextended('drive-push:'||h::text,0));
 select * into d from public.drive_push_devices where household_id=h and endpoint=endpoint_value;
 if action='status' then
  if d.id is null then return null; end if;
 elsif action='register' then
  if person not in ('danielle','maya') or person is null or device_id is null then raise exception 'Select this device participant'; end if;
  -- A browser endpoint is globally unique. Reusing it must never add another row.
  if d.id is not null then device_id:=d.id; end if;
  if exists(select 1 from public.drive_push_devices x where x.id=device_id and x.household_id<>h) then raise exception 'Device not authorized'; end if;
  insert into public.drive_push_devices(id,household_id,participant,endpoint,p256dh,auth_key,expiration_time)
  values(device_id,h,person,endpoint_value,subscription->'keys'->>'p256dh',subscription->'keys'->>'auth',
    case when subscription->>'expirationTime' is null then null else to_timestamp((subscription->>'expirationTime')::double precision/1000) end)
  on conflict(id) do update set participant=excluded.participant,endpoint=excluded.endpoint,p256dh=excluded.p256dh,
   auth_key=excluded.auth_key,expiration_time=excluded.expiration_time,enabled=true,updated_at=now()
  returning * into d;
 elsif action='disable' then
  update public.drive_push_devices set enabled=false,updated_at=now() where id=d.id and household_id=h returning * into d;
 elsif action='test' then
  update public.drive_push_devices set last_test_at=now() where id=d.id and household_id=h and enabled
   and (expiration_time is null or expiration_time>now()) and (last_test_at is null or last_test_at<now()-interval '1 minute') returning * into d;
  if not found then raise exception 'Enable this device first, or wait one minute before another test'; end if;
  -- Return only safe metadata, including for direct authenticated RPC calls.
  -- The Edge Function fetches push material separately using its server role.
 else raise exception 'Unsupported notification action'; end if;
 if d.id is null then return null; end if;
 return jsonb_build_object('id',d.id,'participant',d.participant,'enabled',d.enabled,'expiration_time',d.expiration_time);
end $$;
revoke all on function public.drive_push_device(text,uuid,jsonb,text) from public,anon;
grant execute on function public.drive_push_device(text,uuid,jsonb,text) to authenticated;

create function public.claim_drive_reminders(threshold_minutes integer)
returns setof public.drive_reminder_deliveries language sql security definer set search_path='' as $$
 insert into public.drive_reminder_deliveries(household_id,drive_id,device_id,participant)
 select e.household_id,e.id,d.id,d.participant
 from public.events e join public.drive_push_devices d on d.household_id=e.household_id
 cross join public.drive_reminder_settings cfg
 where cfg.enabled and cfg.activated_at is not null and threshold_minutes between 1 and 1440
  and e.kind='drive' and e.ended_at is null and not e.is_demo
  and e.started_at>=cfg.activated_at and e.created_at>=cfg.activated_at
  and e.started_at<=now()-make_interval(mins=>threshold_minutes)
  and (e.possession=d.participant or e.possession='shared')
  and d.enabled and (d.expiration_time is null or d.expiration_time>now())
  and not exists(select 1 from public.drive_reminder_deliveries log where log.drive_id=e.id and log.device_id=d.id)
 order by e.started_at,d.id limit 20
 on conflict(drive_id,device_id) do nothing returning *;
$$;

create function public.prepare_drive_reminder(delivery_id uuid, threshold_minutes integer)
returns setof public.drive_push_devices language sql security definer set search_path='' as $$
 select d.* from public.drive_reminder_deliveries log
 join public.events e on e.id=log.drive_id and e.household_id=log.household_id
 join public.drive_push_devices d on d.id=log.device_id and d.household_id=log.household_id
 cross join public.drive_reminder_settings cfg
 where log.id=delivery_id and log.status='claimed' and cfg.enabled and cfg.activated_at is not null
  and threshold_minutes between 1 and 1440
  and e.kind='drive' and e.ended_at is null and not e.is_demo
  and e.started_at>=cfg.activated_at and e.created_at>=cfg.activated_at
  and e.started_at<=now()-make_interval(mins=>threshold_minutes)
  and d.enabled and d.participant=log.participant and (d.expiration_time is null or d.expiration_time>now())
  and (e.possession=d.participant or e.possession='shared');
$$;
revoke all on function public.claim_drive_reminders(integer),public.prepare_drive_reminder(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_drive_reminders(integer),public.prepare_drive_reminder(uuid,integer) to service_role;
commit;
