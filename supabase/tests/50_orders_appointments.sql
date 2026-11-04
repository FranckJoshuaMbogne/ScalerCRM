-- Appointments, walk-ins, catalogue, quotations, orders, payments, measurements and customer value.
-- Uses its own users and businesses (runs after 40_pipeline_tasks in the same database).
\set ON_ERROR_STOP on
\set QUIET on

\set pat   '0c000000-0000-0000-0000-000000000001'
\set quinn '0c000000-0000-0000-0000-000000000002'
\set rae   '0c000000-0000-0000-0000-000000000003'
\set sam   '0c000000-0000-0000-0000-000000000004'
\set uma   '0c000000-0000-0000-0000-000000000005'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'pat',   'pat@theta.test',   '{"full_name":"Pat Admin"}'),
  (:'quinn', 'quinn@theta.test', '{"full_name":"Quinn Sales"}'),
  (:'rae',   'rae@theta.test',   '{"full_name":"Rae Production"}'),
  (:'sam',   'sam@theta.test',   '{"full_name":"Sam Accounts"}'),
  (:'uma',   'uma@iota.test',    '{"full_name":"Uma Other"}');

select set_config('request.jwt.claim.sub', :'pat', false);
set role authenticated;
select public.create_business('Theta Tailors', 'theta-tailors', 'Main') as biz \gset
select id as main from public.branches where business_id = :'biz' \gset
reset role;
select set_config('request.jwt.claim.sub', :'uma', false);
set role authenticated;
select public.create_business('Iota Store', 'iota-store', 'Delhi') as other \gset
reset role;

insert into public.business_memberships (business_id, user_id, role_id, status, joined_at)
select :'biz', u.id, r.id, 'active', now()
  from (values (:'quinn'::uuid, 'sales_executive'), (:'rae'::uuid, 'production_manager'), (:'sam'::uuid, 'accounts')) u(id, role)
  join public.roles r on r.key = u.role and r.business_id is null;

select id as st_confirmed from public.order_stages where business_id = :'biz' and key = 'confirmed' \gset
select id as st_production from public.order_stages where business_id = :'biz' and key = 'in_production' \gset
select id as st_delivered from public.order_stages where business_id = :'biz' and key = 'delivered' \gset
select id as st_cancelled from public.order_stages where business_id = :'biz' and key = 'cancelled' \gset
select set_config('t.biz', :'biz', false), set_config('t.main', :'main', false),
       set_config('t.st_production', :'st_production', false), set_config('t.st_cancelled', :'st_cancelled', false);

-- ------------------------------------------------------------ defaults and catalogue
select set_config('request.jwt.claim.sub', :'pat', false);
set role authenticated;
select tests.ok((select count(*) = 7 from public.order_stages where business_id = :'biz'), 'new business gets fulfilment stages');
select tests.ok((select count(*) = 4 from public.measurement_templates where business_id = :'biz'), 'new business gets measurement templates');
select tests.ok((select count(*) = 1 from public.my_permissions(:'biz') p where p = 'settings.orders.manage'),
                'admins can manage the catalogue and stages');
insert into public.catalog_items (business_id, name, kind, unit_price, tax_rate)
values (:'biz', 'Bespoke shirt', 'product', 1250.50, 5) returning id as shirt \gset
select tests.ok((select count(*) = 1 from public.audit_logs where entity_type = 'catalog_items' and entity_id = :'shirt'),
                'catalogue changes are audited');
select tests.fails(format('delete from public.catalog_items where id = %L', :'shirt'), 'catalogue items are hidden, not deleted');

select public.create_lead(:'biz', jsonb_build_object('phone', '+919811100001', 'full_name', 'Ravi', 'branch_id', :'main')) as l1 \gset
select (:'l1'::jsonb ->> 'customer_id') as ravi, (:'l1'::jsonb ->> 'lead_id') as ravi_lead \gset
select public.create_lead(:'biz', jsonb_build_object('phone', '+919811100002', 'full_name', 'Sita')) as l2 \gset
select (:'l2'::jsonb ->> 'customer_id') as sita, (:'l2'::jsonb ->> 'lead_id') as sita_lead \gset

-- ------------------------------------------------------------ orders and totals
select public.create_order(:'biz', jsonb_build_object(
  'customer_id', :'ravi', 'lead_id', :'ravi_lead', 'due_date', '2026-12-31',
  'items', jsonb_build_array(
    jsonb_build_object('catalog_item_id', :'shirt', 'description', 'Bespoke shirt', 'quantity', '2',
                       'unit_price', '1250.50', 'discount', '100', 'tax_rate', '5'),
    jsonb_build_object('description', 'Fabric (metres)', 'quantity', '1.5', 'unit_price', '999.99')))) as o1 \gset
select (:'o1'::jsonb ->> 'order_id') as order1 \gset
select set_config('t.order1', :'order1', false);
select tests.ok((select order_number = 'O-000001' from public.orders where id = :'order1'), 'first order gets O-000001');
select tests.ok((select subtotal = 4000.99 and discount_total = 100.00 and tax_total = 120.05 and total = 4021.04
                   from public.orders where id = :'order1'),
                'totals are exact: 2 × 1250.50 − 100 + 5% tax, plus 1.5 × 999.99 rounded to the paisa');
select tests.ok((select count(*) = 1 from public.order_status_history where order_id = :'order1'), 'order creation is in its history');
select tests.ok((select count(*) = 1 from public.lead_activities where lead_id = :'ravi_lead' and type = 'order_created'),
                'the lead timeline shows the order');
select tests.ok((select count(*) = 1 from public.customer_events where customer_id = :'ravi' and type = 'order_created'),
                'the customer timeline shows the order');
select tests.fails(format('select public.create_order(%L, %L)', :'biz', jsonb_build_object('customer_id', :'ravi', 'items', '[]'::jsonb)),
                   'an order needs at least one line');
select tests.fails(format('select public.create_order(%L, %L)', :'biz',
                          jsonb_build_object('customer_id', :'ravi', 'lead_id', :'sita_lead',
                                             'items', jsonb_build_array(jsonb_build_object('description', 'x', 'unit_price', '1')))),
                   'an order cannot borrow another customer''s lead');
select tests.fails(format('select public.create_order(%L, %L)', :'biz',
                          jsonb_build_object('customer_id', :'ravi',
                                             'items', jsonb_build_array(jsonb_build_object('description', 'x', 'unit_price', '10', 'discount', '11')))),
                   'a line discount cannot exceed the line');

-- ------------------------------------------------------------ payments
insert into public.payments (business_id, order_id, amount, method) values (:'biz', :'order1', 1000, 'upi')
returning receipt_number as r1 \gset
select tests.ok(:'r1' = 'R-000001', 'payments get receipt numbers');
select tests.ok((select paid = 1000 and balance = 3021.04 from public.order_balances where order_id = :'order1'),
                'the balance is computed from payments');
select tests.fails(format('insert into public.payments (business_id, order_id, amount) values (%L, %L, 3021.05)', :'biz', :'order1'),
                   'a payment cannot exceed the balance due');
insert into public.payments (business_id, order_id, kind, amount, method, notes) values (:'biz', :'order1', 'refund', 200, 'cash', 'Fabric returned');
select tests.ok((select net_paid = 800 and balance = 3221.04 from public.order_balances where order_id = :'order1'),
                'refunds reduce what was paid');
select tests.fails(format('insert into public.payments (business_id, order_id, kind, amount) values (%L, %L, %L, 900)', :'biz', :'order1', 'refund'),
                   'a refund cannot exceed what was paid');
select tests.fails(format('update public.payments set amount = 1 where order_id = %L', :'order1'), 'payments cannot be edited');
select tests.fails(format('delete from public.payments where order_id = %L', :'order1'), 'payments cannot be deleted');
select tests.ok((select count(*) = 2 from public.customer_events where customer_id = :'ravi'
                   and type in ('payment_received', 'refund_recorded')),
                'payments and refunds land on the customer timeline');
reset role;

-- Accounts can record payments; a sales executive can't.
select set_config('request.jwt.claim.sub', :'sam', false);
set role authenticated;
insert into public.payments (business_id, order_id, amount, method) values (current_setting('t.biz')::uuid, current_setting('t.order1')::uuid, 221.04, 'card');
select tests.ok((select balance = 3000 from public.order_balances where order_id = current_setting('t.order1')::uuid),
                'accounts can record payments');
select tests.affects_none(format('update public.orders set notes = %L where id = %L', 'x', current_setting('t.order1')),
                          'accounts cannot edit orders');
reset role;

select set_config('request.jwt.claim.sub', :'quinn', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.orders), 'a sales executive sees only their own orders');
select (public.create_lead(current_setting('t.biz')::uuid, '{"phone":"+919811100003","full_name":"Quinn''s customer"}')
        ->> 'customer_id') as qc \gset
select public.create_order(current_setting('t.biz')::uuid, jsonb_build_object(
  'customer_id', :'qc', 'owner_id', :'pat',
  'items', jsonb_build_array(jsonb_build_object('description', 'Kurta', 'unit_price', '1500')))) as oq \gset
reset role;
select set_config('request.jwt.claim.sub', :'quinn', false);
set role authenticated;
select tests.ok((select owner_id = :'quinn' from public.orders where id = (:'oq'::jsonb ->> 'order_id')::uuid),
                'orders created by a sales executive are theirs');
select tests.fails(format('select public.replace_order_items(%L, %L)', :'oq'::jsonb ->> 'order_id',
                          jsonb_build_array(jsonb_build_object('description', 'Kurta', 'unit_price', '1'))),
                   'a sales executive cannot change order lines after creating them');
select tests.fails(format('insert into public.payments (business_id, order_id, amount) values (%L, %L, 10)',
                          current_setting('t.biz'), :'oq'::jsonb ->> 'order_id'),
                   'a sales executive cannot record payments');
reset role;

-- ------------------------------------------------------------ fulfilment
select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
update public.orders set stage_id = current_setting('t.st_production')::uuid where id = current_setting('t.order1')::uuid;
select tests.ok((select stage_id = current_setting('t.st_production')::uuid from public.orders where id = current_setting('t.order1')::uuid),
                'production can move an order through its stages');
select tests.fails(format('update public.orders set due_date = %L where id = %L', '2027-01-05', current_setting('t.order1')),
                   'production cannot change other order details');
select tests.fails(format('update public.orders set stage_id = %L where id = %L', current_setting('t.st_cancelled'), current_setting('t.order1')),
                   'production cannot cancel an order');
reset role;

select set_config('request.jwt.claim.sub', :'pat', false);
set role authenticated;
update public.orders set stage_id = :'st_delivered' where id = :'order1';
select tests.ok((select closed_at is not null from public.orders where id = :'order1'), 'delivering an order closes it');
select tests.ok((select count(*) = 3 from public.order_status_history where order_id = :'order1'), 'every stage move is in the history');
select tests.fails(format('select public.replace_order_items(%L, %L)', :'order1',
                          jsonb_build_array(jsonb_build_object('description', 'x', 'unit_price', '1'))),
                   'a closed order''s lines are locked');

-- ------------------------------------------------------------ quotations
select public.create_quotation(:'biz', jsonb_build_object(
  'customer_id', :'sita', 'lead_id', :'sita_lead',
  'items', jsonb_build_array(jsonb_build_object('description', 'Lehenga', 'unit_price', '20000', 'tax_rate', '12')))) as q1 \gset
select (:'q1'::jsonb ->> 'quotation_id') as quote1 \gset
select tests.ok((select quotation_number = 'Q-000001' and total = 22400 from public.quotations where id = :'quote1'),
                'quotations are numbered and totalled');
select public.replace_quotation_items(:'quote1', jsonb_build_array(
  jsonb_build_object('description', 'Lehenga', 'unit_price', '20000', 'discount', '2000', 'tax_rate', '12'),
  jsonb_build_object('description', 'Dupatta', 'unit_price', '1500')));
select tests.ok((select total = 21660 from public.quotations where id = :'quote1'), 'quotation lines can be revised');
select public.convert_quotation(:'quote1') as c1 \gset
select (:'c1'::jsonb ->> 'order_id') as order2 \gset
select tests.ok((select o.total = 21660 and o.quotation_id = :'quote1' and o.lead_id = :'sita_lead'
                   from public.orders o where o.id = :'order2'),
                'converting a quotation creates the order with the same lines');
select tests.ok((select status = 'accepted' and order_id = :'order2' from public.quotations where id = :'quote1'),
                'and marks the quotation accepted');
select tests.fails(format('select public.convert_quotation(%L)', :'quote1'), 'a quotation converts only once');

-- Customer value ignores cancelled orders.
select public.create_order(:'biz', jsonb_build_object('customer_id', :'sita',
  'items', jsonb_build_array(jsonb_build_object('description', 'Blouse', 'unit_price', '3000')))) as o3 \gset
update public.orders set stage_id = :'st_cancelled' where id = (:'o3'::jsonb ->> 'order_id')::uuid;
select tests.ok((select orders_count = 1 and lifetime_value = 21660 from public.customer_value where customer_id = :'sita'),
                'lifetime value counts orders that weren''t cancelled');
select tests.fails(format('insert into public.payments (business_id, order_id, amount) values (%L, %L, 10)',
                          :'biz', :'o3'::jsonb ->> 'order_id'),
                   'a cancelled order takes no payments');

-- ------------------------------------------------------------ measurements
insert into public.customer_measurements (business_id, customer_id, garment, unit, readings, taken_by)
values (:'biz', :'ravi', 'Shirt', 'in', '{"chest": 40.5, "neck": 15.5}', :'pat') returning id as m1 \gset
select tests.ok((select count(*) = 1 from public.customer_events where customer_id = :'ravi' and type = 'measurement_added'),
                'measurements land on the customer timeline');
select tests.fails(format('update public.customer_measurements set readings = %L where id = %L', '{}', :'m1'),
                   'measurements are kept as history, never overwritten');

-- ------------------------------------------------------------ appointments
select least(now() + interval '30 minutes',
             (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day' - interval '1 minute') at time zone 'Asia/Kolkata')
       as a1_at \gset
-- Soon, but always today in IST (the walk-in below completes today's appointments).
insert into public.appointments (business_id, branch_id, customer_id, lead_id, kind, starts_at, ends_at, staff_id, created_by)
values (:'biz', :'main', :'sita', :'sita_lead', 'trial', :'a1_at', :'a1_at'::timestamptz + interval '60 minutes', :'quinn', :'pat')
returning id as a1 \gset
insert into public.appointments (business_id, branch_id, customer_id, kind, starts_at, ends_at, staff_id, created_by)
values (:'biz', :'main', :'ravi', 'measurement', now() - interval '3 hours', now() - interval '2 hours', :'quinn', :'pat')
returning id as a2 \gset
select tests.fails(format('insert into public.appointments (business_id, customer_id, lead_id, starts_at, ends_at, created_by) values (%L, %L, %L, now(), now() + interval %L, %L)',
                          :'biz', :'ravi', :'sita_lead', '1 hour', :'pat'),
                   'an appointment cannot use another customer''s lead');
select tests.ok((select count(*) = 1 from public.lead_activities where lead_id = :'sita_lead' and type = 'appointment_booked'),
                'booking shows on the lead timeline');
reset role;

select set_config('request.jwt.claim.sub', :'quinn', false);
set role authenticated;
select tests.ok((select count(*) = 2 from public.notifications where type = 'appointment_assigned'),
                'staff are told when someone books them');
update public.appointments set status = 'no_show' where id = :'a2';
select tests.ok((select count(*) = 2 from public.appointment_status_history where appointment_id = :'a2'),
                'appointment status changes are kept');
reset role;

-- Background job: reminder an hour ahead, outcome prompt after the end.
select set_config('request.jwt.claim.sub', :'pat', false);
set role authenticated;
insert into public.appointments (business_id, branch_id, customer_id, kind, starts_at, ends_at, staff_id, created_by)
values (:'biz', :'main', :'ravi', 'delivery', now() - interval '3 hours', now() - interval '2 hours', :'quinn', :'pat');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
select public.run_task_jobs() as jobs \gset
reset role;
select tests.ok((:'jobs'::jsonb ->> 'appointment_reminders_queued')::int = 1
                and (select count(*) = 1 from private.email_outbox where template = 'appointment_reminder'),
                'staff get a reminder email before an appointment');
select tests.ok((select count(*) = 1 from public.notifications where user_id = :'quinn' and type = 'appointment_soon'),
                'and an in-app reminder');
select tests.ok((select count(*) = 1 from public.notifications where user_id = :'quinn' and type = 'appointment_outcome'),
                'an appointment nobody closed asks for its outcome');

-- ------------------------------------------------------------ walk-ins
select set_config('request.jwt.claim.sub', :'pat', false);
set role authenticated;
select public.register_walk_in(:'biz', jsonb_build_object('phone', '+919811100002', 'full_name', 'Sita again',
  'branch_id', :'main', 'purpose', 'Trial')) as w1 \gset
select tests.ok((:'w1'::jsonb ->> 'customer_id') = :'sita' and not (:'w1'::jsonb ->> 'lead_created')::boolean,
                'a known phone walking in joins their existing customer file and open lead');
select tests.ok((select status = 'completed' from public.appointments where id = :'a1'),
                'their booked appointment today is marked completed');
select tests.ok((select count(*) = 1 from public.lead_activities where lead_id = :'sita_lead' and type = 'visit'),
                'the visit is on the lead timeline');
select public.register_walk_in(:'biz', jsonb_build_object('phone', '+919811100009', 'full_name', 'New Walker',
  'branch_id', :'main', 'purpose', 'Browsing suits')) as w2 \gset
select tests.ok((select s.key = 'walk_in' and l.owner_id = :'pat'
                   from public.leads l join public.lead_sources s on s.id = l.first_source_id
                  where l.id = (:'w2'::jsonb ->> 'lead_id')::uuid),
                'a new walk-in becomes a lead with source walk-in, owned by the staff member');
select tests.ok((select count(*) = 2 from public.walk_ins where business_id = :'biz'), 'every walk-in is recorded');
reset role;

select set_config('request.jwt.claim.sub', :'rae', false);
set role authenticated;
select tests.fails(format('select public.register_walk_in(%L, %L)', current_setting('t.biz'), '{"phone":"+919811100010","full_name":"X"}'),
                   'registering walk-ins needs appointments.manage');
reset role;

-- ------------------------------------------------------------ merge
select set_config('request.jwt.claim.sub', :'pat', false);
set role authenticated;
select public.merge_customers(:'ravi', :'sita');
select tests.ok((select count(*) = 0 from public.orders where customer_id = :'sita')
                and (select count(*) = 0 from public.appointments where customer_id = :'sita')
                and (select count(*) = 0 from public.payments where customer_id = :'sita'),
                'a merge moves orders, appointments and payments to the surviving file');
reset role;

-- ------------------------------------------------------------ isolation
select set_config('request.jwt.claim.sub', :'uma', false);
set role authenticated;
select tests.ok((select count(*) = 0 from public.orders), 'other tenant sees no orders');
select tests.ok((select count(*) = 0 from public.payments), 'other tenant sees no payments');
select tests.ok((select count(*) = 0 from public.order_balances), 'other tenant sees no balances');
select tests.ok((select count(*) = 0 from public.appointments), 'other tenant sees no appointments');
select tests.ok((select count(*) = 0 from public.walk_ins), 'other tenant sees no walk-ins');
select tests.ok((select count(*) = 0 from public.customer_measurements), 'other tenant sees no measurements');
select tests.ok((select count(*) = 0 from public.catalog_items where business_id = current_setting('t.biz')::uuid),
                'other tenant sees no catalogue');
select tests.fails(format('select public.create_order(%L, %L)', current_setting('t.biz'),
                          '{"items":[{"description":"x","unit_price":"1"}]}'),
                   'cannot create orders in another business');
reset role;

\echo 'orders, payments and appointments: all checks passed'
