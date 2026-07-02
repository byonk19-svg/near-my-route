import type { Facility, ImportReviewRow, VanPacketSummary } from "./types";
import { normalizeImportValue } from "./scheduleImport";
import { facilityAliasValues, isSafeFacilityAlias, sanitizeFacilityAlias } from "./facilityAliases";

const FIELD_LABELS = [
  "NAME OF TEAM MEMBERS",
  "VAN NAME",
  "MEET DETAILS",
  "SPECIAL INSTRUCTIONS",
  "MAP LINK",
] as const;

const PRIVATE_ROUTE_PATTERN = /\b(home health|homehealth|hh|private residence|residence|home visit|patient home)\b/i;
const PRIVATE_ROUTE_CONTEXT_PATTERN = /homehealth|homevisit|patienthome|privateresidence|private|residence/i;
const PRIVATE_DETAIL_PATTERN = /\b(patient|patients|pts?|dob|date of birth|mrn|medical record|referring|diagnosis|dx|npo|aspiration|dysphagia|clinical|md)\b/i;
const CONTACT_DETAIL_PATTERN = /(?:\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|[^\s@]+@[^\s@]+\.[^\s@]+)/i;
const SAFE_OPERATIONAL_NOTE_PATTERN = /\b(park|parking|entrance|enter|door|side of building|dvd|jump drive|binder|facility|fac|staff|schedule)\b/i;
const NON_FACILITY_STOP_PATTERN = /\b(home depot|meet point|meeting point|meet at|return to)\b/i;
const ADDRESS_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\binterstate\b/g, "i"],
  [/\bih\b/g, "i"],
  [/\bi\s+(\d+)\b/g, "i$1"],
  [/\bavenue\b/g, "ave"],
  [/\bboulevard\b/g, "blvd"],
  [/\bcircle\b/g, "cir"],
  [/\bcourt\b/g, "ct"],
  [/\bdrive\b/g, "dr"],
  [/\bhighway\b/g, "hwy"],
  [/\blane\b/g, "ln"],
  [/\bparkway\b/g, "pkwy"],
  [/\bplace\b/g, "pl"],
  [/\broad\b/g, "rd"],
  [/\bstreet\b/g, "st"],
  [/\bsouth\b/g, "s"],
  [/\bnorth\b/g, "n"],
  [/\beast\b/g, "e"],
  [/\bwest\b/g, "w"],
];

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

function safeSpecialInstructionLines(value?: string) {
  if (!value) return undefined;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !PRIVATE_DETAIL_PATTERN.test(line))
    .filter((line) => !CONTACT_DETAIL_PATTERN.test(line))
    .filter((line) => SAFE_OPERATIONAL_NOTE_PATTERN.test(line));
  return lines.length > 0 ? lines : undefined;
}

export function normalizeVanPacketAddress(value: string) {
  let normalized = value.toLowerCase().replace(/&/g, " and ");
  normalized = normalized.replace(/\bi[-\s]*(\d+)\b/g, "i$1");
  for (const [pattern, replacement] of ADDRESS_WORD_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .replace(/\b(usa|united states|tx|texas)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRouteValue(value: string) {
  return normalizeVanPacketAddress(value).replace(/\s+/g, "");
}

function likelyPrivateRouteStop(address: string) {
  return PRIVATE_ROUTE_PATTERN.test(address);
}

function stopKey(value: string) {
  const match = value.match(/\b(\d{1,6})\s+([^,]+)/i);
  if (!match) return undefined;
  const streetSuffixes = new Set([
    "ave",
    "avenue",
    "blvd",
    "boulevard",
    "cir",
    "circle",
    "ct",
    "court",
    "dr",
    "drive",
    "hwy",
    "highway",
    "ln",
    "lane",
    "pkwy",
    "parkway",
    "pl",
    "place",
    "rd",
    "road",
    "st",
    "street",
    "way",
  ]);
  const streetTokens = match[2]
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9-]/gi, "").toLowerCase())
    .filter(Boolean)
    .filter((token) => !streetSuffixes.has(token))
    .slice(0, 3);
  return normalizeImportValue([match[1], ...streetTokens].join(" "));
}

function contextContainsStop(text: string | undefined, key: string) {
  if (!text) return undefined;
  const normalizedKey = normalizeImportValue(key);
  const lines = text.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => normalizeImportValue(line).includes(normalizedKey));
  if (lineIndex >= 0) return [lines[lineIndex - 1], lines[lineIndex]].filter(Boolean).join("\n");

  const normalized = normalizeImportValue(text);
  const index = normalized.indexOf(normalizedKey);
  if (index < 0) return undefined;
  return normalized.slice(Math.max(0, index - 80), index + normalizedKey.length);
}

function isMeetRouteStop(address: string, meetDetails?: string) {
  if (NON_FACILITY_STOP_PATTERN.test(address)) return true;
  const key = stopKey(address);
  return Boolean(key && contextContainsStop(meetDetails, key));
}

function isPrivateRouteStop(address: string, supplementalText?: string) {
  if (likelyPrivateRouteStop(address)) return true;
  const key = stopKey(address);
  if (!key) return false;
  const context = contextContainsStop(supplementalText, key);
  return Boolean(context && (PRIVATE_ROUTE_PATTERN.test(context) || PRIVATE_ROUTE_CONTEXT_PATTERN.test(context)));
}

function lineLooksLikeAddress(line: string) {
  return /^\s*\d{1,6}\b/.test(line) || /\b\d{1,6}\s+[^,\n]+,\s*[^,\n]+/i.test(line);
}

function stopContext(text: string | undefined, address: string) {
  const key = stopKey(address);
  if (!text || !key) return undefined;
  const normalizedKey = normalizeImportValue(key);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => normalizeImportValue(line).includes(normalizedKey));
  if (index < 0) return undefined;
  const previousLabel = [...lines.slice(Math.max(0, index - 3), index)]
    .reverse()
    .find((line) => !PRIVATE_DETAIL_PATTERN.test(line) && !CONTACT_DETAIL_PATTERN.test(line) && !lineLooksLikeAddress(line));
  const aliasCandidate = sanitizeFacilityAlias(previousLabel);
  return {
    previousLabel: aliasCandidate && isSafeFacilityAlias(aliasCandidate) ? aliasCandidate : previousLabel,
    aliasCandidate: aliasCandidate && isSafeFacilityAlias(aliasCandidate) ? aliasCandidate : undefined,
    context: [previousLabel, lines[index], lines[index + 1]].filter(Boolean).join("\n"),
  };
}

function matchFacility(address: string, facilities: Facility[], nameHint?: string) {
  const normalizedAddress = normalizeVanPacketAddress(address);
  const compactAddress = compactRouteValue(address);
  const normalizedNameHint = normalizeImportValue(nameHint ?? "");
  const hasStreetLikeAddress = /^\d/.test(address.trim()) && compactAddress.length >= 8;

  return facilities
    .map((facility) => {
      const facilityAddress = normalizeVanPacketAddress(facility.address);
      const compactFacilityAddress = compactRouteValue(facility.address);
      const facilityNames = facilityAliasValues(facility).map(normalizeImportValue);
      let confidence = 0;
      let addressScore = 0;
      let nameScore = 0;

      if (compactAddress && compactFacilityAddress === compactAddress) addressScore = 95;
      else if (compactAddress && (compactAddress.includes(compactFacilityAddress) || compactFacilityAddress.includes(compactAddress))) {
        addressScore = 80;
      } else if (hasStreetLikeAddress && compactFacilityAddress.includes(compactAddress.slice(0, 8))) {
        addressScore = 65;
      }

      if (normalizedAddress && facilityAddress && normalizedAddress.includes(facilityAddress)) addressScore = Math.max(addressScore, 65);

      if (normalizedNameHint) {
        const nameMatch = facilityNames.some(
          (facilityName) =>
            facilityName === normalizedNameHint ||
            facilityName.includes(normalizedNameHint) ||
            normalizedNameHint.includes(facilityName),
        );
        if (nameMatch) nameScore = 55;
      }

      const addressContainsName = facilityNames.some((facilityName) => facilityName && normalizeImportValue(address).includes(facilityName));
      if (addressContainsName) nameScore = Math.max(nameScore, 30);

      confidence = addressScore + nameScore;
      return { facility, confidence: Math.min(confidence, 99) };
    })
    .sort((a, b) => b.confidence - a.confidence)[0];
}

function facilityNameFromAddress(address: string, index: number, options?: { isPrivate?: boolean; isMeet?: boolean }) {
  if (options?.isMeet) return `Meet point ${index + 1}`;
  if (options?.isPrivate) return `Private route stop ${index + 1}`;
  const firstPart = address.split(",")[0]?.trim();
  return firstPart || `Imported stop ${index + 1}`;
}

export function parseVanPacketText(
  text: string,
  facilities: Facility[],
  options?: { supplementalText?: string },
): { summary: VanPacketSummary; rows: ImportReviewRow[] } {
  const mapLink = firstUrl(fieldValue(text, "MAP LINK")) ?? firstUrl(text);
  const routeAddresses = addressesFromGoogleMapsDirUrl(mapLink);
  const meetDetails = fieldValue(text, "MEET DETAILS");
  const supplementalText = options?.supplementalText;
  const routeStopKinds = routeAddresses.map((address, index) => {
    const isDuplicateReturn =
      index > 0 && index === routeAddresses.length - 1 && compactRouteValue(address) === compactRouteValue(routeAddresses[0] ?? "");
    const context = stopContext(supplementalText, address);
    return {
      isMeet: isMeetRouteStop(address, meetDetails) || isDuplicateReturn,
      isPrivate: isPrivateRouteStop(address, supplementalText),
      aliasCandidate: context?.aliasCandidate,
      isDuplicateReturn,
    };
  });
  const safeNotes = safeSpecialInstructionLines(fieldValue(text, "SPECIAL INSTRUCTIONS"));
  const summary: VanPacketSummary = {
    teamMembers: splitNames(fieldValue(text, "NAME OF TEAM MEMBERS")),
    vanName: fieldValue(text, "VAN NAME"),
    meetDetails,
    mapLink,
    specialInstructions: safeNotes?.join("\n"),
    safeNotes,
    routeAddresses,
    supplementalTextUsed: Boolean(supplementalText?.trim()),
    privateStopHints: routeStopKinds.filter((kind) => kind.isPrivate).length,
    routeAnchorHints: routeStopKinds.filter((kind) => kind.isMeet).length,
  };

  const rows = routeAddresses.map((address, index) => {
    const rowKind = routeStopKinds[index];
    const match = matchFacility(address, facilities, rowKind?.aliasCandidate);
    const confidence = match?.confidence ?? 0;
    const suggestedFacility = confidence > 0 ? match?.facility : undefined;
    const autoUseExisting = Boolean(suggestedFacility?.id && confidence >= 75);
    const privateRouteStop = (rowKind?.isPrivate ?? false) && !autoUseExisting;
    const meetRouteStop = rowKind?.isMeet ?? false;
    const aliasCandidate = rowKind?.aliasCandidate;
    const aliasNote =
      aliasCandidate && !autoUseExisting
        ? suggestedFacility
          ? "Possible known facility label. Confirm the facility to remember this alias."
          : "PDF label hint. Select the facility to remember this alias."
        : aliasCandidate
          ? `PDF label hint: ${aliasCandidate}`
          : undefined;

    return {
      id: `van-packet-${index}-${Date.now()}`,
      raw: address,
      facilityName: privateRouteStop || meetRouteStop
        ? facilityNameFromAddress(address, index, { isPrivate: privateRouteStop, isMeet: meetRouteStop })
        : suggestedFacility?.name ?? facilityNameFromAddress(address, index),
      address,
      reviewNote: meetRouteStop
        ? rowKind?.isDuplicateReturn
          ? "Duplicate return point skipped. Use the original map link for the full source route."
          : "Meet/start point skipped by default so it does not need facility review."
        : aliasNote
          ? aliasNote
          : undefined,
      routeOnlyReason: meetRouteStop ? "route_anchor" : privateRouteStop ? "private" : undefined,
      aliasCandidate: privateRouteStop || meetRouteStop ? undefined : aliasCandidate,
      matchedFacilityId: privateRouteStop || meetRouteStop ? undefined : suggestedFacility?.id,
      confidence: privateRouteStop || meetRouteStop ? 0 : confidence,
      action: meetRouteStop ? "skip" : privateRouteStop ? "private_route_stop" : autoUseExisting ? "use_existing" : "needs_review",
      sourceMapLink: mapLink,
    } satisfies ImportReviewRow;
  });

  return { summary, rows };
}
