-- Row counts per business for the tables that matter most. Run against the live
-- database and a restored copy; the two outputs must match (scripts/restore-drill.sh).
\pset footer off
select b.slug,
       (select count(*) from public.customers c where c.business_id = b.id)            as customers,
       (select count(*) from public.leads l where l.business_id = b.id)                as leads,
       (select count(*) from public.orders o where o.business_id = b.id)               as orders,
       (select coalesce(sum(amount), 0) from public.payments p where p.business_id = b.id and p.kind = 'payment') as paid,
       (select count(*) from public.messages m where m.business_id = b.id)             as messages,
       (select count(*) from public.audit_logs a where a.business_id = b.id)           as audit_rows
  from public.businesses b
 order by b.slug;
