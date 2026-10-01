# Pre-production readiness — September 30, 2026

No production data, Admin accounts, migrations, deployed functions, Cloudflare
workers, or GitHub branches were changed during this continuation.

## Photo analysis

`supabase/functions/analyze-photo/index.ts` is a server-side OpenAI Responses API
boundary. It accepts bounded JPEG/PNG/WebP uploads, checks allowed origins, uses a
strict structured response schema, does not store the Responses result, and returns
only project category, model-estimated confidence, a short visual explanation, and
up to three allowed Shower configuration recommendations. It has no dimension
fields. The browser asks for analysis only after an explicit customer action; the
customer may apply a recommendation or choose another layout. Manual width/height
remain editable and are not modified by photo analysis.

No `OPENAI_API_KEY` was available in the local environment or configured Supabase
secret names. Therefore real photo classification is not active or demonstrated.
The function responds with an explicit manual fallback until the owner adds the
server-side `OPENAI_API_KEY` secret. `OPENAI_VISION_MODEL` is optional; the function
defaults to `gpt-4.1-mini`. Before public activation, add a durable upstream rate
limit (the function's per-isolate limit is best-effort and not sufficient alone),
confirm the allowed production origin, and test with provider credentials. The
browser only contains the Supabase publishable key, never the OpenAI key. Image
input and JSON-schema response formats follow the [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision)
and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

## Read-only live pricing diagnosis

Queried the live `quote_pricing_config` row with SELECT only. It is Revision 2,
`selling-rates-v1`, and has EnduroShield at $7/sq ft. Observed keys and values:

- Glass approved entries present and exact: Clear 3/8 $45, Low Iron 3/8 $60,
  Reeded 3/8 $80, Acid Etched 3/8 $75, Low Iron Acid Etched 3/8 $120,
  Clear 1/2 $55, Low Iron 1/2 $70.
- Extra entries outside the approved catalog: Clear Glass 1/4 $30 and Low Iron
  Glass 1/4 $50. Automatic estimate validation currently does not offer these keys.
- Mirror Bronze $75 and Grey (stored as `gray`) $75 are present and exact.
- Missing: Clear Mirror 1/4 $45, Low Iron Mirror 1/4 $65, Metal / Frame $15.

The public estimate endpoint returned Revision 2 and $1,800 low/high for Glass 60 x
72 / 3/8 Low Iron. Both Mirror 60 x 96 Clear Mirror requests (unframed and framed)
returned `pricing_unavailable` at Revision 2. This was a live endpoint check, not a
test fixture. The absent Mirror keys explain that result.

Proposed safe Revision 3 catalog: retain the seven approved Glass prices and
EnduroShield $7; add Clear Mirror $45, Low Iron Mirror $65, Bronze Mirror $75,
Grey Mirror $75 and Metal / Frame $15; remove the two unapproved 1/4-inch Glass
keys from the active catalog. Do not save until Bruno approves the exact full
catalog. Expected estimates: 30 sq ft × $60 = $1,800 base; display range
$1,800–$1,950; deposit $900. For Mirror, 40 sq ft × $45 = $1,800 base, range
$1,800–$1,950, deposit $900. With frame: mirror $1,800 + frame $600 = $2,400,
range $2,400–$2,550, deposit $1,200.

## Tracking and Final Quote document

The source workflow creates the order number and one-time private access code in
`submit-quote`; only a hash is stored. The customer gets both credentials for Track
Project. Tracking accepts both and returns a limited public projection. Admin can
save a draft and publish the Final Quote; only the published final price/scope are
customer-visible. This architecture is verified by local mocked tests, but live
creation/tracking was not exercised and the tracking migration/function versions
were not deployed during this continuation.

`quote-document.mjs` builds a Final Quote model only from a published Admin record.
Admin now offers a professional print layout with price, deposit, remaining balance,
scope, customer/project details and clear terms. The browser print dialog can save
that layout as a PDF. The PDF is not generated/stored server-side and is not emailed.
No email delivery or attached PDF is claimed as active.

## Release prerequisites

1. Review and rotate any backend secrets exposed by the Supabase CLI secret-list
   output described in the handoff; review provider audit logs. No secret was changed
   here.
2. Approve Revision 3 values; save only through authorized central Admin pricing.
   Verify the three acceptance calculations against the live endpoint after save.
3. Review the tracking migration against live schema and apply only if missing.
   The central pricing table already exists in live Revision 2; do not reapply its
   migration blindly.
4. Set `OPENAI_API_KEY` as a Supabase Function secret, add durable edge rate
   limiting, deploy `analyze-photo`, and verify genuine provider output plus fallback.
   Deploy updated `pricing`, `submit-quote`, and `admin-quotes` functions only after
   their schema and security review.
5. Build/sync `dist`, stage-release the frontend and verify end-to-end quote creation,
   credential handoff, tracking, published Final Quote and print-to-PDF. Confirm no
   email is sent until a real provider and PDF attachment flow are configured.
6. Production release, GitHub push and all production mutations require a separate
   explicitly authorized release step. None occurred in this work.

## Verification

At the time this note was added, the Node suite passed 40/40 and the isolated browser
suite passed (110 responsive step checks, widths 320–1440 px, no overflow, no runtime
exceptions or console errors). Browser network calls were intercepted and mocked.
Rerun `npm run test:all` after final synchronization for the release candidate.
