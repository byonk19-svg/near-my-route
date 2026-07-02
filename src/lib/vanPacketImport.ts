import type { Facility, ImportReviewRow, VanPacketSummary } from "./types";
import { normalizeImportValue } from "./scheduleImport";

const FIELD_LABELS = [
  "NAME OF TEAM MEMBERS",
  "VAN NAME",
  "MEET DETAILS",
  "SPECIAL INSTRUCTIONS",
  "MAP LINK",
] as const;

const PRIVATE_ROUTE_PATTERN = /\b(home health|homehealth|hh|private residence|residence|home visit|patient home)\b/i;
const PRIVATE_DETAIL_PATTERN = /\b(patient|dob|date of birth|mrn|medical record|referring|diagnosis|dx|npo|aspiration|dysphagia|clinical|md)\b/i;

function labelPattern(label: string) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function fieldValue(text: string, label: string) {
  const labels = FIELD_LABELS.map(labelPattern).join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*${labelPattern(label)}\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*(?:${labels})\\s*:?|$)`, "i");
  return text.match(pattern)?.[1]?.trim();
}

function splitNames(value?: string) {
  if (!value) return [];
  return value
    .split(/\r?\n|,|;|&|\band\b/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstUrl(value?: string) {
  return value?.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>.,]+$/, "");
}

function decodeMapSegment(segment: string) {
  const normalized = segment.replace(/\+/g, " ");
  try {
    return decodeURIComponent(normalized).trim();
  } catch {
    return normalized.trim();
  }
}

export function addressesFromGoogleMapsDirUrl(mapLink?: string) {
  if (!mapLink) return [];

  try {
    const url = new URL(mapLink);
    const markerIndex = url.pathname.toLowerCase().indexOf("/dir/");
    if (markerIndex < 0) return [];
    const routePath = url.pathname.slice(markerIndex + 5);
    return routePath
      .split("/")
      .map(decodeMapSegment)
      .map((segment) => segment.replace(/^place\s+/i, "").trim())
      .filter((segment) => segment && !segment.startsWith("@") && !segment.startsWith("data=") && !segment.startsWith("!"))
      .map((segment) => segment.replace(/\s+/g, " "));
  } catch {
    return [];
  }
}

function safeSpecialInstructions(value?: string) {
  if (!value) return undefined;
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !PRIVATE_DETAIL_PATTERN.test(line))
    .join("\n") || undefined;
}

function likelyPrivateRouteStop(address: string) {
  return PRIVATE_ROUTE_PATTERN.test(address);
}

function matchFacility(address: string, facilities: Facility[]) {
  const normalizedAddress = normalizeImportValue(address);
  const hasStreetLikeAddress = /^\d/.test(address.trim()) && normalizedAddress.length >= 8;

  return facilities
    .map((facility) => {
      const facilityAddress = normalizeImportValue(facility.address);
      const facilityName = normalizeImportValue(facility.name);
      let confidence = 0;

      if (normalizedAddress && (facilityAddress === normalizedAddress || normalizedAddress.includes(facilityAddress))) confidence += 95;
      else if (hasStreetLikeAddress && facilityAddress.includes(normalizedAddress.slice(0, 8))) confidence += 65;
      if (facilityName && normalizedAddress.includes(facilityName)) confidence += 30;

      return { facility, confidence: Math.min(confidence, 99) };
    })
    .sort((a, b) => b.confidence - a.confidence)[0];
}

function facilityNameFromAddress(address: string, index: number) {
  if (likelyPrivateRouteStop(address)) return `Private route stop ${index + 1}`;
  const firstPart = address.split(",")[0]?.trim();
  return firstPart || `Imported stop ${index + 1}`;
}

export function parseVanPacketText(text: string, facilities: Facility[]): { summary: VanPacketSummary; rows: ImportReviewRow[] } {
  const mapLink = firstUrl(fieldValue(text, "MAP LINK")) ?? firstUrl(text);
  const routeAddresses = addressesFromGoogleMapsDirUrl(mapLink);
  const summary: VanPacketSummary = {
    teamMembers: splitNames(fieldValue(text, "NAME OF TEAM MEMBERS")),
    vanName: fieldValue(text, "VAN NAME"),
    meetDetails: fieldValue(text, "MEET DETAILS"),
    mapLink,
    specialInstructions: safeSpecialInstructions(fieldValue(text, "SPECIAL INSTRUCTIONS")),
    routeAddresses,
  };

  const rows = routeAddresses.map((address, index) => {
    const match = matchFacility(address, facilities);
    const confidence = match?.confidence ?? 0;
    const autoUseExisting = Boolean(match?.facility.id && confidence >= 75);
    const privateRouteStop = likelyPrivateRouteStop(address);

    return {
      id: `van-packet-${index}-${Date.now()}`,
      raw: address,
      facilityName: privateRouteStop ? `Private route stop ${index + 1}` : match?.facility.name ?? facilityNameFromAddress(address, index),
      address,
      matchedFacilityId: autoUseExisting ? match.facility.id : match?.facility.id,
      confidence,
      action: privateRouteStop ? "private_route_stop" : autoUseExisting ? "use_existing" : "needs_review",
      sourceMapLink: mapLink,
    } satisfies ImportReviewRow;
  });

  return { summary, rows };
}
