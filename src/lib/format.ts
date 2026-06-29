import type { Facility } from "./types";
import { daysSince } from "./routeCalculations";

export function primaryContact(facility: Facility) {
  return facility.contacts.find((contact) => contact.primary) ?? facility.contacts[0];
}

export function formatDaysAgo(date?: string) {
  if (!date) return "Never";
  const days = daysSince(date);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function friendlyValue(value?: string) {
  if (!value) return "Unknown";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function safeMessage(contactName?: string) {
  return `Hi ${contactName || "[Contact Name]"}, we'll be near your area this morning for MBSS. Do you have anyone appropriate you'd like us to consider adding today?`;
}

export function todayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
