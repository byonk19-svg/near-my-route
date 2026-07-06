import assert from "node:assert/strict";
import test from "node:test";
import { confirmLocationReview } from "./locationReview";
import { FALLBACK_LOCATION_COORDINATES } from "./locationTrust";
import type { Facility, RouteStop } from "./types";

function facility(id: string, patch: Partial<Facility> = {}): Facility {
  return {
    id,
    name: id,
    address: `${id} address`,
    lat: FALLBACK_LOCATION_COORDINATES.lat,
    lng: FALLBACK_LOCATION_COORDINATES.lng,
    locationStatus: "needs_confirmation",
    locationSource: "import",
    contacts: [],
    ...patch,
  };
}

function privateRouteStop(): RouteStop {
  return {
    id: "route-stop-1",
    facilityId: "private-stop-1",
    order: 1,
    status: "planned",
    source: "private_route_stop",
    privateLocation: {
      id: "private-stop-1",
      name: "Private route stop",
      address: "Address needs review",
      lat: FALLBACK_LOCATION_COORDINATES.lat,
      lng: FALLBACK_LOCATION_COORDINATES.lng,
      locationStatus: "needs_confirmation",
      locationSource: "import",
      privateRouteStop: true,
    },
  };
}

const confirmedPatch = {
  address: "100 Real Rd, Houston, TX",
  lat: 29.7,
  lng: -95.5,
};

test("confirmLocationReview confirms imported Facility locations and preserves import source", () => {
  const result = confirmLocationReview({
    facilities: [facility("facility-1")],
    routeStops: [],
    locationId: "facility-1",
    patch: confirmedPatch,
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected confirmation to pass");
  assert.equal(result.confirmedFacilityId, "facility-1");
  assert.equal(result.facilities[0].address, "100 Real Rd, Houston, TX");
  assert.equal(result.facilities[0].lat, 29.7);
  assert.equal(result.facilities[0].lng, -95.5);
  assert.equal(result.facilities[0].locationStatus, "confirmed");
  assert.equal(result.facilities[0].locationSource, "import");
});

test("confirmLocationReview marks non-import Facility confirmations as geocoded", () => {
  const result = confirmLocationReview({
    facilities: [facility("facility-1", { locationSource: "fallback" })],
    routeStops: [],
    locationId: "facility-1",
    patch: confirmedPatch,
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected confirmation to pass");
  assert.equal(result.facilities[0].locationSource, "geocoded");
});

test("confirmLocationReview confirms Private Route Stop locations without creating Facilities", () => {
  const stop = privateRouteStop();
  const result = confirmLocationReview({
    facilities: [],
    routeStops: [stop],
    locationId: "private-stop-1",
    patch: confirmedPatch,
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected confirmation to pass");
  assert.equal(result.confirmedFacilityId, undefined);
  assert.deepEqual(result.facilities, []);
  assert.equal(result.routeStops[0].privateLocation?.address, "100 Real Rd, Houston, TX");
  assert.equal(result.routeStops[0].privateLocation?.locationStatus, "confirmed");
  assert.equal(result.routeStops[0].privateLocation?.locationSource, "import");
});

test("confirmLocationReview blocks invalid confirmation patches without mutating state", () => {
  const currentFacilities = [facility("facility-1")];
  const currentRouteStops = [privateRouteStop()];
  const result = confirmLocationReview({
    facilities: currentFacilities,
    routeStops: currentRouteStops,
    locationId: "facility-1",
    patch: { ...confirmedPatch, address: "" },
  });

  assert.deepEqual(result, {
    ok: false,
    issue: "Add a full address before confirming this location.",
    facilities: currentFacilities,
    routeStops: currentRouteStops,
  });
});

test("confirmLocationReview reports missing Location Review targets without mutating state", () => {
  const currentFacilities = [facility("facility-1")];
  const currentRouteStops = [privateRouteStop()];
  const result = confirmLocationReview({
    facilities: currentFacilities,
    routeStops: currentRouteStops,
    locationId: "missing",
    patch: confirmedPatch,
  });

  assert.deepEqual(result, {
    ok: false,
    issue: "Location not found.",
    facilities: currentFacilities,
    routeStops: currentRouteStops,
  });
});
