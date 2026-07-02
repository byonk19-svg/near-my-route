import type { Facility, RouteLocation, RouteStop } from "./types";
import { routeStopLocation } from "./routeLocations";

export const FALLBACK_LOCATION_COORDINATES = {
  lat: 29.7604,
  lng: -95.3698,
};

const COORDINATE_TOLERANCE = 0.000001;

export function isFallbackLocation(facility: Pick<Facility, "lat" | "lng">) {
  return (
    Math.abs(facility.lat - FALLBACK_LOCATION_COORDINATES.lat) < COORDINATE_TOLERANCE &&
    Math.abs(facility.lng - FALLBACK_LOCATION_COORDINATES.lng) < COORDINATE_TOLERANCE
  );
}

export function hasConfirmedLocation(facility?: Pick<Facility, "locationStatus">) {
  return facility?.locationStatus === "confirmed";
}

export function locationConfirmationIssue(location: Pick<Facility, "address" | "lat" | "lng">) {
  if (!location.address.trim()) return "Add a full address before confirming this location.";
  if (!Number.isFinite(location.lat) || location.lat < -90 || location.lat > 90) {
    return "Enter a valid latitude before confirming this location.";
  }
  if (!Number.isFinite(location.lng) || location.lng < -180 || location.lng > 180) {
    return "Enter a valid longitude before confirming this location.";
  }
  if (isFallbackLocation(location)) return "Edit the fallback coordinates before confirming this location.";
  return undefined;
}

export function unconfirmedRouteFacilities(routeStops: RouteStop[], facilities: Facility[]): RouteLocation[] {
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  return routeStops
    .map((stop) => routeStopLocation(stop, facilityById))
    .filter((location): location is RouteLocation => Boolean(location && !hasConfirmedLocation(location)));
}

export function routeHasUnconfirmedLocations(routeStops: RouteStop[], facilities: Facility[]) {
  return unconfirmedRouteFacilities(routeStops, facilities).length > 0;
}
