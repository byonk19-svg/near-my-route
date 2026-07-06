import {
  buildSmsUrl,
  isDialablePhoneNumber,
  isPlaceholderPhoneNumber,
  primaryContact,
  safeMessage,
  textContacts,
  textReadyContacts,
} from "./format";
import type { Facility, FacilityContact } from "./types";

export type TextFeedback =
  | "copied"
  | "failed"
  | "opened"
  | "fallback_copied"
  | "no_phone"
  | "placeholder_phone"
  | "invalid_phone";

export type OutreachMessageHandoffEnvironment = {
  canAttemptSms: boolean;
};

export type OutreachMessageHandoffResult =
  | {
      kind: "no_phone";
      feedback: "no_phone";
    }
  | {
      kind: "choose_contact";
      contactIds: string[];
    }
  | {
      kind: "blocked_contact";
      contactId: string;
      feedback: "placeholder_phone" | "invalid_phone";
    }
  | {
      kind: "copy_for_manual_sms";
      contactId: string;
      feedback: "fallback_copied";
    }
  | {
      kind: "open_sms";
      contactId: string;
      phone: string;
      smsUrl: string;
      feedback: "opened";
    };

export type MarkTextedEligibility =
  | {
      ok: true;
      contactName?: string;
    }
  | {
      ok: false;
      feedback: "no_phone" | "placeholder_phone" | "invalid_phone";
    };

type BlockingTextFeedback = Extract<TextFeedback, "no_phone" | "placeholder_phone" | "invalid_phone">;
type UndialablePhoneFeedback = Exclude<BlockingTextFeedback, "no_phone">;

export function selectableTextContacts(facility: Facility): Array<FacilityContact & { phone: string }> {
  return textReadyContacts(facility);
}

function blockedPhoneFeedback(phone?: string): BlockingTextFeedback | undefined {
  if (!phone) return "no_phone";
  return undialablePhoneFeedback(phone);
}

function undialablePhoneFeedback(phone: string): UndialablePhoneFeedback | undefined {
  if (isPlaceholderPhoneNumber(phone)) return "placeholder_phone";
  if (!isDialablePhoneNumber(phone)) return "invalid_phone";
  return undefined;
}

function preferredDirectContact(facility: Facility) {
  const readyContacts = textReadyContacts(facility);
  const primaryReadyContacts = readyContacts.filter((contact) => contact.primary);
  if (primaryReadyContacts.length === 1) return primaryReadyContacts[0];
  if (readyContacts.length === 1) return readyContacts[0];
  return undefined;
}

export function planOutreachMessageHandoff(
  facility: Facility,
  environment: OutreachMessageHandoffEnvironment,
): OutreachMessageHandoffResult {
  const contacts = textContacts(facility);
  if (contacts.length === 0) {
    return {
      kind: "no_phone",
      feedback: "no_phone",
    };
  }

  const directContact = preferredDirectContact(facility);
  if (directContact) return planOutreachMessageHandoffForContact(facility, directContact.id, environment);

  const readyContacts = textReadyContacts(facility);
  if (readyContacts.length > 1) {
    return {
      kind: "choose_contact",
      contactIds: readyContacts.map((contact) => contact.id),
    };
  }

  return planOutreachMessageHandoffForContact(facility, contacts[0].id, environment);
}

export function planOutreachMessageHandoffForContact(
  facility: Facility,
  contactId: string,
  environment: OutreachMessageHandoffEnvironment,
): OutreachMessageHandoffResult {
  const contact = facility.contacts.find((item) => item.id === contactId);
  if (!contact?.phone) {
    return {
      kind: "no_phone",
      feedback: "no_phone",
    };
  }

  const phoneIssue = undialablePhoneFeedback(contact.phone);

  if (phoneIssue) {
    return {
      kind: "blocked_contact",
      contactId,
      feedback: phoneIssue,
    };
  }

  const phone = contact.phone;
  if (!environment.canAttemptSms) {
    return {
      kind: "copy_for_manual_sms",
      contactId,
      feedback: "fallback_copied",
    };
  }

  return {
    kind: "open_sms",
    contactId,
    phone,
    smsUrl: buildSmsUrl(phone, safeMessage()),
    feedback: "opened",
  };
}

export function markTextedEligibility(facility: Facility, pendingContactId?: string): MarkTextedEligibility {
  const contact = facility.contacts.find((item) => item.id === pendingContactId) ?? primaryContact(facility);
  const phoneIssue = blockedPhoneFeedback(contact?.phone);

  if (phoneIssue) {
    return {
      ok: false,
      feedback: phoneIssue,
    };
  }

  return {
    ok: true,
    contactName: contact.name,
  };
}
