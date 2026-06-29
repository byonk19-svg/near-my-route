# Near My Route

Route-aware MBSS facility opportunity prototype for finding same-day add-on candidates near tomorrow's route and triaging today's facility responses.

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
- Daily-ops facility view with search, filters, Today Status, contacts, recency, and route fit
- Schedule paste/import review with facility matching and mobile review cards
- Route opportunity ranking by estimated detour time
- Google Maps directions handoff for the current route and preview routes with a selected add-on inserted
- Facility detail drawer with contacts, notes, visit history, outreach history, and PHI-safe add-on template
- Today Status strip, Outreach triage queue, copy-message behavior, do-not-contact state, and tentative add-to-route
- One-route dogfood checklist and notes for capturing workflow friction before routing or database work
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

Google Maps URLs are a navigation handoff only. They do not drive the app's internal opportunity ranking. Mobile browsers may support fewer waypoints than desktop Google Maps, so the current-route panel warns when a route has more than three intermediate waypoints, offers split-leg buttons for longer saved routes, and caps generated URL waypoints at the standard Google Maps URL limit.

## Today Status and Outreach triage

Today Status answers the morning command-center questions: who needs a text, who replied, who can be added, and what that does to the route.

Current statuses are:

- Not contacted (`not_contacted`)
- Texted today (`texted_today`)
- Waiting (`waiting`)
- No patients today (`no_patients_today`)
- Possible add-on (`possible_add_on`)
- Added (`added`)
- Do not contact (`do_not_contact`)

The Outreach tab is a current-day response queue, not a history table. Cards expose the next status-aware action: not-contacted facilities get a text action, waiting facilities get response buttons, possible add-ons get an add action, added facilities get route/remove actions, and no-patients or do-not-contact facilities do not show add CTAs.

Today Status is derived from today's outreach logs, facility do-not-contact state, and current route stops. `OutreachStatus` records the raw log event, while `TodayStatus` is the current-day operating state shown in the queue. The `Added` state requires a route stop with `source: "today_add_on"`; an `added_to_route` outreach log alone is treated as a possible add-on until the route stop exists.

The default follow-up threshold is 14 days. The threshold can still be adjusted in Near My Route and Facilities filters, but the main operating queue should be today's status lifecycle.

## Mobile import review

The Import Schedule flow is built for a phone-first review pass. Paste tomorrow's stops, parse the schedule, review each imported row as a card, correct match/action/address fields, then confirm the route. Patient names and clinical details do not belong in the pasted schedule.

## Dogfood checklist

The route home includes a lightweight one-route checklist for dogfooding the current workflow before adding OSRM or Supabase. Use it to import a real route, review text candidates, log replies, add or remove a tentative stop, open Google Maps, and capture workflow friction. Dogfood notes should describe unclear wording, slow steps, route changes, and tool switches only; do not store patient names or clinical details.

## Next architecture steps

- Dogfood one real route end to end in the current prototype.
- After dogfood, decide whether OSRM or another routing provider is worth introducing behind a routing seam.
- After the mobile workflow is proven, migrate from browser LocalStorage to Supabase.
- Add row-level security before storing real user or facility data.

## Privacy note

The prototype uses facility-level data only. Outreach templates intentionally avoid patient names and clinical details.
