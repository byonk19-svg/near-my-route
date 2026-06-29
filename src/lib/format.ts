import type { Facility, FacilityContact } from "./types";
import { daysSince } from "./routeCalculations";

export const OUTREACH_MESSAGE =
  "Hi! It's Elaine, SLP with Professional Imaging. We'll be doing MBSSs in your area this morning. Do you have anyone appropriate you'd like us to consider adding today?";

export function primaryContact(facility: Facility) {
  return facility.contacts.find((contact) => contact.primary) ?? facility.contacts[0];
}

export function phoneContacts(facility: Facility) {
  return facility.contacts
    .filter((contact): contact is FacilityContact & { phone: string } => Boolean(contact.phone?.trim()))
    .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
}

export function normalizePhoneForSms(phone: string) {
  const trimmed = phone.trim();
  const prefix = trimmed.startsWith("+") ? "+" : "";
  return `${prefix}${trimmed.replace(/\D/g, "")}`;
}

export function buildSmsUrl(phone: string, message = OUTREACH_MESSAGE) {
  return `sms:${normalizePhoneForSms(phone)}?&body=${encodeURIComponent(message)}`;
}

export function canAttemptSms(userAgent = "") {
  return /iPhone|iPad|iPod|Android|Mobile|Mobi/i.test(userAgent);
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

export function safeMessage() {
  return OUTREACH_MESSAGE;
}

export function todayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
