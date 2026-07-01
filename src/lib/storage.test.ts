import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_LOCATION_COORDINATES } from "./locationTrust";
import { initialFacilities } from "./mockData";
import { migrateStoredState } from "./storage";

test("migrateStoredState preserves old state and confirms demo facilities", () => {
  const migrated = migrateStoredState({
    facilities: [{ ...initialFacilities[0], locationStatus: undefined, locationSource: undefined }],
    routeStops: [{ id: "stop-1", facilityId: initialFacilities[0].id, order: 1, status: "planned" }],
    outreachLogs: [{ id: "log-1", facilityId: initialFacilities[0].id, createdAt: "2026-07-01T00:00:00.000Z", method: "text", status: "texted" }],
    dogfoodChecked: { import: true },
    dogfoodNotes: "Workflow note.",
  });

  assert.equal(migrated?.version, 1);
  assert.equal(migrated?.facilities[0].locationStatus, "confirmed");
  assert.equal(migrated?.facilities[0].locationSource, "seed");
  assert.equal(migrated?.routeStops[0].source, "scheduled");
  assert.equal(migrated?.outreachLogs.length, 1);
  assert.equal(migrated?.dogfoodChecked?.import, true);
  assert.equal(migrated?.dogfoodNotes, "Workflow note.");
});

test("migrateStoredState marks fallback and unknown stored facilities as needing confirmation", () => {
  const migrated = migrateStoredState({
    facilities: [
      {
        id: "real-fallback",
        name: "Real Fallback",
        address: "100 Example St, Houston, TX",
        lat: FALLBACK_LOCATION_COORDINATES.lat,
        lng: FALLBACK_LOCATION_COORDINATES.lng,
        contacts: [],
      },
      {
        id: "real-unknown",
        name: "Real Unknown",
        address: "200 Example St, Houston, TX",
        lat: 30.1,
        lng: -95.1,
        contacts: [],
      },
    ],
    routeStops: [],
    outreachLogs: [],
  });

  assert.equal(migrated?.facilities[0].locationStatus, "needs_confirmation");
  assert.equal(migrated?.facilities[0].locationSource, "fallback");
  assert.equal(migrated?.facilities[1].locationStatus, "needs_confirmation");
  assert.equal(migrated?.facilities[1].locationSource, "import");
});

test("migrateStoredState does not crash on partial stored data", () => {
  const migrated = migrateStoredState({ routeStops: "bad", outreachLogs: undefined });

  assert.equal(migrated?.version, 1);
  assert.equal(migrated?.facilities.length, initialFacilities.length);
  assert.deepEqual(migrated?.routeStops, []);
  assert.deepEqual(migrated?.outreachLogs, []);
});
