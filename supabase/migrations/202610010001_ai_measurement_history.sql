-- Additive measurement provenance for preliminary AI-assisted estimates.
-- Apply to STAGING only for the approved staging UX; never apply to production here.
begin;

alter table public.quotes
  add column if not exists ai_estimated_width numeric,
  add column if not exists ai_estimated_height numeric,
  add column if not exists customer_confirmed_width numeric,
  add column if not exists customer_confirmed_height numeric,
  add column if not exists measurement_confidence numeric,
  add column if not exists measurement_source text;

alter table public.quotes
  add constraint quotes_measurement_confidence_range
    check (measurement_confidence is null or measurement_confidence between 0 and 1),
  add constraint quotes_measurement_source_allowed
    check (measurement_source is null or measurement_source in ('customer_manual','ai_estimated_confirmed','ai_estimated_edited'));

comment on column public.quotes.ai_estimated_width is 'Preliminary AI photo estimate in inches; not field verified.';
comment on column public.quotes.ai_estimated_height is 'Preliminary AI photo estimate in inches; not field verified.';
comment on column public.quotes.customer_confirmed_width is 'Customer-confirmed or edited preliminary width in inches.';
comment on column public.quotes.customer_confirmed_height is 'Customer-confirmed or edited preliminary height in inches.';
comment on column public.quotes.measurement_confidence is 'Model-reported visual confidence for preliminary AI dimensions; not calibrated or field verification.';
comment on column public.quotes.measurement_source is 'Source of customer-submitted preliminary dimensions; professional field verification remains separate.';

commit;
