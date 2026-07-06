import assert from "node:assert/strict";
import test from "node:test";
import {
  addRouteAddOn,
  removeRouteAddOn,
  routeAddOnStopForFacility,
  type RouteAddOnSnapshot,
} from "./routeAddOnLifecycle";
import type { OutreachLog, RouteStop } from "./types";

const snapshot: RouteAddOnSnapshot = {
  facilityId: "candidate",
  addedDriveMinutes: 7,
  bestInsertionLabel: "Best between Stop #1 and Stop #2",
  bestInsertionAfterStopId: "stop-1",
  nearestStopName: "Memorial SNF",
  nearestStopDistanceMiles: 1.4,
  reasonBadges: ["+7 min"],
};

function scheduledStop(id: string, facilityId: string, order: number): RouteStop {
  return {
    id,
    facilityId,
    order,
    status: "planned",
    source: "scheduled",
  };
}

function log(id: string, facilityId = "candidate"): OutreachLog {
  return {
    id,
    facilityId,
    createdAt: "2026-07-06T12:00:00.000Z",
    method: "text",
    status: "texted",
  };
}

test("addRouteAddOn inserts a tentative stop after the requested route stop and records route impact", () => {
  const result = addRouteAddOn({
    routeStops: [scheduledStop("stop-1", "first", 1), scheduledStop("stop-2", "second", 2)],
    outreachLogs: [log("existing-log", "first")],
    facilityId: "candidate",
    routeStopId: "stop-addon",
    outreachLogId: "log-addon",
    createdAt: "2026-07-06T13:00:00.000Z",
    contactName: "Lisa",
    snapshot,
  });

  assert.equal(result.kind, "added");
  assert.deepEqual(
    result.routeStops.map((stop) => [stop.id, stop.order]),
    [
      ["stop-1", 1],
      ["stop-addon", 2],
      ["stop-2", 3],
    ],
  );
  assert.deepEqual(result.routeStop.routeImpact, {
    addedDriveMinutes: 7,
    bestInsertionLabel: "Best between Stop #1 and Stop #2",
    bestInsertionAfterStopId: "stop-1",
    nearestStopName: "Memorial SNF",
    nearestStopDistanceMiles: 1.4,
  });
  assert.deepEqual(result.outreachLogs[0], {
    id: "log-addon",
    facilityId: "candidate",
    createdAt: "2026-07-06T13:00:00.000Z",
    method: "other",
    contactName: "Lisa",
    status: "added_to_route",
    notes: "Added tentatively to tomorrow's route.",
  });
});

test("addRouteAddOn inserts before the first stop when the snapshot has no after-stop id", () => {
  const result = addRouteAddOn({
    routeStops: [scheduledStop("stop-1", "first", 1), scheduledStop("stop-2", "second", 2)],
    outreachLogs: [],
    facilityId: "candidate",
    routeStopId: "stop-addon",
    outreachLogId: "log-addon",
    createdAt: "2026-07-06T13:00:00.000Z",
    snapshot: { ...snapshot, bestInsertionLabel: "Before Stop #1", bestInsertionAfterStopId: undefined },
  });

  assert.equal(result.kind, "added");
  assert.deepEqual(
    result.routeStops.map((stop) => [stop.id, stop.order]),
    [
      ["stop-addon", 1],
      ["stop-1", 2],
      ["stop-2", 3],
    ],
  );
});

test("addRouteAddOn reopens an existing tentative add-on without adding a duplicate log", () => {
  const existingAddOn: RouteStop = {
    ...scheduledStop("stop-addon", "candidate", 2),
    status: "tentative",
    source: "today_add_on",
    addedFromLogId: "log-addon",
  };
  const result = addRouteAddOn({
    routeStops: [scheduledStop("stop-1", "first", 1), existingAddOn],
    outreachLogs: [log("log-addon")],
    facilityId: "candidate",
    routeStopId: "new-stop-id",
    outreachLogId: "new-log-id",
    createdAt: "2026-07-06T13:00:00.000Z",
    snapshot,
  });

  assert.equal(result.kind, "existing_tentative_add_on");
  assert.equal(result.routeStop.id, "stop-addon");
  assert.equal(result.routeStops.length, 2);
  assert.deepEqual(result.outreachLogs.map((entry) => entry.id), ["log-addon"]);
});

test("addRouteAddOn does not treat scheduled tentative route stops as removable add-ons", () => {
  const scheduledTentative: RouteStop = {
    ...scheduledStop("stop-1", "candidate", 1),
    status: "tentative",
    source: "scheduled",
  };
  const result = addRouteAddOn({
    routeStops: [scheduledTentative],
    outreachLogs: [],
    facilityId: "candidate",
    routeStopId: "stop-addon",
    outreachLogId: "log-addon",
    createdAt: "2026-07-06T13:00:00.000Z",
    snapshot,
  });

  assert.equal(result.kind, "already_on_route");
  assert.equal(result.routeStop.id, "stop-1");
});

test("removeRouteAddOn removes only a tentative today add-on and its own log", () => {
  const routeStops: RouteStop[] = [
    scheduledStop("stop-1", "first", 1),
    {
      ...scheduledStop("stop-addon", "candidate", 2),
      status: "tentative",
      source: "today_add_on",
      addedFromLogId: "log-addon",
    },
    scheduledStop("stop-2", "second", 3),
  ];
  const result = removeRouteAddOn({
    routeStops,
    outreachLogs: [log("unrelated"), log("log-addon")],
    routeStopId: "stop-addon",
  });

  assert.equal(result.kind, "removed");
  assert.equal(result.removedStop.facilityId, "candidate");
  assert.deepEqual(
    result.routeStops.map((stop) => [stop.id, stop.order]),
    [
      ["stop-1", 1],
      ["stop-2", 2],
    ],
  );
  assert.deepEqual(result.outreachLogs.map((entry) => entry.id), ["unrelated"]);
});

test("removeRouteAddOn leaves non-add-on tentative stops untouched", () => {
  const scheduledTentative: RouteStop = {
    ...scheduledStop("stop-1", "candidate", 1),
    status: "tentative",
    source: "scheduled",
  };
  const result = removeRouteAddOn({
    routeStops: [scheduledTentative],
    outreachLogs: [log("existing")],
    routeStopId: "stop-1",
  });

  assert.equal(result.kind, "not_found");
  assert.deepEqual(result.routeStops, [scheduledTentative]);
  assert.deepEqual(result.outreachLogs.map((entry) => entry.id), ["existing"]);
});

test("routeAddOnStopForFacility finds only tentative today add-ons", () => {
  const addOn: RouteStop = {
    ...scheduledStop("stop-addon", "candidate", 2),
    status: "tentative",
    source: "today_add_on",
  };

  assert.equal(routeAddOnStopForFacility([scheduledStop("stop-1", "candidate", 1)], "candidate"), undefined);
  assert.equal(routeAddOnStopForFacility([addOn], "candidate")?.id, "stop-addon");
});
