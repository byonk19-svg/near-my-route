import {
  buildGoogleMapsDirectionsUrl,
  googleMapsWaypointWarning,
  orderedRouteFacilities,
  splitGoogleMapsDirectionsUrls,
} from "./googleMaps";
import { textReadiness } from "./outreachPriority";
import { unconfirmedRouteFacilities } from "./locationTrust";
import type { Facility, RouteLocation, RouteStop } from "./types";

export type RouteHandoff = {
  locations: RouteLocation[];
  facilityIds: Set<string>;
  unconfirmedLocations: RouteLocation[];
  mapsUrl?: string;
  mapsWarning?: string;
  splitMapsUrls: string[];
  sourceMapLink?: string;
  isMapsBlocked: boolean;
  locationWarning?: string;
  locationOutreachWarning?: string;
  needsLocationReview: boolean;
  readinessTitle: string;
  readinessSummary: string;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function routeLocationWarning(unconfirmedLocations: RouteLocation[]) {
  if (unconfirmedLocations.length === 0) return undefined;

  return `Route includes unconfirmed locations: ${unconfirmedLocations.map((facility) => facility.name).join(", ")}. Confirm location before trusting add-on ranking or Maps handoff.`;
}

function routeReadinessSummary(routeStopCount: number, unconfirmedLocationCount: number, textReadyFacilityCount: number) {
  const locationSummary =
    unconfirmedLocationCount > 0
      ? `${unconfirmedLocationCount} ${pluralize(unconfirmedLocationCount, "location")} need confirm`
      : "locations confirmed";

  return `${routeStopCount} ${pluralize(routeStopCount, "stop")} imported - ${locationSummary} - ${textReadyFacilityCount} text-ready ${pluralize(textReadyFacilityCount, "facility", "facilities")}`;
}

export function buildRouteHandoff(routeStops: RouteStop[], facilities: Facility[]): RouteHandoff {
  const orderedRouteStops = [...routeStops].sort((a, b) => a.order - b.order);
  const locations = orderedRouteFacilities(orderedRouteStops, facilities);
  const unconfirmedLocations = unconfirmedRouteFacilities(orderedRouteStops, facilities);
  const locationWarning = routeLocationWarning(unconfirmedLocations);
  const needsLocationReview = unconfirmedLocations.length > 0;
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  const textReadyFacilityCount = orderedRouteStops
    .map((stop) => facilityById.get(stop.facilityId))
    .filter((facility): facility is Facility => Boolean(facility && textReadiness(facility) === "ready")).length;

  return {
    locations,
    facilityIds: new Set(orderedRouteStops.map((stop) => stop.facilityId)),
    unconfirmedLocations,
    mapsUrl: buildGoogleMapsDirectionsUrl(locations),
    mapsWarning: googleMapsWaypointWarning(locations.length),
    splitMapsUrls: splitGoogleMapsDirectionsUrls(locations),
    sourceMapLink: orderedRouteStops.find((stop) => stop.sourceMapLink)?.sourceMapLink,
    isMapsBlocked: Boolean(locationWarning),
    locationWarning,
    locationOutreachWarning: needsLocationReview
      ? "Route includes unconfirmed locations. Review locations before trusting add-on ranking or Maps handoff."
      : undefined,
    needsLocationReview,
    readinessTitle: needsLocationReview ? "Tomorrow's route needs location review" : "Tomorrow's route ready",
    readinessSummary: routeReadinessSummary(orderedRouteStops.length, unconfirmedLocations.length, textReadyFacilityCount),
  };
}
