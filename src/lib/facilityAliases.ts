import type { Facility } from "./types";

const PRIVATE_OR_CLINICAL_PATTERN =
  /\b(patient|patients|pt|pts|dob|date of birth|mrn|medical record|referring|diagnosis|dx|npo|aspiration|dysphagia|clinical|home health|patient home|hh)\b/i;
const CONTACT_PATTERN = /(?:\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|[^\s@]+@[^\s@]+\.[^\s@]+)/i;
const OPERATIONAL_MARKER_PATTERN =
  /\b(?:initial|confirmed|address|new pt|f\/u|status|comments|spoke with|slp|txt|text|call|must|please)\b/gi;
const GENERIC_ALIAS_VALUES = new Set([
  "hospital",
  "facility",
  "fac",
  "rehab",
  "snf",
  "post acute",
  "nursing",
  "care",
  "center",
  "health center",
  "place",
  "resort",
]);

function normalizeAliasCompareValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function sanitizeFacilityAlias(value?: string) {
  if (!value) return undefined;
  const cleaned = value
    .replace(/\*[^*]*\*/g, " ")
    .replace(OPERATIONAL_MARKER_PATTERN, " ")
    .replace(/[^a-z0-9&'\-\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return undefined;
  return cleaned.toUpperCase();
}

export function isSafeFacilityAlias(value?: string) {
  const alias = sanitizeFacilityAlias(value);
  if (!alias) return false;
  if (alias.length < 4 || alias.length > 64) return false;
  if (PRIVATE_OR_CLINICAL_PATTERN.test(alias) || CONTACT_PATTERN.test(alias)) return false;
  const words = alias.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1 && GENERIC_ALIAS_VALUES.has(words[0].toLowerCase())) return false;
  if (GENERIC_ALIAS_VALUES.has(alias.toLowerCase())) return false;
  return /[a-z]/i.test(alias);
}

export function facilityAliasValues(facility: Facility) {
  return [facility.name, ...(facility.aliases ?? [])]
    .map((value) => sanitizeFacilityAlias(value))
    .filter((value): value is string => Boolean(value));
}

export function facilityHasAliasValue(facility: Facility, alias: string) {
  const normalizedAlias = normalizeAliasCompareValue(alias);
  return facilityAliasValues(facility).some((value) => normalizeAliasCompareValue(value) === normalizedAlias);
}

export function appendFacilityAlias(facilities: Facility[], facilityId: string, candidate?: string) {
  const alias = sanitizeFacilityAlias(candidate);
  if (!alias || !isSafeFacilityAlias(alias)) return facilities;

  return facilities.map((facility) => {
    if (facility.id !== facilityId || facilityHasAliasValue(facility, alias)) return facility;
    return {
      ...facility,
      aliases: [...(facility.aliases ?? []), alias],
    };
  });
}
