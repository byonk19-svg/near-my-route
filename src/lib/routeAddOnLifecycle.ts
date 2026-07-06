import type { OutreachLog, RouteStop } from "./types";

export type RouteAddOnSnapshot = {
  facilityId: string;
  addedDriveMinutes: number;
  bestInsertionLabel: string;
  bestInsertionAfterStopId?: string;
  nearestStopName?: string;
  nearestStopDistanceMiles: number;
  reasonBadges: string[];
};

type AddRouteAddOnInput = {
  routeStops: RouteStop[];
  outreachLogs: OutreachLog[];
  facilityId: string;
  routeStopId: string;
  outreachLogId: string;
  createdAt: string;
  contactName?: string;
  snapshot: RouteAddOnSnapshot;
};

export type AddRouteAddOnResult =
  | {
      kind: "already_on_route";
      routeStop: RouteStop;
      routeStops: RouteStop[];
      outreachLogs: OutreachLog[];
    }
  | {
      kind: "existing_tentative_add_on";
      routeStop: RouteStop;
      routeStops: RouteStop[];
      outreachLogs: OutreachLog[];
    }
  | {
      kind: "added";
      routeStop: RouteStop;
      outreachLog: OutreachLog;
      routeStops: RouteStop[];
      outreachLogs: OutreachLog[];
    };

type RemoveRouteAddOnInput = {
  routeStops: RouteStop[];
  outreachLogs: OutreachLog[];
  routeStopId: string;
};

export type RemoveRouteAddOnResult =
  | {
      kind: "removed";
      removedStop: RouteStop;
      routeStops: RouteStop[];
      outreachLogs: OutreachLog[];
    }
  | {
      kind: "not_found";
      routeStops: RouteStop[];
      outreachLogs: OutreachLog[];
    };

function normalizeRouteOrder(routeStops: RouteStop[]) {
  return [...routeStops]
    .sort((a, b) => a.order - b.order)
    .map((stop, index) => ({ ...stop, order: index + 1 }));
}

function insertionOrder(routeStops: RouteStop[], afterStopId?: string) {
  const orderedStops = [...routeStops].sort((a, b) => a.order - b.order);
  if (orderedStops.length === 0) return 1;
  if (!afterStopId) return orderedStops[0].order - 0.5;

  const afterStop = orderedStops.find((stop) => stop.id === afterStopId);
  const finalStop = orderedStops.at(-1);
  return afterStop ? afterStop.order + 0.5 : (finalStop?.order ?? orderedStops.length) + 0.5;
}

export function routeAddOnStopForFacility(routeStops: RouteStop[], facilityId: string) {
  return routeStops.find(
    (stop) => stop.facilityId === facilityId && stop.status === "tentative" && stop.source === "today_add_on",
  );
}

export function addRouteAddOn(input: AddRouteAddOnInput): AddRouteAddOnResult {
  const existingStop = input.routeStops.find((stop) => stop.facilityId === input.facilityId);
  if (existingStop) {
    if (existingStop.status === "tentative" && existingStop.source === "today_add_on") {
      return {
        kind: "existing_tentative_add_on",
        routeStop: existingStop,
        routeStops: input.routeStops,
        outreachLogs: input.outreachLogs,
      };
    }

    return {
      kind: "already_on_route",
      routeStop: existingStop,
      routeStops: input.routeStops,
      outreachLogs: input.outreachLogs,
    };
  }

  const outreachLog: OutreachLog = {
    id: input.outreachLogId,
    facilityId: input.facilityId,
    createdAt: input.createdAt,
    method: "other",
    contactName: input.contactName,
    status: "added_to_route",
    notes: "Added tentatively to tomorrow's route.",
  };
  const routeStop: RouteStop = {
    id: input.routeStopId,
    facilityId: input.facilityId,
    order: insertionOrder(input.routeStops, input.snapshot.bestInsertionAfterStopId),
    status: "tentative",
    source: "today_add_on",
    addedFromLogId: outreachLog.id,
    routeImpact: {
      addedDriveMinutes: input.snapshot.addedDriveMinutes,
      bestInsertionLabel: input.snapshot.bestInsertionLabel,
      bestInsertionAfterStopId: input.snapshot.bestInsertionAfterStopId,
      nearestStopName: input.snapshot.nearestStopName,
      nearestStopDistanceMiles: input.snapshot.nearestStopDistanceMiles,
    },
    notes: "Tentative add-on. Confirm study time separately from added drive time.",
  };

  return {
    kind: "added",
    routeStop,
    outreachLog,
    routeStops: normalizeRouteOrder([...input.routeStops, routeStop]),
    outreachLogs: [outreachLog, ...input.outreachLogs],
  };
}

export function removeRouteAddOn(input: RemoveRouteAddOnInput): RemoveRouteAddOnResult {
  const removedStop = input.routeStops.find(
    (stop) => stop.id === input.routeStopId && stop.status === "tentative" && stop.source === "today_add_on",
  );

  if (!removedStop) {
    return {
      kind: "not_found",
      routeStops: input.routeStops,
      outreachLogs: input.outreachLogs,
    };
  }

  return {
    kind: "removed",
    removedStop,
    routeStops: normalizeRouteOrder(input.routeStops.filter((stop) => stop.id !== removedStop.id)),
    outreachLogs: removedStop.addedFromLogId
      ? input.outreachLogs.filter((log) => log.id !== removedStop.addedFromLogId)
      : input.outreachLogs,
  };
}
