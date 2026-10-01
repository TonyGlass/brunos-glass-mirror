-- STAGING ONLY. Never apply this seed to the production database.
-- Customer selling prices are seeded at approved Revision 3; no supplier costs.
begin;
insert into public.quote_pricing_config (id,config,revision,updated_at,updated_by)
values (
  1,
  '{"pricingModel":"selling-rates-v1","finalSellingRates":{"clear-glass-3-8":45,"low-iron-glass-3-8":60,"reeded-moru-3-8":80,"satin-acid-etched-3-8":75,"satin-acid-etched-low-iron-3-8":120,"clear-glass-1-2":55,"low-iron-glass-1-2":70,"clear-mirror-1-4":45,"low-iron-mirror-1-4":65,"bronze-mirror-1-4":75,"gray-mirror-1-4":75,"metal-frame":15},"enduroShieldRate":7}'::jsonb,
  3,
  now(),
  '00000000-0000-0000-0000-000000000000'
)
on conflict (id) do update set config=excluded.config,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
commit;
