import assert from "node:assert/strict";
import test from "node:test";
import { buildSmsUrl, canAttemptSms, OUTREACH_MESSAGE, phoneContacts, safeMessage } from "./format";
import { initialFacilities } from "./mockData";

test("safeMessage returns the approved PHI-safe outreach template", () => {
  assert.equal(
    safeMessage(),
    "Hi! It's Elaine, SLP with Professional Imaging. We'll be doing MBSSs in your area this morning. Do you have anyone appropriate you'd like us to consider adding today?",
  );
  assert.equal(safeMessage(), OUTREACH_MESSAGE);
});

test("phoneContacts returns phone-capable contacts with the primary contact first", () => {
  const facility = initialFacilities.find((item) => item.id === "park-manor-westchase");
  assert.ok(facility);

  assert.deepEqual(
    phoneContacts(facility).map((contact) => contact.id),
    ["c-westchase-maria", "c-westchase-ken"],
  );
});

test("buildSmsUrl normalizes phone numbers and encodes the message body", () => {
  const url = buildSmsUrl("(555) 014-4", safeMessage());

  assert.equal(url.startsWith("sms:5550144?&body="), true);
  assert.equal(url.includes("Professional%20Imaging"), true);
  assert.equal(url.includes(" "), false);
});

test("canAttemptSms only enables the Messages handoff for mobile user agents", () => {
  assert.equal(canAttemptSms("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)"), true);
  assert.equal(canAttemptSms("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile"), true);
  assert.equal(canAttemptSms("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"), false);
});
