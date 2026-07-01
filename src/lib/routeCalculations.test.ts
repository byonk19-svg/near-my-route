import assert from "node:assert/strict";
import test from "node:test";
import { calculateRouteOpportunities } from "./routeCalculations";
import type { Facility, OpportunityOptions, RouteStop } from "./types";
import { routeHasUnconfirmedLocations, unconfirmedRouteFacilities } from "./locationTrust";

const options: OpportunityOptions = {
  maxDetourMinutes: 20,
  averageSpeedMph: 30,
};

function facility(id: string, lat: number, lng: number, patch: Partial<Facility> = {}): Facility {
  return {
    id,
    name: id,
    address: `${id} address`,
    lat,
    lng,
    locationStatus: "confirmed",
    locationSource: "seed",
    contacts: [],
    sameDayFriendly: "unknown",
    typicalVolume: "unknown",
    ...patch,
  };
}

function stop(facilityId: string, order: number): RouteStop {
  return {
    id: `stop-${order}`,
    facilityId,
    order,
    status: "planned",
    source: "scheduled",
  };
}

test("calculateRouteOpportunities returns no opportunities for an empty route", () => {
  const candidate = facility("candidate", 29.1, -95.1);

  assert.deepEqual(calculateRouteOpportunities([], [candidate], options), []);
});

test("calculateRouteOpportunities handles one-stop before and after insertion", () => {
  const route = facility("route", 29, -95);
  const candidate = facility("candidate", 29.01, -95.01);
  const [opportunity] = calculateRouteOpportunities([stop("route", 1)], [route, candidate], options);

  assert.equal(opportunity.facility.id, "candidate");
  assert.match(opportunity.bestInsertionLabel, /Before Stop #1|After Stop #1/);
  assert.equal(opportunity.addedDriveMinutes >= 3, true);
});

test("calculateRouteOpportunities chooses the best middle insertion for multi-stop routes", () => {
  const first = facility("first", 29, -95);
  const second = facility("second", 29, -96);
  const candidate = facility("candidate", 29, -95.5);
  const [opportunity] = calculateRouteOpportunities([stop("first", 1), stop("second", 2)], [first, second, candidate], options);

  assert.equal(opportunity.facility.id, "candidate");
  assert.equal(opportunity.bestInsertionLabel, "Best between Stop #1 and Stop #2");
});

test("calculateRouteOpportunities applies do-not-contact penalty and same-day/volume weighting", () => {
  const first = facility("first", 29, -95);
  const second = facility("second", 29, -96);
  const strong = facility("strong", 29, -95.5, {
    sameDayFriendly: "yes",
    typicalVolume: "high",
    contacts: [{ id: "contact", name: "SLP", phone: "713-867-5309", primary: true }],
  });
  const blocked = facility("blocked", 29, -95.5, {
    doNotContact: true,
    sameDayFriendly: "yes",
    typicalVolume: "high",
    contacts: [{ id: "blocked-contact", name: "SLP", phone: "713-867-5310", primary: true }],
  });
  const opportunities = calculateRouteOpportunities([stop("first", 1), stop("second", 2)], [first, second, blocked, strong], options);

  assert.equal(opportunities[0].facility.id, "strong");
  assert.equal(opportunities.at(-1)?.facility.id, "blocked");
});

test("calculateRouteOpportunities honors recent-contact exclusion", () => {
  const first = facility("first", 29, -95);
  const oldContact = facility("old", 29, -95.1, { lastContacted: "2026-06-01" });
  const recentContact = facility("recent", 29, -95.2, { lastContacted: "2026-06-30" });
  const opportunities = calculateRouteOpportunities([stop("first", 1)], [first, oldContact, recentContact], {
    ...options,
    excludeRecentlyContactedDays: 14,
  });

  assert.deepEqual(
    opportunities.map((opportunity) => opportunity.facility.id),
    ["old"],
  );
});

test("calculateRouteOpportunities excludes unconfirmed candidates and blocks unconfirmed route stops", () => {
  const first = facility("first", 29, -95);
  const unconfirmedCandidate = facility("unconfirmed-candidate", 29, -95.1, { locationStatus: "needs_confirmation", locationSource: "fallback" });
  const confirmedCandidate = facility("confirmed-candidate", 29, -95.2);

  assert.deepEqual(
    calculateRouteOpportunities([stop("first", 1)], [first, unconfirmedCandidate, confirmedCandidate], options).map(
      (opportunity) => opportunity.facility.id,
    ),
    ["confirmed-candidate"],
  );

  const unconfirmedStop = facility("unconfirmed-stop", 29, -95, { locationStatus: "needs_confirmation", locationSource: "fallback" });
  assert.deepEqual(calculateRouteOpportunities([stop("unconfirmed-stop", 1)], [unconfirmedStop, confirmedCandidate], options), []);
});

test("route location helpers identify unconfirmed route stops", () => {
  const confirmed = facility("confirmed", 29, -95);
  const unconfirmed = facility("unconfirmed", 29, -95.1, { locationStatus: "needs_confirmation", locationSource: "fallback" });
  const routeStops = [stop("confirmed", 1), stop("unconfirmed", 2)];

  assert.equal(routeHasUnconfirmedLocations(routeStops, [confirmed, unconfirmed]), true);
  assert.deepEqual(
    unconfirmedRouteFacilities(routeStops, [confirmed, unconfirmed]).map((item) => item.id),
    ["unconfirmed"],
  );
});
