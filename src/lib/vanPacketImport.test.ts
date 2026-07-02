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
  assert.equal(result.summary.supplementalTextUsed, false);
  assert.equal(result.summary.privateStopHints, 1);

  assert.equal(result.rows[0].action, "use_existing");
  assert.equal(result.rows[0].matchedFacilityId, "memorial-snf");
  assert.equal(result.rows[1].action, "private_route_stop");
  assert.equal(result.rows[1].facilityName, "Private route stop 2");
  assert.equal(result.rows[2].action, "use_existing");
  assert.equal(result.rows[2].matchedFacilityId, "park-manor-westchase");
  assert.ok(result.rows.every((row) => row.sourceMapLink === result.summary.mapLink));
});

test("parseVanPacketText uses pasted PDF table text to protect bare home health addresses", () => {
  const packet = `NAME OF TEAM MEMBERS: Driver One, SLP Two, TBD
VAN NAME: Sample Van
MEET DETAILS: 07:30 AM MEET POINT = 900 Example Start, Houston, TX
SPECIAL INSTRUCTIONS
HOME HEALTH ADDRESS CONFIRMED 0701MH
MAP LINK: https://www.google.com/maps/dir/900+Example+Start,+Houston,+TX/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX/100+Example+St,+Houston,+TX/900+Example+Start,+Houston,+TX`;
  const pdfText = `HOUSTON VAN 1
MEMORIAL SNF
12620 MEMORIAL DR, HOUSTON, TX
HOME HEALTH
100 EXAMPLE ST, HOUSTON, TX
Patient: PRIVATE_DETAIL
Referring MD: PRIVATE_DETAIL`;

  const result = parseVanPacketText(packet, initialFacilities, { supplementalText: pdfText });

  assert.equal(result.summary.supplementalTextUsed, true);
  assert.equal(result.summary.privateStopHints, 3);
  assert.equal(result.summary.specialInstructions, "HOME HEALTH ADDRESS CONFIRMED 0701MH");
  assert.equal(result.rows[0].action, "private_route_stop");
  assert.equal(result.rows[0].facilityName, "Meet point 1");
  assert.equal(result.rows[1].action, "use_existing");
  assert.equal(result.rows[1].matchedFacilityId, "memorial-snf");
  assert.equal(result.rows[2].action, "private_route_stop");
  assert.equal(result.rows[2].facilityName, "Private route stop 3");
  assert.equal(result.rows[2].matchedFacilityId, undefined);
  assert.equal(result.rows[3].action, "private_route_stop");
  assert.equal(result.rows[3].facilityName, "Meet point 4");
  assert.equal(JSON.stringify(result).includes("PRIVATE_DETAIL"), false);
});
