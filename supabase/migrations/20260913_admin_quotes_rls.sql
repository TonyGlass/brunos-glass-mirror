alter table public.quotes enable row level security;

do $$
begin
  create policy "Admins can read quotes"
    on public.quotes
    for select
    to authenticated
    using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create policy "Admins can update quotes"
    on public.quotes
    for update
    to authenticated
    using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
exception
  when duplicate_object then null;
end
$$;
