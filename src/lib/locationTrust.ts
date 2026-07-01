import type { Facility, RouteStop } from "./types";

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

export function unconfirmedRouteFacilities(routeStops: RouteStop[], facilities: Facility[]) {
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  return routeStops
    .map((stop) => facilityById.get(stop.facilityId))
    .filter((facility): facility is Facility => Boolean(facility && !hasConfirmedLocation(facility)));
}

export function routeHasUnconfirmedLocations(routeStops: RouteStop[], facilities: Facility[]) {
  return unconfirmedRouteFacilities(routeStops, facilities).length > 0;
}
