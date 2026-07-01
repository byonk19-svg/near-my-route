export type FacilityType =
  | "SNF"
  | "Rehab Hospital"
  | "LTACH"
  | "ALF"
  | "Hospital"
  | "Other";

export type SameDayFriendly = "yes" | "no" | "sometimes" | "unknown";
export type TypicalVolume = "low" | "medium" | "high" | "unknown";
export type PreferredMethod = "text" | "call" | "email";
export type LocationStatus = "confirmed" | "needs_confirmation" | "failed";
export type LocationSource = "seed" | "import" | "geocoded" | "fallback";

export type FacilityContact = {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  preferredMethod?: PreferredMethod;
  primary?: boolean;
};

export type Facility = {
  id: string;
  name: string;
  address: string;
  city?: string;
  lat: number;
  lng: number;
  locationStatus?: LocationStatus;
  locationSource?: LocationSource;
  facilityType?: FacilityType;
  groupTag?: string;
  contacts: FacilityContact[];
  lastContacted?: string;
  lastVisited?: string;
  sameDayFriendly?: SameDayFriendly;
  typicalVolume?: TypicalVolume;
  notes?: string;
  parkingNotes?: string;
  doNotContact?: boolean;
};

export type RouteStop = {
  id: string;
  facilityId: string;
  order: number;
  appointmentTime?: string;
  studyCount?: number;
  notes?: string;
  status: "planned" | "confirmed" | "completed" | "tentative";
  source?: "scheduled" | "today_add_on";
  addedFromLogId?: string;
  routeImpact?: {
    addedDriveMinutes: number;
    bestInsertionLabel: string;
    bestInsertionAfterStopId?: string;
    nearestStopName?: string;
    nearestStopDistanceMiles: number;
  };
};

export type OutreachStatus =
  | "texted"
  | "called"
  | "no_answer"
  | "no_patients_today"
  | "possible_add_on"
  | "added_to_route"
  | "follow_up_later"
  | "do_not_contact"
  | "do_not_contact_cleared";

export type OutreachLog = {
  id: string;
  facilityId: string;
  createdAt: string;
  method: "text" | "call" | "email" | "other";
  contactName?: string;
  status: OutreachStatus;
  notes?: string;
};

export type Opportunity = {
  facility: Facility;
  addedDriveMinutes: number;
  addedDistanceMiles: number;
  nearestStopId?: string;
  nearestStopName?: string;
  nearestStopDistanceMiles: number;
  bestInsertionAfterStopId?: string;
  bestInsertionLabel: string;
  reasonBadges: string[];
  score: number;
  group: "Best Add-ons" | "Good Options" | "Maybe Later" | "Not Worth It Today";
};

export type OpportunityOptions = {
  maxDetourMinutes: number;
  averageSpeedMph: number;
  excludeRecentlyContactedDays?: number;
  knownContactsOnly?: boolean;
  sameDayFriendlyOnly?: boolean;
};

export type ImportReviewRow = {
  id: string;
  raw: string;
  appointmentTime?: string;
  facilityName: string;
  address: string;
  studyCount?: number;
  matchedFacilityId?: string;
  confidence: number;
  action: "needs_review" | "use_existing" | "create_new" | "skip";
};
