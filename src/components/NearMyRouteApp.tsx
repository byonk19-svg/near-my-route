"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  CheckCircle,
  Clipboard,
  Download,
  ExternalLink,
  Filter,
  MapPinned,
  MessageSquareText,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Trash2,
  Timer,
} from "lucide-react";
import { initialFacilities, initialOutreachLogs, initialRouteStops } from "@/lib/mockData";
import { calculateRouteOpportunities } from "@/lib/routeCalculations";
import {
  confirmImportReview,
  importReviewModel,
  parseImportReview,
  updateImportReviewRow,
  type ImportReviewDraft,
  type ImportReviewIdPurpose,
} from "@/lib/importReview";
import { clearStoredState, loadStoredState, saveStoredState } from "@/lib/storage";
import type { Facility, FacilityContact, ImportReviewRow, Opportunity, OutreachLog, OutreachStatus, PreferredMethod, RouteLocation, RouteStop } from "@/lib/types";
import {
  buildSmsUrl,
  canAttemptSms,
  formatDaysAgo,
  friendlyValue,
  isDialablePhoneNumber,
  isPlaceholderPhoneNumber,
  primaryContact,
  safeMessage,
  textContacts,
  textReadyContacts,
  todayIsoDate,
} from "@/lib/format";
import {
  buildGoogleMapsDirectionsUrl,
  googleMapsWaypointWarning,
  orderedRouteFacilities,
  parseGoogleMapsCoordinates,
  routeFacilitiesWithInsertedAddOn,
  splitGoogleMapsDirectionsUrls,
} from "@/lib/googleMaps";
import { isDueForFollowUp, outreachRecencyLabel, outreachRecencyState } from "@/lib/outreachRecency";
import {
  deriveTodayStatus,
  latestTodayLog,
  todayStatusLabel,
  todayStatusSummary,
  todayStatusTone,
  type TodayStatus,
} from "@/lib/todayStatus";
import {
  outreachReasonLabels,
  hasAddOnOpportunity,
  selectTextFirst,
  sortOutreachQueue,
  textReadiness,
  type OutreachQueueItem,
} from "@/lib/outreachPriority";
import { dogfoodNotePhiWarning } from "@/lib/privacy";
import { hasConfirmedLocation, isFallbackLocation, locationConfirmationIssue, unconfirmedRouteFacilities } from "@/lib/locationTrust";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-500">Loading map...</div>,
});

const sampleSchedule = `8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies
10:15 AM Park Manor Westchase, 11910 Richmond Ave, Houston, TX, 1 study
1:00 PM, Lakeside Rehab, 9440 Bellaire Blvd, Houston, TX, 2 studies`;

const sampleVanPacket = `NAME OF TEAM MEMBERS
Elaine

VAN NAME
Northwest Van

MEET DETAILS
Meet at office at 7:30 AM.

SPECIAL INSTRUCTIONS
Bring van binder.

MAP LINK
https://www.google.com/maps/dir/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX/Home+Health,+100+Example+St,+Houston,+TX/Park+Manor+Westchase,+11910+Richmond+Ave,+Houston,+TX`;

const sampleVanPacketPdfText = `HOUSTON VAN 1
MEMORIAL SNF
12620 MEMORIAL DR, HOUSTON, TX
HOME HEALTH
100 EXAMPLE ST, HOUSTON, TX
PARK MANOR WESTCHASE
11910 RICHMOND AVE, HOUSTON, TX`;

const opportunityGroups: Opportunity["group"][] = [
  "Best Add-ons",
  "Good Options",
  "Maybe Later",
  "Not Worth It Today",
];

const outreachStatuses: OutreachStatus[] = [
  "texted",
  "called",
  "no_answer",
  "no_patients_today",
  "possible_add_on",
  "added_to_route",
  "follow_up_later",
  "do_not_contact",
];

const dogfoodTasks = [
  { id: "import", label: "Import tomorrow's route" },
  { id: "text", label: "Review text candidates" },
  { id: "replies", label: "Log every reply" },
  { id: "add", label: "Add tentative stop" },
  { id: "remove", label: "Remove tentative stop if needed" },
  { id: "maps", label: "Open Google Maps" },
  { id: "friction", label: "Capture friction" },
] as const;

type AppTab = "Near My Route" | "Facilities" | "Import Schedule" | "Outreach";
type ImportMode = "schedule" | "van_packet";

const tabLabels: Record<AppTab, string> = {
  "Near My Route": "Route",
  Facilities: "Facilities",
  "Import Schedule": "Import",
  Outreach: "Outreach",
};

type RouteView =
  | { kind: "home" }
  | { kind: "review"; facilityId: string; sourceTab: AppTab }
  | {
      kind: "confirmation";
      facilityId: string;
      routeStopId: string;
      snapshot: OpportunitySnapshot;
      contactedToday: boolean;
      canRemove: boolean;
    };

type OpportunitySnapshot = {
  facilityId: string;
  addedDriveMinutes: number;
  bestInsertionLabel: string;
  bestInsertionAfterStopId?: string;
  nearestStopName?: string;
  nearestStopDistanceMiles: number;
  reasonBadges: string[];
};

type TextFeedback = "copied" | "failed" | "opened" | "fallback_copied" | "no_phone" | "placeholder_phone" | "invalid_phone";

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Button({
  children,
  tone = "secondary",
  className,
  onClick,
  type = "button",
  disabled = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "group inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-center text-[13px] font-bold leading-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 [&>svg]:shrink-0 [&>svg]:transition-transform [&>svg]:duration-500 [&>svg]:ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:[&>svg]:translate-x-0.5",
        tone === "primary" && "bg-blue-700 text-white shadow-[0_14px_32px_rgba(37,99,235,0.24),inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-blue-800",
        tone === "secondary" && "nmr-soft-field text-slate-800 hover:border-blue-200 hover:bg-white",
        tone === "ghost" && "text-slate-600 hover:bg-white/70 hover:text-blue-700",
        tone === "danger" && "border border-red-200 bg-red-50 text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-red-100",
        disabled && "pointer-events-none cursor-not-allowed opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "blue" | "orange" | "green" | "red" | "slate" }) {
  return (
    <span
      className={cx(
        "inline-flex whitespace-nowrap items-center rounded-full border px-2.5 py-1 text-[11px] font-bold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]",
        tone === "blue" && "border-blue-200 bg-blue-50 text-blue-700",
        tone === "orange" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "green" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "red" && "border-red-200 bg-red-50 text-red-700",
        tone === "slate" && "border-slate-200 bg-white text-slate-600",
      )}
    >
      {children}
    </span>
  );
}

function StatusSummary({ counts }: { counts: Array<{ status: TodayStatus; label: string; count: number }> }) {
  const visibleCounts = counts.filter(({ count }) => count > 0);

  if (visibleCounts.length === 0) {
    return <p className="text-sm font-semibold text-slate-500">No outreach logged today.</p>;
  }

  return (
    <p className="text-sm font-semibold text-slate-600">
      {visibleCounts.map(({ label, count }) => `${count} ${label.toLowerCase()}`).join(" - ")}
    </p>
  );
}

function statusCount(counts: Array<{ status: TodayStatus; label: string; count: number }>, status: TodayStatus) {
  return counts.find((item) => item.status === status)?.count ?? 0;
}

function dashboardBadgeTone(status?: TodayStatus | RouteStop["status"]): "blue" | "orange" | "green" | "red" | "slate" {
  if (status === "confirmed" || status === "added" || status === "possible_add_on") return "green";
  if (status === "texted_today" || status === "waiting") return "blue";
  if (status === "tentative") return "orange";
  if (status === "planned" || status === "not_contacted") return "slate";
  if (status === "do_not_contact" || status === "no_patients_today") return "red";
  return "blue";
}

function DashboardMetric({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "blue" | "green" | "red" | "slate";
}) {
  return (
    <div
      className={cx(
        "nmr-panel rounded-2xl p-3",
        tone === "blue" && "border-blue-200 bg-blue-50/50",
        tone === "green" && "border-emerald-200 bg-emerald-50/40",
        tone === "red" && "border-amber-200 bg-amber-50/50",
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p
        className={cx(
          "mt-2 text-xl font-black tracking-tight text-slate-950",
          tone === "blue" && "text-blue-700",
          tone === "green" && "text-emerald-700",
          tone === "red" && "text-amber-700",
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-1 text-xs font-medium text-slate-600">{detail}</p> : null}
    </div>
  );
}

function formatStableTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unknown";
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function formatStableDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unknown";
  return [
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
    formatStableTime(value),
  ].join(" ");
}

function blockedTextActionLabel(readiness: ReturnType<typeof textReadiness>) {
  if (readiness === "needs_real_phone") return "Enter real phone first";
  if (readiness === "no_phone") return "Add phone to text";
  return "Text";
}

function importReviewStatusLabel(row: ImportReviewRow, issue?: string) {
  if (row.action === "skip") return "Skipped";
  if (issue) return "Needs review";
  if (row.action === "private_route_stop") return "Needs location";
  if (row.action === "create_new") return "Needs confirmation";
  if (row.action === "use_existing") return "Confirmed";
  return "Needs review";
}

function importReviewStatusTone(row: ImportReviewRow, issue?: string): "blue" | "orange" | "green" | "red" | "slate" {
  if (row.action === "skip") return "slate";
  if (issue || row.action === "private_route_stop" || row.action === "create_new") return "orange";
  if (row.action === "use_existing") return "green";
  return "orange";
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-blue-600"
      />
      {label}
    </label>
  );
}

function OpportunityCard({
  opportunity,
  rank,
  selected,
  todayStatus,
  onSelect,
  onReview,
  onMarkContacted,
  onAddTentatively,
  onPreviewRoute,
}: {
  opportunity: Opportunity;
  rank: number;
  selected: boolean;
  todayStatus: TodayStatus;
  onSelect: () => void;
  onReview: () => void;
  onMarkContacted: () => void;
  onAddTentatively: () => void;
  onPreviewRoute: () => void;
}) {
  const contact = primaryContact(opportunity.facility);

  return (
    <article
      className={cx(
        "nmr-panel rounded-3xl p-3 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
        selected ? "border-blue-300 ring-4 ring-blue-100" : "hover:border-blue-200 hover:-translate-y-0.5",
        opportunity.group === "Not Worth It Today" && "bg-slate-50/80 opacity-80",
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-950 text-[11px] font-black text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)]">
                {rank}
              </span>
              <h3 className="truncate text-sm font-bold text-slate-950">{opportunity.facility.name}</h3>
            </div>
            <p className="mt-2 text-2xl font-black tracking-tight text-amber-600">
              +{opportunity.addedDriveMinutes} min off route
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone={opportunity.group === "Not Worth It Today" ? "slate" : "orange"}>
              {opportunity.group}
            </Badge>
            <Badge tone={todayStatusTone(todayStatus)}>{todayStatusLabel(todayStatus)}</Badge>
          </div>
        </div>
        <div className="mt-2 space-y-1 text-[13px] text-slate-600">
          <p>{opportunity.bestInsertionLabel}</p>
          <p>
            {opportunity.nearestStopDistanceMiles} mi from {opportunity.nearestStopName}
          </p>
          <p>Last contacted: {formatDaysAgo(opportunity.facility.lastContacted)}</p>
          <p>Today status: {todayStatusLabel(todayStatus)}</p>
          <p>Contact: {contact ? `${contact.name}, ${contact.role ?? "SLP"}` : "No known contact"}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {opportunity.reasonBadges.slice(0, 4).map((badge) => (
            <Badge key={badge} tone={badge.includes("poor") || badge.includes("Outside") ? "slate" : "green"}>
              {badge}
            </Badge>
          ))}
        </div>
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button tone="primary" ariaLabel="Review fit" onClick={onReview}>
          <MessageSquareText size={15} /> See why this fits
        </Button>
        <Button onClick={onMarkContacted}>
          <Check size={15} /> Text today
        </Button>
        <Button onClick={onAddTentatively}>
          <Plus size={15} /> Add Tentatively
        </Button>
        <Button onClick={onPreviewRoute}>
          <ExternalLink size={15} /> Preview route
        </Button>
      </div>
    </article>
  );
}

function BestAddOnCard({
  opportunity,
  todayStatus,
  onReview,
  onPreview,
  onImport,
}: {
  opportunity?: Opportunity;
  todayStatus?: TodayStatus;
  onReview: () => void;
  onPreview: () => void;
  onImport: () => void;
}) {
  if (!opportunity) {
    return (
      <section className="nmr-panel rounded-3xl border-dashed p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Best add-on now</p>
        <h2 className="mt-2 text-lg font-black text-slate-950">No route add-ons match these filters</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Adjust the detour or contact filters, or import tomorrow&apos;s schedule before reviewing candidates.
        </p>
        <Button className="mt-3 w-full" ariaLabel="Import route" onClick={onImport}>
          <Clipboard size={15} /> Import route
        </Button>
      </section>
    );
  }

  return (
    <section className="nmr-surface overflow-hidden rounded-[1.75rem] p-1.5">
      <div className="rounded-[1.35rem] bg-white/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">Best add-on now</p>
          <h2 className="mt-1 text-xl font-black leading-tight text-slate-950">{opportunity.facility.name}</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">{opportunity.bestInsertionLabel}</p>
        </div>
        <div className="shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
          <p className="text-2xl font-black leading-none text-amber-600">+{opportunity.addedDriveMinutes}</p>
          <p className="mt-1 text-[11px] font-bold uppercase text-amber-700">min detour</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {todayStatus ? <Badge tone={todayStatusTone(todayStatus)}>{todayStatusLabel(todayStatus)}</Badge> : null}
        {opportunity.reasonBadges.slice(0, 3).map((badge) => (
          <Badge key={badge} tone="green">
            {badge}
          </Badge>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button tone="primary" ariaLabel="Review fit" onClick={onReview}>
          <MessageSquareText size={15} /> Review fit
        </Button>
        <Button onClick={onPreview}>
          <ExternalLink size={15} /> Preview route
        </Button>
      </div>
      </div>
    </section>
  );
}

function LocationConfirmationQueue({
  facilities,
  routeStops,
  routeFacilityIds,
  onConfirm,
}: {
  facilities: Facility[];
  routeStops: RouteStop[];
  routeFacilityIds: Set<string>;
  onConfirm: (locationId: string, patch: { address: string; lat: number; lng: number }) => void;
}) {
  const pendingLocations = [
    ...facilities
      .filter((facility) => facility.locationStatus === "needs_confirmation" && routeFacilityIds.has(facility.id))
      .map((facility) => ({ location: facility, isRouteStop: true })),
    ...routeStops
      .filter((stop) => stop.privateLocation?.locationStatus === "needs_confirmation")
      .map((stop) => ({ location: stop.privateLocation as RouteLocation, isRouteStop: true })),
  ].sort((a, b) => Number(b.isRouteStop) - Number(a.isRouteStop) || a.location.name.localeCompare(b.location.name));
  const [activeLocationId, setActiveLocationId] = useState(pendingLocations[0]?.location.id);
  const activeLocation =
    pendingLocations.find(({ location }) => location.id === activeLocationId) ?? pendingLocations[0];

  if (pendingLocations.length === 0) return null;

  return (
    <section data-testid="location-confirmation-queue" className="rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-orange-700">Location review</p>
          <h2 className="mt-1 text-sm font-black text-slate-950">Needs location confirmation</h2>
        </div>
        <Badge tone="orange">{pendingLocations.length}</Badge>
      </div>
      {pendingLocations.length > 1 ? (
        <div className="mt-3 grid gap-2">
          {pendingLocations.map(({ location }, index) => (
            <button
              key={location.id}
              type="button"
              onClick={() => setActiveLocationId(location.id)}
              className={cx(
                "flex items-center justify-between rounded-2xl border px-3 py-2 text-left text-xs font-bold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                activeLocation.location.id === location.id
                  ? "border-amber-300 bg-white text-amber-800 shadow-[0_10px_24px_rgba(180,83,9,0.1)]"
                  : "border-amber-200 bg-amber-100/60 text-amber-700",
              )}
            >
              <span className="truncate">{index + 1}. {location.name}</span>
              {activeLocation.location.id === location.id ? <span>Reviewing</span> : <span>Open</span>}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-3">
        <LocationConfirmationCard
          key={activeLocation.location.id}
          facility={activeLocation.location}
          isRouteStop={activeLocation.isRouteStop}
          onConfirm={onConfirm}
        />
      </div>
    </section>
  );
}

function DesktopRouteOverviewPanel({
  facilities,
  routeStops,
  opportunities,
  outreachLogs,
  todayCounts,
  isCurrentRouteMapsBlocked,
  onExportSummary,
  onOpenCurrentRoute,
}: {
  facilities: Facility[];
  routeStops: RouteStop[];
  opportunities: Opportunity[];
  outreachLogs: OutreachLog[];
  todayCounts: Array<{ status: TodayStatus; label: string; count: number }>;
  isCurrentRouteMapsBlocked: boolean;
  onExportSummary: () => void;
  onOpenCurrentRoute: () => void;
}) {
  const orderedStops = [...routeStops].sort((a, b) => a.order - b.order);
  const activeStopCount = orderedStops.length;
  const studyCount = orderedStops.reduce((sum, stop) => sum + (stop.studyCount ?? 0), 0);
  const bestDetour = opportunities
    .filter((opportunity) => opportunity.group !== "Not Worth It Today")
    .sort((a, b) => a.addedDriveMinutes - b.addedDriveMinutes || b.score - a.score)[0]?.addedDriveMinutes;
  const addedCount = statusCount(todayCounts, "added");
  const waitingCount = statusCount(todayCounts, "waiting");
  const notContactedCount = statusCount(todayCounts, "not_contacted");

  return (
    <aside className="hidden min-h-0 border-r border-slate-200 bg-white/70 xl:flex xl:w-80 xl:flex-col xl:overflow-y-auto">
      <div className="p-5">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700">Route overview</h2>
        <div className="nmr-surface relative mb-4 h-48 overflow-hidden rounded-[1.5rem] p-1">
          <div className="h-full overflow-hidden rounded-[1.15rem] bg-[#e5eeff]">
          <RouteMap
            facilities={facilities}
            routeStops={routeStops}
            opportunities={opportunities}
            outreachLogs={outreachLogs}
            selectedFacilityId={opportunities[0]?.facility.id}
            onSelectFacility={() => undefined}
          />
          </div>
          <div className="absolute left-4 top-4 rounded-full bg-slate-950 px-3 py-1 text-[11px] font-bold text-white shadow-[0_12px_26px_rgba(15,23,42,0.22)]">
            {activeStopCount} Active Stops
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DashboardMetric
            label="Total detour"
            value={bestDetour === undefined ? "--" : `+${bestDetour} min`}
            tone={bestDetour === undefined ? "slate" : "red"}
          />
          <DashboardMetric label="Studies" value={`${studyCount} ${studyCount === 1 ? "Study" : "Studies"}`} />
        </div>
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700">
            Projected day impact
          </h3>
          <div className="nmr-panel space-y-2 rounded-2xl p-3 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-slate-600">Drive Time</span>
              <span className="font-mono text-slate-950">
                baseline <span className="text-red-700">+{bestDetour ?? 0} min</span>
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-600">Route Stops</span>
              <span className="font-mono text-slate-950">{activeStopCount}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-600">Efficiency</span>
              <span className="font-bold text-green-700">{bestDetour === undefined ? "No candidate" : "High fit"}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 p-5">
        <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700">Outreach funnel</h2>
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-3 text-slate-900">
              <span className="h-2 w-2 rounded-full bg-slate-300" /> Not Contacted
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 font-bold text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">{notContactedCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-3 text-slate-900">
              <span className="h-2 w-2 rounded-full bg-blue-400" /> Pending Resp.
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 font-bold text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">{waitingCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-3 text-slate-900">
              <span className="h-2 w-2 rounded-full bg-blue-700" /> Added to Route
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 font-bold text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">{addedCount}</span>
          </div>
        </div>
        <div className="mt-10 grid gap-2">
          <Button
            disabled={isCurrentRouteMapsBlocked}
            ariaLabel={isCurrentRouteMapsBlocked ? "Confirm locations for Maps" : "Open in Google Maps"}
            onClick={onOpenCurrentRoute}
          >
            <ExternalLink size={15} /> {isCurrentRouteMapsBlocked ? "Confirm locations for Maps" : "Open in Google Maps"}
          </Button>
          <Button onClick={onExportSummary}>
            <Download size={15} /> Export Summary
          </Button>
          <Button disabled>
            <RefreshCw size={15} /> Re-calculate Route
          </Button>
        </div>
      </div>
    </aside>
  );
}

function DesktopRouteTable({
  routeStops,
  facilityById,
  featuredOpportunity,
  selectedFacilityId,
  todayStatusByFacilityId,
  routeViewKind,
  locationReview,
  onSelectFacility,
  onReviewFacility,
}: {
  routeStops: RouteStop[];
  facilityById: Map<string, Facility>;
  featuredOpportunity?: Opportunity;
  selectedFacilityId?: string;
  todayStatusByFacilityId: Map<string, TodayStatus>;
  routeViewKind: RouteView["kind"];
  locationReview?: ReactNode;
  onSelectFacility: (facilityId: string) => void;
  onReviewFacility: (facilityId: string) => void;
}) {
  const orderedStops = [...routeStops].sort((a, b) => a.order - b.order);
  const insertAfterStopId = featuredOpportunity?.bestInsertionAfterStopId;
  const rows: Array<{ kind: "stop"; stop: RouteStop } | { kind: "candidate"; opportunity: Opportunity } | { kind: "empty" }> = [];

  orderedStops.forEach((stop, index) => {
    rows.push({ kind: "stop", stop });
    if (featuredOpportunity && stop.id === insertAfterStopId) rows.push({ kind: "candidate", opportunity: featuredOpportunity });
    if (!featuredOpportunity && index === Math.min(1, orderedStops.length - 1)) rows.push({ kind: "empty" });
  });

  return (
    <section className="min-h-0 flex-1 overflow-y-auto border-r border-slate-200 bg-white/82">
      <div className="p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-950">Planned Route: Tomorrow</h2>
            <p className="mt-1 text-base text-slate-700">Scheduled stops and proximity candidates</p>
          </div>
          <select className="nmr-soft-field h-12 rounded-full px-4 text-sm font-bold text-slate-900 focus:ring-1 focus:ring-blue-700">
            <option>Sort by: Route Order</option>
            <option>Sort by: Detour Time</option>
          </select>
        </div>
        {locationReview ? <div className="mb-6">{locationReview}</div> : null}
        <table className="w-full border-separate border-spacing-y-2 text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              <th className="w-14 px-3 py-3 font-bold">Seq</th>
              <th className="px-3 py-3 font-bold">Facility Details</th>
              <th className="w-36 px-3 py-3 font-bold">Status</th>
              <th className="w-40 px-3 py-3 font-bold">Schedule</th>
              <th className="w-36 px-3 py-3 font-bold">Shift</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "empty") {
                return (
                  <tr key="empty-candidates" className="rounded-2xl bg-white/70">
                    <td className="px-3 py-5 text-slate-500">--</td>
                    <td colSpan={4} className="px-3 py-5 text-center italic text-slate-600">
                      No candidates matching filters
                    </td>
                  </tr>
                );
              }

              if (row.kind === "candidate") {
                const opportunity = row.opportunity;
                return (
                  <tr
                    key={`candidate-${opportunity.facility.id}`}
                    className={cx(
                      "cursor-pointer rounded-2xl bg-amber-50/80 align-top shadow-[inset_4px_0_0_rgb(180_83_9),inset_0_1px_0_rgba(255,255,255,0.8)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5",
                    )}
                    onClick={() => onSelectFacility(opportunity.facility.id)}
                  >
                    <td className="rounded-l-2xl px-3 py-5 text-base font-bold text-amber-700">ADD</td>
                    <td className="px-3 py-5">
                      <button type="button" onClick={() => onReviewFacility(opportunity.facility.id)} className="text-left">
                        <span className="flex items-center gap-2">
                          <span className="text-base font-bold text-slate-950">{opportunity.facility.name}</span>
                          <span className="rounded-full bg-amber-700 px-2 py-1 text-[10px] font-bold uppercase leading-none text-white">
                            Best fit
                          </span>
                        </span>
                        <span className="mt-1 block text-sm text-slate-700">
                          Proximity: {opportunity.nearestStopDistanceMiles} miles from {opportunity.nearestStopName}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-5">
                      <Badge tone="orange">+{opportunity.addedDriveMinutes} min detour</Badge>
                    </td>
                    <td className="px-3 py-5">
                      <p className="font-bold text-slate-950">Target Outreach</p>
                      <p className="text-xs text-slate-600">{opportunity.reasonBadges[0] ?? "Route fit"}</p>
                    </td>
                    <td className="px-3 py-5">
                      <p className="font-bold text-amber-700">+{opportunity.addedDriveMinutes} min</p>
                      <p className="text-[11px] uppercase text-slate-600">Impacts next stop</p>
                    </td>
                  </tr>
                );
              }

              const stop = row.stop;
              const facility = facilityById.get(stop.facilityId);
              const location = stop.privateLocation ?? facility;
              const todayStatus = facility ? todayStatusByFacilityId.get(facility.id) : undefined;
              const isSelected = facility?.id === selectedFacilityId;
              return (
                <tr
                  key={stop.id}
                  className={cx(
                    "rounded-2xl bg-white/74 align-top shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    isSelected && "bg-blue-50/90 ring-1 ring-blue-200",
                    routeViewKind === "confirmation" && stop.status === "tentative" && "bg-emerald-50/80",
                  )}
                >
                  <td className={cx("rounded-l-2xl px-3 py-5 text-base font-bold", isSelected ? "text-blue-700" : "text-slate-700")}>
                    {String(stop.order).padStart(2, "0")}
                  </td>
                  <td className="rounded-r-2xl px-3 py-5">
                    <button
                      type="button"
                      disabled={!facility}
                      onClick={() => facility && onSelectFacility(facility.id)}
                      className="block text-left disabled:cursor-default"
                    >
                      <span className={cx("block text-base font-bold", isSelected ? "text-blue-700" : "text-slate-950")}>
                        {location?.name ?? "Unknown facility"}
                      </span>
                      <span className="mt-1 block max-w-56 text-sm text-slate-700">{location?.address}</span>
                    </button>
                  </td>
                  <td className="px-3 py-5">
                    <Badge tone={dashboardBadgeTone(todayStatus ?? stop.status)}>
                      {stop.status === "tentative" ? "Added" : todayStatus ? todayStatusLabel(todayStatus) : friendlyValue(stop.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-5">
                    <p className="font-medium text-slate-950">{stop.appointmentTime ?? "Time TBD"}</p>
                    <p className="text-xs text-slate-600">
                      {stop.studyCount ?? 0} {(stop.studyCount ?? 0) === 1 ? "Study" : "Studies"}
                    </p>
                  </td>
                  <td className="px-3 py-5">
                    {stop.routeImpact ? (
                      <>
                        <p className="font-bold text-red-700">+{stop.routeImpact.addedDriveMinutes} min</p>
                        <p className="text-xs italic text-slate-600">Tentative</p>
                      </>
                    ) : (
                      <span className="text-slate-400">--</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DesktopCandidatePanel({
  facility,
  opportunity,
  todayStatus,
  outreachLogs,
  isOnRoute,
  showAddedSuccess,
  showMessage,
  copyFeedback,
  onCloseMessage,
  onStartText,
  onCopyMessage,
  onMarkTexted,
  onLogStatus,
  onAddRoute,
  onRemoveAddOn,
  onPreviewRoute,
}: {
  facility?: Facility;
  opportunity?: Opportunity;
  todayStatus?: TodayStatus;
  outreachLogs: OutreachLog[];
  isOnRoute: boolean;
  showAddedSuccess: boolean;
  showMessage: boolean;
  copyFeedback?: TextFeedback;
  onCloseMessage: () => void;
  onStartText: () => void;
  onCopyMessage: () => void;
  onMarkTexted: () => void;
  onLogStatus: (status: OutreachStatus, notes: string) => void;
  onAddRoute: () => void;
  onRemoveAddOn: () => void;
  onPreviewRoute: () => void;
}) {
  if (!facility) {
    return (
      <aside className="hidden w-[30rem] bg-slate-50/72 xl:grid xl:place-items-center">
        <div className="max-w-sm px-8 text-center">
          <div className="mx-auto grid h-28 w-28 place-items-center rounded-[2rem] bg-white text-slate-400 shadow-[0_24px_60px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.9)]">
            <Search size={44} />
          </div>
          <h2 className="mt-6 text-2xl font-bold text-slate-950">Select a candidate</h2>
          <p className="mt-4 text-base leading-7 text-slate-700">
            Choose a facility from the route list or map to view integration details and outreach history.
          </p>
        </div>
      </aside>
    );
  }

  const contact = primaryContact(facility);
  const readiness = textReadiness(facility);
  const canText = readiness === "ready";
  const lastLog = outreachLogs[0];
  const conversion = opportunity ? `${Math.min(100, Math.max(0, Math.round(opportunity.score)))}%` : isOnRoute ? "On route" : "--";
  const routeImpactLabel = opportunity
    ? `This stop adds ${opportunity.addedDriveMinutes} minutes near ${opportunity.nearestStopName}.`
    : isOnRoute
      ? "This facility is already part of tomorrow's route."
      : "No route fit is currently available.";
  const textIsBlockedByPhone = copyFeedback === "placeholder_phone" || copyFeedback === "invalid_phone";

  return (
    <aside className="hidden min-h-0 w-[30rem] overflow-y-auto bg-slate-50/72 xl:block">
      <div className="space-y-7 p-8">
        <div className="border-b border-slate-200 pb-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[12px] font-bold uppercase tracking-wide text-blue-700">Candidate detail</p>
            <p className="text-xs font-medium text-slate-700">ID: {facility.id.toUpperCase().slice(0, 8)}</p>
          </div>
          <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">{facility.name}</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DashboardMetric label="Last contact" value={formatDaysAgo(facility.lastContacted)} detail="Target: < 14 Days" />
          <DashboardMetric label="Conversion" value={conversion} detail={opportunity ? "Route fit score" : undefined} tone="green" />
          <DashboardMetric label="Last visit" value={formatDaysAgo(facility.lastVisited)} />
          <DashboardMetric label="Friendly" value={friendlyValue(facility.sameDayFriendly)} />
        </div>

        <section>
          <h3 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-slate-700">Key contact</h3>
          <div className="nmr-surface rounded-[1.5rem] p-1.5">
            <div className="rounded-[1.1rem] bg-white p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            {contact ? (
              <>
                <div className="flex items-center gap-4">
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-sm font-bold text-blue-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    {contact.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-slate-950">
                      {contact.name} <span className="font-medium">({contact.role ?? "SLP Contact"})</span>
                    </p>
                    <p className="text-sm font-medium text-slate-900">{contact.phone ?? contact.email ?? "No phone saved"}</p>
                  </div>
                  <Phone size={18} className="text-blue-700" />
                </div>
                {isPlaceholderPhoneNumber(contact.phone) ? (
                  <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                    Replace this placeholder number before opening Messages.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-medium text-slate-600">No known SLP contact yet.</p>
            )}
            {facility.notes ? (
              <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm italic leading-6 text-slate-800">
                &quot;{facility.notes}&quot;
              </p>
            ) : null}
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-slate-700">Route integration</h3>
          <div className="nmr-surface rounded-[1.5rem] p-1.5">
            <div className="rounded-[1.1rem] bg-white p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e5eeff] text-xs font-bold text-slate-700">02</span>
              <span className="h-2 rounded-full bg-amber-100">
                <span className="block h-2 w-1/3 rounded-full bg-amber-600" />
              </span>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-700 text-[11px] font-bold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)]">ADD</span>
              <span className="h-2 rounded-full bg-[#e5eeff]" />
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e5eeff] text-xs font-bold text-slate-700">03</span>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-800">{routeImpactLabel}</p>
            {opportunity ? (
              <button type="button" onClick={onPreviewRoute} className="mt-3 text-sm font-bold text-blue-700">
                Preview route handoff
              </button>
            ) : null}
            </div>
          </div>
        </section>

        {showAddedSuccess || todayStatus === "added" ? (
          <div className="flex items-center justify-center gap-3 rounded-full bg-emerald-600 px-4 py-3 text-base font-bold text-white shadow-[0_16px_34px_rgba(5,150,105,0.22)]">
            <Check size={18} /> Stop added to route
          </div>
        ) : canText ? (
          <Button className="w-full" tone="primary" onClick={onStartText}>
            <Send size={16} /> Execute Messaging
          </Button>
        ) : (
          <Button className="w-full" disabled>
            <Send size={16} /> {blockedTextActionLabel(readiness)}
          </Button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Button onClick={() => onLogStatus("no_answer", "Waiting for facility response.")}>Mark Waiting</Button>
          <Button onClick={() => onLogStatus("no_patients_today", "Facility replied no appropriate add-ons today.")}>
            Negative Log
          </Button>
          {opportunity && todayStatus !== "added" && todayStatus !== "no_patients_today" && todayStatus !== "do_not_contact" ? (
            <Button tone="primary" ariaLabel="Possible add-on" onClick={() => onLogStatus("possible_add_on", "Facility may have a same-day add-on.")}>
              Mark possible add-on
            </Button>
          ) : null}
        </div>
        {todayStatus === "possible_add_on" && opportunity ? (
          <Button className="w-full" tone="primary" onClick={onAddRoute}>
            <Plus size={15} /> Add to route
          </Button>
        ) : null}
        {showAddedSuccess ? (
          <Button className="w-full" tone="danger" onClick={onRemoveAddOn}>
            <Trash2 size={15} /> Remove tentative stop
          </Button>
        ) : (
          <Button
            className="w-full"
            tone="danger"
            onClick={() => onLogStatus("do_not_contact", "Removed from recommendations from route planning.")}
          >
            Remove from Recommendations
          </Button>
        )}
        {showMessage ? (
          <section className="border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-blue-950">Safe outreach template</h3>
              <Button tone="ghost" onClick={onCloseMessage}>Close</Button>
            </div>
            <textarea
              readOnly
              value={safeMessage()}
              className="mt-2 min-h-36 w-full resize-none rounded-md border border-blue-200 bg-white p-3 text-sm leading-6 text-slate-800"
            />
            <p className="mt-2 text-xs font-medium text-blue-800">
              Facility-level only. No patient names or clinical details.
            </p>
            {copyFeedback === "opened" ? (
              <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-800">
                Template copied and Messages opened. Return here after sending, then mark this facility texted.
              </p>
            ) : null}
            {copyFeedback === "copied" ? (
              <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-800">
                Template copied.
              </p>
            ) : null}
            {copyFeedback === "fallback_copied" ? (
              <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
                Template copied. Open Messages on your phone, then mark this facility texted.
              </p>
            ) : null}
            {copyFeedback === "no_phone" ? (
              <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
                No phone number is saved. Use the visible template manually, then mark this facility texted.
              </p>
            ) : null}
            {copyFeedback === "placeholder_phone" ? (
              <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
                This contact still has a placeholder 555 number. Edit the phone number before opening Messages.
              </p>
            ) : null}
            {copyFeedback === "invalid_phone" ? (
              <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
                This contact does not have a dialable phone number. Enter a real phone number before opening Messages.
              </p>
            ) : null}
            {copyFeedback === "failed" ? (
              <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
                Clipboard was blocked. The message is visible above so you can copy it manually.
              </p>
            ) : null}
            {!textIsBlockedByPhone ? (
              <Button tone="primary" className="mt-3 w-full" onClick={onCopyMessage}>
                <Clipboard size={15} /> Copy message
              </Button>
            ) : null}
            {!textIsBlockedByPhone ? (
              <Button className="mt-2 w-full" onClick={onMarkTexted}>
                <Check size={15} /> Mark texted
              </Button>
            ) : null}
          </section>
        ) : null}
        {lastLog ? (
          <p className="border-t border-slate-300 pt-4 text-xs font-medium text-slate-600">
            Last outreach event: {todayStatusLabel(todayStatus ?? "not_contacted")} at {formatStableTime(lastLog.createdAt)}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function DesktopRouteDashboard({
  facilities,
  routeStops,
  opportunities,
  outreachLogs,
  selectedFacility,
  selectedOpportunity,
  selectedTodayStatus,
  selectedOutreachLogs,
  featuredOpportunity,
  facilityById,
  todayStatusByFacilityId,
  todayCounts,
  routeViewKind,
  showAddedSuccess,
  locationReview,
  isCurrentRouteMapsBlocked,
  showMessage,
  copyFeedback,
  onSelectFacility,
  onReviewFacility,
  onExportSummary,
  onOpenCurrentRoute,
  onCloseMessage,
  onStartText,
  onCopyMessage,
  onMarkTexted,
  onLogStatus,
  onAddRoute,
  onRemoveAddOn,
  onPreviewRoute,
}: {
  facilities: Facility[];
  routeStops: RouteStop[];
  opportunities: Opportunity[];
  outreachLogs: OutreachLog[];
  selectedFacility?: Facility;
  selectedOpportunity?: Opportunity;
  selectedTodayStatus?: TodayStatus;
  selectedOutreachLogs: OutreachLog[];
  featuredOpportunity?: Opportunity;
  facilityById: Map<string, Facility>;
  todayStatusByFacilityId: Map<string, TodayStatus>;
  todayCounts: Array<{ status: TodayStatus; label: string; count: number }>;
  routeViewKind: RouteView["kind"];
  showAddedSuccess: boolean;
  locationReview?: ReactNode;
  isCurrentRouteMapsBlocked: boolean;
  showMessage: boolean;
  copyFeedback?: TextFeedback;
  onSelectFacility: (facilityId: string) => void;
  onReviewFacility: (facilityId: string) => void;
  onExportSummary: () => void;
  onOpenCurrentRoute: () => void;
  onCloseMessage: () => void;
  onStartText: () => void;
  onCopyMessage: () => void;
  onMarkTexted: () => void;
  onLogStatus: (status: OutreachStatus, notes: string) => void;
  onAddRoute: () => void;
  onRemoveAddOn: () => void;
  onPreviewRoute: () => void;
}) {
  const dashboardFacility = showAddedSuccess ? selectedFacility : selectedFacility ?? featuredOpportunity?.facility;
  const dashboardOpportunity =
    dashboardFacility && featuredOpportunity?.facility.id === dashboardFacility.id
      ? selectedOpportunity ?? featuredOpportunity
      : selectedOpportunity?.facility.id === dashboardFacility?.id
        ? selectedOpportunity
        : undefined;
  const dashboardTodayStatus = dashboardFacility ? todayStatusByFacilityId.get(dashboardFacility.id) : undefined;
  const dashboardOutreachLogs = dashboardFacility
    ? outreachLogs.filter((log) => log.facilityId === dashboardFacility.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return (
    <div className="nmr-enter relative hidden min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white/55 shadow-[0_24px_80px_rgba(15,23,42,0.08)] xl:flex">
      {showAddedSuccess ? (
        <div className="absolute left-1/2 top-4 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-emerald-600 px-6 py-3 text-base font-bold text-white shadow-[0_18px_38px_rgba(5,150,105,0.24)]">
          <CheckCircle size={20} /> Stop added to route successfully
        </div>
      ) : null}
      <DesktopRouteOverviewPanel
        facilities={facilities}
        routeStops={routeStops}
        opportunities={opportunities}
        outreachLogs={outreachLogs}
        todayCounts={todayCounts}
        isCurrentRouteMapsBlocked={isCurrentRouteMapsBlocked}
        onExportSummary={onExportSummary}
        onOpenCurrentRoute={onOpenCurrentRoute}
      />
      <DesktopRouteTable
        routeStops={routeStops}
        facilityById={facilityById}
        featuredOpportunity={showAddedSuccess ? undefined : featuredOpportunity}
        selectedFacilityId={dashboardFacility?.id}
        todayStatusByFacilityId={todayStatusByFacilityId}
        routeViewKind={routeViewKind}
        locationReview={locationReview}
        onSelectFacility={onSelectFacility}
        onReviewFacility={onReviewFacility}
      />
      <DesktopCandidatePanel
        facility={dashboardFacility}
        opportunity={dashboardOpportunity}
        todayStatus={dashboardTodayStatus ?? selectedTodayStatus}
        outreachLogs={dashboardOutreachLogs.length > 0 ? dashboardOutreachLogs : selectedOutreachLogs}
        isOnRoute={Boolean(dashboardFacility && routeStops.some((stop) => stop.facilityId === dashboardFacility.id))}
        showAddedSuccess={showAddedSuccess}
        showMessage={showMessage}
        copyFeedback={dashboardFacility ? copyFeedback : undefined}
        onCloseMessage={onCloseMessage}
        onStartText={onStartText}
        onCopyMessage={onCopyMessage}
        onMarkTexted={onMarkTexted}
        onLogStatus={onLogStatus}
        onAddRoute={onAddRoute}
        onRemoveAddOn={onRemoveAddOn}
        onPreviewRoute={onPreviewRoute}
      />
    </div>
  );
}

function LocationConfirmationCard({
  facility,
  isRouteStop,
  onConfirm,
}: {
  facility: RouteLocation;
  isRouteStop: boolean;
  onConfirm: (locationId: string, patch: { address: string; lat: number; lng: number }) => void;
}) {
  const [address, setAddress] = useState(facility.address);
  const [lat, setLat] = useState(String(facility.lat));
  const [lng, setLng] = useState(String(facility.lng));
  const [mapsUrl, setMapsUrl] = useState("");
  const [mapsUrlIssue, setMapsUrlIssue] = useState<string | undefined>();
  const [mapsUrlSuccess, setMapsUrlSuccess] = useState<string | undefined>();
  const [issue, setIssue] = useState<string | undefined>();
  const parsedLat = parseCoordinate(lat);
  const parsedLng = parseCoordinate(lng);
  const hasFallbackCoordinates = Number.isFinite(parsedLat) && Number.isFinite(parsedLng) && isFallbackLocation({ lat: parsedLat, lng: parsedLng });
  const hasMapsUrl = Boolean(mapsUrl.trim());
  const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [facility.name, address].filter(Boolean).join(", "),
  )}`;

  function parseCoordinate(value: string) {
    const trimmed = value.trim();
    return trimmed ? Number(trimmed) : Number.NaN;
  }

  function useCoordinatesFromMapsUrl() {
    const parsedCoordinates = parseGoogleMapsCoordinates(mapsUrl);
    setMapsUrlSuccess(undefined);
    if (!mapsUrl.trim()) {
      setMapsUrlIssue("Paste a Google Maps URL before using coordinates from it.");
      return;
    }
    if (!parsedCoordinates) {
      setMapsUrlIssue(
        mapsUrl.toLowerCase().includes("/maps/search/")
          ? "This looks like a Google Maps search URL, not a resolved pin URL. Open it in Google Maps, select the facility pin, then copy a URL that includes @latitude,longitude or !3d/!4d coordinates."
          : "No usable coordinates were found in that Google Maps URL.",
      );
      return;
    }

    setLat(String(parsedCoordinates.lat));
    setLng(String(parsedCoordinates.lng));
    setIssue(undefined);
    setMapsUrlIssue(undefined);
    setMapsUrlSuccess(
      parsedCoordinates.source === "place"
        ? "Coordinates added from Google Maps URL. Confirm the pin is correct before saving."
        : "Coordinates came from the visible Google Maps URL. Confirm the pin is on the right facility before saving.",
    );
  }

  function confirmLocation() {
    const nextLocation = {
      address: address.trim(),
      lat: parseCoordinate(lat),
      lng: parseCoordinate(lng),
    };
    const nextIssue = locationConfirmationIssue(nextLocation);
    setIssue(nextIssue);
    if (nextIssue) return;
    onConfirm(facility.id, nextLocation);
  }

  return (
    <article className="rounded-[1.35rem] border border-amber-200 bg-white p-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-black text-slate-950">{facility.name}</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Source: {friendlyValue(facility.locationSource ?? "import")}
          </p>
        </div>
        {isRouteStop ? <Badge tone="orange">On route</Badge> : null}
      </div>
      <label className="mt-3 block text-[11px] font-bold uppercase text-slate-500">
        Address
        <input
          aria-label={`Address for ${facility.name}`}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="nmr-soft-field mt-1 h-9 w-full rounded-full px-3 text-sm font-semibold normal-case text-slate-900"
        />
      </label>
      <a
        href={mapsSearchUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-blue-700 hover:border-blue-300"
      >
        <ExternalLink size={13} /> Open address in Google Maps
      </a>
      {hasFallbackCoordinates ? (
        <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
          These are placeholder Houston coordinates. Open the address in Google Maps, then replace latitude and longitude before confirming.
        </p>
      ) : null}
      <label className="mt-3 block text-[11px] font-bold uppercase text-slate-500">
        Google Maps URL
        <input
          aria-label={`Google Maps URL for ${facility.name}`}
          value={mapsUrl}
          onChange={(event) => {
            setMapsUrl(event.target.value);
            setMapsUrlIssue(undefined);
            setMapsUrlSuccess(undefined);
          }}
          placeholder="Paste Google Maps URL"
          className="nmr-soft-field mt-1 h-9 w-full rounded-full px-3 text-sm font-semibold normal-case text-slate-900"
        />
      </label>
      <p className="mt-1 text-xs font-semibold text-slate-500">
        Paste the Maps URL after opening the address. We&apos;ll extract coordinates if they are present.
      </p>
      <Button className="mt-2 w-full" tone="secondary" disabled={!hasMapsUrl} onClick={useCoordinatesFromMapsUrl}>
        {hasMapsUrl ? "Use coordinates from URL" : "Paste Maps URL first"}
      </Button>
      {mapsUrlIssue ? (
        <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
          {mapsUrlIssue}
        </p>
      ) : null}
      {mapsUrlSuccess ? (
        <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-800">
          {mapsUrlSuccess}
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block text-[11px] font-bold uppercase text-slate-500">
          Latitude
          <input
            aria-label={`Latitude for ${facility.name}`}
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            inputMode="decimal"
            className="nmr-soft-field mt-1 h-9 w-full rounded-full px-3 text-sm font-semibold normal-case text-slate-900"
          />
        </label>
        <label className="block text-[11px] font-bold uppercase text-slate-500">
          Longitude
          <input
            aria-label={`Longitude for ${facility.name}`}
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            inputMode="decimal"
            className="nmr-soft-field mt-1 h-9 w-full rounded-full px-3 text-sm font-semibold normal-case text-slate-900"
          />
        </label>
      </div>
      {issue ? (
        <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
          {issue}
        </p>
      ) : null}
      <Button className="mt-3 w-full" tone="primary" onClick={confirmLocation}>
        <Check size={15} /> Confirm Location
      </Button>
    </article>
  );
}

function DogfoodChecklist({
  checked,
  notes,
  notesWarning,
  className,
  onToggle,
  onNotesChange,
}: {
  checked: Record<string, boolean>;
  notes: string;
  notesWarning?: string;
  className?: string;
  onToggle: (taskId: string, checked: boolean) => void;
  onNotesChange: (notes: string) => void;
}) {
  const completed = dogfoodTasks.filter((task) => checked[task.id]).length;

  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Dogfood run</p>
          <h2 className="mt-1 text-sm font-black text-slate-950">One real route checklist</h2>
        </div>
        <Badge tone={completed === dogfoodTasks.length ? "green" : "blue"}>
          {completed}/{dogfoodTasks.length}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2">
        {dogfoodTasks.map((task) => (
          <label key={task.id} className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(checked[task.id])}
              onChange={(event) => onToggle(task.id, event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            {task.label}
          </label>
        ))}
      </div>
      <label className="mt-3 block text-xs font-bold uppercase text-slate-500">
        Dogfood notes
        <textarea
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="Write what felt slow, unclear, or manual. Note wording, route changes, and tool switches."
          className="mt-1 min-h-24 w-full resize-y rounded-md border border-slate-200 p-2 text-sm font-medium normal-case text-slate-900"
        />
      </label>
      {notesWarning ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold normal-case text-red-800">
          {notesWarning}
        </p>
      ) : null}
      <p className="mt-2 text-xs font-semibold text-slate-500">
        Capture workflow friction, not patient details.
      </p>
    </section>
  );
}

function DetailDrawer({
  facility,
  opportunity,
  todayStatus,
  outreachLogs,
  showMessage,
  isOnRoute = false,
  className,
  onCloseMessage,
  onCall,
  onStartText,
  onCopyMessage,
  onMarkTexted,
  onClearDoNotContact,
  onUpdateContactPhone,
  onLogStatus,
  onAddRoute,
  onRemoveAddOn,
  onPreviewRoute,
  onOpenRoute,
  copyFeedback,
}: {
  facility?: Facility;
  opportunity?: Opportunity;
  todayStatus?: TodayStatus;
  outreachLogs: OutreachLog[];
  showMessage: boolean;
  isOnRoute?: boolean;
  className?: string;
  onCloseMessage: () => void;
  onCall: () => void;
  onStartText: () => void;
  onCopyMessage: () => void;
  onMarkTexted: () => void;
  onClearDoNotContact: () => void;
  onUpdateContactPhone: (contactId: string, phone: string) => void;
  onLogStatus: (status: OutreachStatus, notes: string) => void;
  onAddRoute: () => void;
  onRemoveAddOn: () => void;
  onPreviewRoute: () => void;
  onOpenRoute: () => void;
  copyFeedback?: TextFeedback;
}) {
  if (!facility) {
    return (
      <aside className={cx("hidden w-[360px] shrink-0 border-l border-slate-200 bg-white p-4 xl:block", className)}>
        <div className="grid h-full place-items-center rounded-lg border border-dashed border-slate-200 text-center text-sm text-slate-500">
          Select a facility to view contacts, notes, and route fit.
        </div>
      </aside>
    );
  }

  const message = safeMessage();
  const canAddRoute = Boolean(opportunity);
  const canContact = todayStatus !== "do_not_contact";
  const readiness = textReadiness(facility);
  const canStartText = readiness === "ready";
  const textIsBlockedByPhone = copyFeedback === "placeholder_phone" || copyFeedback === "invalid_phone";
  const responseActions =
    todayStatus === "added" || todayStatus === "no_patients_today" || todayStatus === "do_not_contact"
      ? []
      : [
          <Button key="waiting" onClick={() => onLogStatus("no_answer", "Waiting for facility response.")}>
            <Timer size={15} /> Waiting
          </Button>,
          <Button key="no-patients" onClick={() => onLogStatus("no_patients_today", "Facility replied no appropriate add-ons today.")}>
            No patients today
          </Button>,
          canAddRoute ? (
            <Button key="possible" tone="primary" ariaLabel="Possible add-on" onClick={() => onLogStatus("possible_add_on", "Facility may have a same-day add-on.")}>
              Mark possible add-on
            </Button>
          ) : null,
        ];

  return (
    <aside className={cx("w-full shrink-0 border-t border-slate-200 bg-white p-4 pb-28 xl:w-[380px] xl:border-l xl:border-t-0 xl:pb-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-950">{facility.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{facility.address}</p>
        </div>
        <Badge tone={todayStatus ? todayStatusTone(todayStatus) : facility.doNotContact ? "red" : "slate"}>
          {todayStatus ? todayStatusLabel(todayStatus) : facility.doNotContact ? "Do not contact" : "Not contacted"}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-bold uppercase text-slate-500">Added drive</p>
          <p className="mt-1 text-xl font-black text-orange-600">
            {opportunity ? `+${opportunity.addedDriveMinutes} min` : isOnRoute ? "On route" : "No match"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-bold uppercase text-slate-500">Nearest stop</p>
          <p className="mt-1 text-sm font-bold text-slate-900">
            {opportunity ? opportunity.nearestStopName : isOnRoute ? "Scheduled stop" : "Adjust filters"}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="font-semibold text-slate-500">Last contacted</dt>
          <dd className="font-bold text-slate-900">{formatDaysAgo(facility.lastContacted)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Last visited</dt>
          <dd className="font-bold text-slate-900">{formatDaysAgo(facility.lastVisited)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Same-day friendly</dt>
          <dd className="font-bold text-slate-900">{friendlyValue(facility.sameDayFriendly)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Typical volume</dt>
          <dd className="font-bold text-slate-900">{friendlyValue(facility.typicalVolume)}</dd>
        </div>
      </dl>

      {!hasConfirmedLocation(facility) ? (
        <p className="mt-4 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800">
          Location needs confirmation before route ranking.
        </p>
      ) : null}

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[900] mt-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur xl:hidden">
        <Button onClick={onOpenRoute}>
          <ArrowLeft size={15} /> Back to route
        </Button>
        {canAddRoute && todayStatus !== "added" ? (
          <Button tone="primary" onClick={onAddRoute}>
            <Plus size={15} /> Add to route
          </Button>
        ) : opportunity ? (
          <Button onClick={onPreviewRoute}>
            <ExternalLink size={15} /> Preview route
          </Button>
        ) : (
          <Button disabled>Route fit unavailable</Button>
        )}
      </div>

      <section className="mt-5">
        <h3 className="text-sm font-black text-slate-900">Contacts</h3>
        <div className="mt-2 space-y-2">
          {facility.contacts.length > 0 ? (
            facility.contacts.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-900">{item.name}</p>
                  {item.primary ? <Badge tone="blue">Primary</Badge> : null}
                </div>
                <p className="mt-1 text-slate-500">{item.role ?? "SLP Contact"}</p>
                <label className="mt-2 block text-[11px] font-bold uppercase text-slate-500">
                  Phone
                  <input
                    aria-label={`Phone for ${item.name}`}
                    value={item.phone ?? ""}
                    onChange={(event) => onUpdateContactPhone(item.id, event.target.value)}
                    placeholder="Add phone number"
                    inputMode="tel"
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold normal-case text-slate-900"
                  />
                </label>
                {isPlaceholderPhoneNumber(item.phone) ? (
                  <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
                    Replace this placeholder number before opening Messages.
                  </p>
                ) : null}
                {!item.phone && item.email ? <p className="mt-2 text-xs font-semibold text-slate-500">{item.email}</p> : null}
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
              No known SLP contact yet.
            </p>
          )}
        </div>
      </section>

      <section className="mt-5">
        <h3 className="text-sm font-black text-slate-900">Notes</h3>
        <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">
          {facility.notes || "No notes yet."}
        </p>
      </section>

      <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-slate-900">Log response</h3>
          {todayStatus ? <Badge tone={todayStatusTone(todayStatus)}>{todayStatusLabel(todayStatus)}</Badge> : null}
        </div>
        {todayStatus === "added" ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={onOpenRoute}>
              <ExternalLink size={15} /> Route
            </Button>
            <Button tone="danger" onClick={onRemoveAddOn}>
              <Trash2 size={15} /> Remove
            </Button>
          </div>
        ) : null}
        {todayStatus === "not_contacted" ? (
          <Button className="mt-3 w-full" tone={canStartText ? "primary" : "secondary"} disabled={!canStartText} onClick={onStartText}>
            <Send size={15} /> {canStartText ? "Open Messages" : blockedTextActionLabel(readiness)}
          </Button>
        ) : null}
        {responseActions.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2">{responseActions}</div> : null}
        {todayStatus === "possible_add_on" && canAddRoute ? (
          <Button className="mt-2 w-full" tone="primary" onClick={onAddRoute}>
            <Plus size={15} /> Add to route
          </Button>
        ) : null}
        {todayStatus === "possible_add_on" && !canAddRoute ? (
          <p className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
            Already on the route or no route fit is available.
          </p>
        ) : null}
        {todayStatus !== "do_not_contact" ? (
          <Button
            className="mt-2 w-full"
            tone="danger"
            onClick={() => onLogStatus("do_not_contact", "Marked do not contact from today's response.")}
          >
            Do not contact
          </Button>
        ) : (
          <Button className="mt-2 w-full" onClick={onClearDoNotContact}>
            <RotateCcw size={15} /> Clear do not contact
          </Button>
        )}
      </section>

      {canContact || opportunity ? (
        <section className="mt-5">
          <h3 className="text-sm font-black text-slate-900">Support tools</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {canContact ? (
              <Button onClick={onCall}>
                <Phone size={15} /> Call
              </Button>
            ) : null}
            {opportunity ? (
              <Button onClick={onPreviewRoute}>
                <ExternalLink size={15} /> Preview route
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {showMessage ? (
        <section className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-blue-950">Safe outreach template</h3>
            <Button tone="ghost" onClick={onCloseMessage}>Close</Button>
          </div>
          <textarea
            readOnly
            value={message}
            className="mt-2 min-h-36 w-full resize-none rounded-md border border-blue-200 bg-white p-3 text-sm leading-6 text-slate-800"
          />
          <p className="mt-2 text-xs font-medium text-blue-800">
            Facility-level only. No patient names or clinical details.
          </p>
          {copyFeedback === "opened" ? (
            <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-800">
              Template copied and Messages opened. Return here after sending, then mark this facility texted.
            </p>
          ) : null}
          {copyFeedback === "copied" ? (
            <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-800">
              Template copied.
            </p>
          ) : null}
          {copyFeedback === "fallback_copied" ? (
            <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
              Template copied. Open Messages on your phone, then mark this facility texted.
            </p>
          ) : null}
          {copyFeedback === "no_phone" ? (
            <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
              No phone number is saved. Use the visible template manually, then mark this facility texted.
            </p>
          ) : null}
          {copyFeedback === "placeholder_phone" ? (
            <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
              This contact still has a placeholder 555 number. Edit the phone number before opening Messages.
            </p>
          ) : null}
          {copyFeedback === "invalid_phone" ? (
            <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
              This contact does not have a dialable phone number. Enter a real phone number before opening Messages.
            </p>
          ) : null}
          {copyFeedback === "failed" ? (
            <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
              Clipboard was blocked. The message is visible above so you can copy it manually.
            </p>
          ) : null}
          {!textIsBlockedByPhone ? (
            <Button tone="primary" className="mt-3 w-full" onClick={onCopyMessage}>
              <Clipboard size={15} /> Copy message
            </Button>
          ) : null}
          {!textIsBlockedByPhone ? (
            <Button className="mt-2 w-full" onClick={onMarkTexted}>
              <Check size={15} /> Mark texted
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="mt-5">
        <h3 className="text-sm font-black text-slate-900">Outreach history</h3>
        <div className="mt-2 space-y-2">
          {outreachLogs.length > 0 ? (
            outreachLogs.map((log) => (
              <div key={log.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-bold text-slate-900">{friendlyValue(log.status)}</p>
                <p className="text-slate-500">
                  {formatStableDateTime(log.createdAt)} - {friendlyValue(log.method)}
                </p>
                {log.notes ? <p className="mt-1 text-slate-600">{log.notes}</p> : null}
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
              No outreach logged yet.
            </p>
          )}
        </div>
      </section>
    </aside>
  );
}

function TodayStatusStrip({ counts }: { counts: Array<{ status: TodayStatus; label: string; count: number }> }) {
  const visibleCounts = counts.filter(({ count }) => count > 0);

  if (visibleCounts.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-500">
        No outreach statuses logged yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {visibleCounts.map(({ status, label, count }) => (
        <div key={status} className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-black text-slate-950">{count}</p>
        </div>
      ))}
    </div>
  );
}

function ContactSetupPanel({
  facility,
  defaultOpen = false,
  onAddContact,
  onUpdateContact,
}: {
  facility: Facility;
  defaultOpen?: boolean;
  onAddContact: () => void;
  onUpdateContact: (contactId: string, patch: Partial<FacilityContact>) => void;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const readiness = textReadiness(facility);
  const readyContact = textReadyContacts(facility)[0];
  const readinessCopy =
    readiness === "ready"
      ? `Phone ready${readyContact ? ` for ${readyContact.name}` : ""}.`
      : readiness === "needs_real_phone"
        ? "Replace placeholder or invalid numbers before texting."
        : "Add a phone-capable contact before texting.";

  return (
    <details
      data-testid={`contact-setup-${facility.id}`}
      className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-black text-slate-950">
        Contact setup
        <span className="ml-2 align-middle text-xs font-bold text-slate-500">{readiness === "ready" ? "Phone ready" : "Needs phone"}</span>
      </summary>
      <p className={cx("mt-2 text-xs font-bold", readiness === "ready" ? "text-green-700" : "text-orange-700")}>{readinessCopy}</p>
      <div className="mt-3 grid gap-3">
        {facility.contacts.map((contact, index) => (
          <div key={contact.id} data-testid={`contact-editor-${contact.id}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-600">
                <input
                  type="radio"
                  name={`recommended-${facility.id}`}
                  checked={Boolean(contact.primary)}
                  onChange={() => onUpdateContact(contact.id, { primary: true })}
                  className="h-4 w-4 border-slate-300 text-blue-600"
                />
                Recommended
              </label>
              {isPlaceholderPhoneNumber(contact.phone) ? (
                <Badge tone="orange">Placeholder phone</Badge>
              ) : contact.phone && !isDialablePhoneNumber(contact.phone) ? (
                <Badge tone="orange">Invalid phone</Badge>
              ) : contact.phone ? (
                <Badge tone="green">Phone ready</Badge>
              ) : (
                <Badge tone="orange">No phone</Badge>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] font-bold uppercase text-slate-500">
                Name
                <input
                  aria-label={`Contact name for ${contact.name || `contact ${index + 1}`}`}
                  value={contact.name}
                  onChange={(event) => onUpdateContact(contact.id, { name: event.target.value })}
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold normal-case text-slate-900"
                />
              </label>
              <label className="text-[11px] font-bold uppercase text-slate-500">
                Role
                <input
                  aria-label={`Role for ${contact.name || `contact ${index + 1}`}`}
                  value={contact.role ?? ""}
                  onChange={(event) => onUpdateContact(contact.id, { role: event.target.value })}
                  placeholder="SLP"
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold normal-case text-slate-900"
                />
              </label>
              <label className="text-[11px] font-bold uppercase text-slate-500">
                Phone
                <input
                  aria-label={`Phone for ${contact.name || `contact ${index + 1}`}`}
                  value={contact.phone ?? ""}
                  onChange={(event) => onUpdateContact(contact.id, { phone: event.target.value })}
                  placeholder="Add phone number"
                  inputMode="tel"
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold normal-case text-slate-900"
                />
              </label>
              <label className="text-[11px] font-bold uppercase text-slate-500">
                Method
                <select
                  aria-label={`Preferred method for ${contact.name || `contact ${index + 1}`}`}
                  value={contact.preferredMethod ?? "text"}
                  onChange={(event) => onUpdateContact(contact.id, { preferredMethod: event.target.value as PreferredMethod })}
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold normal-case text-slate-900"
                >
                  <option value="text">Text</option>
                  <option value="call">Call</option>
                  <option value="email">Email</option>
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
      <Button className="mt-3 w-full" onClick={onAddContact}>
        <Plus size={15} /> Add contact
      </Button>
    </details>
  );
}

function OutreachQueueCard({
  facility,
  opportunity,
  status,
  latestLog,
  reasonLabels,
  onAddContact,
  onUpdateContact,
  onReview,
  onTemplate,
  onLogStatus,
  onAddRoute,
  onOpenRoute,
  onRemoveAddOn,
}: {
  facility: Facility;
  opportunity?: Opportunity;
  status: TodayStatus;
  latestLog?: OutreachLog;
  reasonLabels: string[];
  onAddContact: () => void;
  onUpdateContact: (contactId: string, patch: Partial<FacilityContact>) => void;
  onReview: () => void;
  onTemplate: () => void;
  onLogStatus: (status: OutreachStatus, notes: string) => void;
  onAddRoute: () => void;
  onOpenRoute: () => void;
  onRemoveAddOn: () => void;
}) {
  const readiness = textReadiness(facility);
  const contact =
    readiness === "ready"
      ? textReadyContacts(facility)[0] ?? primaryContact(facility)
      : primaryContact(facility);
  const canAddRoute = Boolean(opportunity);
  const actionButtons: React.ReactNode[] = [];

  if (status === "not_contacted") {
    actionButtons.push(
      readiness === "ready" ? (
        <Button key="text" tone="primary" onClick={onTemplate}>
          <Send size={15} /> Text
        </Button>
      ) : (
        <Button key="text-blocked" disabled>
          {blockedTextActionLabel(readiness)}
        </Button>
      ),
    );
  }

  if (status === "texted_today" || status === "waiting") {
    actionButtons.push(
      <Button key="waiting" tone={status === "texted_today" ? "primary" : "secondary"} onClick={() => onLogStatus("no_answer", "Waiting for facility response.")}>
        <Timer size={15} /> Waiting
      </Button>,
      <Button key="no-patients" onClick={() => onLogStatus("no_patients_today", "Facility replied no appropriate add-ons today.")}>
        No patients
      </Button>,
      <Button key="possible" ariaLabel="Possible add-on" onClick={() => onLogStatus("possible_add_on", "Facility may have a same-day add-on.")}>
        Mark possible add-on
      </Button>,
    );
  }

  if (status === "possible_add_on") {
    if (canAddRoute) {
      actionButtons.push(
        <Button key="add" tone="primary" onClick={onAddRoute}>
          <Plus size={15} /> Add
        </Button>,
      );
    }
    actionButtons.push(
      <Button key="waiting" onClick={() => onLogStatus("no_answer", "Waiting for facility response.")}>
        <Timer size={15} /> Waiting
      </Button>,
      <Button key="no-patients" onClick={() => onLogStatus("no_patients_today", "Facility replied no appropriate add-ons today.")}>
        No patients
      </Button>,
    );
  }

  if (status === "added") {
    actionButtons.push(
      <Button key="route" tone="primary" onClick={onOpenRoute}>
        <ExternalLink size={15} /> Route
      </Button>,
      <Button key="remove" tone="danger" onClick={onRemoveAddOn}>
        <Trash2 size={15} /> Remove
      </Button>,
    );
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <button type="button" onClick={onReview} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-slate-950">{facility.name}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {opportunity ? `+${opportunity.addedDriveMinutes} min - ${opportunity.bestInsertionLabel}` : facility.address}
            </p>
          </div>
          <Badge tone={todayStatusTone(status)}>{todayStatusLabel(status)}</Badge>
        </div>
        <p className="mt-2 text-sm font-semibold text-slate-900">
          {contact ? `${contact.name}, ${contact.role ?? "SLP"}` : "No known contact"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {latestLog ? `${formatStableTime(latestLog.createdAt)} - ${friendlyValue(latestLog.status)}` : "No update logged today"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reasonLabels.map((label) => (
            <Badge
              key={label}
              tone={label.includes("Needs") || label.includes("No phone") ? "orange" : label.includes("friendly") || label.includes("ready") ? "green" : "slate"}
            >
              {label}
            </Badge>
          ))}
        </div>
      </button>
      {status === "not_contacted" && readiness !== "ready" ? (
        <ContactSetupPanel
          facility={facility}
          onAddContact={onAddContact}
          onUpdateContact={onUpdateContact}
        />
      ) : null}
      {actionButtons.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2">{actionButtons}</div> : null}
      {status === "possible_add_on" && !canAddRoute ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          No add-on route fit is available for this facility.
        </p>
      ) : null}
      {status === "no_patients_today" || status === "do_not_contact" ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          Closed for today. Open the card to review details.
        </p>
      ) : null}
    </article>
  );
}

function TextFirstCard({
  item,
  onAddContact,
  onUpdateContact,
  onText,
  onReview,
}: {
  item?: OutreachQueueItem;
  onAddContact: () => void;
  onUpdateContact: (contactId: string, patch: Partial<FacilityContact>) => void;
  onText: () => void;
  onReview: () => void;
}) {
  if (!item) {
    return (
    <section data-testid="text-first-card" className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Text first</p>
        <h3 className="mt-1 text-base font-black text-slate-950">No uncontacted facility needs a text right now</h3>
      </section>
    );
  }

  const readiness = textReadiness(item.facility);
  const contact =
    readiness === "ready"
      ? textReadyContacts(item.facility)[0] ?? primaryContact(item.facility)
      : primaryContact(item.facility);
  const readinessLabel = readiness === "ready" ? "Ready to text" : readiness === "needs_real_phone" ? "Needs real phone" : "Needs phone";
  const labels = outreachReasonLabels(item).filter((label) => label !== readinessLabel);

  return (
    <section data-testid="text-first-card" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Text first</p>
          <h3 className="mt-1 truncate text-xl font-black text-slate-950">{item.facility.name}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-700">
            {item.opportunity ? `+${item.opportunity.addedDriveMinutes} min - ${item.opportunity.bestInsertionLabel}` : item.facility.address}
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            {contact ? `${contact.name}, ${contact.role ?? "SLP Contact"}` : "No known contact"}
          </p>
        </div>
        <Badge tone={readiness === "ready" ? "green" : "orange"}>{readinessLabel}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {labels.map((label) => (
          <Badge
            key={label}
            tone={label.includes("Needs") || label.includes("No phone") ? "orange" : label.includes("friendly") || label.includes("ready") ? "green" : "slate"}
          >
            {label}
          </Badge>
        ))}
      </div>
      <ContactSetupPanel
        facility={item.facility}
        defaultOpen={readiness !== "ready"}
        onAddContact={onAddContact}
        onUpdateContact={onUpdateContact}
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button tone={readiness === "ready" ? "primary" : "secondary"} disabled={readiness !== "ready"} onClick={onText}>
          <Send size={15} /> {readiness === "ready" ? "Text" : blockedTextActionLabel(readiness)}
        </Button>
        <Button onClick={onReview}>
          <MessageSquareText size={15} /> Review
        </Button>
      </div>
    </section>
  );
}

function TextContactPicker({
  facility,
  contacts,
  onChoose,
  onClose,
}: {
  facility?: Facility;
  contacts: FacilityContact[];
  onChoose: (contactId: string) => void;
  onClose: () => void;
}) {
  if (!facility) return null;

  return (
    <div className="fixed inset-0 z-50 grid items-end bg-slate-950/40 p-3 sm:items-center">
      <section className="mx-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Choose text contact</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">{facility.name}</h2>
          </div>
          <Button tone="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="mt-4 grid gap-2">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => onChoose(contact.id)}
              className="rounded-lg border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-black text-slate-950">{contact.name}</p>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {contact.primary ? <Badge tone="blue">Recommended</Badge> : null}
                  {isPlaceholderPhoneNumber(contact.phone) ? <Badge tone="orange">Needs real phone</Badge> : null}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-600">{contact.role ?? "SLP Contact"}</p>
              <p className="mt-1 text-sm text-slate-500">{contact.phone ?? "No phone saved"}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function FacilityMatchSelect({
  row,
  facilities,
  idPrefix,
  onUpdateRow,
}: {
  row: ImportReviewRow;
  facilities: Facility[];
  idPrefix: string;
  onUpdateRow: (rowId: string, patch: Partial<ImportReviewRow>) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchId = `${idPrefix}-${row.id}-facility-search`;
  const visibleFacilities = facilities.filter((facility) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return `${facility.name} ${facility.address} ${facility.city ?? ""}`.toLowerCase().includes(query);
  });

  return (
    <div className="mt-3">
      <label className="block text-xs font-bold uppercase text-slate-500" htmlFor={searchId}>
        Search existing facilities
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-200 px-3">
        <Search size={14} className="shrink-0 text-slate-400" />
        <input
          id={searchId}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by name, address, or city"
          className="h-10 min-w-0 flex-1 text-sm font-medium text-slate-900 outline-none"
        />
      </div>
      <label className="mt-2 block text-xs font-bold uppercase text-slate-500" htmlFor={`${searchId}-select`}>
        Existing facility
      </label>
      <select
        id={`${searchId}-select`}
        value={row.matchedFacilityId ?? ""}
        onChange={(event) =>
          onUpdateRow(row.id, {
            matchedFacilityId: event.target.value || undefined,
            action: event.target.value ? "use_existing" : "needs_review",
            rememberAlias: event.target.value ? row.rememberAlias : false,
          })
        }
        className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-900"
      >
        <option value="">Choose existing facility</option>
        {visibleFacilities.map((facility) => (
          <option key={facility.id} value={facility.id}>
            {facility.name} - {facility.address}
          </option>
        ))}
      </select>
    </div>
  );
}

function canCollapseImportRow(row: ImportReviewRow, issue?: string) {
  return row.action === "use_existing" && !issue && row.confidence >= 75 && Boolean(row.matchedFacilityId);
}

function ImportMatchedSummary({
  row,
  facilityById,
  idPrefix,
  isExpanded,
  onChange,
}: {
  row: ImportReviewRow;
  facilityById: Map<string, Facility>;
  idPrefix: string;
  isExpanded: boolean;
  onChange: () => void;
}) {
  const match = row.matchedFacilityId ? facilityById.get(row.matchedFacilityId) : undefined;
  const controlsId = `${idPrefix}-import-row-controls-${row.id}`;

  return (
    <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-green-700">Matched existing facility</p>
          <p className="mt-1 font-black text-green-950">{match?.name ?? row.facilityName}</p>
          <p className="mt-1 text-xs font-semibold text-green-800">
            {row.confidence}% match - {match?.address ?? row.address}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Change match for ${row.facilityName}`}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? controlsId : undefined}
          onClick={onChange}
          className="shrink-0 rounded-md border border-green-300 bg-white px-3 py-2 text-xs font-bold text-green-800"
        >
          Change
        </button>
      </div>
    </div>
  );
}

function ImportRowControls({
  row,
  facilities,
  idPrefix,
  onUpdateRow,
}: {
  row: ImportReviewRow;
  facilities: Facility[];
  idPrefix: string;
  onUpdateRow: (rowId: string, patch: Partial<ImportReviewRow>) => void;
}) {
  const actions: Array<{ action: ImportReviewRow["action"]; label: string }> = [
    { action: "use_existing", label: "Use existing facility" },
    { action: "private_route_stop", label: "Private/non-facility stop" },
    { action: "skip", label: "Skip" },
    { action: "create_new", label: "Create new facility" },
  ];

  return (
    <div id={`${idPrefix}-import-row-controls-${row.id}`}>
      <p className="mt-3 text-xs font-bold uppercase text-slate-500" id={`${idPrefix}-${row.id}-action-label`}>
        Action
      </p>
      <div
        className="mt-1 flex flex-wrap gap-2"
        role="group"
        aria-labelledby={`${idPrefix}-${row.id}-action-label`}
      >
        {actions.map((item) => (
          <button
            key={item.action}
            type="button"
            onClick={() => onUpdateRow(row.id, { action: item.action })}
            className={cx(
              "rounded-md border px-3 py-2 text-xs font-bold transition",
              row.action === item.action
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {row.action === "needs_review" || row.action === "use_existing" ? (
        <FacilityMatchSelect row={row} facilities={facilities} idPrefix={idPrefix} onUpdateRow={onUpdateRow} />
      ) : null}
      {row.aliasCandidate && row.matchedFacilityId && row.action === "use_existing" ? (
        <label className="mt-3 flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
          <input
            type="checkbox"
            checked={Boolean(row.rememberAlias)}
            onChange={(event) => onUpdateRow(row.id, { rememberAlias: event.target.checked })}
            className="mt-1"
          />
          <span>Remember &quot;{row.aliasCandidate}&quot; as an alias for this facility</span>
        </label>
      ) : null}
      {row.action === "create_new" ? (
        <label className="mt-3 block text-xs font-bold uppercase text-slate-500" htmlFor={`${idPrefix}-${row.id}-facility-name`}>
          New facility name
          <input
            id={`${idPrefix}-${row.id}-facility-name`}
            value={row.facilityName}
            onChange={(event) => onUpdateRow(row.id, { facilityName: event.target.value })}
            className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold normal-case text-slate-900"
          />
        </label>
      ) : null}
      {row.action === "create_new" || row.action === "private_route_stop" ? (
        <>
          <label className="mt-3 block text-xs font-bold uppercase text-slate-500" htmlFor={`${idPrefix}-${row.id}-address`}>
            Location address
          </label>
          <textarea
            id={`${idPrefix}-${row.id}-address`}
            value={row.address}
            onChange={(event) => onUpdateRow(row.id, { address: event.target.value })}
            className="mt-1 min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900"
          />
        </>
      ) : null}
    </div>
  );
}

function ImportReviewCards({
  rows,
  facilities,
  facilityById,
  issuesByRowId,
  expandedRowIds,
  onToggleRowExpansion,
  onUpdateRow,
  className = "lg:hidden",
  showRowIssues = true,
}: {
  rows: ImportReviewRow[];
  facilities: Facility[];
  facilityById: Map<string, Facility>;
  issuesByRowId: Record<string, string>;
  expandedRowIds: Record<string, boolean>;
  onToggleRowExpansion: (rowId: string) => void;
  onUpdateRow: (rowId: string, patch: Partial<ImportReviewRow>) => void;
  className?: string;
  showRowIssues?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className={cx("rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600", className)}>
        Parse a schedule to review each stop as a mobile card.
      </div>
    );
  }

  return (
    <div className={cx("grid gap-3", className)}>
      {rows.map((row, index) => {
        const matchName = row.matchedFacilityId ? facilityById.get(row.matchedFacilityId)?.name : undefined;
        const confidenceTone = row.confidence >= 75 ? "green" : row.confidence >= 45 ? "orange" : "slate";
        const issue = issuesByRowId[row.id];
        const statusTone = importReviewStatusTone(row, issue);
        const statusLabel = importReviewStatusLabel(row, issue);
        const isExpanded = Boolean(expandedRowIds[row.id]);
        const canCollapseMatch = canCollapseImportRow(row, issue);
        const showControls = !canCollapseMatch || isExpanded;

        return (
          <article
            key={row.id}
            data-testid={`import-review-card-${index + 1}`}
            className={cx(
              "rounded-lg border bg-white p-3 shadow-sm",
              row.action === "skip" ? "border-slate-200 opacity-70" : "border-slate-200",
              (issue || row.action === "private_route_stop" || row.action === "create_new") &&
                row.action !== "skip" &&
                "border-orange-300 bg-orange-50/40",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-slate-500">Stop {index + 1}</p>
                <h3 className="mt-1 truncate text-base font-black text-slate-950">{row.facilityName}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {row.appointmentTime || "Time missing"} - {row.studyCount ?? 0} studies
                </p>
                {row.reviewNote ? <p className="mt-1 text-xs font-semibold text-blue-700">{row.reviewNote}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={statusTone}>{statusLabel}</Badge>
                <Badge tone={confidenceTone}>{row.confidence}% match</Badge>
              </div>
            </div>
            {canCollapseMatch ? (
              <div className="mt-3">
                <ImportMatchedSummary
                  row={row}
                  facilityById={facilityById}
                  idPrefix="mobile"
                  isExpanded={isExpanded}
                  onChange={() => onToggleRowExpansion(row.id)}
                />
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                <p className="text-xs font-bold uppercase text-slate-500">Matched facility</p>
                <p className="mt-1 font-bold text-slate-900">{matchName ?? "No likely match"}</p>
              </div>
            )}
            {showControls ? (
              <ImportRowControls row={row} facilities={facilities} idPrefix="mobile" onUpdateRow={onUpdateRow} />
            ) : null}
            {issue && showRowIssues ? <p className="mt-2 text-xs font-semibold text-orange-700">{issue}</p> : null}
            {showControls || issue ? (
              <details className="mt-3 text-xs text-slate-500">
                <summary className="cursor-pointer font-bold text-slate-600">Show original text</summary>
                <p className="mt-1 rounded-md bg-slate-50 p-2 font-mono">{row.raw}</p>
              </details>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function TentativeAddConfirmation({
  facility,
  routeStops,
  facilityById,
  snapshot,
  contactedToday,
  canRemove,
  onBackToRoute,
  onRemoveTentative,
}: {
  facility?: Facility;
  routeStops: RouteStop[];
  facilityById: Map<string, Facility>;
  snapshot: OpportunitySnapshot;
  contactedToday: boolean;
  canRemove: boolean;
  onBackToRoute: () => void;
  onRemoveTentative: () => void;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:py-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-green-700">Tentative add-on</p>
          <h2 className="mt-1 text-xl font-black text-green-950">Added to tentative route</h2>
          <p className="mt-1 text-sm leading-6 text-green-900">You can adjust before starting tomorrow&apos;s route.</p>
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-black text-slate-950">Updated route order</h3>
          <div className="mt-3 space-y-2">
            {routeStops.map((stop) => {
              const stopFacility = facilityById.get(stop.facilityId);
              const isInserted = stop.facilityId === snapshot.facilityId;
              return (
                <div
                  key={stop.id}
                  className={cx(
                    "flex items-center gap-3 rounded-lg border p-3",
                    isInserted ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50",
                  )}
                >
                  <span
                    className={cx(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black text-white",
                      isInserted ? "bg-green-600" : "bg-blue-600",
                    )}
                  >
                    {stop.order}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-950">
                      {stopFacility?.name ?? "Unknown facility"}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      {isInserted
                        ? `${snapshot.bestInsertionLabel} - +${snapshot.addedDriveMinutes} min detour`
                        : `${stop.appointmentTime ?? "Time TBD"} - ${friendlyValue(stop.status)}`}
                    </span>
                  </span>
                  {isInserted ? <Badge tone="green">Tentative</Badge> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Outreach log</p>
          <p className="mt-1 text-sm font-bold text-slate-950">
            {contactedToday ? "Contacted today" : "Tentative route add logged"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {facility?.name ?? "This facility"} is on tomorrow&apos;s route as a tentative add-on.
          </p>
        </div>

        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mt-4 grid gap-2 rounded-lg bg-white/95 py-2 backdrop-blur sm:static sm:grid-cols-2 sm:bg-transparent sm:py-0 sm:backdrop-blur-none">
          <Button tone="primary" onClick={onBackToRoute}>
            <ArrowLeft size={15} /> Back to route
          </Button>
          {canRemove ? <Button onClick={onRemoveTentative}>Remove tentative stop</Button> : null}
        </div>
      </section>
    </main>
  );
}

export default function NearMyRouteApp() {
  const [facilities, setFacilities] = useState(initialFacilities);
  const [routeStops, setRouteStops] = useState(initialRouteStops);
  const [outreachLogs, setOutreachLogs] = useState(initialOutreachLogs);
  const [activeTab, setActiveTab] = useState<AppTab>("Near My Route");
  const [routeView, setRouteView] = useState<RouteView>({ kind: "home" });
  const [selectedFacilityId, setSelectedFacilityId] = useState("encompass-westchase");
  const [maxDetourMinutes, setMaxDetourMinutes] = useState(10);
  const [notContactedRecentlyOnly, setNotContactedRecentlyOnly] = useState(false);
  const [knownContactsOnly, setKnownContactsOnly] = useState(false);
  const [sameDayFriendlyOnly, setSameDayFriendlyOnly] = useState(false);
  const [followUpThresholdDays, setFollowUpThresholdDays] = useState(14);
  const [facilitySearch, setFacilitySearch] = useState("");
  const [facilityTypeFilter, setFacilityTypeFilter] = useState("All");
  const [contactStatusFilter, setContactStatusFilter] = useState("All");
  const [importMode, setImportMode] = useState<ImportMode>("schedule");
  const [scheduleText, setScheduleText] = useState(sampleSchedule);
  const [vanPacketPdfText, setVanPacketPdfText] = useState("");
  const [importReviewDraft, setImportReviewDraft] = useState<ImportReviewDraft>();
  const [expandedImportRowIds, setExpandedImportRowIds] = useState<Record<string, boolean>>({});
  const [manualStatus, setManualStatus] = useState<OutreachStatus>("texted");
  const [dogfoodChecked, setDogfoodChecked] = useState<Record<string, boolean>>({});
  const [dogfoodNotes, setDogfoodNotes] = useState("");
  const [dogfoodNoteWarning, setDogfoodNoteWarning] = useState<string>();
  const [showMessage, setShowMessage] = useState(false);
  const [copyFeedbackByFacilityId, setCopyFeedbackByFacilityId] = useState<Record<string, TextFeedback>>({});
  const [textPickerFacilityId, setTextPickerFacilityId] = useState<string>();
  const [pendingTextContactByFacilityId, setPendingTextContactByFacilityId] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [showDemoTools] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1",
  );
  const idCounterRef = useRef(0);

  function nextId(prefix: string) {
    idCounterRef.current += 1;
    return `${prefix}-${Date.now()}-${idCounterRef.current}`;
  }

  function nextImportReviewId(purpose: ImportReviewIdPurpose) {
    const prefixes: Record<ImportReviewIdPurpose, string> = {
      row: "import-row",
      facility: "facility",
      "private-route-stop": "private-stop",
      "route-stop": "stop",
    };
    return nextId(prefixes[purpose]);
  }

  useEffect(() => {
    const stored = loadStoredState();
    if (stored) {
      window.requestAnimationFrame(() => {
        setFacilities(stored.facilities);
        setRouteStops(stored.routeStops);
        setOutreachLogs(stored.outreachLogs);
        setDogfoodChecked(stored.dogfoodChecked ?? {});
        const storedDogfoodWarning = dogfoodNotePhiWarning(stored.dogfoodNotes ?? "");
        setDogfoodNoteWarning(storedDogfoodWarning);
        setDogfoodNotes(storedDogfoodWarning ? "" : (stored.dogfoodNotes ?? ""));
        setHydrated(true);
      });
    } else {
      window.requestAnimationFrame(() => setHydrated(true));
    }
  }, []);

  useEffect(() => {
    if (hydrated) saveStoredState({ facilities, routeStops, outreachLogs, dogfoodChecked, dogfoodNotes });
  }, [dogfoodChecked, dogfoodNotes, facilities, routeStops, outreachLogs, hydrated]);

  useEffect(() => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }, [activeTab, routeView.kind]);

  const opportunities = useMemo(
    () =>
      calculateRouteOpportunities(routeStops, facilities, {
        maxDetourMinutes,
        averageSpeedMph: 28,
        excludeRecentlyContactedDays: notContactedRecentlyOnly ? followUpThresholdDays : undefined,
        knownContactsOnly,
        sameDayFriendlyOnly,
      }),
    [facilities, followUpThresholdDays, knownContactsOnly, maxDetourMinutes, notContactedRecentlyOnly, routeStops, sameDayFriendlyOnly],
  );

  const routeFitOpportunities = useMemo(
    () =>
      calculateRouteOpportunities(routeStops, facilities, {
        maxDetourMinutes: 999,
        averageSpeedMph: 28,
      }),
    [facilities, routeStops],
  );

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId);
  const selectedFilteredOpportunity = opportunities.find((item) => item.facility.id === selectedFacilityId);
  const selectedOpportunity =
    selectedFilteredOpportunity ??
    routeFitOpportunities.find((item) => item.facility.id === selectedFacilityId);
  const selectedOutreachLogs = outreachLogs
    .filter((log) => log.facilityId === selectedFacilityId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const orderedRouteStops = [...routeStops].sort((a, b) => a.order - b.order);
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  const todayStatusByFacilityId = new Map(
    facilities.map((facility) => [
      facility.id,
      deriveTodayStatus({ facility, outreachLogs, routeStops }),
    ]),
  );
  const selectedTodayStatus = selectedFacility
    ? todayStatusByFacilityId.get(selectedFacility.id)
    : undefined;
  const textPickerFacility = textPickerFacilityId ? facilities.find((facility) => facility.id === textPickerFacilityId) : undefined;
  const textPickerContacts = textPickerFacility ? textReadyContacts(textPickerFacility) : [];
  const todayQueue = sortOutreachQueue(facilities
    .map((facility) => {
      const opportunity =
        opportunities.find((item) => item.facility.id === facility.id) ??
        routeFitOpportunities.find((item) => item.facility.id === facility.id);
      const status = todayStatusByFacilityId.get(facility.id) ?? "not_contacted";
      return {
        facility,
        opportunity,
        status,
        latestLog: latestTodayLog(facility.id, outreachLogs),
      };
    }));
  const textFirstItem = selectTextFirst(todayQueue);
  const remainingQueue = todayQueue.filter((item) => item.facility.id !== textFirstItem?.facility.id);
  const readyToTextQueue = remainingQueue.filter(
    (item) => item.status === "not_contacted" && hasAddOnOpportunity(item) && textReadiness(item.facility) === "ready",
  );
  const needsPhoneQueue = remainingQueue.filter(
    (item) => item.status === "not_contacted" && hasAddOnOpportunity(item) && textReadiness(item.facility) !== "ready",
  );
  const responseQueue = remainingQueue.filter((item) => item.status !== "not_contacted");
  const todayCounts = todayStatusSummary([...todayStatusByFacilityId.values()]);
  const firstPendingLocationFacility = facilities.find((facility) => facility.locationStatus === "needs_confirmation");
  const currentRouteStatusCounts = todayStatusSummary(
    orderedRouteStops
      .map((stop) => todayStatusByFacilityId.get(stop.facilityId))
      .filter((status): status is TodayStatus => Boolean(status)),
  );
  const currentImportReviewModel = importReviewDraft ? importReviewModel(importReviewDraft) : undefined;
  const vanPacketSummary =
    importReviewDraft?.source.kind === "van_packet" ? importReviewDraft.source.summary : undefined;
  const reviewRows = currentImportReviewModel?.rows ?? [];
  const visibleImportReviewRows = currentImportReviewModel?.visibleRows ?? [];
  const routeAnchorRows = currentImportReviewModel?.routeAnchorRows ?? [];
  const importIssuesByRowId = currentImportReviewModel?.issuesByRowId ?? {};
  const importSummary = currentImportReviewModel?.summary ?? {
    useExisting: 0,
    createNew: 0,
    privateRouteStop: 0,
    skipped: 0,
    unresolved: 0,
    confirmed: 0,
  };
  const canConfirmImport = Boolean(currentImportReviewModel?.canConfirm);
  const confirmImportLabel =
    importSummary.unresolved > 0
      ? `Resolve ${importSummary.unresolved} ${importSummary.unresolved === 1 ? "Row" : "Rows"} Before Confirming`
      : `Confirm ${importSummary.confirmed} ${importSummary.confirmed === 1 ? "Stop" : "Stops"}`;
  const currentRouteFacilities = orderedRouteFacilities(routeStops, facilities);
  const currentRouteUnconfirmedFacilities = unconfirmedRouteFacilities(orderedRouteStops, facilities);
  const currentRouteFacilityIds = new Set(orderedRouteStops.map((stop) => stop.facilityId));
  const currentRouteLocationWarning =
    currentRouteUnconfirmedFacilities.length > 0
      ? `Route includes unconfirmed locations: ${currentRouteUnconfirmedFacilities.map((facility) => facility.name).join(", ")}. Confirm location before trusting add-on ranking or Maps handoff.`
      : undefined;
  const currentRouteLocationOutreachWarning =
    currentRouteUnconfirmedFacilities.length > 0
      ? "Route includes unconfirmed locations. Review locations before trusting add-on ranking or Maps handoff."
      : undefined;
  const isCurrentRouteMapsBlocked = Boolean(currentRouteLocationWarning);
  const currentRouteMapsUrl = buildGoogleMapsDirectionsUrl(currentRouteFacilities);
  const currentRouteMapsWarning = googleMapsWaypointWarning(currentRouteFacilities.length);
  const currentRouteSplitUrls = splitGoogleMapsDirectionsUrls(currentRouteFacilities);
  const currentRouteSourceMapLink = orderedRouteStops.find((stop) => stop.sourceMapLink)?.sourceMapLink;
  const detourRankByFacilityId = new Map(
    [...opportunities]
      .sort((a, b) => a.addedDriveMinutes - b.addedDriveMinutes || b.score - a.score)
      .map((opportunity, index) => [opportunity.facility.id, index + 1]),
  );
  const featuredOpportunity = [...opportunities]
    .filter((opportunity) => opportunity.group !== "Not Worth It Today")
    .sort((a, b) => a.addedDriveMinutes - b.addedDriveMinutes || b.score - a.score)[0];
  const routeNeedsLocationReview = currentRouteUnconfirmedFacilities.length > 0;
  const routeReadinessTitle = routeNeedsLocationReview
    ? "Tomorrow's route needs location review"
    : `Tomorrow's route ready`;
  const routeTextReadyCount = orderedRouteStops
    .map((stop) => facilityById.get(stop.facilityId))
    .filter((facility): facility is Facility => {
      if (!facility) return false;
      return textReadiness(facility) === "ready";
    }).length;
  const routeReadinessSummary = `${orderedRouteStops.length} ${orderedRouteStops.length === 1 ? "stop" : "stops"} imported - ${routeNeedsLocationReview ? `${currentRouteUnconfirmedFacilities.length} ${currentRouteUnconfirmedFacilities.length === 1 ? "location" : "locations"} need confirm` : "locations confirmed"} - ${routeTextReadyCount} text-ready ${routeTextReadyCount === 1 ? "facility" : "facilities"}`;

  function selectFacility(facilityId: string) {
    setSelectedFacilityId(facilityId);
    setShowMessage(false);
    setTextPickerFacilityId(undefined);
    setCopyFeedbackByFacilityId((current) => {
      const next = { ...current };
      delete next[facilityId];
      return next;
    });
  }

  function selectTopLevelTab(tab: AppTab) {
    setActiveTab(tab);
    setShowMessage(false);
    setTextPickerFacilityId(undefined);
    if (tab !== "Near My Route") {
      setRouteView({ kind: "home" });
    }
  }

  function openRouteHome(facilityId = selectedFacilityId) {
    setActiveTab("Near My Route");
    setSelectedFacilityId(facilityId);
    setShowMessage(false);
    setTextPickerFacilityId(undefined);
    setRouteView({ kind: "home" });
  }

  function openFacilityReview(facilityId: string, showTemplate = false, sourceTab: AppTab = activeTab) {
    setActiveTab("Near My Route");
    setSelectedFacilityId(facilityId);
    setShowMessage(showTemplate);
    setTextPickerFacilityId(undefined);
    setRouteView({ kind: "review", facilityId, sourceTab });
  }

  function closeFacilityReview(view: Extract<RouteView, { kind: "review" }>) {
    setSelectedFacilityId(view.facilityId);
    if (view.sourceTab === "Near My Route") {
      openRouteHome(view.facilityId);
    } else {
      selectTopLevelTab(view.sourceTab);
    }
  }

  function reviewBackLabel(view: Extract<RouteView, { kind: "review" }>) {
    if (view.sourceTab === "Near My Route") return "Back to route";
    if (view.sourceTab === "Import Schedule") return "Back to import";
    return `Back to ${view.sourceTab}`;
  }

  function snapshotOpportunity(facilityId: string): OpportunitySnapshot {
    const opportunity =
      opportunities.find((item) => item.facility.id === facilityId) ??
      routeFitOpportunities.find((item) => item.facility.id === facilityId);
    return {
      facilityId,
      addedDriveMinutes: opportunity?.addedDriveMinutes ?? 0,
      bestInsertionLabel: opportunity?.bestInsertionLabel ?? "Already on tomorrow's route",
      bestInsertionAfterStopId: opportunity?.bestInsertionAfterStopId,
      nearestStopName: opportunity?.nearestStopName,
      nearestStopDistanceMiles: opportunity?.nearestStopDistanceMiles ?? 0,
      reasonBadges: opportunity?.reasonBadges ?? [],
    };
  }

  function logOutreach(
    facilityId: string,
    status: OutreachStatus,
    method: OutreachLog["method"],
    notes?: string,
    contactNameOverride?: string,
  ) {
    const facility = facilities.find((item) => item.id === facilityId);
    const contact = facility ? primaryContact(facility) : undefined;
    const now = new Date().toISOString();
    const log: OutreachLog = {
      id: nextId("log"),
      facilityId,
      createdAt: now,
      method,
      contactName: contactNameOverride ?? contact?.name,
      status,
      notes,
    };

    setOutreachLogs((current) => [log, ...current]);
    if (status === "added_to_route") return log.id;

    setFacilities((current) =>
      current.map((item) =>
        item.id === facilityId
          ? {
              ...item,
              lastContacted: status === "do_not_contact_cleared" ? item.lastContacted : todayIsoDate(),
              doNotContact: status === "do_not_contact" ? true : status === "do_not_contact_cleared" ? false : item.doNotContact,
            }
          : item,
      ),
    );
    return log.id;
  }

  function logTodayResponse(facilityId: string, status: OutreachStatus, notes: string) {
    logOutreach(facilityId, status, "other", notes);
    setSelectedFacilityId(facilityId);
    setShowMessage(false);
  }

  function clearDoNotContact(facilityId: string) {
    logOutreach(facilityId, "do_not_contact_cleared", "other", "Cleared do not contact; facility can return to outreach.");
    setSelectedFacilityId(facilityId);
    setShowMessage(false);
  }

  function updateDogfoodTask(taskId: string, checked: boolean) {
    setDogfoodChecked((current) => ({ ...current, [taskId]: checked }));
  }

  function updateDogfoodNotes(notes: string) {
    const warning = dogfoodNotePhiWarning(notes);
    setDogfoodNoteWarning(warning);
    if (warning) return;
    setDogfoodNotes(notes);
  }

  function updateReviewRow(rowId: string, patch: Partial<ImportReviewRow>) {
    setImportReviewDraft((current) => current ? updateImportReviewRow(current, rowId, patch) : current);
  }

  function updateContactPhone(facilityId: string, contactId: string, phone: string) {
    updateContact(facilityId, contactId, { phone });
  }

  function updateContact(facilityId: string, contactId: string, patch: Partial<FacilityContact>) {
    const normalizedPatch = {
      ...patch,
      ...(Object.prototype.hasOwnProperty.call(patch, "phone") ? { phone: patch.phone?.trim() || undefined } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "role") ? { role: patch.role?.trim() || undefined } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "name") ? { name: patch.name ?? "" } : {}),
    };
    setFacilities((current) =>
      current.map((facility) =>
        facility.id === facilityId
          ? {
              ...facility,
              contacts: facility.contacts.map((contact) =>
                contact.id === contactId
                  ? { ...contact, ...normalizedPatch }
                  : normalizedPatch.primary
                    ? { ...contact, primary: false }
                    : contact,
              ),
            }
          : facility,
      ),
    );
    setCopyFeedbackByFacilityId((current) => {
      if (current[facilityId] === "placeholder_phone" || current[facilityId] === "invalid_phone") return current;
      const next = { ...current };
      delete next[facilityId];
      return next;
    });
  }

  function addContact(facilityId: string) {
    setFacilities((current) =>
      current.map((facility) => {
        if (facility.id !== facilityId) return facility;
        const hasPrimaryContact = facility.contacts.some((contact) => contact.primary);
        return {
          ...facility,
          contacts: [
            ...facility.contacts,
            {
              id: nextId("contact"),
              name: "New contact",
              role: "SLP",
              preferredMethod: "text" as const,
              primary: !hasPrimaryContact,
            },
          ],
        };
      }),
    );
  }

  function confirmFacilityLocation(locationId: string, patch: { address: string; lat: number; lng: number }) {
    setFacilities((current) =>
      current.map((facility) =>
        facility.id === locationId
          ? {
              ...facility,
              address: patch.address,
              lat: patch.lat,
              lng: patch.lng,
              locationStatus: "confirmed",
              locationSource: facility.locationSource === "import" ? "import" : "geocoded",
            }
          : facility,
      ),
    );
    setRouteStops((current) =>
      current.map((stop) =>
        stop.privateLocation?.id === locationId
          ? {
              ...stop,
              privateLocation: {
                ...stop.privateLocation,
                address: patch.address,
                lat: patch.lat,
                lng: patch.lng,
                locationStatus: "confirmed",
                locationSource: "import",
              },
            }
          : stop,
      ),
    );
    if (facilities.some((facility) => facility.id === locationId)) setSelectedFacilityId(locationId);
  }

  function parseImportSchedule() {
    const showImportReview = () => {
      window.setTimeout(() => {
        document.getElementById("import-review-section")?.scrollIntoView({ block: "start", behavior: "auto" });
      }, 0);
    };

    if (importMode === "van_packet") {
      setImportReviewDraft(parseImportReview({
        mode: "van_packet",
        text: scheduleText,
        supplementalText: vanPacketPdfText,
        facilities,
        nextId: nextImportReviewId,
      }));
      setExpandedImportRowIds({});
      setScheduleText("");
      setVanPacketPdfText("");
      showImportReview();
      return;
    }

    setImportReviewDraft(parseImportReview({
      mode: "schedule",
      text: scheduleText,
      facilities,
      nextId: nextImportReviewId,
    }));
    setExpandedImportRowIds({});
    showImportReview();
  }

  function toggleImportRowExpansion(rowId: string) {
    setExpandedImportRowIds((current) => ({ ...current, [rowId]: !current[rowId] }));
  }

  function confirmImportedRoute() {
    if (!importReviewDraft || !canConfirmImport) return;
    const result = confirmImportReview(importReviewDraft, facilities, { nextId: nextImportReviewId });
    if (!result.ok) return;
    setFacilities(result.facilities);
    setRouteStops(result.routeStops);
    setImportReviewDraft(undefined);
    setExpandedImportRowIds({});
    openRouteHome(result.initialFacilityId ?? selectedFacilityId);
  }

  async function copySafeMessage(facilityId: string, feedback: TextFeedback = "copied") {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility || typeof navigator === "undefined" || !navigator.clipboard) {
      setShowMessage(true);
      setCopyFeedbackByFacilityId((current) => ({ ...current, [facilityId]: "failed" }));
      return false;
    }

    try {
      await navigator.clipboard.writeText(safeMessage());
      setCopyFeedbackByFacilityId((current) => ({ ...current, [facilityId]: feedback }));
      return true;
    } catch {
      setShowMessage(true);
      setCopyFeedbackByFacilityId((current) => ({ ...current, [facilityId]: "failed" }));
      return false;
    }
  }

  async function startTextFlow(facilityId: string) {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;

    setSelectedFacilityId(facilityId);
    const contacts = textContacts(facility);
    if (contacts.length === 0) {
      setPendingTextContactByFacilityId((current) => {
        const next = { ...current };
        delete next[facilityId];
        return next;
      });
      await copySafeMessage(facilityId, "no_phone");
      openFacilityReview(facilityId, true, activeTab);
      return;
    }

    const readyContacts = textReadyContacts(facility);
    const recommendedReadyContacts = readyContacts.filter((contact) => contact.primary);
    const directContact = recommendedReadyContacts.length === 1 ? recommendedReadyContacts[0] : readyContacts.length === 1 ? readyContacts[0] : undefined;

    if (directContact) {
      await openMessagesForContact(facilityId, directContact.id);
      return;
    }

    if (readyContacts.length > 1) {
      setShowMessage(false);
      setTextPickerFacilityId(facilityId);
      return;
    }

    await openMessagesForContact(facilityId, contacts[0].id);
  }

  async function openMessagesForContact(facilityId: string, contactId: string) {
    const facility = facilities.find((item) => item.id === facilityId);
    const contact = facility?.contacts.find((item) => item.id === contactId);
    if (!facility || !contact?.phone) return;

    setTextPickerFacilityId(undefined);
    if (isPlaceholderPhoneNumber(contact.phone)) {
      setPendingTextContactByFacilityId((current) => ({ ...current, [facilityId]: contact.id }));
      setCopyFeedbackByFacilityId((current) => ({ ...current, [facilityId]: "placeholder_phone" }));
      openFacilityReview(facilityId, true, activeTab);
      return;
    }
    if (!isDialablePhoneNumber(contact.phone)) {
      setPendingTextContactByFacilityId((current) => ({ ...current, [facilityId]: contact.id }));
      setCopyFeedbackByFacilityId((current) => ({ ...current, [facilityId]: "invalid_phone" }));
      openFacilityReview(facilityId, true, activeTab);
      return;
    }

    const canOpenSms = typeof navigator !== "undefined" && canAttemptSms(navigator.userAgent);
    if (!canOpenSms) {
      setPendingTextContactByFacilityId((current) => ({ ...current, [facilityId]: contact.id }));
      await copySafeMessage(facilityId, "fallback_copied");
      openFacilityReview(facilityId, true, activeTab);
      return;
    }

    const smsPhone = contact.phone;
    setPendingTextContactByFacilityId((current) => ({ ...current, [facilityId]: contact.id }));
    await copySafeMessage(facilityId, "opened");
    openFacilityReview(facilityId, true, activeTab);
    window.setTimeout(() => {
      window.location.href = buildSmsUrl(smsPhone, safeMessage());
    }, 0);
  }

  function markTexted(facilityId: string) {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;
    const pendingContactId = pendingTextContactByFacilityId[facilityId];
    const contact = facility.contacts.find((item) => item.id === pendingContactId) ?? primaryContact(facility);
    if (!contact?.phone || isPlaceholderPhoneNumber(contact.phone) || !isDialablePhoneNumber(contact.phone)) {
      setCopyFeedbackByFacilityId((current) => ({
        ...current,
        [facilityId]: !contact?.phone ? "no_phone" : isPlaceholderPhoneNumber(contact.phone) ? "placeholder_phone" : "invalid_phone",
      }));
      setShowMessage(true);
      return;
    }
    logOutreach(facilityId, "texted", "text", "Manually marked texted after Messages fallback.", contact?.name);
    setShowMessage(false);
    setCopyFeedbackByFacilityId((current) => ({ ...current, [facilityId]: "copied" }));
    setPendingTextContactByFacilityId((current) => {
      const next = { ...current };
      delete next[facilityId];
      return next;
    });
  }

  function openMapsUrl(url?: string) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function exportRouteSummary() {
    const escapeCsv = (value: string | number | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = orderedRouteStops.map((stop) => {
      const facility = facilityById.get(stop.facilityId);
      const location = stop.privateLocation ?? facility;
      const status = facility ? todayStatusByFacilityId.get(facility.id) ?? "not_contacted" : undefined;
      return [
        stop.order,
        location?.name ?? "Private route stop",
        location?.address ?? "",
        stop.appointmentTime ?? "Time TBD",
        stop.studyCount ?? 0,
        stop.status,
        status ? todayStatusLabel(status) : "Private",
        stop.routeImpact?.addedDriveMinutes ?? "",
      ];
    });
    const csv = [
      ["Seq", "Facility", "Address", "Schedule", "Studies", "Route Status", "Outreach Status", "Added Drive Minutes"],
      ...rows,
    ]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `near-my-route-summary-${todayIsoDate()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function previewRouteWithAddOn(opportunity: Opportunity) {
    const previewFacilities = routeFacilitiesWithInsertedAddOn(
      routeStops,
      facilities,
      opportunity.facility,
      opportunity.bestInsertionAfterStopId,
    );
    openMapsUrl(buildGoogleMapsDirectionsUrl(previewFacilities));
  }

  function addTentatively(facilityId: string) {
    const existingStop = routeStops.find((stop) => stop.facilityId === facilityId);
    const snapshot = snapshotOpportunity(facilityId);
    if (existingStop) {
      setSelectedFacilityId(facilityId);
      if (existingStop.status !== "tentative") {
        setRouteView({ kind: "home" });
        return;
      }
      setRouteView({
        kind: "confirmation",
        facilityId,
        routeStopId: existingStop.id,
        snapshot,
        contactedToday: Boolean(latestTodayLog(facilityId, outreachLogs)),
        canRemove: true,
      });
      return;
    }
    const afterStopId = snapshot.bestInsertionAfterStopId;
    const afterStop = routeStops.find((stop) => stop.id === afterStopId);
    const order = afterStop ? afterStop.order + 0.5 : routeStops.length + 1;
    const routeStopId = nextId("stop");
    const addedLogId = logOutreach(facilityId, "added_to_route", "other", "Added tentatively to tomorrow's route.");
    const nextStops = [
      ...routeStops,
      {
        id: routeStopId,
        facilityId,
        order,
        status: "tentative" as const,
        source: "today_add_on" as const,
        addedFromLogId: addedLogId,
        routeImpact: {
          addedDriveMinutes: snapshot.addedDriveMinutes,
          bestInsertionLabel: snapshot.bestInsertionLabel,
          bestInsertionAfterStopId: snapshot.bestInsertionAfterStopId,
          nearestStopName: snapshot.nearestStopName,
          nearestStopDistanceMiles: snapshot.nearestStopDistanceMiles,
        },
        notes: "Tentative add-on. Confirm study time separately from added drive time.",
      },
    ]
      .sort((a, b) => a.order - b.order)
      .map((stop, index) => ({ ...stop, order: index + 1 }));
    setRouteStops(nextStops);
    setActiveTab("Near My Route");
    setSelectedFacilityId(facilityId);
    setShowMessage(false);
    setRouteView({ kind: "confirmation", facilityId, routeStopId, snapshot, contactedToday: false, canRemove: true });
  }

  function removeTentativeStop(routeStopId: string) {
    const removedStop = routeStops.find(
      (stop) => stop.id === routeStopId && stop.status === "tentative" && stop.source === "today_add_on",
    );

    setRouteStops((current) =>
      current
        .filter((stop) => stop.id !== routeStopId || stop.status !== "tentative")
        .sort((a, b) => a.order - b.order)
        .map((stop, index) => ({ ...stop, order: index + 1 })),
    );
    if (removedStop) {
      if (removedStop.addedFromLogId) {
        setOutreachLogs((current) => current.filter((log) => log.id !== removedStop.addedFromLogId));
      }
      setSelectedFacilityId(removedStop.facilityId);
    }
    setRouteView({ kind: "home" });
  }

  function removeTodayAddOn(facilityId: string) {
    const addOnStop = routeStops.find(
      (stop) => stop.facilityId === facilityId && stop.source === "today_add_on" && stop.status === "tentative",
    );
    if (!addOnStop) return;
    removeTentativeStop(addOnStop.id);
    setSelectedFacilityId(facilityId);
  }

  function resetDemo() {
    clearStoredState();
    setFacilities(initialFacilities);
    setRouteStops(initialRouteStops);
    setOutreachLogs(initialOutreachLogs);
    setActiveTab("Near My Route");
    setRouteView({ kind: "home" });
    setSelectedFacilityId("encompass-westchase");
    setShowMessage(false);
    setCopyFeedbackByFacilityId({});
    setDogfoodChecked({});
    setDogfoodNotes("");
    setDogfoodNoteWarning(undefined);
    setImportReviewDraft(undefined);
    setImportMode("schedule");
    setScheduleText(sampleSchedule);
    setVanPacketPdfText("");
  }

  const filteredFacilities = facilities.filter((facility) => {
    const query = facilitySearch.toLowerCase();
    const matchesSearch =
      facility.name.toLowerCase().includes(query) ||
      facility.address.toLowerCase().includes(query) ||
      facility.city?.toLowerCase().includes(query);
    const matchesType = facilityTypeFilter === "All" || facility.facilityType === facilityTypeFilter;
    const matchesContact =
      contactStatusFilter === "All" ||
      (contactStatusFilter === "Known contacts" && facility.contacts.length > 0) ||
      (contactStatusFilter === "No contact" && facility.contacts.length === 0) ||
      (contactStatusFilter === "Due for follow-up" && isDueForFollowUp(facility, followUpThresholdDays));

    return matchesSearch && matchesType && matchesContact;
  });

  const groupedOpportunities = opportunityGroups.map((group) => ({
    group,
    items: opportunities
      .filter((item) => item.group === group)
      .sort((a, b) => a.addedDriveMinutes - b.addedDriveMinutes || b.score - a.score),
  }));

  return (
    <div className="min-h-screen pb-[calc(8rem+env(safe-area-inset-bottom))] text-slate-950 sm:pb-0">
      <header className="bg-[#eef3f8] px-3 pt-3 pb-3 sm:sticky sm:top-0 sm:z-[500] sm:px-4 sm:pt-4">
        <div className="nmr-surface nmr-enter mx-auto flex max-w-[1800px] items-center justify-between gap-3 rounded-[1.5rem] bg-white/98 px-4 py-3 xl:h-16 xl:px-5 xl:py-0">
          <div className="flex items-center gap-4 xl:gap-8">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white shadow-[0_16px_34px_rgba(15,23,42,0.22),inset_0_1px_0_rgba(255,255,255,0.18)]">
              <MapPinned size={22} />
            </div>
            <div className="-ml-2">
              <h1 className="text-xl font-black uppercase leading-tight text-slate-950 xl:text-lg">Near My Route</h1>
              <p className="text-xs font-medium text-slate-600 xl:hidden">Route-aware MBSS facility opportunities</p>
              <p className="hidden text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 xl:block">
                Administrative logistics portal
              </p>
            </div>
          </div>
          <nav className="hidden flex-wrap gap-6 self-stretch sm:flex xl:ml-2">
            {(["Near My Route", "Facilities", "Import Schedule", "Outreach"] as AppTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-label={tab}
                onClick={() => selectTopLevelTab(tab)}
                className={cx(
                  "rounded-full px-4 py-2 text-sm font-bold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                  activeTab === tab
                    ? "bg-blue-700 text-white shadow-[0_12px_26px_rgba(37,99,235,0.24)]"
                    : "text-slate-600 hover:bg-white hover:text-blue-700",
                )}
              >
                {tab === "Near My Route"
                  ? "Route Planning"
                  : tab === "Facilities"
                    ? "Facility Master"
                    : tab === "Import Schedule"
                      ? "Import"
                      : "Outreach Logs"}
              </button>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-4 xl:flex">
            <div className="nmr-soft-field flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-slate-950">
              <CalendarDays size={17} />
              <span>Tomorrow&apos;s Route</span>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <button type="button" className="rounded-full p-2 text-slate-700 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white hover:text-blue-700" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button type="button" className="rounded-full p-2 text-slate-700 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white hover:text-blue-700" aria-label="Settings">
              <Settings size={18} />
            </button>
          </div>
          {showDemoTools ? (
            <details className="hidden rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] sm:block">
              <summary className="cursor-pointer font-bold text-slate-600">Demo tools</summary>
              <div className="mt-3 w-52">
                <Button className="w-full" tone="ghost" onClick={resetDemo}>
                  <RotateCcw size={15} /> Reset demo
                </Button>
              </div>
            </details>
          ) : null}
        </div>
      </header>

      <nav className="sticky top-2 z-[400] mx-3 mt-1 rounded-[1.5rem] border border-slate-200 bg-white/96 px-2 py-2 shadow-[0_14px_34px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur sm:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {(["Near My Route", "Import Schedule", "Outreach", "Facilities"] as AppTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-label={tab}
              onClick={() => selectTopLevelTab(tab)}
              className={cx(
                "min-h-11 rounded-[1.1rem] px-2 text-xs font-black transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                activeTab === tab ? "bg-blue-700 text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)]" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </nav>

      {activeTab === "Near My Route" ? (
        <>
        {routeView.kind === "review" ? (
          <main className="mx-auto max-w-2xl px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:py-4 xl:hidden">
            <Button tone="ghost" onClick={() => closeFacilityReview(routeView)}>
              <ArrowLeft size={15} /> {reviewBackLabel(routeView)}
            </Button>
            <DetailDrawer
              className="mt-3 rounded-xl border border-slate-200"
              facility={selectedFacility}
              opportunity={routeView.sourceTab === "Near My Route" ? selectedFilteredOpportunity : selectedOpportunity}
              todayStatus={selectedTodayStatus}
              outreachLogs={selectedOutreachLogs}
              showMessage={showMessage}
              isOnRoute={Boolean(selectedFacility && routeStops.some((stop) => stop.facilityId === selectedFacility.id))}
              onCloseMessage={() => setShowMessage(false)}
              onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged call attempt.")}
              onStartText={() => selectedFacility && void startTextFlow(selectedFacility.id)}
              onCopyMessage={() => selectedFacility && void copySafeMessage(selectedFacility.id)}
              onMarkTexted={() => selectedFacility && markTexted(selectedFacility.id)}
              onClearDoNotContact={() => selectedFacility && clearDoNotContact(selectedFacility.id)}
              onUpdateContactPhone={(contactId, phone) => selectedFacility && updateContactPhone(selectedFacility.id, contactId, phone)}
              onLogStatus={(status, notes) => selectedFacility && logTodayResponse(selectedFacility.id, status, notes)}
              onAddRoute={() => selectedFacility && addTentatively(selectedFacility.id)}
              onRemoveAddOn={() => selectedFacility && removeTodayAddOn(selectedFacility.id)}
              onPreviewRoute={() => selectedOpportunity && previewRouteWithAddOn(selectedOpportunity)}
              onOpenRoute={() => selectedFacility && openRouteHome(selectedFacility.id)}
              copyFeedback={selectedFacility ? copyFeedbackByFacilityId[selectedFacility.id] : undefined}
            />
          </main>
        ) : null}

        {routeView.kind === "confirmation" ? (
          <div className="xl:hidden">
            <TentativeAddConfirmation
              facility={facilityById.get(routeView.facilityId)}
              routeStops={orderedRouteStops}
              facilityById={facilityById}
              snapshot={routeView.snapshot}
              contactedToday={routeView.contactedToday}
              canRemove={routeView.canRemove}
              onBackToRoute={() => openRouteHome(routeView.facilityId)}
              onRemoveTentative={() => removeTentativeStop(routeView.routeStopId)}
            />
          </div>
        ) : null}

        <main className={cx(
          "mx-auto flex max-w-[1800px] flex-col px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:py-4 xl:h-[calc(100vh-5.5rem)] xl:px-4 xl:py-4",
          routeView.kind === "review" && "hidden xl:flex",
        )}>
          <section className="nmr-surface nmr-enter mb-3 rounded-[1.75rem] p-4 xl:hidden">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Route readiness</p>
                <h2 className="mt-1 text-xl font-black leading-tight text-slate-950">{routeReadinessTitle}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">{routeReadinessSummary}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:flex">
                {routeNeedsLocationReview ? (
                  <>
                    <Button tone="primary" onClick={() => openRouteHome(currentRouteUnconfirmedFacilities[0]?.id ?? selectedFacilityId)}>
                      Review one location
                    </Button>
                    <Button disabled ariaLabel="Confirm locations for Maps">
                      <ExternalLink size={15} /> Open in Google Maps
                    </Button>
                  </>
                ) : (
                  <Button disabled={isCurrentRouteMapsBlocked} onClick={() => openMapsUrl(currentRouteMapsUrl)}>
                    <ExternalLink size={15} /> Open in Google Maps
                  </Button>
                )}
                <Button ariaLabel="Import route" onClick={() => selectTopLevelTab("Import Schedule")}>
                  <Clipboard size={15} /> Import route
                </Button>
                <Button onClick={() => featuredOpportunity && openFacilityReview(featuredOpportunity.facility.id)} disabled={!featuredOpportunity}>
                  <MessageSquareText size={15} /> Review add-on
                </Button>
              </div>
            </div>
          </section>
          <div className="grid min-h-0 flex-1 gap-4 xl:hidden">
          <section className="flex w-full shrink-0 flex-col gap-3 rounded-[1.75rem] border border-slate-200 bg-white/42 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <BestAddOnCard
              opportunity={featuredOpportunity}
              todayStatus={
                featuredOpportunity
                  ? todayStatusByFacilityId.get(featuredOpportunity.facility.id) ?? "not_contacted"
                  : undefined
              }
              onReview={() => featuredOpportunity && openFacilityReview(featuredOpportunity.facility.id)}
              onPreview={() => featuredOpportunity && previewRouteWithAddOn(featuredOpportunity)}
              onImport={() => selectTopLevelTab("Import Schedule")}
            />

            <div className="nmr-panel rounded-3xl p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-950">Outreach status</h2>
                <Badge tone="blue">{currentRouteStatusCounts.reduce((sum, item) => sum + item.count, 0)} on route</Badge>
              </div>
              <div className="mt-2">
                <StatusSummary counts={todayCounts} />
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-bold uppercase text-slate-500">Show status counts</summary>
                <div className="mt-3">
                <TodayStatusStrip counts={todayCounts} />
                </div>
              </details>
            </div>

            <div className="nmr-panel rounded-3xl p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-950">Tomorrow&apos;s route</h2>
                {currentRouteSourceMapLink ? (
                  <Button ariaLabel="Open original map link" onClick={() => openMapsUrl(currentRouteSourceMapLink)}>
                    <ExternalLink size={15} /> Original map
                  </Button>
                ) : null}
              </div>
              {currentRouteMapsWarning ? (
                <p className="mt-2 rounded-md border border-yellow-200 bg-yellow-50 px-2 py-1 text-xs font-semibold text-yellow-800">
                  {currentRouteMapsWarning}
                </p>
              ) : null}
              {currentRouteLocationWarning ? (
                <div className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-2 text-xs font-bold text-orange-800">
                  <p>{currentRouteLocationWarning}</p>
                  <Button
                    className="mt-2"
                    onClick={() => openRouteHome(currentRouteUnconfirmedFacilities[0]?.id ?? selectedFacilityId)}
                  >
                    Review locations
                  </Button>
                </div>
              ) : null}
              {currentRouteSplitUrls.length > 0 ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {currentRouteSplitUrls.map((url, index) => (
                    <Button key={url} disabled={isCurrentRouteMapsBlocked} onClick={() => openMapsUrl(url)}>
                      <ExternalLink size={15} /> Open leg {index + 1}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 space-y-2">
                {orderedRouteStops.map((stop) => {
                  const facility = facilityById.get(stop.facilityId);
                  const location = stop.privateLocation ?? facility;
                  if (!location) return null;
                  const status = facility ? todayStatusByFacilityId.get(facility.id) ?? "not_contacted" : undefined;
                  return (
                      <button
                        key={stop.id}
                        type="button"
                        disabled={!facility}
                        onClick={() => facility && openFacilityReview(facility.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white/78 p-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-blue-200 hover:bg-blue-50"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-black text-white">
                        {stop.order}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-900">{location.name}</span>
                        <span className="text-xs text-slate-500">
                          {stop.appointmentTime ?? "Time TBD"} - {stop.studyCount ?? 0} studies - {friendlyValue(stop.status)}
                        </span>
                        {!hasConfirmedLocation(location) ? (
                          <span className="mt-1 block text-xs font-bold text-orange-700">Location needs confirmation</span>
                        ) : null}
                      </span>
                      {status ? <Badge tone={todayStatusTone(status)}>{todayStatusLabel(status)}</Badge> : <Badge tone="slate">Private</Badge>}
                    </button>
                  );
                })}
              </div>
            </div>

            <LocationConfirmationQueue
              facilities={facilities}
              routeStops={orderedRouteStops}
              routeFacilityIds={currentRouteFacilityIds}
              onConfirm={confirmFacilityLocation}
            />

            {showDemoTools ? (
              <details className="nmr-panel rounded-3xl p-3">
                <summary className="cursor-pointer text-sm font-black text-slate-950">Demo tools</summary>
                {dogfoodNoteWarning ? (
                  <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
                    {dogfoodNoteWarning}
                  </p>
                ) : null}
                <details open className="mt-3 rounded-2xl border border-slate-200 bg-white/70 p-3">
                  <summary className="cursor-pointer text-sm font-black text-slate-950">
                    Today route checklist ({dogfoodTasks.filter((task) => dogfoodChecked[task.id]).length}/{dogfoodTasks.length})
                  </summary>
                  <div className="mt-3">
                    <DogfoodChecklist
                      checked={dogfoodChecked}
                      notes={dogfoodNotes}
                      notesWarning={dogfoodNoteWarning}
                      className="border-0 bg-transparent p-0 shadow-none"
                      onToggle={updateDogfoodTask}
                      onNotesChange={updateDogfoodNotes}
                    />
                  </div>
                </details>
              </details>
            ) : null}

            <details className="nmr-panel rounded-3xl p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-black text-slate-950">Opportunity filters</summary>
              <div className="mt-3">
                <label className="block text-xs font-bold uppercase text-slate-500">
                  Max detour: {maxDetourMinutes} minutes
                  <input
                    type="range"
                    min="5"
                    max="30"
                    value={maxDetourMinutes}
                    onChange={(event) => setMaxDetourMinutes(Number(event.target.value))}
                    className="mt-2 w-full"
                  />
                </label>
                <div className="mt-3 grid gap-2">
                  <Toggle
                    label="Show due for follow-up only"
                    checked={notContactedRecentlyOnly}
                    onChange={setNotContactedRecentlyOnly}
                  />
                  <Toggle label="Show known contacts only" checked={knownContactsOnly} onChange={setKnownContactsOnly} />
                  <Toggle
                    label="Show same-day friendly only"
                    checked={sameDayFriendlyOnly}
                    onChange={setSameDayFriendlyOnly}
                  />
                  <label className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                    Follow-up after
                    <input
                      type="number"
                      min="1"
                      value={followUpThresholdDays}
                      onChange={(event) => setFollowUpThresholdDays(Number(event.target.value))}
                      className="h-9 w-20 rounded-md border border-slate-200 px-2 text-sm font-bold text-slate-900"
                    />
                    days
                  </label>
                </div>
              </div>
            </details>

            <div className="nmr-panel hidden rounded-3xl p-3 lg:block">
              <div className="flex items-center gap-2">
                <Filter size={15} className="text-slate-500" />
                <h2 className="text-sm font-black text-slate-950">Opportunity filters</h2>
              </div>
              <label className="mt-3 block text-xs font-bold uppercase text-slate-500">
                Max detour: {maxDetourMinutes} minutes
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={maxDetourMinutes}
                  onChange={(event) => setMaxDetourMinutes(Number(event.target.value))}
                  className="mt-2 w-full"
                />
              </label>
              <div className="mt-3 grid gap-2">
                <Toggle
                  label="Show due for follow-up only"
                  checked={notContactedRecentlyOnly}
                  onChange={setNotContactedRecentlyOnly}
                />
                <Toggle label="Show known contacts only" checked={knownContactsOnly} onChange={setKnownContactsOnly} />
                <Toggle
                  label="Show same-day friendly only"
                  checked={sameDayFriendlyOnly}
                  onChange={setSameDayFriendlyOnly}
                />
                <label className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                  Follow-up after
                  <input
                    type="number"
                    min="1"
                    value={followUpThresholdDays}
                    onChange={(event) => setFollowUpThresholdDays(Number(event.target.value))}
                    className="h-9 w-20 rounded-md border border-slate-200 px-2 text-sm font-bold text-slate-900"
                  />
                  days
                </label>
              </div>
            </div>

            <details className="nmr-panel rounded-3xl p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-black text-slate-950">
                More opportunities ({opportunities.length})
              </summary>
              <div className="mt-3 space-y-4">
                {groupedOpportunities.map(({ group, items }) => {
                  if (items.length === 0) return null;
                  if (group === "Maybe Later" && maxDetourMinutes <= 10) return null;

                  return (
                    <section key={group}>
                      <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-black text-slate-950">
                          {group === "Good Options" ? "Along the Way" : group}
                        </h2>
                        <Badge tone={group === "Not Worth It Today" ? "slate" : "orange"}>{items.length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {items.map((opportunity) => (
                          <OpportunityCard
                            key={opportunity.facility.id}
                            opportunity={opportunity}
                            rank={detourRankByFacilityId.get(opportunity.facility.id) ?? 0}
                            selected={selectedFacilityId === opportunity.facility.id}
                            todayStatus={todayStatusByFacilityId.get(opportunity.facility.id) ?? "not_contacted"}
                            onSelect={() => selectFacility(opportunity.facility.id)}
                            onReview={() => openFacilityReview(opportunity.facility.id)}
                            onMarkContacted={() => void startTextFlow(opportunity.facility.id)}
                            onAddTentatively={() => addTentatively(opportunity.facility.id)}
                            onPreviewRoute={() => previewRouteWithAddOn(opportunity)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </details>

            <div className="hidden space-y-4 lg:block">
              {groupedOpportunities.map(({ group, items }) => {
                if (items.length === 0) return null;
                if (group === "Maybe Later" && maxDetourMinutes <= 10) return null;

                return (
                  <section key={group}>
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-black text-slate-950">
                        {group === "Good Options" ? "Along the Way" : group}
                      </h2>
                      <Badge tone={group === "Not Worth It Today" ? "slate" : "orange"}>{items.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {items.map((opportunity) => (
                        <OpportunityCard
                          key={opportunity.facility.id}
                          opportunity={opportunity}
                          rank={detourRankByFacilityId.get(opportunity.facility.id) ?? 0}
                          selected={selectedFacilityId === opportunity.facility.id}
                          todayStatus={todayStatusByFacilityId.get(opportunity.facility.id) ?? "not_contacted"}
                          onSelect={() => selectFacility(opportunity.facility.id)}
                          onReview={() => openFacilityReview(opportunity.facility.id)}
                          onMarkContacted={() => void startTextFlow(opportunity.facility.id)}
                          onAddTentatively={() => addTentatively(opportunity.facility.id)}
                          onPreviewRoute={() => previewRouteWithAddOn(opportunity)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>

          <section className="nmr-surface relative hidden min-h-[560px] overflow-hidden rounded-[1.75rem] p-1.5 xl:sticky xl:top-24 xl:block xl:h-[calc(100vh-7rem)]">
            <div className="h-full overflow-hidden rounded-[1.35rem]">
            <RouteMap
              facilities={facilities}
              routeStops={routeStops}
              opportunities={opportunities}
              outreachLogs={outreachLogs}
              selectedFacilityId={selectedFacilityId}
              onSelectFacility={(facilityId) => openFacilityReview(facilityId)}
            />
            </div>
          </section>

          <DetailDrawer
            className="hidden xl:sticky xl:top-24 xl:block xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:rounded-[1.75rem] xl:border xl:border-slate-200"
            facility={selectedFacility}
            opportunity={selectedFilteredOpportunity}
            todayStatus={selectedTodayStatus}
            outreachLogs={selectedOutreachLogs}
            showMessage={showMessage}
            isOnRoute={Boolean(selectedFacility && routeStops.some((stop) => stop.facilityId === selectedFacility.id))}
            onCloseMessage={() => setShowMessage(false)}
            onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged call attempt.")}
            onStartText={() => selectedFacility && void startTextFlow(selectedFacility.id)}
            onCopyMessage={() => selectedFacility && void copySafeMessage(selectedFacility.id)}
            onMarkTexted={() => selectedFacility && markTexted(selectedFacility.id)}
            onClearDoNotContact={() => selectedFacility && clearDoNotContact(selectedFacility.id)}
            onUpdateContactPhone={(contactId, phone) => selectedFacility && updateContactPhone(selectedFacility.id, contactId, phone)}
            onLogStatus={(status, notes) => selectedFacility && logTodayResponse(selectedFacility.id, status, notes)}
            onAddRoute={() => selectedFacility && addTentatively(selectedFacility.id)}
            onRemoveAddOn={() => selectedFacility && removeTodayAddOn(selectedFacility.id)}
            onPreviewRoute={() => selectedOpportunity && previewRouteWithAddOn(selectedOpportunity)}
            onOpenRoute={() => selectedFacility && openRouteHome(selectedFacility.id)}
            copyFeedback={selectedFacility ? copyFeedbackByFacilityId[selectedFacility.id] : undefined}
          />
          </div>
          <DesktopRouteDashboard
            facilities={facilities}
            routeStops={orderedRouteStops}
            opportunities={opportunities}
            outreachLogs={outreachLogs}
            selectedFacility={routeView.kind === "confirmation" ? facilityById.get(routeView.facilityId) : selectedFacility}
            selectedOpportunity={selectedFilteredOpportunity}
            selectedTodayStatus={selectedTodayStatus}
            selectedOutreachLogs={selectedOutreachLogs}
            featuredOpportunity={featuredOpportunity}
            facilityById={facilityById}
            todayStatusByFacilityId={todayStatusByFacilityId}
            todayCounts={todayCounts}
            routeViewKind={routeView.kind}
            showAddedSuccess={routeView.kind === "confirmation"}
            locationReview={
              <LocationConfirmationQueue
                facilities={facilities}
                routeStops={orderedRouteStops}
                routeFacilityIds={currentRouteFacilityIds}
                onConfirm={confirmFacilityLocation}
              />
            }
            isCurrentRouteMapsBlocked={isCurrentRouteMapsBlocked}
            showMessage={showMessage}
            copyFeedback={
              routeView.kind === "confirmation"
                ? copyFeedbackByFacilityId[routeView.facilityId]
                : selectedFacility
                  ? copyFeedbackByFacilityId[selectedFacility.id]
                  : undefined
            }
            onSelectFacility={selectFacility}
            onReviewFacility={(facilityId) => openFacilityReview(facilityId)}
            onExportSummary={exportRouteSummary}
            onOpenCurrentRoute={() => openMapsUrl(currentRouteMapsUrl)}
            onCloseMessage={() => setShowMessage(false)}
            onStartText={() => selectedFacility && void startTextFlow(selectedFacility.id)}
            onCopyMessage={() => selectedFacility && void copySafeMessage(selectedFacility.id)}
            onMarkTexted={() => selectedFacility && markTexted(selectedFacility.id)}
            onLogStatus={(status, notes) => selectedFacility && logTodayResponse(selectedFacility.id, status, notes)}
            onAddRoute={() => selectedFacility && addTentatively(selectedFacility.id)}
            onRemoveAddOn={() =>
              routeView.kind === "confirmation"
                ? removeTentativeStop(routeView.routeStopId)
                : selectedFacility && removeTodayAddOn(selectedFacility.id)
            }
            onPreviewRoute={() => selectedOpportunity && previewRouteWithAddOn(selectedOpportunity)}
          />
        </main>
        </>
      ) : null}

      {activeTab === "Facilities" ? (
        <main className="mx-auto grid max-w-[1800px] gap-4 px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:py-4 xl:grid-cols-[1fr_380px]">
          <section className="nmr-surface nmr-enter overflow-hidden rounded-[1.75rem]">
            <div className="border-b border-slate-200 p-4">
              <h2 className="text-lg font-black">Facilities</h2>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px_190px_190px]">
                <label className="relative">
                  <Search className="absolute left-3 top-3 text-slate-400" size={16} />
                  <input
                    value={facilitySearch}
                    onChange={(event) => setFacilitySearch(event.target.value)}
                    placeholder="Search by name or address"
                    className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm"
                  />
                </label>
                <select value={facilityTypeFilter} onChange={(event) => setFacilityTypeFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-sm">
                  {["All", "SNF", "Rehab Hospital", "LTACH", "ALF", "Hospital", "Other"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select value={contactStatusFilter} onChange={(event) => setContactStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-sm">
                  {["All", "Known contacts", "No contact", "Due for follow-up"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  Due after
                  <input
                    type="number"
                    min="1"
                    value={followUpThresholdDays}
                    onChange={(event) => setFollowUpThresholdDays(Number(event.target.value))}
                    className="h-10 w-20 rounded-md border border-slate-200 px-2 text-sm text-slate-900"
                  />
                  days
                </label>
              </div>
            </div>
            <div className="grid gap-3 p-3 lg:hidden">
              {filteredFacilities.map((facility) => {
                const contact = primaryContact(facility);
                const status = todayStatusByFacilityId.get(facility.id) ?? "not_contacted";
                return (
                  <article
                    key={facility.id}
                    className={cx(
                      "nmr-panel rounded-3xl p-3",
                      selectedFacilityId === facility.id ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openFacilityReview(facility.id)}
                      className="block w-full text-left"
                    >
                      <h3 className="text-base font-black text-slate-950">{facility.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{facility.address}</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {contact ? `${contact.name}, ${contact.role ?? "SLP"}` : "No known contact"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Badge>{facility.facilityType ?? "Facility"}</Badge>
                        <Badge tone={facility.sameDayFriendly === "yes" ? "green" : "slate"}>
                          {friendlyValue(facility.sameDayFriendly)}
                        </Badge>
                        <Badge tone="blue">{formatDaysAgo(facility.lastContacted)}</Badge>
                        <Badge tone={outreachRecencyState(facility, followUpThresholdDays) === "due_for_follow_up" ? "orange" : "slate"}>
                          {outreachRecencyLabel(outreachRecencyState(facility, followUpThresholdDays))}
                        </Badge>
                        <Badge tone={todayStatusTone(status)}>{todayStatusLabel(status)}</Badge>
                      </div>
                    </button>
                    <Button className="mt-3 w-full" tone="primary" ariaLabel="Review fit" onClick={() => openFacilityReview(facility.id)}>
                      See why this fits
                    </Button>
                  </article>
                );
              })}
            </div>
            <div className="hidden divide-y divide-slate-100 lg:block">
              {filteredFacilities.map((facility) => {
                const contact = primaryContact(facility);
                const status = todayStatusByFacilityId.get(facility.id) ?? "not_contacted";
                const opportunity =
                  opportunities.find((item) => item.facility.id === facility.id) ??
                  routeFitOpportunities.find((item) => item.facility.id === facility.id);
                const routeStop = routeStops.find((stop) => stop.facilityId === facility.id);
                const routeFitLabel = opportunity
                  ? `+${opportunity.addedDriveMinutes} min, ${opportunity.bestInsertionLabel}`
                  : routeStop
                    ? `${routeStop.appointmentTime ?? "Time TBD"} scheduled stop`
                    : "No route fit";

                return (
                  <button
                    key={facility.id}
                    type="button"
                    onClick={() => selectFacility(facility.id)}
                    className={cx(
                      "grid w-full grid-cols-[minmax(220px,1.4fr)_170px_minmax(170px,1fr)_minmax(190px,1.2fr)_160px_120px] items-center gap-4 px-4 py-3 text-left text-sm hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500",
                      selectedFacilityId === facility.id && "bg-blue-50",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-black text-slate-950">{facility.name}</span>
                      <span className="block truncate text-xs font-medium text-slate-500">
                        {facility.city ?? facility.address} - {facility.facilityType ?? "Facility"}
                      </span>
                    </span>
                    <span>
                      <Badge tone={todayStatusTone(status)}>{todayStatusLabel(status)}</Badge>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900">
                        {contact ? `${contact.name}, ${contact.role ?? "SLP"}` : "No known contact"}
                      </span>
                      <span className="block text-xs font-medium text-slate-500">{formatDaysAgo(facility.lastContacted)}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-900">{routeFitLabel}</span>
                      <span className="block text-xs font-medium text-slate-500">Last visited {formatDaysAgo(facility.lastVisited)}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={facility.sameDayFriendly === "yes" ? "green" : "slate"}>
                        {friendlyValue(facility.sameDayFriendly)}
                      </Badge>
                      <Badge>{friendlyValue(facility.typicalVolume)}</Badge>
                    </span>
                    <span className="justify-self-end rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700">
                      See why this fits
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          <DetailDrawer
            className="hidden xl:block"
            facility={selectedFacility}
            opportunity={selectedOpportunity}
            todayStatus={selectedTodayStatus}
            outreachLogs={selectedOutreachLogs}
            showMessage={showMessage}
            isOnRoute={Boolean(selectedFacility && routeStops.some((stop) => stop.facilityId === selectedFacility.id))}
            onCloseMessage={() => setShowMessage(false)}
            onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged from Facilities view.")}
            onStartText={() => selectedFacility && void startTextFlow(selectedFacility.id)}
            onCopyMessage={() => selectedFacility && void copySafeMessage(selectedFacility.id)}
            onMarkTexted={() => selectedFacility && markTexted(selectedFacility.id)}
            onClearDoNotContact={() => selectedFacility && clearDoNotContact(selectedFacility.id)}
            onUpdateContactPhone={(contactId, phone) => selectedFacility && updateContactPhone(selectedFacility.id, contactId, phone)}
            onLogStatus={(status, notes) => selectedFacility && logTodayResponse(selectedFacility.id, status, notes)}
            onAddRoute={() => selectedFacility && addTentatively(selectedFacility.id)}
            onRemoveAddOn={() => selectedFacility && removeTodayAddOn(selectedFacility.id)}
            onPreviewRoute={() => selectedOpportunity && previewRouteWithAddOn(selectedOpportunity)}
            onOpenRoute={() => selectedFacility && openRouteHome(selectedFacility.id)}
            copyFeedback={selectedFacility ? copyFeedbackByFacilityId[selectedFacility.id] : undefined}
          />
        </main>
      ) : null}

      {activeTab === "Import Schedule" ? (
        <main className="mx-auto grid max-w-6xl gap-4 px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:py-4 lg:grid-cols-[420px_1fr]">
          <section className="nmr-surface nmr-enter rounded-[1.75rem] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Step 1</p>
            <h2 className="mt-1 text-lg font-black">Import tomorrow&apos;s route</h2>
            <p className="mt-1 text-sm text-slate-500">
              {importMode === "van_packet"
                ? "Paste the email body/map link and, if needed, copied PDF table text. PDF table text is used only to identify stop-review hints like Home Health/private stops, then cleared after parsing. Patient details are not saved to review rows."
                : "Paste tomorrow's stops. Patient details do not belong here."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-full border border-slate-200 bg-slate-100/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              {([
                ["schedule", "Schedule"],
                ["van_packet", "Van Packet"],
              ] as Array<[ImportMode, string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setImportMode(mode);
                    setImportReviewDraft(undefined);
                    setScheduleText(mode === "schedule" ? sampleSchedule : sampleVanPacket);
                    setVanPacketPdfText(mode === "schedule" ? "" : sampleVanPacketPdfText);
                  }}
                  className={cx(
                    "rounded-full px-3 py-2 text-sm font-bold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    importMode === mode ? "bg-white text-blue-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)]" : "text-slate-600 hover:bg-white",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {importMode === "van_packet" ? (
              <div className="mt-4 grid gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Email body and map link</span>
                  <textarea
                    value={scheduleText}
                    onChange={(event) => setScheduleText(event.target.value)}
                    className="mt-1 min-h-48 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm leading-6"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">PDF table text</span>
                  <textarea
                    value={vanPacketPdfText}
                    onChange={(event) => setVanPacketPdfText(event.target.value)}
                    className="mt-1 min-h-40 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm leading-6"
                  />
                  <span className="mt-1 block text-xs font-semibold text-slate-500">
                    Used only for stop-review hints and cleared after parsing.
                  </span>
                </label>
              </div>
            ) : (
              <textarea
                value={scheduleText}
                onChange={(event) => setScheduleText(event.target.value)}
                className="mt-4 min-h-64 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm leading-6"
              />
            )}
            <div className="mt-3 flex gap-2">
              <Button tone="primary" ariaLabel={importMode === "van_packet" ? "Parse Van Packet" : "Parse Schedule"} onClick={parseImportSchedule}>
                {importMode === "van_packet" ? "Parse van packet" : "Parse route"}
              </Button>
              <Button
                onClick={() => {
                  setScheduleText(importMode === "van_packet" ? sampleVanPacket : sampleSchedule);
                  setVanPacketPdfText(importMode === "van_packet" ? sampleVanPacketPdfText : "");
                }}
              >
                Use sample
              </Button>
            </div>
            {vanPacketSummary ? (
              <div data-testid="van-packet-summary" className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Van packet</p>
                <div className="mt-2 grid gap-1 text-slate-700">
                  <p>
                    <span className="font-bold">Team:</span>{" "}
                    {vanPacketSummary.teamMembers.length > 0 ? vanPacketSummary.teamMembers.join(", ") : "Not listed"}
                  </p>
                  <p>
                    <span className="font-bold">Van:</span> {vanPacketSummary.vanName ?? "Not listed"}
                  </p>
                  <p>
                    <span className="font-bold">Meet:</span> {vanPacketSummary.meetDetails ?? "Not listed"}
                  </p>
                  <p>
                    <span className="font-bold">Map stops:</span> {vanPacketSummary.routeAddresses.length}
                  </p>
                  <p>
                    <span className="font-bold">Private stop hints:</span> {vanPacketSummary.privateStopHints}
                  </p>
                  {vanPacketSummary.routeAnchorHints > 0 ? (
                    <p>
                      <span className="font-bold">Route start/end:</span> {vanPacketSummary.routeAnchorHints} skipped
                    </p>
                  ) : null}
                  {vanPacketSummary.supplementalTextUsed ? (
                    <p>
                      <span className="font-bold">PDF table:</span> Used for stop review hints
                    </p>
                  ) : null}
                  {vanPacketSummary.safeNotes?.length ? (
                    <details className="mt-2 rounded-md border border-blue-200 bg-white/60 p-2">
                      <summary className="cursor-pointer text-sm font-bold text-blue-800">Review safe notes</summary>
                      <ul className="mt-2 grid gap-1 text-sm text-slate-700">
                        {vanPacketSummary.safeNotes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
                {vanPacketSummary.mapLink ? (
                  <Button className="mt-3" onClick={() => openMapsUrl(vanPacketSummary.mapLink)}>
                    <ExternalLink size={15} /> Open original map link
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section id="import-review-section" className="nmr-surface nmr-enter rounded-[1.75rem] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Step 2</p>
                <h2 className="mt-1 text-lg font-black">Review imported stops</h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  {reviewRows.length === 0
                    ? "Parse a route to review matches."
                    : `${reviewRows.length} rows found - ${importSummary.useExisting} matched - ${importSummary.privateRouteStop} private/non-facility - ${importSummary.skipped} skipped - ${importSummary.unresolved} needs review`}
                </p>
              </div>
              <div className="hidden lg:block">
                <Button
                  tone="primary"
                  disabled={!canConfirmImport}
                  onClick={confirmImportedRoute}
                >
                  {confirmImportLabel}
                </Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-black text-green-700">{importSummary.confirmed}</p>
                <p className="text-[11px] font-bold uppercase text-slate-500">Confirmed</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-black text-slate-950">{importSummary.useExisting}</p>
                <p className="text-[11px] font-bold uppercase text-slate-500">Matched</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-black text-slate-950">{importSummary.privateRouteStop}</p>
                <p className="text-[11px] font-bold uppercase text-slate-500">Needs location</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-black text-slate-950">{importSummary.skipped}</p>
                <p className="text-[11px] font-bold uppercase text-slate-500">Skipped</p>
              </div>
              <div className="rounded-md border border-orange-200 bg-orange-50 p-2">
                <p className="text-lg font-black text-orange-800">{importSummary.unresolved}</p>
                <p className="text-[11px] font-bold uppercase text-orange-700">Unresolved</p>
              </div>
            </div>
            {reviewRows.length > 0 ? (
              <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                {importSummary.unresolved > 0
                  ? `${importSummary.confirmed} confirmed. Resolve ${importSummary.unresolved} before route ranking.`
                  : `${importSummary.confirmed} confirmed and ready for route review.`}
              </p>
            ) : null}
            {importSummary.unresolved > 0 ? (
              <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
                Resolve uncertain rows before confirming. Confirm is blocked until you keep a match, create a real facility, mark as a private route stop, or skip the row.
              </div>
            ) : null}
            {routeAnchorRows.length > 0 ? (
              <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-black">Route start/end</p>
                <div className="mt-2 grid gap-2">
                  {routeAnchorRows.map((row) => (
                    <div key={row.id} className="rounded-md border border-blue-100 bg-white px-3 py-2">
                      <p className="font-bold">{row.facilityName}</p>
                      <p className="text-xs font-semibold text-blue-700">{row.reviewNote ?? "Skipped from facility review."}</p>
                      <p className="mt-1 text-xs text-slate-600">{row.address}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {reviewRows.some((row) => row.action === "create_new") ? (
              <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
                <p>New facility locations must be confirmed before add-on ranking.</p>
                {firstPendingLocationFacility ? (
                  <Button className="mt-2" onClick={() => openRouteHome(firstPendingLocationFacility.id)}>
                    Review locations
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 lg:hidden">
              <Button
                tone="primary"
                className="w-full"
                disabled={!canConfirmImport}
                onClick={confirmImportedRoute}
              >
                {confirmImportLabel}
              </Button>
            </div>
            <div className="mt-4 lg:hidden">
              <ImportReviewCards
                rows={visibleImportReviewRows}
                facilities={facilities}
                facilityById={facilityById}
                issuesByRowId={importIssuesByRowId}
                expandedRowIds={expandedImportRowIds}
                onToggleRowExpansion={toggleImportRowExpansion}
                onUpdateRow={updateReviewRow}
                showRowIssues={importMode !== "van_packet"}
              />
            </div>
            {importMode === "van_packet" ? (
              <div className="mt-4 hidden lg:block">
                <ImportReviewCards
                  rows={visibleImportReviewRows}
                  facilities={facilities}
                  facilityById={facilityById}
                  issuesByRowId={importIssuesByRowId}
                  expandedRowIds={expandedImportRowIds}
                  onToggleRowExpansion={toggleImportRowExpansion}
                  onUpdateRow={updateReviewRow}
                  className=""
                  showRowIssues={false}
                />
              </div>
            ) : null}
            <div className={cx("mt-4 overflow-x-auto", importMode === "van_packet" ? "hidden" : "hidden lg:block")}>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Imported Stop</th>
                    <th className="px-3 py-2">Matched Facility</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Edit address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reviewRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                        Parse a schedule to review matches.
                      </td>
                    </tr>
                  ) : (
                    reviewRows.map((row, index) => {
                      const issue = importIssuesByRowId[row.id];
                      const isExpanded = Boolean(expandedImportRowIds[row.id]);
                      const canCollapseMatch = canCollapseImportRow(row, issue);
                      const showControls = !canCollapseMatch || isExpanded;

                      return (
                        <tr
                          key={row.id}
                          data-testid={`import-review-row-${index + 1}`}
                          className={issue ? "bg-orange-50/60" : undefined}
                        >
                          <td className="px-3 py-3">
                            <p className="font-bold text-slate-950">{row.facilityName}</p>
                            <p className="text-xs text-slate-500">
                              {row.appointmentTime || "Time missing"} - {row.studyCount ?? 0} studies
                            </p>
                            {issue ? <p className="mt-1 text-xs font-semibold text-orange-700">{issue}</p> : null}
                          </td>
                          <td className="px-3 py-3">
                            {canCollapseMatch ? (
                              <div className="min-w-72">
                                <ImportMatchedSummary
                                  row={row}
                                  facilityById={facilityById}
                                  idPrefix="desktop"
                                  isExpanded={isExpanded}
                                  onChange={() => toggleImportRowExpansion(row.id)}
                                />
                                {showControls ? (
                                  <ImportRowControls
                                    row={row}
                                    facilities={facilities}
                                    idPrefix="desktop"
                                    onUpdateRow={updateReviewRow}
                                  />
                                ) : null}
                              </div>
                            ) : (
                              <>
                                <p className="font-semibold text-slate-900">
                                  {row.matchedFacilityId ? facilityById.get(row.matchedFacilityId)?.name : "No likely match"}
                                </p>
                                {row.action === "needs_review" || row.action === "use_existing" ? (
                                  <FacilityMatchSelect row={row} facilities={facilities} idPrefix="desktop" onUpdateRow={updateReviewRow} />
                                ) : null}
                              </>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <Badge tone={row.confidence >= 75 ? "green" : row.confidence >= 45 ? "orange" : "slate"}>
                              {row.confidence}%
                            </Badge>
                          </td>
                          <td className="px-3 py-3">
                            {canCollapseMatch ? (
                              <span className="text-xs font-bold uppercase text-green-700">
                                {showControls ? "Editing" : "Ready"}
                              </span>
                            ) : (
                              <select
                                aria-label={`Action for ${row.facilityName}`}
                                value={row.action}
                                onChange={(event) => updateReviewRow(row.id, { action: event.target.value as ImportReviewRow["action"] })}
                                className="h-9 rounded-md border border-slate-200 px-2 text-sm"
                              >
                                <option value="needs_review">Needs review</option>
                                <option value="use_existing">Use selected existing facility</option>
                                <option value="create_new">Create new facility</option>
                                <option value="private_route_stop">Private/non-facility stop</option>
                                <option value="skip">Skip row</option>
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {canCollapseMatch ? (
                              <p className="text-xs font-semibold text-slate-500">
                                {showControls ? "Use expanded controls." : "No changes needed."}
                              </p>
                            ) : (
                              <>
                                {row.action === "create_new" ? (
                                  <label className="mb-2 block text-xs font-bold uppercase text-slate-500">
                                    New facility name
                                    <input
                                      aria-label={`New facility name for ${row.facilityName}`}
                                      value={row.facilityName}
                                      onChange={(event) => updateReviewRow(row.id, { facilityName: event.target.value })}
                                      className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm font-semibold normal-case text-slate-900"
                                    />
                                  </label>
                                ) : null}
                                {row.action === "create_new" || row.action === "private_route_stop" ? (
                                  <>
                                    <input
                                      aria-label={`Address for ${row.facilityName}`}
                                      value={row.address}
                                      onChange={(event) => updateReviewRow(row.id, { address: event.target.value })}
                                      className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                                    />
                                    <p className="mt-1 text-xs text-slate-500">Blank address blocks confirmation.</p>
                                  </>
                                ) : (
                                  <p className="text-xs font-semibold text-slate-500">Choose create or private stop to edit a location.</p>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      ) : null}

      {activeTab === "Outreach" ? (
        <main className="mx-auto max-w-6xl px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:py-4">
          <section className="nmr-surface nmr-enter rounded-[1.75rem] p-4">
            <h2 className="text-lg font-black">Outreach</h2>
            <p className="mt-1 text-sm text-slate-500">
              Work today&apos;s facility responses first. Templates intentionally avoid PHI.
            </p>
            {currentRouteLocationOutreachWarning ? (
              <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800">
                <p>{currentRouteLocationOutreachWarning}</p>
                <Button
                  className="mt-2"
                  onClick={() => openRouteHome(currentRouteUnconfirmedFacilities[0]?.id ?? selectedFacilityId)}
                >
                  Review locations
                </Button>
              </div>
            ) : null}
            <div className="mt-4">
              <TodayStatusStrip counts={todayCounts} />
            </div>
            <TextFirstCard
              item={textFirstItem}
              onAddContact={() => textFirstItem && addContact(textFirstItem.facility.id)}
              onUpdateContact={(contactId, patch) => textFirstItem && updateContact(textFirstItem.facility.id, contactId, patch)}
              onText={() => textFirstItem && void startTextFlow(textFirstItem.facility.id)}
              onReview={() => textFirstItem && openFacilityReview(textFirstItem.facility.id, false, "Outreach")}
            />
            <h3 className="mt-5 text-sm font-black text-slate-950">Ready to text</h3>
            <div data-testid="ready-to-text-queue" className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {readyToTextQueue.length > 0 ? (
                readyToTextQueue.map(({ facility, opportunity, status, latestLog }) => (
                  <OutreachQueueCard
                    key={facility.id}
                    facility={facility}
                    opportunity={opportunity}
                    status={status}
                    latestLog={latestLog}
                    reasonLabels={outreachReasonLabels({ facility, opportunity, status, latestLog })}
                    onAddContact={() => addContact(facility.id)}
                    onUpdateContact={(contactId, patch) => updateContact(facility.id, contactId, patch)}
                    onReview={() => openFacilityReview(facility.id, false, "Outreach")}
                    onTemplate={() => {
                      void startTextFlow(facility.id);
                    }}
                    onLogStatus={(nextStatus, notes) => logTodayResponse(facility.id, nextStatus, notes)}
                    onAddRoute={() => addTentatively(facility.id)}
                    onOpenRoute={() => openRouteHome(facility.id)}
                    onRemoveAddOn={() => removeTodayAddOn(facility.id)}
                  />
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                  No text-ready facilities yet.
                </p>
              )}
            </div>
            {needsPhoneQueue.length > 0 ? (
              <>
                <h3 className="mt-5 text-sm font-black text-slate-950">Needs phone before texting</h3>
                <div data-testid="needs-phone-queue" className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {needsPhoneQueue.map(({ facility, opportunity, status, latestLog }) => (
                    <OutreachQueueCard
                      key={facility.id}
                      facility={facility}
                      opportunity={opportunity}
                      status={status}
                      latestLog={latestLog}
                      reasonLabels={outreachReasonLabels({ facility, opportunity, status, latestLog })}
                      onAddContact={() => addContact(facility.id)}
                      onUpdateContact={(contactId, patch) => updateContact(facility.id, contactId, patch)}
                      onReview={() => openFacilityReview(facility.id, false, "Outreach")}
                      onTemplate={() => {
                        void startTextFlow(facility.id);
                      }}
                      onLogStatus={(nextStatus, notes) => logTodayResponse(facility.id, nextStatus, notes)}
                      onAddRoute={() => addTentatively(facility.id)}
                      onOpenRoute={() => openRouteHome(facility.id)}
                      onRemoveAddOn={() => removeTodayAddOn(facility.id)}
                    />
                  ))}
                </div>
              </>
            ) : null}
            <h3 className="mt-5 text-sm font-black text-slate-950">Response queue</h3>
            <div data-testid="response-queue" className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {responseQueue.length > 0 ? (
                responseQueue.map(({ facility, opportunity, status, latestLog }) => (
                  <OutreachQueueCard
                    key={facility.id}
                    facility={facility}
                    opportunity={opportunity}
                    status={status}
                    latestLog={latestLog}
                    reasonLabels={outreachReasonLabels({ facility, opportunity, status, latestLog })}
                    onAddContact={() => addContact(facility.id)}
                    onUpdateContact={(contactId, patch) => updateContact(facility.id, contactId, patch)}
                    onReview={() => openFacilityReview(facility.id, false, "Outreach")}
                    onTemplate={() => {
                      void startTextFlow(facility.id);
                    }}
                    onLogStatus={(nextStatus, notes) => logTodayResponse(facility.id, nextStatus, notes)}
                    onAddRoute={() => addTentatively(facility.id)}
                    onOpenRoute={() => openRouteHome(facility.id)}
                    onRemoveAddOn={() => removeTodayAddOn(facility.id)}
                  />
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                  No active replies yet.
                </p>
              )}
            </div>
            <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-black text-slate-900">Outreach history</summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Facility</th>
                    <th className="px-4 py-3">Date/time</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Contact person</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {outreachLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-3 font-bold text-slate-950">{facilityById.get(log.facilityId)?.name}</td>
                      <td className="px-4 py-3">{formatStableDateTime(log.createdAt)}</td>
                      <td className="px-4 py-3">{friendlyValue(log.method)}</td>
                      <td className="px-4 py-3">{log.contactName ?? "Unknown"}</td>
                      <td className="px-4 py-3">
                        <Badge tone={log.status === "added_to_route" ? "green" : log.status === "do_not_contact" ? "red" : "blue"}>
                          {friendlyValue(log.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{log.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </details>
            <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-black text-slate-900">Manual log</summary>
              <p className="mt-2 text-sm text-slate-500">
                Use this only when the queue cards do not cover the update you need.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <select value={selectedFacilityId} onChange={(event) => setSelectedFacilityId(event.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-sm">
                  {facilities.map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.name}
                    </option>
                  ))}
                </select>
                <select
                  value={manualStatus}
                  onChange={(event) => setManualStatus(event.target.value as OutreachStatus)}
                  className="h-10 rounded-md border border-slate-200 px-3 text-sm"
                >
                  {outreachStatuses.map((status) => (
                    <option key={status} value={status}>
                      {friendlyValue(status)}
                    </option>
                  ))}
                </select>
                <Button
                  tone="primary"
                  onClick={() => logOutreach(selectedFacilityId, manualStatus, "other", "Manual outreach update.")}
                >
                  Save Outreach
                </Button>
                <Button
                  onClick={() => {
                    openFacilityReview(selectedFacilityId, true);
                  }}
                >
                  <MessageSquareText size={15} /> Open Template
                </Button>
              </div>
            </details>
          </section>
        </main>
      ) : null}

      <TextContactPicker
        facility={textPickerFacility}
        contacts={textPickerContacts}
        onChoose={(contactId) => textPickerFacility && void openMessagesForContact(textPickerFacility.id, contactId)}
        onClose={() => setTextPickerFacilityId(undefined)}
      />
    </div>
  );
}
