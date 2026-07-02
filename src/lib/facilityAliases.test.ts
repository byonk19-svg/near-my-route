import assert from "node:assert/strict";
import test from "node:test";
import { appendFacilityAlias, isSafeFacilityAlias, sanitizeFacilityAlias } from "./facilityAliases";
import type { Facility } from "./types";

const baseFacility: Facility = {
  id: "facility-1",
  name: "Sample Rehab",
  address: "100 Example Rd, Houston, TX",
  lat: 29.7,
  lng: -95.4,
  contacts: [],
};

test("sanitizeFacilityAlias cleans operational markers without erasing useful labels", () => {
  assert.equal(sanitizeFacilityAlias("HOSPITAL KATY *HOSPITAL INITIAL*"), "HOSPITAL KATY");
  assert.equal(sanitizeFacilityAlias("RESORT KATY"), "RESORT KATY");
  assert.equal(sanitizeFacilityAlias("HOME HEALTH ADDRESS CONFIRMED"), "HOME HEALTH");
});

test("isSafeFacilityAlias rejects private, contact, blank, and generic labels", () => {
  assert.equal(isSafeFacilityAlias("RESORT KATY"), true);
  assert.equal(isSafeFacilityAlias("HOSPITAL KATY"), true);
  assert.equal(isSafeFacilityAlias("Patient Home"), false);
  assert.equal(isSafeFacilityAlias("713-555-1212"), false);
  assert.equal(isSafeFacilityAlias("facility"), false);
});

test("appendFacilityAlias appends safe local aliases without duplicates", () => {
  const once = appendFacilityAlias([baseFacility], "facility-1", "RESORT KATY");
  assert.deepEqual(once[0].aliases, ["RESORT KATY"]);

  const twice = appendFacilityAlias(once, "facility-1", "resort katy");
  assert.deepEqual(twice[0].aliases, ["RESORT KATY"]);

  const rejected = appendFacilityAlias(twice, "facility-1", "Patient Home");
  assert.deepEqual(rejected[0].aliases, ["RESORT KATY"]);
});
