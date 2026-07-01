import assert from "node:assert/strict";
import test from "node:test";
import { initialFacilities } from "./mockData";
import { deriveTodayStatus, todayStatusFromOutreachStatus } from "./todayStatus";
import type { OutreachLog, RouteStop } from "./types";

const today = "2026-07-01";

function facility(id: string) {
  const item = initialFacilities.find((facility) => facility.id === id);
  assert.ok(item);
  return item;
}

function log(status: OutreachLog["status"], createdAt: string): OutreachLog {
  return {
    id: `${status}-${createdAt}`,
    facilityId: "encompass-westchase",
    createdAt,
    method: "other",
    status,
  };
}

function todayAddOnStop(facilityId = "encompass-westchase"): RouteStop {
  return {
    id: "stop-addon",
    facilityId,
    order: 1,
    status: "tentative",
    source: "today_add_on",
  };
}

test("deriveTodayStatus keeps do-not-contact active until explicitly cleared", () => {
  const status = deriveTodayStatus({
    facility: { ...facility("encompass-westchase"), doNotContact: true },
    outreachLogs: [log("do_not_contact", "2026-07-01T08:00:00.000Z")],
    routeStops: [],
    today,
  });

  assert.equal(status, "do_not_contact");
});

test("deriveTodayStatus lets a later clear event reactivate a do-not-contact facility", () => {
  const status = deriveTodayStatus({
    facility: { ...facility("encompass-westchase"), doNotContact: true },
    outreachLogs: [
      log("do_not_contact_cleared", "2026-07-01T09:00:00.000Z"),
      log("do_not_contact", "2026-07-01T08:00:00.000Z"),
    ],
    routeStops: [],
    today,
  });

  assert.equal(status, "not_contacted");
});

test("deriveTodayStatus preserves added status after do-not-contact is cleared", () => {
  const status = deriveTodayStatus({
    facility: { ...facility("encompass-westchase"), doNotContact: true },
    outreachLogs: [
      log("do_not_contact_cleared", "2026-07-01T09:00:00.000Z"),
      log("do_not_contact", "2026-07-01T08:00:00.000Z"),
    ],
    routeStops: [todayAddOnStop()],
    today,
  });

  assert.equal(status, "added");
});

test("todayStatusFromOutreachStatus maps a clear event back to active outreach", () => {
  assert.equal(todayStatusFromOutreachStatus("do_not_contact_cleared"), "not_contacted");
});
