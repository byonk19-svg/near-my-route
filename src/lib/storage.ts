import type { Facility, OutreachLog, RouteStop } from "./types";

export type NearMyRouteState = {
  facilities: Facility[];
  routeStops: RouteStop[];
  outreachLogs: OutreachLog[];
};

const STORAGE_KEY = "near-my-route-state-v1";

export function loadStoredState(): NearMyRouteState | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NearMyRouteState) : undefined;
  } catch {
    return undefined;
  }
}

export function saveStoredState(state: NearMyRouteState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearStoredState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
