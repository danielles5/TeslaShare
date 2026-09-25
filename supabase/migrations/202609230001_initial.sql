-- One vehicle per household. A unified source table makes the active-operation
-- constraint enforceable across both drives and charges.
create table public.households (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null default 'Danielle & Maya', timezone text not null default 'Asia/Jerusalem', created_at timestamptz not null default now()
);
create table public.events (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 kind text not null check (kind in ('drive','charge','manual')),
 possession text not null check (possession in ('danielle','maya','shared','guest')),
 guest_name text, start_range numeric, end_range numeric, distance numeric,
 started_at timestamptz not null default now(), ended_at timestamptz, duration_minutes numeric,
 charge_type text check(charge_type in ('normal_full','partial_emergency')), cost numeric(14,2), kwh numeric, rate numeric,
 payer text check(payer in ('danielle','maya','guest')), payer_guest_name text,
 notes text not null default '', is_demo boolean not null default false, demo_batch_id uuid,
 revision integer not null default 1, created_at timestamptz not null default now(),
 check (start_range is null or start_range between 0 and 100000), check(end_range is null or end_range between 0 and 100000),
 check (distance is null or distance >= 0), check(cost is null or cost >= 0), check(kwh is null or kwh > 0), check(rate is null or rate >= 0),
 check(duration_minutes is null or duration_minutes >= 0), check (ended_at is null or ended_at >= started_at),
 check (possession <> 'guest' or (guest_name is not null and length(trim(guest_name)) > 0)), check(payer <> 'guest' or (payer_guest_name is not null and length(trim(payer_guest_name)) > 0)),
 check (is_demo = (demo_batch_id is not null)),
 check ((kind='manual' and distance is not null and ended_at is not null and start_range is null and end_range is null)
     or (kind<>'manual' and start_range is not null and distance is null and (ended_at is null)=(end_range is null))),
 check (kind <> 'charge' or ended_at is null or (cost is not null and payer is not null and charge_type is not null)),
 check (kind='charge' or (cost is null and payer is null and charge_type is null and kwh is null and rate is null)),
 check(not is_demo or ended_at is not null)
);
create unique index one_active_operation on public.events(household_id) where ended_at is null;
create index event_timeline on public.events(household_id,started_at,id);
create table public.repayments (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 payer text not null, recipient text not null, amount numeric(14,2) not null check(amount>0), occurred_at timestamptz not null default now(),
 notes text not null default '', is_demo boolean not null default false, demo_batch_id uuid,
 check(payer <> recipient), check(payer in ('danielle','maya') or payer ~ '^guest:.+'), check(recipient in ('danielle','maya') or recipient ~ '^guest:.+'),
 check(is_demo=(demo_batch_id is not null))
);
create table public.mutation_receipts (
 household_id uuid not null references public.households(id) on delete cascade,
 request_id uuid not null, created_at timestamptz not null default now(), primary key(household_id,request_id)
);
alter table public.mutation_receipts enable row level security;
revoke all on public.mutation_receipts from anon,authenticated;
alter table public.households enable row level security;
alter table public.events enable row level security;
alter table public.repayments enable row level security;
create policy household_read on public.households for select to authenticated using(owner_user_id=(select auth.uid()));
create policy event_read on public.events for select to authenticated using(household_id in (select id from public.households where owner_user_id=(select auth.uid())));
create policy repayment_read on public.repayments for select to authenticated using(household_id in (select id from public.households where owner_user_id=(select auth.uid())));
-- All writes go through the locked RPC; browser clients cannot bypass revision/overlap checks.
revoke all on public.households,public.events,public.repayments from anon,authenticated;
grant select on public.households,public.events,public.repayments to authenticated;
create view public.range_timeline with (security_invoker=true) as
 select id,household_id,kind,start_range,end_range,started_at,ended_at,possession,guest_name,is_demo,demo_batch_id from public.events where kind<>'manual' and ended_at is not null;
grant select on public.range_timeline to authenticated;

create function public.household_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.households; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to continue'; end if;
 insert into public.households(owner_user_id) values(auth.uid()) on conflict(owner_user_id) do nothing;
 select * into h from public.households where owner_user_id=auth.uid();
 -- One SQL statement gives an internally consistent source snapshot.
 select jsonb_build_object('household',to_jsonb(h),'events',coalesce((select jsonb_agg(e order by e.started_at,e.id) from public.events e where household_id=h.id),'[]'::jsonb),
 'repayments',coalesce((select jsonb_agg(r order by r.occurred_at,r.id) from public.repayments r where household_id=h.id),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.mutate_household(action text, payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare h uuid; e public.events; old public.events; r public.repayments; item jsonb;
 batch constant uuid := '20260901-0000-4000-8000-000000000001';
begin
 if auth.uid() is null then raise exception 'Sign in to continue'; end if;
 select id into h from public.households where owner_user_id=auth.uid();
 if h is null then raise exception 'Initialize household first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h::text,0));
 if payload->>'request_id' is not null and exists(select 1 from public.mutation_receipts where household_id=h and request_id=(payload->>'request_id')::uuid) then return public.household_snapshot(); end if;
 if action='save_event' then
  if payload->>'id' is not null then
   select * into old from public.events where id=(payload->>'id')::uuid and household_id=h;
   if old.id is null then raise exception 'Entry no longer exists'; end if;
   if old.revision is distinct from (payload->>'revision')::int then raise exception 'This entry changed on another phone. Refresh and try again.'; end if;
  end if;
  select * into e from jsonb_populate_record(null::public.events,coalesce(to_jsonb(old),'{}'::jsonb)||payload);
  e.id:=coalesce(old.id,gen_random_uuid()); e.household_id:=h; e.is_demo:=coalesce(old.is_demo,false); e.demo_batch_id:=old.demo_batch_id;
  e.revision:=coalesce(old.revision,0)+1; e.created_at:=coalesce(old.created_at,now()); e.notes:=coalesce(e.notes,'');
  if old.id is not null and (e.kind<>old.kind or e.started_at<>old.started_at) then raise exception 'Entry type and start time cannot be changed'; end if;
  if old.ended_at is not null and e.ended_at is null then raise exception 'A completed entry cannot be reopened'; end if;
  if e.started_at>now()+interval '1 minute' or e.ended_at>now()+interval '1 minute' then raise exception 'Entries cannot be in the future'; end if;
  if e.kind<>'manual' and exists(select 1 from public.events x where x.household_id=h and x.id<>e.id and not x.is_demo and not e.is_demo and x.kind<>'manual'
   and tstzrange(x.started_at,coalesce(x.ended_at,'infinity'::timestamptz),'[)') && tstzrange(e.started_at,coalesce(e.ended_at,'infinity'::timestamptz),'[)')) then raise exception 'This time overlaps another drive or charge'; end if;
  if e.kind='manual' and exists(select 1 from public.events x where x.household_id=h and x.ended_at is null) then raise exception 'Finish the active operation before adding a manual estimate'; end if;
  delete from public.events where id=e.id and household_id=h;
  insert into public.events select e.*;
 elsif action='delete_event' then
  delete from public.events where id=(payload->>'id')::uuid and household_id=h and revision=(payload->>'revision')::int;
  if not found then raise exception 'Entry changed or was deleted. Refresh and try again.'; end if;
 elsif action='repay' then
  select * into r from jsonb_populate_record(null::public.repayments,payload);
  r.id:=gen_random_uuid();r.household_id:=h;r.is_demo:=false;r.demo_batch_id:=null;r.occurred_at:=now();r.notes:=coalesce(r.notes,'');
  insert into public.repayments select r.*;
 elsif action='delete_repayment' then
  delete from public.repayments where id=(payload->>'id')::uuid and household_id=h;
 elsif action='load_demo' then
  if not exists(select 1 from public.events where household_id=h and demo_batch_id=batch) then
   for item in select value from jsonb_array_elements(payload->'events') loop
    select * into e from jsonb_populate_record(null::public.events,item - 'id' - 'household_id');
    e.id:=gen_random_uuid();e.household_id:=h;e.is_demo:=true;e.demo_batch_id:=batch;e.revision:=1;e.created_at:=now();e.notes:=coalesce(e.notes,'');
    insert into public.events select e.*;
   end loop;
   for item in select value from jsonb_array_elements(payload->'repayments') loop
    select * into r from jsonb_populate_record(null::public.repayments,item - 'id' - 'household_id');
    r.id:=gen_random_uuid();r.household_id:=h;r.is_demo:=true;r.demo_batch_id:=batch;
    insert into public.repayments select r.*;
   end loop;
  end if;
 elsif action='delete_demo' then
  delete from public.events where household_id=h and is_demo and demo_batch_id=batch;
  delete from public.repayments where household_id=h and is_demo and demo_batch_id=batch;
 else raise exception 'Unknown action'; end if;
 if payload->>'request_id' is not null then insert into public.mutation_receipts(household_id,request_id) values(h,(payload->>'request_id')::uuid); end if;
 return public.household_snapshot();
end $$;
revoke all on function public.household_snapshot(),public.mutate_household(text,jsonb) from public,anon;
grant execute on function public.household_snapshot(),public.mutate_household(text,jsonb) to authenticated;
