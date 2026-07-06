import { locationConfirmationIssue } from "./locationTrust";
import type { Facility, RouteStop } from "./types";

export type LocationConfirmationPatch = {
  address: string;
  lat: number;
  lng: number;
};

type ConfirmLocationReviewInput = {
  facilities: Facility[];
  routeStops: RouteStop[];
  locationId: string;
  patch: LocationConfirmationPatch;
};

export type ConfirmLocationReviewResult =
  | {
      ok: true;
      facilities: Facility[];
      routeStops: RouteStop[];
      confirmedFacilityId?: string;
    }
  | {
      ok: false;
      issue: string;
      facilities: Facility[];
      routeStops: RouteStop[];
    };

export function confirmLocationReview(input: ConfirmLocationReviewInput): ConfirmLocationReviewResult {
  const issue = locationConfirmationIssue(input.patch);
  if (issue) {
    return {
      ok: false,
      issue,
      facilities: input.facilities,
      routeStops: input.routeStops,
    };
  }

  const facilityExists = input.facilities.some((facility) => facility.id === input.locationId);
  const privateStopExists = input.routeStops.some((stop) => stop.privateLocation?.id === input.locationId);

  if (!facilityExists && !privateStopExists) {
    return {
      ok: false,
      issue: "Location not found.",
      facilities: input.facilities,
      routeStops: input.routeStops,
    };
  }

  return {
    ok: true,
    confirmedFacilityId: facilityExists ? input.locationId : undefined,
    facilities: input.facilities.map((facility) =>
      facility.id === input.locationId
        ? {
            ...facility,
            address: input.patch.address,
            lat: input.patch.lat,
            lng: input.patch.lng,
            locationStatus: "confirmed",
            locationSource: facility.locationSource === "import" ? "import" : "geocoded",
          }
        : facility,
    ),
    routeStops: input.routeStops.map((stop) =>
      stop.privateLocation?.id === input.locationId
        ? {
            ...stop,
            privateLocation: {
              ...stop.privateLocation,
              address: input.patch.address,
              lat: input.patch.lat,
              lng: input.patch.lng,
              locationStatus: "confirmed",
              locationSource: "import",
            },
          }
        : stop,
    ),
  };
}
