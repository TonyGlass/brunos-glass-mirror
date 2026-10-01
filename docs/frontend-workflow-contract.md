> Current central-pricing implementation: see [central-pricing.md](central-pricing.md). It supersedes the historical browser-local pricing notes below. Its migration and functions are prepared but not applied/deployed.

﻿# Frontend workflow contract

This document describes repository code, not an audited live Supabase schema. No schema changes are proposed or required by this frontend implementation.

## Existing boundaries

The public seven-step quote experience is unchanged. Internal workflow views are mounted only inside the existing admin CRM after authentication and a successful authorized quote read. This is not a new installer permission system. The current API authorizes administrators; installer roles require future backend review.

Only `quotes` is referenced as a business table by the application. Existing `quote_requests`, `projects`, `orders`, `customers`, `products`, `services`, and `test_connection` tables are not queried in this code. Their existing columns, relationships, constraints and access policies must be inspected before deciding on any backend changes. Do not infer an empty database or create replacement tables.

## Existing quote fields

- Identity: `id`, `created_at`.
- Customer: `name`, `phone`, `email`, `city`.
- Project: `service`, `product`, `door_type`, `glass_type`, `hardware_finish`, `handle_style`, `quantity`.
- Measurements: `width`, `height`, `square_feet`.
- Description: `message`. The public submission appends hardware counts to this text, not structured columns.
- Pricing: `estimated_price`, `estimated_price_low`, `estimated_price_high`, `final_price`.
- Workflow: `status`.
- Attachments: `photo_paths`.

`submit-quote` inserts quote data, issues signed upload tokens, and finalizes `photo_paths`. `admin-quotes` lists/reads these fields and updates only `status` and `final_price`. It returns derived `photos: [{path, signedUrl}]`, with signed URLs lasting one hour. Customer attachments use the existing `quote-photos` bucket. Nothing in this phase changes these functions or storage operations.

The existing status API accepts exactly `New`, `Reviewing`, `Quoted`, `Approved`, `Completed`, `Lost`. The editor maps equivalent display casing to these values. No new lifecycle state is submitted. Unknown existing statuses are displayed verbatim and require an explicit supported selection before using the existing editor. `Lost` remains supported even though it is outside the requested nine-stage path.

## Presentation architecture

`project-workflow.js` provides rendering, local view interactions and exact measurement formatting. It receives an existing authorized quote plus formatting helpers; it contains no fetch, Supabase, localStorage or sessionStorage operations. `admin.js` retains the existing API helper and update payload. Existing pricing settings and calculations remain unchanged.

Views: Review; Quote & deposit; Work Order preview; Scheduling; Completion Photos & Notes; History. The nine-stage lifecycle marks only the current known status. It does not invent prior stage completion, timestamps, actors, approval evidence or payment verification.

Existing browser-local project drafts are not erased or migrated. Their helper definitions remain preserved, but the operational views do not read or write them. In particular, stored draft status, final price, amount paid and generated draft identifiers are not treated as authoritative. Existing browser-local pricing settings are a separate, unchanged feature.

The existing workspace form ID and reused field names are retained where relevant. Preview submission is intercepted without a persistence action. Unsaved values persist only while that rendered quote remains open; switching quotes, rerendering after a real quote update, refreshing or signing out discards them. Tab changes alone do not discard entries. No success message claims a save.

## Measurements

Customer measurements are approximate and not verified field measurements. Existing submission converts fractions into numeric inches, so original notation is unavailable in the current API. Numeric multiples of 1/16 are displayed as exact reduced fractions without rounding. Non-sixteenth values are displayed unchanged as stored values. Original string values, when supplied, are preserved. Square footage and quote calculations are untouched.

Field width, height, door/panel size, deductions, measurement notes and corrections are temporary text inputs. They preserve typed construction fractions (including 1/4, 1/8 and 1/16) without replacing saved customer dimensions. Their persistence and verification require future backend capability mapping.

Glass thickness is derived for display only from the existing `glass_type` suffix. Other structured hardware information is not inferred from free text; the original customer message remains visible.

## Payments and Work Orders

The displayed required deposit reuses the existing 50% of final price expression. No new price, tax, fee or balance calculation is introduced. Payment amount/date, confirmation, processor records and approval evidence are unavailable from the current API and are never inferred from status or customer input.

Work Order content is a preview, explicitly not authorized or issued. Issuance and schedule-confirmation controls are disabled. Eligibility must eventually require trusted deposit verification plus required project/site/measurement information. The focused field view is an admin presentation mode, not installer authorization. It replaces the prior link to a nonexistent installer page. Browser printing includes a preview warning; no production PDF generation is provided.

## Completion media

Customer photos/videos are rendered separately from selected completion images. Existing signed HTTPS attachment URLs are used for viewing only; unsupported URL schemes are rejected. Video attachments use video controls and an original-file link.

Completion images use temporary object URLs; no upload occurs. Object URLs are revoked on replacement, clearing, quote rerender or sign-out. The UI preview limit is 10 JPEG/PNG/WebP files of at most 50 MB each, solely to bound browser resources; this is not a future backend upload contract. Completion save is disabled.

## Future capability mapping, not a migration proposal

Inspect existing tables and relationships first, then identify how authorized APIs can provide:

- Customer/project/order associations; installation address and access details.
- Formal quotation number, terms and authoritative line items/taxes/fees if applicable.
- Customer approval evidence, timestamps and responsible actor.
- Verified deposit amount/date/status/reference and authorization to confirm payment.
- Installation eligibility, Work Order identity/version/issuance, installer access.
- Exact original and field-verified measurements, deductions, corrections and verification attribution.
- Installer assignment, scheduled installation date and schedule notes.
- Installation instructions, observations, material/hardware differences and site conditions.
- Completion photos and their associations, work performed, problems/damage, corrections, customer observations, extra work and completion date/review.
- Actual transition history with timestamps and responsible users.

These requirements may already be supported by existing tables or storage. No new tables, columns, buckets, policies, functions or migrations should be assumed necessary.

## Validation boundaries

Use mocked authentication/API responses for local browser testing. Verify existing update bodies and customer create/upload/finalize behavior without writing real records. Compare protected files and business logic against the pre-task working copy rather than Git HEAD, because the repository already contains unrelated uncommitted changes. Leave `dist`, payment pages, Supabase, environment and deployment configuration untouched. Do not run the Python insertion smoke test against the live database.


## Project cart and document previews

ProjectCartPreview.getItems() returns defensive snapshots for a future multi-item adapter.
The cart is memory-only, never submitted, and lost on refresh. Current Request a Quote
continues to submit exactly the active single configuration. No totals are aggregated.
Snapshots contain existing service/product/material/hardware values, raw measurements,
and the estimate label produced by the existing calculator. They are not an authoritative
pricing or persistence contract. Glass Doors and Commercial Glass remain informational.

Formal Quote is a separate admin preview of customer-facing information. It does not use
an automatic estimate as a final price. Missing issuance number/date, expiration, address,
installation, tax breakdown, terms and approval evidence are explicitly unavailable.
The displayed post-deposit balance is arithmetic, not evidence of payment.

Work Order remains internal and unissued until deposit verification, scheduling and
installer authorization are supported. Completion photos have local Final/Before/After
labels; all notes and images are disposable. MARK INSTALLATION COMPLETE is disabled.

Future integration boundaries (not implemented): validated multi-item quote submission,
existing-schema audit before persistence, verified payment events, document issuance and
PDF rendering for Formal Quote/Work Order, email/WhatsApp delivery, supplier data kept
internal, authenticated customer approval, installer authentication and role enforcement,
private completion-media storage and audited workflow transitions. No new database
objects or API contracts are assumed or created by these previews.


## Commercial pricing configuration

The existing calculateEstimatedPrice remains the only frontend pricing engine.
The material table is authoritative for Low-Iron 3/8. Legacy saved glassLowIron38
is read only when no explicit glassCosts entry exists. Saving Admin settings mirrors
that table entry into legacy keys. Missing, invalid, negative or reversed ranges
cannot produce an estimate. Null and blank costs are never replaced by zero.

Delivery/transport is included explicitly in the existing Other project costs range;
there is no additional fee or duplicate calculation. A dedicated transport component
would need an agreed applicability rule before separating it from that range.

Admin settings remain localStorage brunosQuotePricingConfigV1, scoped to browser and
origin. They are NOT distributed to public visitors. A future authorized shared
configuration source must supply confirmed commercial inputs to the existing engine;
private supplier costs and margin must not be exposed through a public settings API.
Server-side trusted pricing/validation requires separate backend authorization.
Current submission preserves estimate fields and leaves final_price null. Live inserts
are not part of local verification when production-data changes are prohibited.

Workflow boundaries remain: request/estimate -> authorized Admin review -> issued formal
quote/PDF and customer delivery -> approval -> verified 50% final-quote deposit -> project/
work order -> authenticated installer assignment -> route/work sheet -> private completion
photos/notes -> audited completion. Assignment, routes, document delivery and payment
verification are not simulated or persisted by these frontend previews.
