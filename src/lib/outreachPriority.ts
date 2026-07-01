import { isPlaceholderPhoneNumber, primaryContact, textContacts, textReadyContacts } from "./format";
import type { Facility, Opportunity, OutreachLog } from "./types";
import type { TodayStatus } from "./todayStatus";

export type OutreachQueueItem = {
  facility: Facility;
  opportunity?: Opportunity;
  status: TodayStatus;
  latestLog?: OutreachLog;
};

export type TextReadiness = "ready" | "needs_real_phone" | "no_phone";

const outreachPriorityOrder: Record<TodayStatus, number> = {
  possible_add_on: 0,
  not_contacted: 1,
  texted_today: 2,
  waiting: 2,
  no_patients_today: 3,
  added: 4,
  do_not_contact: 5,
};

export function textReadiness(facility: Facility): TextReadiness {
  const contacts = textContacts(facility);
  if (contacts.length === 0) return "no_phone";
  return textReadyContacts(facility).length > 0 ? "ready" : "needs_real_phone";
}

export function hasAddOnOpportunity(item: OutreachQueueItem) {
  return Boolean(item.opportunity);
}

function routeUsefulness(item: OutreachQueueItem) {
  const opportunity = item.opportunity;
  const facility = item.facility;
  let score = 0;

  if (opportunity) score += opportunity.score;
  if (facility.sameDayFriendly === "yes") score += 18;
  if (facility.sameDayFriendly === "sometimes") score += 8;
  if (primaryContact(facility)) score += 12;
  if (facility.typicalVolume === "high") score += 12;
  if (facility.typicalVolume === "medium") score += 6;
  if (textReadiness(facility) === "ready") score += 40;
  if (item.status === "not_contacted") score += 10;

  return score;
}

export function outreachReasonLabels(item: OutreachQueueItem) {
  const labels: string[] = [];
  const readiness = textReadiness(item.facility);
  const contact = primaryContact(item.facility);
  const readyPrimary = contact?.phone && (contact.preferredMethod ?? "text") === "text" && !isPlaceholderPhoneNumber(contact.phone);
  const readyContact = textReadyContacts(item.facility)[0];

  if (item.opportunity) labels.push(`+${item.opportunity.addedDriveMinutes} min detour`);
  if (readiness === "ready" && contact?.primary && readyPrimary) labels.push("Primary SLP ready");
  if (readiness === "ready" && (!contact?.primary || !readyPrimary) && readyContact) labels.push("Phone ready");
  if (readiness === "needs_real_phone") labels.push("Needs real phone");
  if (readiness === "no_phone") labels.push("No phone saved");
  if (item.facility.sameDayFriendly === "yes") labels.push("Same-day friendly");
  if (item.facility.sameDayFriendly === "sometimes") labels.push("Sometimes same-day");
  if (item.facility.typicalVolume === "high") labels.push("High volume");
  if (item.facility.typicalVolume === "medium") labels.push("Medium volume");

  return labels.slice(0, 5);
}

export function sortOutreachQueue(items: OutreachQueueItem[]) {
  return [...items].sort((a, b) => {
    const statusDelta = outreachPriorityOrder[a.status] - outreachPriorityOrder[b.status];
    if (statusDelta !== 0) return statusDelta;

    if (a.status === "not_contacted") {
      return routeUsefulness(b) - routeUsefulness(a) || (a.opportunity?.addedDriveMinutes ?? 999) - (b.opportunity?.addedDriveMinutes ?? 999);
    }

    return routeUsefulness(b) - routeUsefulness(a) || (a.opportunity?.addedDriveMinutes ?? 999) - (b.opportunity?.addedDriveMinutes ?? 999);
  });
}

export function selectTextFirst(items: OutreachQueueItem[]) {
  const candidates = items.filter(
    (item) => item.status === "not_contacted" && !item.facility.doNotContact && hasAddOnOpportunity(item),
  );
  const ready = candidates.filter((item) => textReadiness(item.facility) === "ready");
  return sortOutreachQueue(ready.length > 0 ? ready : candidates)[0];
}
