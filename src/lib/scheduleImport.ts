import type { Facility, ImportReviewRow, RouteStop } from "./types";

const STUDY_COUNT_PATTERN = /(\d+)\s*(study|studies)/i;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function matchFacility(name: string, address: string, facilities: Facility[]) {
  const normalizedName = normalize(name);
  const normalizedAddress = normalize(address);

  return facilities
    .map((facility) => {
      const facilityName = normalize(facility.name);
      const facilityAddress = normalize(facility.address);
      let confidence = 0;

      if (facilityName === normalizedName) confidence += 80;
      if (facilityName.includes(normalizedName) || normalizedName.includes(facilityName)) {
        confidence += 45;
      }
      if (normalizedAddress && facilityAddress.includes(normalizedAddress.slice(0, 8))) {
        confidence += 20;
      }

      return { facility, confidence: Math.min(confidence, 99) };
    })
    .sort((a, b) => b.confidence - a.confidence)[0];
}

export function parseScheduleText(text: string, facilities: Facility[]): ImportReviewRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [appointmentTime = "", facilityName = "", address = "", studyText = ""] = line
        .split(",")
        .map((part) => part.trim());
      const match = matchFacility(facilityName, address, facilities);
      const studyMatch = studyText.match(STUDY_COUNT_PATTERN);
      const confidence = match?.confidence ?? 0;

      return {
        id: `import-${index}-${Date.now()}`,
        raw: line,
        appointmentTime,
        facilityName: facilityName || `Imported facility ${index + 1}`,
        address,
        studyCount: studyMatch ? Number(studyMatch[1]) : undefined,
        matchedFacilityId: confidence >= 45 ? match.facility.id : undefined,
        confidence,
        action: confidence >= 45 ? "use_existing" : "create_new",
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
    .filter((row) => row.action !== "skip")
    .forEach((row, index) => {
      let facilityId = row.matchedFacilityId;

      if (row.action === "create_new" || !facilityId) {
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

      routeStops.push({
        id: `stop-${Date.now()}-${index}`,
        facilityId,
        order: routeStops.length + 1,
        appointmentTime: row.appointmentTime,
        studyCount: row.studyCount,
        status: "planned",
      });
    });

  return { facilities: nextFacilities, routeStops };
}
