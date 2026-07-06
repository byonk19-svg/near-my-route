import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmImportReview,
  importReviewModel,
  parseImportReview,
  updateImportReviewRow,
  type ImportReviewIdPurpose,
} from "./importReview";
import { initialFacilities } from "./mockData";

function deterministicIds() {
  const counts: Record<ImportReviewIdPurpose, number> = {
    row: 0,
    facility: 0,
    "private-route-stop": 0,
    "route-stop": 0,
  };

  return (purpose: ImportReviewIdPurpose) => {
    counts[purpose] += 1;
    return `${purpose}-${counts[purpose]}`;
  };
}

test("schedule Import Review produces deterministic rows and all-or-nothing confirmation", () => {
  const nextId = deterministicIds();
  const draft = parseImportReview({
    mode: "schedule",
    text: [
      "8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies",
      "11:00 AM, Cypress Care, 100 New Rd, Houston, TX, 1 study",
    ].join("\n"),
    facilities: initialFacilities,
    nextId,
  });

  assert.equal(draft.source.kind, "schedule");
  assert.deepEqual(
    draft.rows.map((row) => row.id),
    ["row-1", "row-2"],
  );

  const blockedModel = importReviewModel(draft);
  assert.equal(blockedModel.canConfirm, false);
  assert.equal(blockedModel.summary.confirmed, 1);
  assert.equal(blockedModel.summary.unresolved, 1);
  assert.deepEqual(blockedModel.issuesByRowId, {
    "row-2": "Choose an existing facility, create a new facility, mark as a private route stop, or skip.",
  });

  const blockedConfirmation = confirmImportReview(draft, initialFacilities, { nextId });
  assert.equal(blockedConfirmation.ok, false);
  if (!blockedConfirmation.ok) {
    assert.equal(blockedConfirmation.summary.unresolved, 1);
    assert.equal(blockedConfirmation.issuesByRowId["row-2"], blockedModel.issuesByRowId["row-2"]);
  }

  const readyDraft = updateImportReviewRow(draft, "row-2", { action: "create_new" });
  const result = confirmImportReview(readyDraft, initialFacilities, { nextId });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected confirmation to pass");

  assert.equal(result.routeStops.length, 2);
  assert.deepEqual(
    result.routeStops.map((stop) => stop.id),
    ["route-stop-1", "route-stop-2"],
  );
  assert.equal(result.routeStops[1].facilityId, "facility-1");
  assert.equal(result.facilities.at(-1)?.id, "facility-1");
  assert.equal(result.facilities.at(-1)?.name, "Cypress Care");
  assert.equal(result.facilities.at(-1)?.locationStatus, "needs_confirmation");
  assert.equal(result.locationReviewTargets.length, 1);
  assert.equal(result.locationReviewTargets[0].id, "facility-1");
  assert.equal(result.initialFacilityId, "memorial-snf");
});

test("Van Packet Import Review preserves safe source metadata and Route Anchors without raw pasted text", () => {
  const sourceMapLink =
    "https://www.google.com/maps/dir/900+Example+Start,+Houston,+TX/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX/100+Example+St,+Houston,+TX/900+Example+Start,+Houston,+TX";
  const packet = `NAME OF TEAM MEMBERS
Elaine; Jordan

VAN NAME
Northwest Van

MEET DETAILS
Meet point = 900 Example Start, Houston, TX.

SPECIAL INSTRUCTIONS
Use side entrance and avoid blocking parking.
Patient: PRIVATE_DETAIL

MAP LINK
${sourceMapLink}`;
  const pdfText = `MEMORIAL SNF
12620 MEMORIAL DR, HOUSTON, TX
HOME HEALTH
100 EXAMPLE ST, HOUSTON, TX
Patient: PRIVATE_DETAIL`;
  const draft = parseImportReview({
    mode: "van_packet",
    text: packet,
    supplementalText: pdfText,
    facilities: initialFacilities,
    nextId: deterministicIds(),
  });

  assert.equal(draft.source.kind, "van_packet");
  if (draft.source.kind !== "van_packet") throw new Error("expected Van Packet source");
  assert.equal(draft.source.summary.vanName, "Northwest Van");
  assert.deepEqual(draft.source.summary.safeNotes, ["Use side entrance and avoid blocking parking."]);
  assert.equal(draft.source.summary.routeAnchorHints, 2);
  assert.equal(draft.source.summary.privateStopHints, 1);
  assert.equal(JSON.stringify(draft).includes("PRIVATE_DETAIL"), false);

  const model = importReviewModel(draft);
  assert.equal(model.rows.length, 4);
  assert.equal(model.visibleRows.length, 2);
  assert.equal(model.routeAnchorRows.length, 2);
  assert.deepEqual(
    model.routeAnchorRows.map((row) => row.action),
    ["skip", "skip"],
  );
  assert.equal(model.canConfirm, true);
});

test("Import Review row updates normalize dependent fields", () => {
  const draft = parseImportReview({
    mode: "schedule",
    text: "10:15 AM, Park Manor, Houston, TX, 1 study",
    facilities: initialFacilities,
    nextId: deterministicIds(),
  });
  const selected = updateImportReviewRow(draft, "row-1", {
    action: "use_existing",
    matchedFacilityId: "park-manor-westchase",
    aliasCandidate: "PARK",
    rememberAlias: true,
  });

  assert.equal(selected.rows[0].action, "use_existing");
  assert.equal(selected.rows[0].rememberAlias, true);

  const privateStop = updateImportReviewRow(selected, "row-1", { action: "private_route_stop" });
  assert.equal(privateStop.rows[0].matchedFacilityId, undefined);
  assert.equal(privateStop.rows[0].aliasCandidate, undefined);
  assert.equal(privateStop.rows[0].rememberAlias, undefined);

  const skipped = updateImportReviewRow(selected, "row-1", { action: "skip" });
  assert.equal(skipped.rows[0].raw, "10:15 AM, Park Manor, Houston, TX, 1 study");
  assert.equal(skipped.rows[0].address, "Houston, TX");
  assert.equal(importReviewModel(skipped).canConfirm, false);
  assert.equal(importReviewModel(skipped).summary.skipped, 1);
});

test("Import Review confirmation learns aliases and creates Private Route Stops without Facilities", () => {
  const nextId = deterministicIds();
  const draft = parseImportReview({
    mode: "van_packet",
    text: "MAP LINK\nhttps://www.google.com/maps/dir/999+Alias+Test+Rd,+Houston,+TX/100+Example+St,+Houston,+TX",
    supplementalText: "WESTCHASE OUTPOST\n999 ALIAS TEST RD, HOUSTON, TX\nHOME HEALTH\n100 EXAMPLE ST, HOUSTON, TX",
    facilities: initialFacilities,
    nextId,
  });
  const withAlias = updateImportReviewRow(draft, "row-1", {
    action: "use_existing",
    matchedFacilityId: "park-manor-westchase",
    rememberAlias: true,
  });

  const result = confirmImportReview(withAlias, initialFacilities, { nextId });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected confirmation to pass");

  const facility = result.facilities.find((item) => item.id === "park-manor-westchase");
  assert.equal(facility?.aliases?.includes("WESTCHASE OUTPOST"), true);
  assert.equal(result.facilities.some((item) => item.name === "Private route stop 2"), false);
  assert.equal(result.routeStops[1].source, "private_route_stop");
  assert.equal(result.routeStops[1].facilityId, "private-route-stop-1");
  assert.equal(result.routeStops[1].privateLocation?.locationStatus, "needs_confirmation");
  assert.equal(result.locationReviewTargets[0].id, "private-route-stop-1");
  assert.equal(result.sourceMapLink, draft.rows[0].sourceMapLink);
});
