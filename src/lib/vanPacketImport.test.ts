import assert from "node:assert/strict";
import test from "node:test";
import { initialFacilities } from "./mockData";
import { addressesFromGoogleMapsDirUrl, parseVanPacketText } from "./vanPacketImport";

test("addressesFromGoogleMapsDirUrl decodes ordered /dir/ path segments", () => {
  const addresses = addressesFromGoogleMapsDirUrl(
    "https://www.google.com/maps/dir/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX/Home+Health,+100+Example+St,+Houston,+TX/Park+Manor+Westchase,+11910+Richmond+Ave,+Houston,+TX/@29.7,-95.5,12z",
  );

  assert.deepEqual(addresses, [
    "Memorial SNF, 12620 Memorial Dr, Houston, TX",
    "Home Health, 100 Example St, Houston, TX",
    "Park Manor Westchase, 11910 Richmond Ave, Houston, TX",
  ]);
});

test("parseVanPacketText extracts non-PHI route fields and defaults Home Health rows to private", () => {
  const packet = `NAME OF TEAM MEMBERS
Elaine; Jordan

VAN NAME
Northwest Van

MEET DETAILS
Meet at office at 7:30 AM.

SPECIAL INSTRUCTIONS
Bring van binder.
Patient: Do Not Store
DOB 1/1/1960
Referring MD: Do Not Store

MAP LINK
https://www.google.com/maps/dir/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX/Home+Health,+100+Example+St,+Houston,+TX/Park+Manor+Westchase,+11910+Richmond+Ave,+Houston,+TX`;

  const result = parseVanPacketText(packet, initialFacilities);

  assert.deepEqual(result.summary.teamMembers, ["Elaine", "Jordan"]);
  assert.equal(result.summary.vanName, "Northwest Van");
  assert.equal(result.summary.meetDetails, "Meet at office at 7:30 AM.");
  assert.equal(result.summary.specialInstructions, "Bring van binder.");
  assert.equal(result.summary.routeAddresses.length, 3);

  assert.equal(result.rows[0].action, "use_existing");
  assert.equal(result.rows[0].matchedFacilityId, "memorial-snf");
  assert.equal(result.rows[1].action, "private_route_stop");
  assert.equal(result.rows[1].facilityName, "Private route stop 2");
  assert.equal(result.rows[2].action, "use_existing");
  assert.equal(result.rows[2].matchedFacilityId, "park-manor-westchase");
  assert.ok(result.rows.every((row) => row.sourceMapLink === result.summary.mapLink));
});
