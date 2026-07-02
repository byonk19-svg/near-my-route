import assert from "node:assert/strict";
import test from "node:test";
import { initialFacilities } from "./mockData";
import { applyImportRows, importRowBlockingReason, parseScheduleText } from "./scheduleImport";
import type { ImportReviewRow } from "./types";

test("parses comma-heavy known facility lines without creating duplicates", () => {
  const [row] = parseScheduleText(
    "8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies",
    initialFacilities,
  );

  assert.equal(row.appointmentTime, "8:30 AM");
  assert.equal(row.facilityName, "Memorial SNF");
  assert.equal(row.address, "12620 Memorial Dr, Houston, TX");
  assert.equal(row.studyCount, 2);
  assert.equal(row.matchedFacilityId, "memorial-snf");
  assert.equal(row.action, "use_existing");
  assert.equal(importRowBlockingReason(row), undefined);
});

test("parses a time followed by a space instead of a comma", () => {
  const [row] = parseScheduleText(
    "10:15 AM Park Manor Westchase, 11910 Richmond Ave, Houston, TX, 1 study",
    initialFacilities,
  );

  assert.equal(row.appointmentTime, "10:15 AM");
  assert.equal(row.facilityName, "Park Manor Westchase");
  assert.equal(row.address, "11910 Richmond Ave, Houston, TX");
  assert.equal(row.studyCount, 1);
  assert.equal(row.matchedFacilityId, "park-manor-westchase");
  assert.equal(row.action, "use_existing");
});

test("ignores blank lines and CRLF separators", () => {
  const rows = parseScheduleText(
    "\r\n8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies\r\n\r\n1:00 PM, Lakeside Rehab, 9440 Bellaire Blvd, Houston, TX, 2 studies\r\n",
    initialFacilities,
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.matchedFacilityId),
    ["memorial-snf", "lakeside-rehab"],
  );
});

test("allows missing trailing study count for a clear existing facility match", () => {
  const [row] = parseScheduleText(
    "9:45 AM Encompass Rehab Westchase, 12005 Richmond Ave, Houston, TX",
    initialFacilities,
  );

  assert.equal(row.studyCount, undefined);
  assert.equal(row.matchedFacilityId, "encompass-westchase");
  assert.equal(row.action, "use_existing");
  assert.equal(importRowBlockingReason(row), undefined);
});

test("keeps weak partial-name matches in needs-review state", () => {
  const [row] = parseScheduleText("10:15 AM, Park Manor, Houston, TX, 1 study", initialFacilities);

  assert.equal(row.facilityName, "Park Manor");
  assert.equal(row.confidence, 45);
  assert.equal(row.matchedFacilityId, "park-manor-westchase");
  assert.equal(row.action, "needs_review");
  assert.equal(
    importRowBlockingReason(row),
    "Choose an existing facility, create a new facility, mark as a private route stop, or skip.",
  );
});

test("reuses existing facilities when applying confirmed import rows", () => {
  const rows = parseScheduleText(
    "8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies",
    initialFacilities,
  );
  const result = applyImportRows(rows, initialFacilities);

  assert.equal(result.facilities.length, initialFacilities.length);
  assert.equal(result.routeStops.length, 1);
  assert.equal(result.routeStops[0].facilityId, "memorial-snf");
});

test("creates exactly one facility for an explicit valid create-new row", () => {
  const row: ImportReviewRow = {
    id: "row-new",
    raw: "11:00 AM, Cypress Care, 100 New Rd, Houston, TX, 1 study",
    appointmentTime: "11:00 AM",
    facilityName: "Cypress Care",
    address: "100 New Rd, Houston, TX",
    studyCount: 1,
    confidence: 0,
    action: "create_new",
  };
  const result = applyImportRows([row], initialFacilities);

  assert.equal(result.facilities.length, initialFacilities.length + 1);
  assert.equal(result.routeStops.length, 1);
  assert.equal(result.facilities.at(-1)?.name, "Cypress Care");
  assert.equal(result.facilities.at(-1)?.locationStatus, "needs_confirmation");
  assert.equal(result.facilities.at(-1)?.locationSource, "import");
  assert.match(result.facilities.at(-1)?.notes ?? "", /Confirm location/);
});

test("applyImportRows remembers safe aliases for selected existing facilities", () => {
  const row = {
    id: "alias-row",
    raw: "RESORT KATY",
    facilityName: "1222 Park West Green Dr",
    address: "1222 Park West Green Dr, Katy, TX",
    sourceMapLink: "https://maps.example/route",
    matchedFacilityId: "park-manor-westchase",
    confidence: 55,
    action: "use_existing" as const,
    aliasCandidate: "RESORT KATY",
    rememberAlias: true,
  };

  const result = applyImportRows([row], initialFacilities);
  const facility = result.facilities.find((item) => item.id === "park-manor-westchase");

  assert.equal(result.routeStops.length, 1);
  assert.deepEqual(facility?.aliases, ["RESORT KATY"]);
});

test("skipped and unresolved rows do not create route stops or facilities", () => {
  const skipped: ImportReviewRow = {
    id: "row-skip",
    raw: "skip",
    appointmentTime: "11:00 AM",
    facilityName: "Skip Me",
    address: "100 New Rd, Houston, TX",
    confidence: 0,
    action: "skip",
  };
  const unresolved: ImportReviewRow = {
    ...skipped,
    id: "row-review",
    action: "needs_review",
  };
  const result = applyImportRows([skipped, unresolved], initialFacilities);

  assert.equal(result.facilities.length, initialFacilities.length);
  assert.equal(result.routeStops.length, 0);
});

test("guardrails block unresolved, unselected, and placeholder create-new rows", () => {
  const needsReview: ImportReviewRow = {
    id: "needs-review",
    raw: "10 AM, Park Manor, Houston, TX",
    appointmentTime: "10 AM",
    facilityName: "Park Manor",
    address: "Houston, TX",
    confidence: 45,
    action: "needs_review",
  };
  const missingExisting: ImportReviewRow = {
    ...needsReview,
    id: "missing-existing",
    action: "use_existing",
  };
  const blankAddress: ImportReviewRow = {
    ...needsReview,
    id: "blank-address",
    facilityName: "Cypress Care",
    address: "",
    action: "create_new",
  };
  const placeholderName: ImportReviewRow = {
    ...blankAddress,
    id: "placeholder-name",
    facilityName: "Unknown",
    address: "100 New Rd, Houston, TX",
  };
  const blankName: ImportReviewRow = {
    ...blankAddress,
    id: "blank-name",
    facilityName: " ",
    address: "100 New Rd, Houston, TX",
  };

  assert.equal(
    importRowBlockingReason(needsReview),
    "Choose an existing facility, create a new facility, mark as a private route stop, or skip.",
  );
  assert.equal(importRowBlockingReason(missingExisting), "Select an existing facility before confirming.");
  assert.equal(importRowBlockingReason(blankAddress), "Add a full address before creating a new facility.");
  assert.equal(importRowBlockingReason(blankName), "Add a real facility name or skip this row.");
  assert.equal(importRowBlockingReason(placeholderName), "Add a real facility name or skip this row.");
});
