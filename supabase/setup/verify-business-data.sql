-- READ ONLY. Compare immediately before/after backend setup with no concurrent
-- normal app edits. Only counts/fingerprints leave the database, not record data.
select 'households' as source, count(*) as records,
 md5(coalesce(string_agg(to_jsonb(t)::text, '' order by t.id),'')) as fingerprint
from public.households t
union all
select 'events',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by t.id),''))
from public.events t
union all
select 'repayments',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by t.id),''))
from public.repayments t
union all
select 'mutation_receipts',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by t.household_id,t.request_id),''))
from public.mutation_receipts t;
