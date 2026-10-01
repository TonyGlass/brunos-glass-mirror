-- Proposed migration only: do not run until reviewed. No prices or existing data are changed.
begin;
create table public.quote_pricing_config (
  id smallint primary key check (id = 1),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);
alter table public.quote_pricing_config enable row level security;
alter table public.quote_pricing_config force row level security;
revoke all on public.quote_pricing_config from public, anon, authenticated, service_role;
grant select, insert, update on public.quote_pricing_config to service_role;
create policy "Pricing service access only"
  on public.quote_pricing_config for all to service_role
  using (true) with check (true);
comment on table public.quote_pricing_config is
  'Private commercial pricing. Browser access only through server-authorized pricing endpoint. No public costs or margin.';
commit;
