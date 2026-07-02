import assert from "node:assert/strict";
import test from "node:test";
import { initialFacilities } from "./mockData";
import { addressesFromGoogleMapsDirUrl, normalizeVanPacketAddress, parseVanPacketText } from "./vanPacketImport";

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
  assert.equal(result.summary.routeAnchorHints, 0);

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
  assert.equal(result.summary.privateStopHints, 1);
  assert.equal(result.summary.routeAnchorHints, 2);
  assert.equal(result.summary.specialInstructions, undefined);
  assert.equal(result.rows[0].action, "skip");
  assert.equal(result.rows[0].facilityName, "Meet point 1");
  assert.equal(result.rows[0].routeOnlyReason, "route_anchor");
  assert.equal(result.rows[1].action, "use_existing");
  assert.equal(result.rows[1].matchedFacilityId, "memorial-snf");
  assert.equal(result.rows[1].reviewNote, "PDF label hint: MEMORIAL SNF");
  assert.equal(result.rows[2].action, "private_route_stop");
  assert.equal(result.rows[2].facilityName, "Private route stop 3");
  assert.equal(result.rows[2].matchedFacilityId, undefined);
  assert.equal(result.rows[2].routeOnlyReason, "private");
  assert.equal(result.rows[3].action, "skip");
  assert.equal(result.rows[3].facilityName, "Meet point 4");
  assert.equal(result.rows[3].routeOnlyReason, "route_anchor");
  assert.equal(JSON.stringify(result).includes("PRIVATE_DETAIL"), false);
});

test("normalizeVanPacketAddress handles common roadway variants", () => {
  assert.equal(normalizeVanPacketAddress("18550 Interstate 45 South, Conroe, TX"), normalizeVanPacketAddress("18550 I-45 S, Conroe, Texas"));
  assert.equal(normalizeVanPacketAddress("117 Vision Park Boulevard"), normalizeVanPacketAddress("117 Vision Park Blvd"));
  assert.equal(normalizeVanPacketAddress("27840 Johnson Road"), normalizeVanPacketAddress("27840 Johnson Rd"));
  assert.equal(normalizeVanPacketAddress("2331 Grand Reserve Drive"), normalizeVanPacketAddress("2331 Grand Reserve Dr"));
});

test("parseVanPacketText uses PDF label hints and does not assign random zero-confidence matches", () => {
  const facilities = [
    {
      id: "sample-rehab",
      name: "Sample Rehab North",
      address: "18550 Interstate 45 South, Conroe, TX 77384",
      lat: 30.1,
      lng: -95.4,
      contacts: [],
    },
  ];
  const packet = `NAME OF TEAM MEMBERS
Driver One
VAN NAME
Sample Van
MAP LINK
https://www.google.com/maps/dir/18550+I-45+S,+Conroe,+TX+77384/710+Farm+Road,+Example,+TX`;
  const pdfText = `SAMPLE REHAB NORTH
18550 I-45 SOUTH, CONROE, TX 77384
UNMATCHED STOP
710 FARM ROAD, EXAMPLE, TX`;

  const result = parseVanPacketText(packet, facilities, { supplementalText: pdfText });

  assert.equal(result.rows[0].action, "use_existing");
  assert.equal(result.rows[0].matchedFacilityId, "sample-rehab");
  assert.equal(result.rows[0].confidence >= 75, true);
  assert.equal(result.rows[1].action, "needs_review");
  assert.equal(result.rows[1].matchedFacilityId, undefined);
  assert.equal(result.rows[1].confidence, 0);
  assert.equal(result.rows[1].facilityName, "710 Farm Road");
});

test("parseVanPacketText keeps alias-only matches in review but auto-uses address-supported aliases", () => {
  const facilities = [
    {
      id: "resort-katy",
      name: "Sample Resort at Katy",
      aliases: ["RESORT KATY"],
      address: "1222 Park West Green Drive, Katy, TX 77493",
      lat: 29.7,
      lng: -95.8,
      contacts: [],
    },
  ];
  const supportedPacket = `MAP LINK
https://www.google.com/maps/dir/1222+Park+West+Green+Dr,+Katy,+TX+77493`;
  const supportedPdf = `RESORT KATY
1222 PARK WEST GREEN DR, KATY, TX 77493`;
  const supported = parseVanPacketText(supportedPacket, facilities, { supplementalText: supportedPdf });

  assert.equal(supported.rows[0].action, "use_existing");
  assert.equal(supported.rows[0].matchedFacilityId, "resort-katy");
  assert.equal(supported.rows[0].aliasCandidate, "RESORT KATY");

  const hintOnlyPacket = `MAP LINK
https://www.google.com/maps/dir/710+Farm+Road,+Example,+TX`;
  const hintOnlyPdf = `RESORT KATY
710 FARM ROAD, EXAMPLE, TX`;
  const hintOnly = parseVanPacketText(hintOnlyPacket, facilities, { supplementalText: hintOnlyPdf });

  assert.equal(hintOnly.rows[0].action, "needs_review");
  assert.equal(hintOnly.rows[0].matchedFacilityId, "resort-katy");
  assert.equal(hintOnly.rows[0].confidence, 55);
  assert.equal(hintOnly.rows[0].reviewNote, "Possible known facility label. Confirm the facility to remember this alias.");
});

test("parseVanPacketText cleans messy PDF labels and detects home health label shapes", () => {
  const messyFacility = [
    {
      id: "hospital-katy",
      name: "Sample Hospital Katy",
      aliases: ["HOSPITAL KATY"],
      address: "2331 Grand Reserve Drive, Katy, TX",
      lat: 29.7,
      lng: -95.8,
      contacts: [],
    },
  ];
  const packet = `MAP LINK
https://www.google.com/maps/dir/2331+Grand+Reserve+Dr,+Katy,+TX/100+Example+St,+Houston,+TX/200+Example+Ave,+Houston,+TX/300+Example+Rd,+Houston,+TX`;
  const pdf = `HOSPITAL KATY *HOSPITAL INITIAL*
2331 GRAND RESERVE DRIVE, KATY, TX
HH
100 EXAMPLE ST, HOUSTON, TX
HOME HEALTH ADDRESS CONFIRMED
200 EXAMPLE AVE, HOUSTON, TX
PATIENT HOME
300 EXAMPLE RD, HOUSTON, TX`;

  const result = parseVanPacketText(packet, messyFacility, { supplementalText: pdf });

  assert.equal(result.rows[0].action, "use_existing");
  assert.equal(result.rows[0].aliasCandidate, "HOSPITAL KATY");
  assert.equal(result.rows[1].action, "private_route_stop");
  assert.equal(result.rows[2].action, "private_route_stop");
  assert.equal(result.rows[3].action, "private_route_stop");
});

test("parseVanPacketText keeps only collapsed safe operational notes", () => {
  const packet = `SPECIAL INSTRUCTIONS
Use the side entrance and do not block parking.
Call coordinator 713-555-1212 before arrival.
Patient has clinical details.
Make a jump drive for facility education.
MAP LINK
https://www.google.com/maps/dir/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX`;

  const result = parseVanPacketText(packet, initialFacilities);

  assert.deepEqual(result.summary.safeNotes, [
    "Use the side entrance and do not block parking.",
    "Make a jump drive for facility education.",
  ]);
  assert.equal(JSON.stringify(result.summary).includes("713-555-1212"), false);
  assert.equal(JSON.stringify(result.summary).includes("clinical"), false);
});
