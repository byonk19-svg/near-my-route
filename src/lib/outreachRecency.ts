import type { Facility } from "./types";
import { daysSince } from "./routeCalculations";

export type OutreachRecencyState =
  | "never_contacted"
  | "due_for_follow_up"
  | "contacted_recently"
  | "contacted_today"
  | "do_not_contact";

export function isDueForFollowUp(facility: Facility, dueThresholdDays: number) {
  if (facility.doNotContact) return false;
  return !facility.lastContacted || daysSince(facility.lastContacted) >= dueThresholdDays;
}

export function outreachRecencyState(
  facility: Facility,
  dueThresholdDays: number,
): OutreachRecencyState {
  if (facility.doNotContact) return "do_not_contact";
  if (!facility.lastContacted) return "never_contacted";
  if (daysSince(facility.lastContacted) === 0) return "contacted_today";
  if (isDueForFollowUp(facility, dueThresholdDays)) return "due_for_follow_up";
  return "contacted_recently";
}

export function outreachRecencyLabel(state: OutreachRecencyState) {
  switch (state) {
    case "never_contacted":
      return "Never contacted";
    case "due_for_follow_up":
      return "Due for follow-up";
    case "contacted_recently":
      return "Contacted recently";
    case "contacted_today":
      return "Texted today";
    case "do_not_contact":
      return "Do not contact";
  }
}
