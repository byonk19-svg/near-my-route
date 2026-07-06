import assert from "node:assert/strict";
import test from "node:test";
import { buildRouteHandoff } from "./routeHandoff";
import type { Facility, RouteStop } from "./types";

function facility(id: string, patch: Partial<Facility> = {}): Facility {
  return {
    id,
    name: `Facility ${id}`,
    address: `${id} Main St, Houston, TX`,
    lat: 29.7,
    lng: -95.4,
    locationStatus: "confirmed",
    locationSource: "seed",
    contacts: [],
    sameDayFriendly: "unknown",
    typicalVolume: "unknown",
    ...patch,
  };
}

function stop(id: string, facilityId: string, order: number, patch: Partial<RouteStop> = {}): RouteStop {
  return {
    id,
    facilityId,
    order,
    status: "planned",
    source: "scheduled",
    ...patch,
  };
}

test("buildRouteHandoff returns Maps actions and ready copy for confirmed current routes", () => {
  const facilities = [
    facility("a", {
      name: "Alpha Rehab",
      contacts: [{ id: "a-contact", name: "Amy", phone: "713-867-5309", preferredMethod: "text", primary: true }],
    }),
    facility("b", {
      name: "Beta SNF",
      lat: 29.8,
      lng: -95.5,
      contacts: [{ id: "b-contact", name: "Bea", phone: "555-0100", preferredMethod: "text", primary: true }],
    }),
  ];

  const handoff = buildRouteHandoff(
    [
      stop("stop-b", "b", 2),
      stop("stop-a", "a", 1, { sourceMapLink: "https://maps.example/original" }),
    ],
    facilities,
  );

  assert.equal(handoff.isMapsBlocked, false);
  assert.equal(handoff.needsLocationReview, false);
  assert.equal(handoff.locationWarning, undefined);
  assert.equal(handoff.locationOutreachWarning, undefined);
  assert.equal(handoff.readinessTitle, "Tomorrow's route ready");
  assert.equal(handoff.readinessSummary, "2 stops imported - locations confirmed - 1 text-ready facility");
  assert.equal(handoff.sourceMapLink, "https://maps.example/original");
  assert.deepEqual(handoff.locations.map((location) => location.id), ["a", "b"]);
  assert.deepEqual([...handoff.facilityIds], ["a", "b"]);
  assert.match(handoff.mapsUrl ?? "", /origin=29\.7%2C-95\.4/);
  assert.match(handoff.mapsUrl ?? "", /destination=29\.8%2C-95\.5/);
});

test("buildRouteHandoff blocks Maps when route locations still need Location Review", () => {
  const facilities = [
    facility("confirmed", { name: "Confirmed Facility" }),
    facility("needs-review", { name: "Imported Facility", locationStatus: "needs_confirmation" }),
  ];

  const handoff = buildRouteHandoff([stop("one", "confirmed", 1), stop("two", "needs-review", 2)], facilities);

  assert.equal(handoff.isMapsBlocked, true);
  assert.equal(handoff.needsLocationReview, true);
  assert.equal(handoff.unconfirmedLocations[0]?.id, "needs-review");
  assert.deepEqual(handoff.unconfirmedLocations.map((location) => location.name), ["Imported Facility"]);
  assert.equal(
    handoff.locationWarning,
    "Route includes unconfirmed locations: Imported Facility. Confirm location before trusting add-on ranking or Maps handoff.",
  );
  assert.equal(
    handoff.locationOutreachWarning,
    "Route includes unconfirmed locations. Review locations before trusting add-on ranking or Maps handoff.",
  );
  assert.equal(handoff.readinessTitle, "Tomorrow's route needs location review");
  assert.equal(handoff.readinessSummary, "2 stops imported - 1 location need confirm - 0 text-ready facilities");
});

test("buildRouteHandoff includes private route stops in Location Review and split-leg decisions", () => {
  const facilities = Array.from({ length: 7 }, (_, index) =>
    facility(`facility-${index}`, {
      lat: 29.7 + index / 100,
      lng: -95.4 - index / 100,
    }),
  );
  const routeStops = facilities.map((item, index) => stop(`stop-${index}`, item.id, index + 1));
  routeStops.splice(
    2,
    0,
    stop("private-stop", "private-location", 3, {
      source: "private_route_stop",
      privateLocation: {
        id: "private-location",
        name: "Private Route Stop",
        address: "100 Example St, Houston, TX",
        lat: 29.91,
        lng: -95.61,
        locationStatus: "needs_confirmation",
        locationSource: "import",
        privateRouteStop: true,
      },
    }),
  );

  const handoff = buildRouteHandoff(routeStops, facilities);

  assert.equal(handoff.isMapsBlocked, true);
  assert.equal(handoff.unconfirmedLocations[0]?.id, "private-location");
  assert.equal(handoff.splitMapsUrls.length, 2);
  assert.equal(handoff.mapsWarning, "Google Maps mobile browsers may only support 3 waypoints. Review the route after it opens.");
  assert.equal(handoff.readinessSummary, "8 stops imported - 1 location need confirm - 0 text-ready facilities");
});
