# Near My Route Agent Instructions

## Critical Next.js Rule

This is NOT the Next.js you know.

This project uses a newer Next.js version with breaking changes. APIs, conventions, routing behavior, compiler behavior, and file structure may differ from model training data.

Before writing or editing any Next.js code:

- Check the installed version in `package.json`.
- Read the relevant guide in `node_modules/next/dist/docs/`.
- Prefer installed local docs over memory or generic internet examples.
- Heed deprecation notices.
- Do not introduce old Next.js patterns unless the installed docs confirm they are still valid.

Useful discovery commands:

- List available local docs:
  `Get-ChildItem -Recurse -File node_modules/next/dist/docs | Select-Object -First 100`

- Search local Next docs:
  `rg "search term" node_modules/next/dist/docs`

- Read a relevant doc:
  `Get-Content -TotalCount 220 node_modules/next/dist/docs/path/to/doc.md`

If `node_modules` is missing, run `npm install` before relying on local Next docs.

## Project Purpose

Near My Route is a route-aware MBSS facility opportunity prototype. It helps find same-day add-on candidates near tomorrow's route and triage today's facility responses.

The app is facility-level. It is not a patient-record system.

## Domain Language

Use the terms from `CONTEXT.md`.

Preferred terms:

- Facility
- SLP Contact
- Primary SLP Contact
- Outreach Message
- Visit

Avoid replacing those with generic CRM terms like:

- site
- account
- owner
- provider
- appointment
- trip
- referral request

## Privacy And Safety Rules

Do not store, generate, or ask for patient names, clinical details, diagnoses, dates of birth, MRNs, or other PHI.

Outreach messages must stay facility-level and PHI-safe.

Schedule import work must assume pasted schedules should not contain patient names or clinical details.

Dogfood notes should describe workflow friction only: unclear wording, slow steps, route changes, and tool switches. Do not add patient details.

## Current Product Direction

The product is intentionally local-first and PHI-free while the workflow is being dogfooded.

Do not start OSRM, Supabase, Google Routes, Mapbox, auth, external SMS integrations, or other backend service work unless explicitly asked.

The next coding branch should come from concrete manual dogfood evidence, not speculative roadmap work.

## Architecture Map

Main areas:

- `src/app/` - Next app entry files.
- `src/components/NearMyRouteApp.tsx` - main app UI.
- `src/components/RouteMap.tsx` - map rendering.
- `src/lib/routeCalculations.ts` - route opportunity calculations and future routing API seam.
- `src/lib/googleMaps.ts` - Google Maps directions handoff.
- `src/lib/scheduleImport.ts` - schedule paste/import parsing.
- `src/lib/todayStatus.ts` - current-day facility status lifecycle.
- `src/lib/outreachPriority.ts` - outreach queue priority behavior.
- `src/lib/storage.ts` - LocalStorage persistence.
- `src/lib/types.ts` - shared domain types.
- `src/lib/mockData.ts` - Houston-area mock facilities and route stops.

Prefer changing focused `src/lib/*` modules before adding logic directly into large UI components.

## Outreach Lifecycle Rules

The approved outreach text is facility-level and PHI-safe:

```text
Hi! It's Elaine, SLP with Professional Imaging. We'll be doing MBSSs in your area this morning. Do you have anyone appropriate you'd like us to consider adding today?
```

Messages handoff may copy this template and attempt an `sms:` URL on mobile.

The app must not log `Texted today` until the user explicitly taps `Mark texted`.

Placeholder `555` phone numbers must never count as ready.

Contact `preferredMethod` is meaningful for texting. Only text-preferred phone contacts can make a facility text-ready.

A single recommended text-ready contact may bypass the chooser and be used directly for Messages handoff.

## Routing Rules

The current MVP uses internal route calculations, not a live routing API.

If adding future routing behavior, keep it behind the `calculateRouteOpportunities` seam so the UI and data model remain mostly stable.

Google Maps URLs are a handoff only. They should not drive internal opportunity ranking.

## Local Persistence

The prototype uses LocalStorage under the `near-my-route-state-v1` key.

Be careful when changing persisted data shapes. Preserve old local data when practical, or add a clear migration or reset path.

## Commands

Install dependencies:

- `npm install`

Start local dev server:

- `npm run dev`

Production build:

- `npm run build`

Lint:

- `npm run lint`

Unit tests:

- `npm test`

Focused e2e verification scripts:

- `npm run test:e2e:import`
- `npm run test:e2e:messages`
- `npm run test:e2e:outreach-priority`
- `npm run test:e2e:dogfood`
- `npm run test:e2e:contacts`

## Validation Expectations

For small copy or styling changes:

- Run `npm run lint` if practical.

For changes in `src/lib/*`:

- Run `npm test`.
- Also run the matching focused e2e script when the change touches import, messages, outreach priority, dogfood flow, or contact setup.

For Next.js, routing, build config, package, or app entry changes:

- Run `npm run lint`.
- Run `npm run build`.

For behavior changes touching the route workflow:

- Run `npm test`.
- Run the relevant e2e verification script.
- Mention any verification that could not be run.

Do not claim tests passed unless they were actually run.

## Dependency Rules

Do not add new dependencies without asking first.

Prefer existing project utilities and browser APIs.

Do not introduce a database, auth, routing provider, mapping provider, or SMS integration unless explicitly requested.

## Code Style

- Keep changes small and focused.
- Prefer existing project patterns.
- Avoid broad refactors.
- Avoid renaming domain concepts unless requested.
- Keep facility workflow language plain and operational.
- Keep mobile workflow behavior in mind.
- Do not mix unrelated cleanup with requested changes.

## Context Discipline

Before opening large files, search narrowly.

Avoid dumping huge command output, generated files, full logs, full diffs, or large JSON blobs.

For commands with potentially large output, cap by bytes:

- `COMMAND 2>&1 | Select-Object -First 200`
- `COMMAND 2>&1 | Select-Object -Last 200`

## Before Finishing

Summarize:

- What changed.
- Files touched.
- What validation ran.
- Any risk or follow-up needed.
