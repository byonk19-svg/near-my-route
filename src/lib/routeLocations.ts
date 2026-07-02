import type { Facility, RouteLocation, RouteStop } from "./types";

export function routeStopLocation(stop: RouteStop, facilityById: Map<string, Facility>): RouteLocation | undefined {
  if (stop.privateLocation) return stop.privateLocation;
  const facility = facilityById.get(stop.facilityId);
  if (!facility) return undefined;

  return {
    id: facility.id,
    name: facility.name,
    address: facility.address,
    lat: facility.lat,
    lng: facility.lng,
    locationStatus: facility.locationStatus,
    locationSource: facility.locationSource,
  };
}

export function orderedRouteLocations(routeStops: RouteStop[], facilities: Facility[]) {
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  return [...routeStops]
    .sort((a, b) => a.order - b.order)
    .map((stop) => routeStopLocation(stop, facilityById))
    .filter((location): location is RouteLocation => Boolean(location));
}
