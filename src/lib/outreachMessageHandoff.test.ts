import assert from "node:assert/strict";
import test from "node:test";
import { buildSmsUrl, safeMessage } from "./format";
import {
  markTextedEligibility,
  planOutreachMessageHandoff,
  planOutreachMessageHandoffForContact,
  selectableTextContacts,
} from "./outreachMessageHandoff";
import type { Facility } from "./types";

function facility(contacts: Facility["contacts"]): Facility {
  return {
    id: "facility-1",
    name: "Test Facility",
    address: "100 Test Dr, Houston, TX",
    lat: 29.7,
    lng: -95.5,
    contacts,
  };
}

test("planOutreachMessageHandoff reports no phone when no text-preferred SLP Contact has a phone", () => {
  const result = planOutreachMessageHandoff(
    facility([{ id: "call-only", name: "Amy", phone: "713-867-5309", preferredMethod: "call", primary: true }]),
    { canAttemptSms: false },
  );

  assert.deepEqual(result, {
    kind: "no_phone",
    feedback: "no_phone",
  });
});

test("planOutreachMessageHandoff blocks placeholder and invalid phones before browser handoff", () => {
  const placeholder = planOutreachMessageHandoff(
    facility([{ id: "primary", name: "Lisa", phone: "555-0188", preferredMethod: "text", primary: true }]),
    { canAttemptSms: true },
  );
  const invalid = planOutreachMessageHandoff(
    facility([{ id: "primary", name: "Lisa", phone: "abc", preferredMethod: "text", primary: true }]),
    { canAttemptSms: true },
  );

  assert.deepEqual(placeholder, {
    kind: "blocked_contact",
    contactId: "primary",
    feedback: "placeholder_phone",
  });
  assert.deepEqual(invalid, {
    kind: "blocked_contact",
    contactId: "primary",
    feedback: "invalid_phone",
  });
});

test("planOutreachMessageHandoff chooses one ready Primary SLP Contact directly", () => {
  const result = planOutreachMessageHandoff(
    facility([
      { id: "primary", name: "Lisa", phone: "713-867-5309", preferredMethod: "text", primary: true },
      { id: "secondary", name: "Ken", phone: "713-867-5310", preferredMethod: "text" },
    ]),
    { canAttemptSms: true },
  );

  assert.deepEqual(result, {
    kind: "open_sms",
    contactId: "primary",
    phone: "713-867-5309",
    smsUrl: buildSmsUrl("713-867-5309", safeMessage()),
    feedback: "opened",
  });
});

test("planOutreachMessageHandoff requires a chooser when multiple ready non-primary SLP Contacts exist", () => {
  const result = planOutreachMessageHandoff(
    facility([
      { id: "first", name: "Amy", phone: "713-867-5309", preferredMethod: "text" },
      { id: "second", name: "Ken", phone: "713-867-5310", preferredMethod: "text" },
    ]),
    { canAttemptSms: true },
  );

  assert.deepEqual(result, {
    kind: "choose_contact",
    contactIds: ["first", "second"],
  });
});

test("planOutreachMessageHandoff returns desktop fallback when sms cannot be attempted", () => {
  const result = planOutreachMessageHandoff(
    facility([{ id: "primary", name: "Lisa", phone: "713-867-5309", preferredMethod: "text", primary: true }]),
    { canAttemptSms: false },
  );

  assert.deepEqual(result, {
    kind: "copy_for_manual_sms",
    contactId: "primary",
    feedback: "fallback_copied",
  });
});

test("planOutreachMessageHandoffForContact validates picker choices through the same interface", () => {
  const result = planOutreachMessageHandoffForContact(
    facility([
      { id: "primary", name: "Lisa", phone: "713-867-5309", preferredMethod: "text", primary: true },
      { id: "placeholder", name: "Ken", phone: "555-0199", preferredMethod: "text" },
    ]),
    "placeholder",
    { canAttemptSms: true },
  );

  assert.deepEqual(result, {
    kind: "blocked_contact",
    contactId: "placeholder",
    feedback: "placeholder_phone",
  });
});

test("selectableTextContacts returns ready chooser contacts without placeholder or invalid phones", () => {
  assert.deepEqual(
    selectableTextContacts(
      facility([
        { id: "primary", name: "Lisa", phone: "555-0188", preferredMethod: "text", primary: true },
        { id: "ready", name: "Ken", phone: "713-867-5310", preferredMethod: "text" },
        { id: "invalid", name: "Sam", phone: "abc", preferredMethod: "text" },
      ]),
    ).map((contact) => contact.id),
    ["ready"],
  );
});

test("markTextedEligibility allows only a dialable non-placeholder pending SLP Contact", () => {
  const target = facility([
    { id: "primary", name: "Lisa", phone: "555-0188", preferredMethod: "text", primary: true },
    { id: "ready", name: "Ken", phone: "713-867-5310", preferredMethod: "text" },
    { id: "invalid", name: "Sam", phone: "abc", preferredMethod: "text" },
  ]);

  assert.deepEqual(markTextedEligibility(target, "ready"), {
    ok: true,
    contactName: "Ken",
  });
  assert.deepEqual(markTextedEligibility(target, "primary"), {
    ok: false,
    feedback: "placeholder_phone",
  });
  assert.deepEqual(markTextedEligibility(target, "invalid"), {
    ok: false,
    feedback: "invalid_phone",
  });
  assert.deepEqual(markTextedEligibility(facility([]), undefined), {
    ok: false,
    feedback: "no_phone",
  });
});
