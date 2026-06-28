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
- Facility detail drawer with contacts, notes, visit history, outreach history, and PHI-safe add-on template
- Outreach logging, mark-contacted behavior, do-not-contact state, and tentative add-to-route
- LocalStorage persistence under `near-my-route-state-v1`

## Route calculation

The MVP uses `src/lib/routeCalculations.ts`:

- Haversine distance between coordinates
- Candidate insertion before Stop #1, between each stop pair, and after the final stop
- Added distance converted to drive minutes using a configurable average speed, an urban road factor, and a small minimum operational detour floor
- Opportunity ranking based on detour time, same-day friendliness, known contacts, recent outreach, volume, and do-not-contact status

This file is the intended replacement seam for a future routing API. A later version can call Google Routes, Mapbox Directions, OSRM, or another service from `calculateRouteOpportunities` while keeping the UI and data model mostly unchanged. The external API should return route-aware added drive time, not just straight-line distance.

## Privacy note

The prototype uses facility-level data only. Outreach templates intentionally avoid patient names and clinical details.
