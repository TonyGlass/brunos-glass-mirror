# Central pricing: prepared locally, not applied or deployed

## Inspection and design

A read-only live PostgREST schema inspection reported `customers`, `orders`,
`products`, `projects`, `quote_requests`, `quotes`, `services`, and `test_connection`.
No pricing table was present in the exposed schema. Existing quote estimate columns
were confirmed. PostgREST does not expose live RLS definitions; those must still be
verified using the SQL preflight below. The local quote RLS migration and server
Admin authentication were inspected. They are not replaced.

The browser calculator previously required raw supplier costs and margin. Publishing
that configuration would expose private business inputs. Instead the same
`calculateEstimatedPrice()` formula now lives once in
`supabase/functions/_shared/pricing-engine.mjs`. Both public estimate requests and
new quote submissions call it on the server. No second pricing formula exists.
Customer JavaScript calculates only the display-only 50% estimated deposit.

Public responses contain `{complete, low, high, revision}` or an unavailable reason.
They do not contain configuration, missing private cost names, internal costs,
supplier notes, margin, or profit. Exact missing fields remain in authenticated Admin.

## Exact proposed migration

Review and apply **only after authorization**:
`supabase/migrations/202609290001_central_quote_pricing.sql`.

It creates `public.quote_pricing_config` with:

| Column | Purpose |
| --- | --- |
| `id smallint primary key check (id = 1)` | Single active configuration |
| `config jsonb not null` | Existing material/hardware/project-cost/margin structure |
| `revision bigint > 0` | Optimistic concurrency and estimate consistency |
| `updated_at timestamptz` | Server timestamp |
| `updated_by uuid` | Verified Admin user ID |

The migration enables and forces RLS, revokes PUBLIC/anon/authenticated table access,
and grants service_role select/insert/update with a service-only policy. Browsers
cannot directly read or modify private configuration. The existing server-only
`SUPABASE_SECRET_KEYS` credential is reused; no secret is added to frontend code.
The SQL inserts no prices and changes no existing table, policy or record.
It deliberately fails if the table already exists instead of silently reusing an
unknown schema. Do not drop an existing table to resolve that conflict.

Read-only SQL preflight for an authorized SQL session (not executed by this task):

```sql
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('quote_pricing_config', 'quotes', 'products', 'services')
order by table_name, ordinal_position;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
```

## Security and consistency

- `pricing` has gateway JWT verification disabled because `estimate` is public.
  `read`/`save` call `auth.getUser(token)` and check verified `app_metadata.role = admin`
  or the existing server `ADMIN_EMAILS` allowlist. User-editable metadata is not an
  authorization source. CORS is not authorization.
- Only known numeric cost fields are persisted; extra supplier notes are not accepted.
  Unknown rates remain null; negative, nonnumeric and reversed ranges are rejected.
- Every save includes the revision loaded by that Admin. Updates compare revisions
  atomically; initial insertion relies on the singleton primary key. Conflicts return
  409 and require a reload. No silent last-writer-wins overwrite.
- Public requests derive square feet from dimensions. New quote submission reads
  central pricing again and overwrites client estimate fields, square feet, status
  (`New`), and final price (`null`) with the same engine. Stale revisions return 409
  before insertion so the customer can review the updated estimate.
- Hardware counts travel as transient `pricing.counts`; no quote columns are added.
  Existing hardware notes and photo create/upload/finalize behavior remain.
- Missing costs permit an explicitly unavailable estimate and null quote estimate
  fields. A service error does not silently fall back to local prices.
- Existing quotes are not recalculated or backfilled. Admin still reads their saved
  estimate columns. Final reviewed pricing remains separate.
- Client updates are debounced; stale responses are ignored. Submission rechecks
  pricing. No private configuration is kept in customer localStorage.

## Configuration and coordinated release prerequisites

No migration, function deployment, pricing publication, or production write was run.
The updated frontend requires the prepared endpoint and migration. Until they are
released together, it correctly reports central pricing unavailable.

After a separately authorized coordinated release:

1. Verify the SQL preflight, then apply the single proposed migration.
2. Release `pricing`, updated `submit-quote`, their shared modules, and frontend changes.
   Existing secrets and the Admin allowlist must already be configured.
3. An authorized Admin opens Estimate cost settings. An empty central store loads
   existing defaults into the editor only; nothing is published automatically.
4. On the browser containing Bruno's real settings, select **Load legacy browser
   settings for review**, or enter verified values. Review and explicitly **Save
   central cost settings**. The legacy localStorage key remains untouched.
5. Verify another Admin device and an anonymous customer browser. Confirm direct
   anon/authenticated table reads/writes are denied.

Do not release piecemeal: the new client supplies a pricing revision and the new
submit function requires it. Older clients receive a review/refresh error. Missing
commercial costs were not invented or seeded. Delivery remains in Other project costs.

## Local verification

Run `node --test tests/central-pricing.test.mjs` with Node 24. Its TypeScript stripper
executes actual Edge Function source against isolated dependencies. Tests cover
authorization, fresh sessions, public denial/redaction, concurrent saves, missing
inputs, stale revisions, forged prices and quote insertion/upload preparation.

Isolated Chrome tests exercised actual pages with intercepted network calls: Admin
save/reload, a second browser context, Shower Low-Iron 3/8 at 67 5/8 x 95 1/16 inches,
Standard 1/4 Mirror at 24 x 36 inches, both estimate blocks, 50% deposit, payloads,
photo upload, Admin display, null final_price, Project Cart and responsive layouts.
Test costs exist only in test memory and are not commercial defaults.

PostgreSQL RLS enforcement and deployed persistence were **not** tested: no local
PostgreSQL/Deno runtime was available and live changes were prohibited. Mock-backed
tests do not establish live Supabase persistence or production availability.

PDF/email/payment/installer/route integrations remain future work. No fake delivery,
payment confirmations or installation state writes were introduced.
