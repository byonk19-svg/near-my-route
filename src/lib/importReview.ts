import { appendFacilityAlias } from "./facilityAliases";
import { FALLBACK_LOCATION_COORDINATES } from "./locationTrust";
import { importRowBlockingReason, parseScheduleText } from "./scheduleImport";
import type { Facility, ImportReviewRow, RouteLocation, RouteStop, VanPacketSummary } from "./types";
import { parseVanPacketText } from "./vanPacketImport";

export type ImportReviewMode = "schedule" | "van_packet";

export type ImportReviewIdPurpose =
  | "row"
  | "facility"
  | "private-route-stop"
  | "route-stop";

export type ImportReviewIdSource = (purpose: ImportReviewIdPurpose) => string;

export type ImportReviewDraft = {
  mode: ImportReviewMode;
  rows: ImportReviewRow[];
  source:
    | { kind: "schedule" }
    | {
        kind: "van_packet";
        summary: VanPacketSummary;
      };
};

export type ImportReviewSummary = {
  useExisting: number;
  createNew: number;
  privateRouteStop: number;
  skipped: number;
  unresolved: number;
  confirmed: number;
};

export type ImportReviewModel = {
  draft: ImportReviewDraft;
  rows: ImportReviewRow[];
  visibleRows: ImportReviewRow[];
  routeAnchorRows: ImportReviewRow[];
  summary: ImportReviewSummary;
  issuesByRowId: Record<string, string>;
  blockingRows: ImportReviewRow[];
  canConfirm: boolean;
  confirmationLabelData: {
    unresolved: number;
    confirmed: number;
  };
};

export type ParseImportReviewInput =
  | {
      mode: "schedule";
      text: string;
      facilities: Facility[];
      nextId?: ImportReviewIdSource;
    }
  | {
      mode: "van_packet";
      text: string;
      supplementalText?: string;
      facilities: Facility[];
      nextId?: ImportReviewIdSource;
    };

export type ImportReviewConfirmation =
  | {
      ok: false;
      summary: ImportReviewSummary;
      issuesByRowId: Record<string, string>;
    }
  | {
      ok: true;
      facilities: Facility[];
      routeStops: RouteStop[];
      locationReviewTargets: RouteLocation[];
      sourceMapLink?: string;
      initialFacilityId?: string;
    };

function rowIdSource(nextId?: ImportReviewIdSource) {
  return nextId ? () => nextId("row") : undefined;
}

export function parseImportReview(input: ParseImportReviewInput): ImportReviewDraft {
  if (input.mode === "van_packet") {
    const result = parseVanPacketText(input.text, input.facilities, {
      supplementalText: input.supplementalText,
      nextId: rowIdSource(input.nextId),
    });
    return {
      mode: "van_packet",
      rows: result.rows,
      source: {
        kind: "van_packet",
        summary: result.summary,
      },
    };
  }

  return {
    mode: "schedule",
    rows: parseScheduleText(input.text, input.facilities, { nextId: rowIdSource(input.nextId) }),
    source: { kind: "schedule" },
  };
}

function normalizeImportReviewRow(row: ImportReviewRow): ImportReviewRow {
  if (row.action === "private_route_stop") {
    const { matchedFacilityId, rememberAlias, aliasCandidate, ...rest } = row;
    void matchedFacilityId;
    void rememberAlias;
    void aliasCandidate;
    return rest;
  }

  if (row.action === "create_new") {
    const { matchedFacilityId, rememberAlias, ...rest } = row;
    void matchedFacilityId;
    void rememberAlias;
    return rest;
  }

  if (row.action === "skip" || row.action === "needs_review") {
    const { rememberAlias, ...rest } = row;
    void rememberAlias;
    return rest;
  }

  if (!row.matchedFacilityId || !row.aliasCandidate) {
    const { rememberAlias, ...rest } = row;
    void rememberAlias;
    return rest;
  }

  return row;
}

export function updateImportReviewRow(
  draft: ImportReviewDraft,
  rowId: string,
  patch: Partial<ImportReviewRow>,
): ImportReviewDraft {
  return {
    ...draft,
    rows: draft.rows.map((row) =>
      row.id === rowId ? normalizeImportReviewRow({ ...row, ...patch }) : row,
    ),
  };
}

function issuesByRowId(rows: ImportReviewRow[]) {
  return rows.reduce<Record<string, string>>((issues, row) => {
    const issue = importRowBlockingReason(row);
    if (issue) issues[row.id] = issue;
    return issues;
  }, {});
}

function importReviewSummary(rows: ImportReviewRow[], issues: Record<string, string>): ImportReviewSummary {
  return {
    useExisting: rows.filter((row) => row.action === "use_existing").length,
    createNew: rows.filter((row) => row.action === "create_new").length,
    privateRouteStop: rows.filter((row) => row.action === "private_route_stop").length,
    skipped: rows.filter((row) => row.action === "skip").length,
    unresolved: Object.keys(issues).length,
    confirmed: rows.filter((row) => row.action !== "skip" && !issues[row.id]).length,
  };
}

export function importReviewModel(draft: ImportReviewDraft): ImportReviewModel {
  const issues = issuesByRowId(draft.rows);
  const summary = importReviewSummary(draft.rows, issues);
  const blockingRows = draft.rows.filter((row) => Boolean(issues[row.id]));
  const visibleRows =
    draft.mode === "van_packet"
      ? draft.rows.filter((row) => row.routeOnlyReason !== "route_anchor")
      : draft.rows;

  return {
    draft,
    rows: draft.rows,
    visibleRows,
    routeAnchorRows: draft.rows.filter((row) => row.routeOnlyReason === "route_anchor"),
    summary,
    issuesByRowId: issues,
    blockingRows,
    canConfirm: draft.rows.length > 0 && summary.confirmed > 0 && summary.unresolved === 0,
    confirmationLabelData: {
      unresolved: summary.unresolved,
      confirmed: summary.confirmed,
    },
  };
}

function newFacilityFromRow(row: ImportReviewRow, facilityId: string): Facility {
  return {
    id: facilityId,
    name: row.facilityName,
    address: row.address || "Address needs review",
    city: "Imported",
    lat: FALLBACK_LOCATION_COORDINATES.lat,
    lng: FALLBACK_LOCATION_COORDINATES.lng,
    locationStatus: "needs_confirmation",
    locationSource: "import",
    facilityType: "Other",
    contacts: [],
    sameDayFriendly: "unknown",
    typicalVolume: "unknown",
    notes: "Imported from pasted schedule. Confirm location before route ranking.",
  };
}

function privateLocationFromRow(row: ImportReviewRow, id: string): RouteLocation {
  return {
    id,
    name: row.facilityName,
    address: row.address,
    lat: FALLBACK_LOCATION_COORDINATES.lat,
    lng: FALLBACK_LOCATION_COORDINATES.lng,
    locationStatus: "needs_confirmation",
    locationSource: "import",
    privateRouteStop: true,
  };
}

export function confirmImportReview(
  draft: ImportReviewDraft,
  facilities: Facility[],
  options: { nextId: ImportReviewIdSource },
): ImportReviewConfirmation {
  const model = importReviewModel(draft);
  if (!model.canConfirm) {
    return {
      ok: false,
      summary: model.summary,
      issuesByRowId: model.issuesByRowId,
    };
  }

  let nextFacilities = [...facilities];
  const routeStops: RouteStop[] = [];
  const locationReviewTargets: RouteLocation[] = [];

  draft.rows
    .filter((row) => row.action !== "skip")
    .forEach((row) => {
      let facilityId = row.matchedFacilityId;
      let privateLocation: RouteLocation | undefined;

      if (row.action === "create_new") {
        facilityId = options.nextId("facility");
        const facility = newFacilityFromRow(row, facilityId);
        nextFacilities = [...nextFacilities, facility];
        locationReviewTargets.push({
          id: facility.id,
          name: facility.name,
          address: facility.address,
          lat: facility.lat,
          lng: facility.lng,
          locationStatus: facility.locationStatus,
          locationSource: facility.locationSource,
        });
      }

      if (row.action === "private_route_stop") {
        facilityId = options.nextId("private-route-stop");
        privateLocation = privateLocationFromRow(row, facilityId);
        locationReviewTargets.push(privateLocation);
      }

      if (!facilityId) return;

      if (row.action === "use_existing" && row.rememberAlias && row.aliasCandidate) {
        nextFacilities = appendFacilityAlias(nextFacilities, facilityId, row.aliasCandidate);
      }

      routeStops.push({
        id: options.nextId("route-stop"),
        facilityId,
        privateLocation,
        order: routeStops.length + 1,
        appointmentTime: row.appointmentTime,
        studyCount: row.studyCount,
        status: "planned",
        source: row.action === "private_route_stop" ? "private_route_stop" : "scheduled",
        sourceMapLink: row.sourceMapLink,
      });
    });

  return {
    ok: true,
    facilities: nextFacilities,
    routeStops,
    locationReviewTargets,
    sourceMapLink: routeStops.find((stop) => stop.sourceMapLink)?.sourceMapLink,
    initialFacilityId: routeStops[0]?.facilityId,
  };
}
