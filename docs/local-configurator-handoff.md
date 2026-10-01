# Local configurator continuation — September 30, 2026

Work continued from the existing uncommitted working tree. No Git reset, checkout,
revert, push, deployment, migration execution, or production data write was performed.
The previous session's transcript was not available; the starting state below was
reconstructed from source, Git diffs, untracked files, documentation, and tests.

## Already present when this continuation began

- Modified `index.html`, `script.js`, and `style.css`: magazine/service presentation,
  referrals and QR links, customer estimates, and a partially converted direct wizard.
  The newest source already specified project → measurement → configuration → options
  → estimate → customer → review. It included camera/manual buttons, mirror placement,
  six shower layouts, and mobile CSS. The old modal was no longer initialized.
- Modified `admin.html`, `admin.js`, `admin.css`: selling-rate editing, quote management,
  final-quote drafts/publication, measurement and installation workspace controls.
- Modified Supabase config and `admin-quotes` / `submit-quote` functions; new `pricing`
  function and three shared pricing modules. These implement central pricing,
  authorization, revision checking, and quote/tracking contracts.
- Two proposed SQL migrations: central pricing and Admin final-quote/customer tracking.
- New project cart, workflow, and tracking JS/CSS; payment information page; logo,
  magazine crops, project photo, referral PNGs, and seven configuration SVGs.
- Three documentation files; 26 Node tests and an externally launched browser smoke
  script. Initial Node result: **23 passed, 3 failed** (old model expectations, old
  custom-step expectations, and source/dist mismatch).
- `dist` contained the earlier frontend, Admin, project modules, payment page and
  presentation images. Only index/script/style lagged the latest source; the seven
  configuration diagrams were missing there.
- `.wrangler` contained existing browser profiles/crash reports and local emulator
  databases/bundles. These were inventoried and preserved, not treated as product code.

## Completed in this continuation

- Restored custom service cards inside the direct configurator, including reopening
  the form after a successful request; removed obsolete dialog accessibility hints.
- Moved the actual upload control to measurement and mirror frame selection to Options.
  Camera selection uses the existing upload pipeline. No dimensions are inferred from
  photos. Manual dimensions stay editable and fractional validation is retained.
- Kept the original estimate element/ID live, preserving cart integration; updated
  all estimate breakdowns so Live Estimate and Review agree.
- Added a safely rendered review summary for layout, material/options, exact entered
  dimensions, quantity, customer/contact/address and attachments, with an edit link.
- Adapted configuration headings for mirrors and general glass; completed four-step
  custom requests; preserved material reset and separate mirror/shower options.
- Preserved the existing central price, display allowance, deposit and create/upload/
  finalize contracts. Camera/photo selection status clears after successful upload.
- Synchronized the three inspected stale local dist files and added their SVG assets.
  Other pre-existing source, backend, Admin, payment, and generated changes remain.
- Updated tests for the existing six-diagram direction; added a self-contained headless
  browser runner and npm test commands. All external page requests are intercepted
  before navigation. Browser SDK/auth, pricing, upload and submission are mocked.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 26 passed, 0 failed; central pricing, submission, presentation/dist, tracking and Edge Function parsing |
| `npm run test:browser` | Passed; shower, mirror, glass and custom flows; required selection/fraction/email validation; camera/manual interaction; exact dimensions; review escaping; duplicate IDs; pricing/deposit presentation; frame breakdown; cart; mocked create/upload/finalize; Admin signed-out screen |
| Responsive browser checks | 95 step/layout checks plus initial page checks at 320, 375, 768, 1024 and 1440 px; no horizontal overflow |
| Browser runtime | No uncaught exceptions or console errors; no production traffic |
| `node --check` | Passed for script, Admin, cart, tracking and workflow JavaScript |
| `.venv/Scripts/python.exe test_supabase.py` | Passed; client initialization only, not a live connection/persistence test |
| `git diff --check` | Passed |

The first browser launch failed inside the sandbox. The approved outside-sandbox run
worked. An inherited strict width equality assertion was corrected to allow the browser's
vertical scrollbar. Node emits its experimental TypeScript-stripping warning.
`prueba_supabase.py` was deliberately not run: it inserts into the real quotes table.

Run `npm run test:all` for the complete isolated Node/browser suite. Node 24 and an
installed Chrome/Edge are required. `TEST_BROWSER` can select another Chromium binary;
`PRESENTATION_HTTP_PORT` and `PRESENTATION_CDP_PORT` override defaults 8766 and 9444.
The runner closes only its own browser/server and keeps temporary diagnostic profiles.

## Intentionally pending

- Production release, SQL migration review/application, function deployment and live
  persistence/RLS verification. None was attempted; local mocks do not verify production.
- Camera-based AI measurement/visualization remains a labeled future capability.
- Real payment processing, document/email delivery and multi-item cart submission
  remain outside this configurator continuation. Existing preview boundaries remain.
- The historical workflow/central-pricing notes describe earlier phases; use the
  current implementation and this continuation record for the direct customer flow.

## Quotation-first entry and reference crops

Continued from the same working tree on September 30, 2026. The quote wizard now
follows a compact quotation-first entry page. The header contains one logo and the
entry presents the three project families with direct category cards. Shower and
Mirror cards select their matching service and proceed to measurement; the Shower
card may preselect its requested layout without touching material selection. The
Architectural & Custom Glass cards start the existing custom review path and do not
invent an estimate. Older service, process and tracking content remains after the
quote entry for customers who want it.

Individual JPEG crops from the user's supplied 1536 x 1024 reference board are in
`images/reference/` and `dist/images/reference/`. The original Downloads image was
not edited. Crop rectangles, tile labels, and source details are recorded in
`docs/reference-image-crops.md`. Each crop was visually checked against its source
tile. The six shower configuration cards now use the corresponding shower crops;
Mirror cards use Mirror crops; Architectural examples use partitions, railings,
wine-room, door, and tabletop crops. A previously mislabeled mirrored commercial
bar image is categorized as a Mirror reference, not Glass.

Local verification after these updates:

- `npm test`: 39 passed, 0 failed.
- `npm run test:browser`: passed, including quick starts for Shower, Mirror, and
  custom Architectural Glass; all requested viewport widths (320, 375, 768, 1024,
  1440); 110 responsive wizard checks; no overflow, runtime exceptions or console
  errors. Browser backend traffic was intercepted/mocked.
- `node --check`: passed for the public, measurement, quote, tracking, cart, and
  Admin JavaScript modules.
- `git diff --check`: passed.

Pricing remained unchanged. The central catalog and $15/sq-ft Mirror frame behavior
are covered by local Node tests, not by a live production pricing request. Quote
submission and tracking creation are mocked in browser checks and isolated in Node
function tests; no production records were created. AI/photo measurement is not
implemented. Customer PDF creation and email delivery remain preview/preparation
only; no quote email is sent by this local workflow.
