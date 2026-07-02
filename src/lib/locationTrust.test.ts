import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_LOCATION_COORDINATES, locationConfirmationIssue } from "./locationTrust";

test("locationConfirmationIssue accepts confirmed real coordinates", () => {
  assert.equal(
    locationConfirmationIssue({
      address: "12620 Memorial Dr, Houston, TX",
      lat: 29.7728,
      lng: -95.5585,
    }),
    undefined,
  );
});

test("locationConfirmationIssue blocks blank address, invalid coordinates, and fallback coordinates", () => {
  assert.equal(
    locationConfirmationIssue({
      address: "",
      lat: 29.7728,
      lng: -95.5585,
    }),
    "Add a full address before confirming this location.",
  );
  assert.equal(
    locationConfirmationIssue({
      address: "100 New Rd, Houston, TX",
      lat: 120,
      lng: -95.5585,
    }),
    "Enter a valid latitude before confirming this location.",
  );
  assert.equal(
    locationConfirmationIssue({
      address: "100 New Rd, Houston, TX",
      lat: 29.7728,
      lng: -220,
    }),
    "Enter a valid longitude before confirming this location.",
  );
  assert.equal(
    locationConfirmationIssue({
      address: "100 New Rd, Houston, TX",
      lat: FALLBACK_LOCATION_COORDINATES.lat,
      lng: FALLBACK_LOCATION_COORDINATES.lng,
    }),
    "Edit the fallback coordinates before confirming this location.",
  );
});
