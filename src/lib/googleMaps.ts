import type { Facility, RouteStop } from "./types";

const GOOGLE_MAPS_DIRECTIONS_URL = "https://www.google.com/maps/dir/";
const MOBILE_WAYPOINT_LIMIT = 3;
const STANDARD_WAYPOINT_LIMIT = 9;
const SPLIT_LEG_STOP_LIMIT = MOBILE_WAYPOINT_LIMIT + 2;

function hasValidCoordinates(facility: Facility) {
  return (
    Number.isFinite(facility.lat) &&
    Number.isFinite(facility.lng) &&
    Math.abs(facility.lat) <= 90 &&
    Math.abs(facility.lng) <= 180
  );
}

function googleMapsPlaceQuery(facility: Facility) {
  if (hasValidCoordinates(facility)) return `${facility.lat},${facility.lng}`;
  return [facility.name, facility.address].filter(Boolean).join(", ");
}

export function googleMapsWaypointWarning(stopCount: number) {
  const waypointCount = Math.max(0, stopCount - 2);

  if (waypointCount > STANDARD_WAYPOINT_LIMIT) {
    return `Google Maps URLs can hand off ${STANDARD_WAYPOINT_LIMIT} waypoints. This link includes the first ${STANDARD_WAYPOINT_LIMIT}; split the route before navigating.`;
  }

  if (waypointCount > MOBILE_WAYPOINT_LIMIT) {
    return `Google Maps mobile browsers may only support ${MOBILE_WAYPOINT_LIMIT} waypoints. Review the route after it opens.`;
  }

  return undefined;
}

export function buildGoogleMapsDirectionsUrl(routeFacilities: Facility[]) {
  if (routeFacilities.length < 2) return undefined;

  const origin = routeFacilities[0];
  const destination = routeFacilities[routeFacilities.length - 1];
  const waypoints = routeFacilities.slice(1, -1).slice(0, STANDARD_WAYPOINT_LIMIT);
  const params = new URLSearchParams({
    api: "1",
    origin: googleMapsPlaceQuery(origin),
    destination: googleMapsPlaceQuery(destination),
    travelmode: "driving",
  });

  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(googleMapsPlaceQuery).join("|"));
  }

  return `${GOOGLE_MAPS_DIRECTIONS_URL}?${params.toString()}`;
}

export function splitGoogleMapsDirectionsUrls(routeFacilities: Facility[]) {
  if (routeFacilities.length <= SPLIT_LEG_STOP_LIMIT) return [];

  const legs: string[] = [];
  let startIndex = 0;

  while (startIndex < routeFacilities.length - 1) {
    const endIndex = Math.min(startIndex + SPLIT_LEG_STOP_LIMIT - 1, routeFacilities.length - 1);
    const legUrl = buildGoogleMapsDirectionsUrl(routeFacilities.slice(startIndex, endIndex + 1));
    if (legUrl) legs.push(legUrl);
    startIndex = endIndex;
  }

  return legs;
}

export function orderedRouteFacilities(routeStops: RouteStop[], facilities: Facility[]) {
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  return [...routeStops]
    .sort((a, b) => a.order - b.order)
    .map((stop) => facilityById.get(stop.facilityId))
    .filter((facility): facility is Facility => Boolean(facility));
}

export function routeFacilitiesWithInsertedAddOn(
  routeStops: RouteStop[],
  facilities: Facility[],
  addOnFacility: Facility,
  afterStopId?: string,
) {
  const orderedStops = [...routeStops].sort((a, b) => a.order - b.order);
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  const routeFacilities = orderedStops
    .map((stop) => facilityById.get(stop.facilityId))
    .filter((facility): facility is Facility => Boolean(facility));

  if (routeFacilities.some((facility) => facility.id === addOnFacility.id)) return routeFacilities;
  if (routeFacilities.length === 0) return [addOnFacility];
  if (!afterStopId) return [addOnFacility, ...routeFacilities];

  const afterIndex = orderedStops.findIndex((stop) => stop.id === afterStopId);
  if (afterIndex < 0) return [...routeFacilities, addOnFacility];

  return [
    ...routeFacilities.slice(0, afterIndex + 1),
    addOnFacility,
    ...routeFacilities.slice(afterIndex + 1),
  ];
}
