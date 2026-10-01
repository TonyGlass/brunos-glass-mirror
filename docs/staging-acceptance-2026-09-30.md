# Mobile staging acceptance — September 30, 2026

## Deployment

- Customer site: https://brunos-glass-mirror-staging.english-academy-fl.workers.dev/
- Track Project: https://brunos-glass-mirror-staging.english-academy-fl.workers.dev/#tracking
- Admin: https://brunos-glass-mirror-staging.english-academy-fl.workers.dev/admin.html
- Cloudflare Worker: `brunos-glass-mirror-staging`; static assets from `.staging-dist`.
- Isolated Supabase project: `ohtcuocrxfidpwypxvwv`.
- No GitHub push, production route change, or production deployment occurred.

The staging database alone received the bootstrap schema, existing Admin RLS and
central-pricing migrations, additive Final Quote/tracking migration, and the
approved Revision 3 selling-rate seed. No production quote data or supplier costs
were copied. Deployed staging functions: `pricing`, `submit-quote`, `admin-quotes`,
and `analyze-photo`. Staging Admin allowlisting is `office@brunosglass.com`. The
separate staging Auth invitation was sent once with the user's authorization; no
production Auth account was changed.

## Live checks

Staging central pricing returned Revision 3 and these results:

- Shower Doors, 60 x 72, Low-Iron Glass - 3/8: $1,800 base.
- Mirror, 60 x 96, Clear Mirror - 1/4: $1,800 base.
- Same Mirror with Metal / Frame: $1,800 mirror + $600 frame = $2,400 base.
- Customer-facing preliminary range is base to base + $150; published Final Quote
  requires a 50% deposit.

A synthetic request marked `STAGING AUTOMATED ACCEPTANCE TEST ONLY` was created in
the staging database. The backend generated its Order Number and private access
code, and Track Project verified both and returned the correct $1,800 preliminary
estimate and $1,800–$1,950 range. Only a hash of the private access code is stored.
The private code was not recorded or printed. No production quote was created.

The direct HTTPS browser smoke test passed at 320, 375, 390, 430, 768, 1024, and
1440 px with no horizontal overflow. All displayed reference images loaded and
the quote-first, manual-measurement, Track Project, and Admin sign-in entries were
present. The separate Admin account must complete sign-in before authenticated
CRM review/publication/print can be verified.

## AI, PDF, and email status

The server-side vision integration is deployed, but no provider credential is
configured. Live staging analysis returns 503 and the honest manual fallback.
Real image classification/recommendations require an OpenAI API key with Responses
API access, installed only as the staging Edge Function secret `OPENAI_API_KEY`
(optionally `OPENAI_VISION_MODEL`). No AI dimensions are produced; customers must
enter and confirm tape measurements.

Final Quote document data and the authenticated Admin browser print view are
implemented. The print view lets Bruno use the browser's Save as PDF feature; there
is no server-generated/stored PDF artifact. Customer email delivery is not
configured or claimed. The only email sent was the authorized staging Admin invite.

## Tests

- Pre-deployment: `npm run test:all` passed 40/40 Node tests and the local browser
  regression suite.
- Post-deployment: `npm test` passed 40/40; the isolated local browser suite passed
  with 110 responsive-step checks, no browser exceptions or console errors. That
  suite intercepts/mocks backend traffic and is not live service evidence.
- Direct live checks: staging pricing, synthetic create/track flow, analyzer
  unavailable/manual fallback, and browser viewport/image checks passed.
- `scripts/staging-browser-smoke.mjs` can repeat the direct viewport/image checks.

## Production release plan — not executed

1. Have the invited staging Admin complete sign-in; verify quote review, Final Quote
   draft and publication, browser PDF print, and customer tracking visibility.
2. Configure and test real SMTP/customer email if required. Add a server-only
   OpenAI key only if live photo classification is needed. Manual measurement and
   customer confirmation remain the physical dimension workflow.
3. Review and approve the additive migrations and Revision 3 catalog. In an
   authorized production window, apply production migrations, deploy the four
   Edge Functions, and update production central pricing. None has happened.
4. Deploy synchronized `dist` and the production Worker only after those steps;
   then verify real production quote, upload, pricing, tracking, Admin, and PDF
   acceptance without creating test production records.
