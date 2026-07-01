import assert from "node:assert/strict";
import test from "node:test";
import { initialFacilities } from "./mockData";
import { hasAddOnOpportunity, outreachReasonLabels, selectTextFirst, sortOutreachQueue, textReadiness, type OutreachQueueItem } from "./outreachPriority";
import type { Facility } from "./types";

function facility(id: string, patch: Partial<Facility> = {}) {
  const base = initialFacilities.find((item) => item.id === id);
  assert.ok(base);
  return { ...base, ...patch };
}

function item(facility: Facility, status: OutreachQueueItem["status"], addedDriveMinutes = 10): OutreachQueueItem {
  return {
    facility,
    status,
    opportunity: {
      facility,
      addedDriveMinutes,
      addedDistanceMiles: addedDriveMinutes / 2,
      nearestStopName: "Route stop",
      nearestStopDistanceMiles: 1,
      bestInsertionLabel: "Best between Stop #1 and Stop #2",
      reasonBadges: [],
      score: 100 - addedDriveMinutes,
      group: "Best Add-ons",
    },
  };
}

function routeStopItem(facility: Facility, status: OutreachQueueItem["status"]): OutreachQueueItem {
  return { facility, status };
}

test("textReadiness distinguishes ready, placeholder, and missing phone contacts", () => {
  const ready = facility("encompass-westchase", {
    contacts: [{ id: "ready", name: "Lisa", phone: "713-867-5309", primary: true }],
  });
  const placeholder = facility("park-manor-westchase");
  const invalid = facility("encompass-westchase", {
    contacts: [{ id: "invalid", name: "Lisa", phone: "abc", primary: true }],
  });
  const missing = facility("encompass-westchase", { contacts: [] });

  assert.equal(textReadiness(ready), "ready");
  assert.equal(textReadiness(placeholder), "needs_real_phone");
  assert.equal(textReadiness(invalid), "needs_real_phone");
  assert.equal(textReadiness(missing), "no_phone");
});

test("textReadiness ignores non-text preferred phone contacts", () => {
  const callOnly = facility("encompass-westchase", {
    contacts: [{ id: "call", name: "Lisa", phone: "713-867-5309", preferredMethod: "call", primary: true }],
  });
  const mixed = facility("encompass-westchase", {
    contacts: [
      { id: "call", name: "Lisa", phone: "713-867-5309", preferredMethod: "call", primary: true },
      { id: "text", name: "Ken", phone: "713-867-5310", preferredMethod: "text" },
    ],
  });

  assert.equal(textReadiness(callOnly), "no_phone");
  assert.equal(textReadiness(mixed), "ready");
});

test("selectTextFirst chooses the best ready not-contacted option before placeholder setup work", () => {
  const ready = facility("encompass-westchase", {
    contacts: [{ id: "ready", name: "Lisa", phone: "713-867-5309", primary: true }],
  });
  const placeholder = facility("park-manor-westchase");
  const noPhone = facility("westchase-nursing", { contacts: [] });

  const selected = selectTextFirst([
    item(placeholder, "not_contacted", 3),
    item(noPhone, "not_contacted", 2),
    item(ready, "not_contacted", 8),
  ]);

  assert.equal(selected?.facility.id, "encompass-westchase");
});

test("selectTextFirst excludes current-route facilities without add-on opportunities", () => {
  const scheduledReady = facility("memorial-snf", {
    contacts: [{ id: "ready-scheduled", name: "Amy", phone: "713-867-5309", primary: true }],
  });
  const addOnCandidate = facility("encompass-westchase", {
    contacts: [{ id: "ready-addon", name: "Lisa", phone: "713-867-5309", primary: true }],
  });

  const selected = selectTextFirst([
    routeStopItem(scheduledReady, "not_contacted"),
    item(addOnCandidate, "not_contacted", 8),
  ]);

  assert.equal(selected?.facility.id, "encompass-westchase");
});

test("hasAddOnOpportunity separates route stops from outreach add-on candidates", () => {
  const scheduled = routeStopItem(facility("memorial-snf"), "not_contacted");
  const candidate = item(facility("encompass-westchase"), "not_contacted", 3);

  assert.equal(hasAddOnOpportunity(scheduled), false);
  assert.equal(hasAddOnOpportunity(candidate), true);
});

test("sortOutreachQueue puts possible add-ons first, then route-useful not-contacted work", () => {
  const ready = facility("encompass-westchase", {
    contacts: [{ id: "ready", name: "Lisa", phone: "713-867-5309", primary: true }],
  });
  const placeholder = facility("park-manor-westchase");
  const possible = facility("westchase-nursing");

  const sorted = sortOutreachQueue([
    item(placeholder, "not_contacted", 3),
    item(ready, "not_contacted", 8),
    item(possible, "possible_add_on", 12),
  ]);

  assert.equal(sorted[0].facility.id, "westchase-nursing");
  assert.deepEqual(
    sorted.slice(1).map((entry) => entry.status),
    ["not_contacted", "not_contacted"],
  );
});

test("outreachReasonLabels explain detour, readiness, and facility fit", () => {
  const ready = facility("encompass-westchase", {
    contacts: [{ id: "ready", name: "Lisa", phone: "713-867-5309", primary: true }],
  });
  const labels = outreachReasonLabels(item(ready, "not_contacted", 3));

  assert.equal(labels.includes("+3 min detour"), true);
  assert.equal(labels.includes("Primary SLP ready"), true);
  assert.equal(labels.includes("Same-day friendly"), true);
  assert.equal(labels.includes("High volume"), true);
});

test("outreachReasonLabels does not claim primary ready when only a secondary phone is usable", () => {
  const mixedContacts = facility("park-manor-westchase", {
    contacts: [
      { id: "primary", name: "Maria", phone: "555-0144", primary: true },
      { id: "secondary", name: "Ken", phone: "713-867-5309" },
    ],
  });
  const labels = outreachReasonLabels(item(mixedContacts, "not_contacted", 3));

  assert.equal(labels.includes("Primary SLP ready"), false);
  assert.equal(labels.includes("Phone ready"), true);
});
