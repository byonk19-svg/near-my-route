import type { Facility, ImportReviewRow, RouteStop } from "./types";

const TRAILING_STUDY_COUNT_PATTERN = /,?\s*(\d+)\s*(study|studies)\s*$/i;
const LEADING_TIME_PATTERN = /^(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*,?\s*/i;
const AUTO_MATCH_CONFIDENCE = 75;
const PLACEHOLDER_PATTERN = /^(unknown|tbd|n\/a|na|placeholder|imported facility(?: \d+)?)$/i;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeWords(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function startsWithNormalized(value: string, prefix: string) {
  const normalizedValue = normalizeWords(value);
  const normalizedPrefix = normalizeWords(prefix);
  return normalizedValue === normalizedPrefix || normalizedValue.startsWith(`${normalizedPrefix} `);
}

function splitFacilityAndAddress(value: string, facilities: Facility[]) {
  const knownFacility = [...facilities]
    .sort((a, b) => b.name.length - a.name.length)
    .find((facility) => startsWithNormalized(value, facility.name));

  if (knownFacility) {
    const facilityName = knownFacility.name;
    const address = value
      .slice(facilityName.length)
      .replace(/^\s*,\s*/, "")
      .trim();

    return { facilityName, address };
  }

  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return { facilityName: value.trim(), address: "" };
  }

  return {
    facilityName: parts[0],
    address: parts.slice(1).join(", "),
  };
}

function matchFacility(name: string, address: string, facilities: Facility[]) {
  const normalizedName = normalize(name);
  const normalizedAddress = normalize(address);
  const hasStreetLikeAddress = /^\d/.test(address.trim()) && normalizedAddress.length >= 8;

  return facilities
    .map((facility) => {
      const facilityName = normalize(facility.name);
      const facilityAddress = normalize(facility.address);
      let confidence = 0;

      if (normalizedName && facilityName === normalizedName) confidence += 80;
      if (normalizedName && (facilityName.includes(normalizedName) || normalizedName.includes(facilityName))) {
        confidence += 45;
      }
      if (normalizedAddress && facilityAddress === normalizedAddress) {
        confidence += 35;
      } else if (hasStreetLikeAddress && facilityAddress.includes(normalizedAddress.slice(0, 8))) {
        confidence += 20;
      }

      return { facility, confidence: Math.min(confidence, 99) };
    })
    .sort((a, b) => b.confidence - a.confidence)[0];
}

function isPlaceholder(value: string) {
  return PLACEHOLDER_PATTERN.test(value.trim());
}

export function importRowBlockingReason(row: ImportReviewRow) {
  if (row.action === "skip") return undefined;
  if (!row.appointmentTime?.trim()) return "Add an appointment time or skip this row.";
  if (!row.facilityName.trim() || isPlaceholder(row.facilityName)) return "Add a real facility name or skip this row.";
  if (row.action === "needs_review") return "Choose an existing facility, create a new facility, or skip.";
  if (row.action === "use_existing" && !row.matchedFacilityId) return "Select an existing facility before confirming.";
  if (row.action === "create_new" && (!row.address.trim() || isPlaceholder(row.address))) {
    return "Add a full address before creating a new facility.";
  }
  return undefined;
}

export function parseScheduleText(text: string, facilities: Facility[]): ImportReviewRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const timeMatch = line.match(LEADING_TIME_PATTERN);
      const appointmentTime = timeMatch?.[1]?.trim() ?? "";
      const withoutTime = timeMatch ? line.slice(timeMatch[0].length).trim() : line;
      const studyMatch = withoutTime.match(TRAILING_STUDY_COUNT_PATTERN);
      const studyCount = studyMatch ? Number(studyMatch[1]) : undefined;
      const middle = studyMatch
        ? withoutTime.slice(0, studyMatch.index).replace(/,\s*$/, "").trim()
        : withoutTime.trim();
      const { facilityName, address } = splitFacilityAndAddress(middle, facilities);
      const match = matchFacility(facilityName, address, facilities);
      const confidence = match?.confidence ?? 0;
      const autoUseExisting = Boolean(match?.facility.id && confidence >= AUTO_MATCH_CONFIDENCE);

      return {
        id: `import-${index}-${Date.now()}`,
        raw: line,
        appointmentTime,
        facilityName,
        address,
        studyCount,
        matchedFacilityId: autoUseExisting ? match.facility.id : match?.facility.id,
        confidence,
        action: autoUseExisting ? "use_existing" : "needs_review",
      };
    });
}

function temporaryCoordinates(index: number) {
  const base = [
    { lat: 29.737, lng: -95.589 },
    { lat: 29.711, lng: -95.524 },
    { lat: 29.781, lng: -95.505 },
    { lat: 29.645, lng: -95.548 },
  ];

  return base[index % base.length];
}

export function applyImportRows(
  rows: ImportReviewRow[],
  facilities: Facility[],
): { facilities: Facility[]; routeStops: RouteStop[] } {
  const nextFacilities = [...facilities];
  const routeStops: RouteStop[] = [];

  rows
    .filter((row) => row.action !== "skip" && row.action !== "needs_review")
    .forEach((row, index) => {
      let facilityId = row.matchedFacilityId;

      if (importRowBlockingReason(row)) return;

      if (row.action === "create_new") {
        const coordinates = temporaryCoordinates(index);
        facilityId = `facility-${Date.now()}-${index}`;
        nextFacilities.push({
          id: facilityId,
          name: row.facilityName,
          address: row.address || "Address needs review",
          city: "Imported",
          lat: coordinates.lat,
          lng: coordinates.lng,
          facilityType: "Other",
          contacts: [],
          sameDayFriendly: "unknown",
          typicalVolume: "unknown",
          notes: "Imported from pasted schedule. Confirm address and contacts.",
        });
      }

      if (!facilityId) return;

      routeStops.push({
        id: `stop-${Date.now()}-${index}`,
        facilityId,
        order: routeStops.length + 1,
        appointmentTime: row.appointmentTime,
        studyCount: row.studyCount,
        status: "planned",
        source: "scheduled",
      });
    });

  return { facilities: nextFacilities, routeStops };
}
