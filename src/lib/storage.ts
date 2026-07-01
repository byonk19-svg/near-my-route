import type { Facility, OutreachLog, RouteStop } from "./types";
import { initialFacilities } from "./mockData";
import { isFallbackLocation } from "./locationTrust";

export type NearMyRouteState = {
  version?: 1;
  facilities: Facility[];
  routeStops: RouteStop[];
  outreachLogs: OutreachLog[];
  dogfoodChecked?: Record<string, boolean>;
  dogfoodNotes?: string;
};

const STORAGE_KEY = "near-my-route-state-v1";
const demoFacilityIds = new Set(initialFacilities.map((facility) => facility.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function migrateFacility(facility: Facility): Facility {
  if (facility.locationStatus) return facility;

  if (demoFacilityIds.has(facility.id)) {
    return { ...facility, locationStatus: "confirmed", locationSource: facility.locationSource ?? "seed" };
  }

  if (isFallbackLocation(facility)) {
    return { ...facility, locationStatus: "needs_confirmation", locationSource: facility.locationSource ?? "fallback" };
  }

  return { ...facility, locationStatus: "needs_confirmation", locationSource: facility.locationSource ?? "import" };
}

export function migrateStoredState(parsed: unknown): NearMyRouteState | undefined {
  if (!isRecord(parsed)) return undefined;

  const facilities = Array.isArray(parsed.facilities) ? (parsed.facilities as Facility[]).map(migrateFacility) : initialFacilities;
  const routeStops = Array.isArray(parsed.routeStops)
    ? (parsed.routeStops as RouteStop[]).map((stop) => ({
        ...stop,
        source: stop.source ?? "scheduled",
      }))
    : [];
  const outreachLogs = Array.isArray(parsed.outreachLogs) ? (parsed.outreachLogs as OutreachLog[]) : [];
  const dogfoodChecked = isRecord(parsed.dogfoodChecked) ? (parsed.dogfoodChecked as Record<string, boolean>) : undefined;
  const dogfoodNotes = typeof parsed.dogfoodNotes === "string" ? parsed.dogfoodNotes : undefined;

  return {
    version: 1,
    facilities,
    routeStops,
    outreachLogs,
    dogfoodChecked,
    dogfoodNotes,
  };
}

export function loadStoredState(): NearMyRouteState | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return migrateStoredState(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function saveStoredState(state: NearMyRouteState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 1 }));
}

export function clearStoredState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
