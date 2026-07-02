import type { Facility, RouteLocation, RouteStop } from "./types";
import { orderedRouteLocations, routeStopLocation } from "./routeLocations";

const GOOGLE_MAPS_DIRECTIONS_URL = "https://www.google.com/maps/dir/";
const MOBILE_WAYPOINT_LIMIT = 3;
const STANDARD_WAYPOINT_LIMIT = 9;
const SPLIT_LEG_STOP_LIMIT = MOBILE_WAYPOINT_LIMIT + 2;

export type GoogleMapsCoordinateSource = "place" | "mapCenter" | "query";

export type ParsedGoogleMapsCoordinates = {
  lat: number;
  lng: number;
  source: GoogleMapsCoordinateSource;
};

const DECIMAL_COORDINATE = String.raw`-?\d+(?:\.\d+)?`;
const PLACE_COORDINATES_PATTERN = new RegExp(`!3d(${DECIMAL_COORDINATE})!4d(${DECIMAL_COORDINATE})`, "i");
const MAP_CENTER_COORDINATES_PATTERN = new RegExp(`@(${DECIMAL_COORDINATE}),(${DECIMAL_COORDINATE})(?:[,/?#]|$)`, "i");
const QUERY_COORDINATES_PATTERN = new RegExp(`^\\s*(${DECIMAL_COORDINATE})\\s*,\\s*(${DECIMAL_COORDINATE})\\s*$`);

function hasValidCoordinates(facility: RouteLocation) {
  return (
    Number.isFinite(facility.lat) &&
    Number.isFinite(facility.lng) &&
    Math.abs(facility.lat) <= 90 &&
    Math.abs(facility.lng) <= 180
  );
}

function isValidCoordinatePair(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parsedCoordinatePair(latValue: string, lngValue: string, source: GoogleMapsCoordinateSource) {
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!isValidCoordinatePair(lat, lng)) return undefined;
  return { lat, lng, source };
}

function decodedUrlText(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseGoogleMapsCoordinates(value: string): ParsedGoogleMapsCoordinates | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const decoded = decodedUrlText(trimmed);
  const placeCoordinates = PLACE_COORDINATES_PATTERN.exec(decoded);
  if (placeCoordinates) {
    return parsedCoordinatePair(placeCoordinates[1], placeCoordinates[2], "place");
  }

  const mapCenterCoordinates = MAP_CENTER_COORDINATES_PATTERN.exec(decoded);
  if (mapCenterCoordinates) {
    return parsedCoordinatePair(mapCenterCoordinates[1], mapCenterCoordinates[2], "mapCenter");
  }

  try {
    const url = new URL(trimmed);
    const query = url.searchParams.get("q");
    if (!query) return undefined;
    const queryCoordinates = QUERY_COORDINATES_PATTERN.exec(query);
    if (!queryCoordinates) return undefined;
    return parsedCoordinatePair(queryCoordinates[1], queryCoordinates[2], "query");
  } catch {
    const queryCoordinates = QUERY_COORDINATES_PATTERN.exec(trimmed);
    if (!queryCoordinates) return undefined;
    return parsedCoordinatePair(queryCoordinates[1], queryCoordinates[2], "query");
  }
}

function googleMapsPlaceQuery(facility: RouteLocation) {
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

export function buildGoogleMapsDirectionsUrl(routeFacilities: RouteLocation[]) {
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

export function splitGoogleMapsDirectionsUrls(routeFacilities: RouteLocation[]) {
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
  return orderedRouteLocations(routeStops, facilities);
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
    .map((stop) => routeStopLocation(stop, facilityById))
    .filter((facility): facility is RouteLocation => Boolean(facility));

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
