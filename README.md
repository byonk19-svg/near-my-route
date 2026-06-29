# Near My Route

Route-aware MBSS facility opportunity prototype for finding same-day add-on candidates near tomorrow's route.

## Run locally

```bash
npm install
npm run dev
```

Open the printed local URL, usually `http://localhost:3000`.

## What is included

- Next.js, TypeScript, React, Tailwind CSS
- React Leaflet map with OpenStreetMap tiles
- Houston-area mock facilities and tomorrow route stops
- Facility CRM list with search and filters
- Schedule paste/import review with facility matching
- Route opportunity ranking by estimated detour time
- Google Maps directions handoff for the current route and preview routes with a selected add-on inserted
- Facility detail drawer with contacts, notes, visit history, outreach history, and PHI-safe add-on template
- Outreach logging, copy-message behavior, follow-up due filters, map recency badges, do-not-contact state, and tentative add-to-route
- LocalStorage persistence under `near-my-route-state-v1`

## Route calculation

The MVP uses `src/lib/routeCalculations.ts`:

- Haversine distance between coordinates
- Candidate insertion before Stop #1, between each stop pair, and after the final stop
- Added distance converted to drive minutes using a configurable average speed, an urban road factor, and a small minimum operational detour floor
- Opportunity ranking based on detour time, same-day friendliness, known contacts, recent outreach, volume, and do-not-contact status

This file is the intended replacement seam for a future routing API. A later version can call Google Routes, Mapbox Directions, OSRM, or another service from `calculateRouteOpportunities` while keeping the UI and data model mostly unchanged. The external API should return route-aware added drive time, not just straight-line distance.

## Google Maps handoff

The app can open the ordered route in Google Maps using a directions URL with:

- origin = the first route stop
- destination = the final route stop
- waypoints = intermediate stops
- travel mode = driving

Opportunity details can also preview a route with that facility inserted at its best estimated insertion point without permanently changing the route.

Google Maps URLs are a navigation handoff only. They do not drive the app's internal opportunity ranking. Mobile browsers may support fewer waypoints than desktop Google Maps, so the app warns when a route has more than three intermediate waypoints and caps generated URL waypoints at the standard Google Maps URL limit.

## Outreach cadence

Facility pins reflect relationship recency without changing scheduled route stop styling:

- Never contacted
- Due for follow-up
- Contacted recently
- Texted today
- Do not contact

The default follow-up threshold is 14 days. The threshold can be adjusted in Near My Route and Facilities filters, and the due filter includes never-contacted facilities plus facilities older than the threshold. Do-not-contact facilities keep their own state and are not treated as due.

## Next architecture steps

- Add a routing provider abstraction before introducing any external routing API.
- Test OSRM or another routing provider behind a feature flag, then use a reliable hosted or self-hosted service for real usage.
- Migrate from LocalStorage to Supabase after the single-day mobile workflow is validated.
- Add row-level security before storing real user or facility data.

## Privacy note

The prototype uses facility-level data only. Outreach templates intentionally avoid patient names and clinical details.
