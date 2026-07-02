import assert from "node:assert/strict";
import test from "node:test";
import { parseGoogleMapsCoordinates } from "./googleMaps";

test("parseGoogleMapsCoordinates reads exact Google Maps place coordinates", () => {
  assert.deepEqual(
    parseGoogleMapsCoordinates("https://www.google.com/maps/place/Test/@29.7,-95.5,17z/data=!3m1!4b1!4m6!3d29.7665596!4d-95.7785803"),
    {
      lat: 29.7665596,
      lng: -95.7785803,
      source: "place",
    },
  );
});

test("parseGoogleMapsCoordinates reads visible map center coordinates", () => {
  assert.deepEqual(parseGoogleMapsCoordinates("https://www.google.com/maps/place/Test/@29.7066,-95.5492,17z"), {
    lat: 29.7066,
    lng: -95.5492,
    source: "mapCenter",
  });
});

test("parseGoogleMapsCoordinates reads simple q coordinate searches", () => {
  assert.deepEqual(parseGoogleMapsCoordinates("https://www.google.com/maps/search/?api=1&q=29.71,-95.55"), {
    lat: 29.71,
    lng: -95.55,
    source: "query",
  });
});

test("parseGoogleMapsCoordinates ignores invalid, missing, and out-of-range coordinates", () => {
  assert.equal(parseGoogleMapsCoordinates("not a maps url"), undefined);
  assert.equal(parseGoogleMapsCoordinates("https://www.google.com/maps/place/Test"), undefined);
  assert.equal(parseGoogleMapsCoordinates("https://www.google.com/maps/place/Test/@120,-95.5,17z"), undefined);
  assert.equal(parseGoogleMapsCoordinates("https://www.google.com/maps/search/?api=1&q=29.71,-195.55"), undefined);
});

test("parseGoogleMapsCoordinates prefers exact place coordinates over visible map center coordinates", () => {
  assert.deepEqual(
    parseGoogleMapsCoordinates("https://www.google.com/maps/place/Test/@29.1,-95.1,17z/data=!3d29.2!4d-95.2"),
    {
      lat: 29.2,
      lng: -95.2,
      source: "place",
    },
  );
});
