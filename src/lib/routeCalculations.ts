import type { Facility, Opportunity, OpportunityOptions, RouteStop } from "./types";
import { hasConfirmedLocation } from "./locationTrust";

const EARTH_RADIUS_MILES = 3958.8;
const URBAN_ROAD_FACTOR = 1.7;

type Point = Pick<Facility, "lat" | "lng">;

export function haversineMiles(a: Point, b: Point): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export function distanceToDriveMinutes(miles: number, averageSpeedMph: number): number {
  return Math.max(3, Math.round(((miles * URBAN_ROAD_FACTOR) / averageSpeedMph) * 60));
}

export function daysSince(dateString?: string, now = new Date()) {
  if (!dateString) return Number.POSITIVE_INFINITY;
  const date = new Date(`${dateString}T12:00:00`);
  const comparisonDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.floor((comparisonDate.getTime() - date.getTime()) / 86_400_000);
}

function groupForMinutes(minutes: number): Opportunity["group"] {
  if (minutes <= 5) return "Best Add-ons";
  if (minutes <= 10) return "Good Options";
  if (minutes <= 15) return "Maybe Later";
  return "Not Worth It Today";
}

function primaryContact(facility: Facility) {
  return facility.contacts.find((contact) => contact.primary) ?? facility.contacts[0];
}

function buildReasonBadges(
  facility: Facility,
  addedDriveMinutes: number,
  maxDetourMinutes: number,
) {
  const badges = [`+${addedDriveMinutes} min`];

  if (facility.contacts.length > 0) badges.push("Strong contact");
  if (facility.sameDayFriendly === "yes") badges.push("Same-day friendly");
  if (facility.sameDayFriendly === "sometimes") badges.push("Sometimes same-day");
  if (facility.typicalVolume === "high") badges.push("High volume");
  if (daysSince(facility.lastContacted) >= 14) badges.push("Not contacted recently");
  if (facility.groupTag && addedDriveMinutes > 15) badges.push("Same network, poor fit today");
  if (facility.doNotContact) badges.push("Do not contact");
  if (addedDriveMinutes > maxDetourMinutes) badges.push("Outside detour filter");

  return badges;
}

function scoreOpportunity(
  facility: Facility,
  addedDriveMinutes: number,
  maxDetourMinutes: number,
) {
  let score = 100 - addedDriveMinutes * 4;

  if (addedDriveMinutes <= maxDetourMinutes) score += 12;
  if (facility.sameDayFriendly === "yes") score += 18;
  if (facility.sameDayFriendly === "sometimes") score += 7;
  if (primaryContact(facility)) score += 15;
  if (daysSince(facility.lastContacted) >= 14) score += 12;
  if (facility.typicalVolume === "high") score += 15;
  if (facility.typicalVolume === "medium") score += 7;
  if (facility.doNotContact) score -= 80;

  return score;
}

export function calculateRouteOpportunities(
  routeStops: RouteStop[],
  facilities: Facility[],
  options: OpportunityOptions,
): Opportunity[] {
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  const orderedStops = [...routeStops].sort((a, b) => a.order - b.order);
  const routeFacilities = orderedStops
    .map((stop) => facilityById.get(stop.facilityId))
    .filter((facility): facility is Facility => Boolean(facility));
  const routeFacilityIds = new Set(orderedStops.map((stop) => stop.facilityId));

  if (routeFacilities.length === 0 || routeFacilities.some((facility) => !hasConfirmedLocation(facility))) return [];

  return facilities
    .filter((facility) => !routeFacilityIds.has(facility.id))
    .filter((facility) => hasConfirmedLocation(facility))
    .filter((facility) => !options.knownContactsOnly || facility.contacts.length > 0)
    .filter(
      (facility) =>
        !options.sameDayFriendlyOnly ||
        facility.sameDayFriendly === "yes" ||
        facility.sameDayFriendly === "sometimes",
    )
    .filter(
      (facility) =>
        !options.excludeRecentlyContactedDays ||
        daysSince(facility.lastContacted) >= options.excludeRecentlyContactedDays,
    )
    .map((facility) => {
      const nearest = routeFacilities.reduce(
        (best, stopFacility) => {
          const miles = haversineMiles(facility, stopFacility);
          return miles < best.distance ? { facility: stopFacility, distance: miles } : best;
        },
        { facility: routeFacilities[0], distance: Number.POSITIVE_INFINITY },
      );

      const insertionCandidates = orderedStops.flatMap((stop, index) => {
        const current = facilityById.get(stop.facilityId);
        if (!current) return [];

        if (index === 0 && orderedStops.length === 1) {
          return [
            {
              label: "Before Stop #1",
              afterStopId: undefined,
              addedDistance: haversineMiles(facility, current),
            },
            {
              label: "After Stop #1",
              afterStopId: stop.id,
              addedDistance: haversineMiles(current, facility),
            },
          ];
        }

        const candidates = [];
        if (index === 0) {
          candidates.push({
            label: "Before Stop #1",
            afterStopId: undefined,
            addedDistance: haversineMiles(facility, current),
          });
        }

        const nextStop = orderedStops[index + 1];
        const nextFacility = nextStop ? facilityById.get(nextStop.facilityId) : undefined;

        if (nextFacility) {
          candidates.push({
            label: `Best between Stop #${stop.order} and Stop #${nextStop.order}`,
            afterStopId: stop.id,
            addedDistance:
              haversineMiles(current, facility) +
              haversineMiles(facility, nextFacility) -
              haversineMiles(current, nextFacility),
          });
        } else {
          candidates.push({
            label: `Best after Stop #${stop.order}`,
            afterStopId: stop.id,
            addedDistance: haversineMiles(current, facility),
          });
        }

        return candidates;
      });

      const bestInsertion = insertionCandidates.reduce((best, candidate) =>
        candidate.addedDistance < best.addedDistance ? candidate : best,
      );
      const addedDriveMinutes = distanceToDriveMinutes(
        bestInsertion.addedDistance,
        options.averageSpeedMph,
      );

      return {
        facility,
        addedDriveMinutes,
        addedDistanceMiles: Number(bestInsertion.addedDistance.toFixed(1)),
        nearestStopId: nearest.facility?.id,
        nearestStopName: nearest.facility?.name,
        nearestStopDistanceMiles: Number(nearest.distance.toFixed(1)),
        bestInsertionAfterStopId: bestInsertion.afterStopId,
        bestInsertionLabel: bestInsertion.label,
        reasonBadges: buildReasonBadges(facility, addedDriveMinutes, options.maxDetourMinutes),
        score: scoreOpportunity(facility, addedDriveMinutes, options.maxDetourMinutes),
        group: groupForMinutes(addedDriveMinutes),
      };
    })
    .sort((a, b) => b.score - a.score || a.addedDriveMinutes - b.addedDriveMinutes || a.facility.name.localeCompare(b.facility.name));
}

export function routeLineFacilities(routeStops: RouteStop[], facilities: Facility[]) {
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  return [...routeStops]
    .sort((a, b) => a.order - b.order)
    .map((stop) => facilityById.get(stop.facilityId))
    .filter((facility): facility is Facility => Boolean(facility));
}
