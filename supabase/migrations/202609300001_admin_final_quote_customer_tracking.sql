-- Local proposal only. Review and apply through a separately approved release.
-- This is additive: current estimate data, pricing config, and RLS policies are untouched.
begin;

create sequence if not exists public.project_order_number_seq;

alter table public.quotes
  add column if not exists tracking_number text,
  add column if not exists tracking_token_hash text,
  add column if not exists installation_address text,
  add column if not exists project_status text,
  add column if not exists assigned_technician text,
  add column if not exists verified_width text,
  add column if not exists verified_height text,
  add column if not exists measurement_completed_at timestamptz,
  add column if not exists technician_notes text,
  add column if not exists measurement_photo_paths jsonb not null default '[]'::jsonb,
  add column if not exists assigned_installer text,
  add column if not exists installation_status text,
  add column if not exists installation_scheduled_at timestamptz,
  add column if not exists installer_notes text,
  add column if not exists installation_photo_paths jsonb not null default '[]'::jsonb,
  add column if not exists installation_completed_at timestamptz,
  add column if not exists final_quote_draft_price numeric check (final_quote_draft_price is null or final_quote_draft_price >= 0),
  add column if not exists final_quote_draft_scope text,
  add column if not exists final_quote_draft_date date,
  add column if not exists final_quote_draft_expires_at date,
  add column if not exists final_quote_sent_at timestamptz,
  add column if not exists final_quote_scope text,
  add column if not exists final_quote_date date,
  add column if not exists final_quote_expires_at date,
  add column if not exists final_quote_accepted_at timestamptz,
  add column if not exists amount_paid numeric check (amount_paid is null or amount_paid >= 0),
  add column if not exists payment_date date,
  add column if not exists payment_verified_at timestamptz;

-- Keep historical status/payment unknown where no value was recorded, while
-- assigning defaults to newly inserted orders.
alter table public.quotes
  alter column project_status set default 'Quote Requested',
  alter column amount_paid set default 0;

create unique index if not exists quotes_tracking_number_unique
  on public.quotes (tracking_number) where tracking_number is not null;

create or replace function public.assign_quote_tracking_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_sequence bigint;
begin
  if new.tracking_number is null then
    order_sequence := nextval('public.project_order_number_seq');
    new.tracking_number := 'BGM-' || to_char(current_date, 'YYYY') || '-' ||
      upper(lpad(to_hex(order_sequence), greatest(5, length(to_hex(order_sequence))), '0'));
  end if;
  if new.project_status is null then
    new.project_status := 'Quote Requested';
  end if;
  return new;
end;
$$;

revoke all on function public.assign_quote_tracking_number() from public, anon, authenticated;

drop trigger if exists quotes_assign_tracking_number on public.quotes;
create trigger quotes_assign_tracking_number
before insert on public.quotes
for each row execute function public.assign_quote_tracking_number();

comment on column public.quotes.tracking_token_hash is
  'SHA-256 digest of a high-entropy customer tracking access code. Never return this column.';
comment on column public.quotes.final_quote_draft_price is
  'Admin-only unpublished draft. Customer tracking must never select or return this value.';
comment on column public.quotes.final_quote_sent_at is
  'Publication gate for customer-visible final quote fields.';

commit;
