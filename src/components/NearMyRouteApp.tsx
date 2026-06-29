"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clipboard,
  ExternalLink,
  Filter,
  MapPinned,
  MessageSquareText,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Timer,
} from "lucide-react";
import { initialFacilities, initialOutreachLogs, initialRouteStops } from "@/lib/mockData";
import { calculateRouteOpportunities } from "@/lib/routeCalculations";
import { applyImportRows, importRowBlockingReason, parseScheduleText } from "@/lib/scheduleImport";
import { clearStoredState, loadStoredState, saveStoredState } from "@/lib/storage";
import type { Facility, FacilityContact, ImportReviewRow, Opportunity, OutreachLog, OutreachStatus, RouteStop } from "@/lib/types";
import {
  buildSmsUrl,
  canAttemptSms,
  formatDaysAgo,
  friendlyValue,
  isPlaceholderPhoneNumber,
  phoneContacts,
  primaryContact,
  safeMessage,
  todayIsoDate,
} from "@/lib/format";
import {
  buildGoogleMapsDirectionsUrl,
  googleMapsWaypointWarning,
  orderedRouteFacilities,
  routeFacilitiesWithInsertedAddOn,
  splitGoogleMapsDirectionsUrls,
} from "@/lib/googleMaps";
import { isDueForFollowUp, outreachRecencyLabel, outreachRecencyState } from "@/lib/outreachRecency";
import {
  deriveTodayStatus,
  latestTodayLog,
  todayStatusLabel,
  todayStatusOrder,
  todayStatusSummary,
  todayStatusTone,
  type TodayStatus,
} from "@/lib/todayStatus";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-500">Loading map...</div>,
});

const sampleSchedule = `8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies
10:15 AM Park Manor Westchase, 11910 Richmond Ave, Houston, TX, 1 study
1:00 PM, Lakeside Rehab, 9440 Bellaire Blvd, Houston, TX, 2 studies`;

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

type TextFeedback = "copied" | "failed" | "opened" | "fallback_copied" | "no_phone" | "placeholder_phone";

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
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-center text-[13px] font-semibold leading-tight transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
        tone === "primary" && "bg-blue-600 text-white hover:bg-blue-700",
        tone === "secondary" && "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        tone === "ghost" && "text-slate-600 hover:bg-slate-100",
        tone === "danger" && "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
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
        "inline-flex whitespace-nowrap items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tone === "blue" && "border-blue-200 bg-blue-50 text-blue-700",
        tone === "orange" && "border-orange-200 bg-orange-50 text-orange-700",
        tone === "green" && "border-green-200 bg-green-50 text-green-700",
        tone === "red" && "border-red-200 bg-red-50 text-red-700",
        tone === "slate" && "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {children}
    </span>
  );
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
        "rounded-lg border bg-white p-3 shadow-sm transition",
        selected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300",
        opportunity.group === "Not Worth It Today" && "bg-slate-50 opacity-80",
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600 text-[11px] font-black text-white">
                {rank}
              </span>
              <h3 className="truncate text-sm font-bold text-slate-950">{opportunity.facility.name}</h3>
            </div>
            <p className="mt-2 text-2xl font-black tracking-tight text-orange-600">
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
        <Button tone="primary" onClick={onReview}>
          <MessageSquareText size={15} /> Review fit
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
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Best add-on now</p>
        <h2 className="mt-2 text-lg font-black text-slate-950">No route add-ons match these filters</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Adjust the detour or contact filters, or import tomorrow&apos;s schedule before reviewing candidates.
        </p>
        <Button className="mt-3 w-full" onClick={onImport}>
          <Clipboard size={15} /> Import Schedule
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Best add-on now</p>
          <h2 className="mt-1 truncate text-xl font-black text-slate-950">{opportunity.facility.name}</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">{opportunity.bestInsertionLabel}</p>
        </div>
        <div className="shrink-0 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-right">
          <p className="text-2xl font-black leading-none text-orange-600">+{opportunity.addedDriveMinutes}</p>
          <p className="mt-1 text-[11px] font-bold uppercase text-orange-700">min detour</p>
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
        <Button tone="primary" onClick={onReview}>
          <MessageSquareText size={15} /> Review fit
        </Button>
        <Button onClick={onPreview}>
          <ExternalLink size={15} /> Preview route
        </Button>
      </div>
    </section>
  );
}

function DogfoodChecklist({
  checked,
  notes,
  className,
  onToggle,
  onNotesChange,
}: {
  checked: Record<string, boolean>;
  notes: string;
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
  className,
  onCloseMessage,
  onCall,
  onStartText,
  onCopyMessage,
  onMarkTexted,
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
  className?: string;
  onCloseMessage: () => void;
  onCall: () => void;
  onStartText: () => void;
  onCopyMessage: () => void;
  onMarkTexted: () => void;
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
          <Button key="possible" tone="primary" onClick={() => onLogStatus("possible_add_on", "Facility may have a same-day add-on.")}>
            Possible add-on
          </Button>,
        ];

  return (
    <aside className={cx("w-full shrink-0 border-t border-slate-200 bg-white p-4 xl:w-[380px] xl:border-l xl:border-t-0", className)}>
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
            {opportunity ? `+${opportunity.addedDriveMinutes} min` : "On route"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-bold uppercase text-slate-500">Nearest stop</p>
          <p className="mt-1 text-sm font-bold text-slate-900">
            {opportunity ? opportunity.nearestStopName : "Scheduled stop"}
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
          <h3 className="text-sm font-black text-slate-900">Today response</h3>
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
          <Button className="mt-3 w-full" tone="primary" onClick={onStartText}>
            <Send size={15} /> Open Messages
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
        ) : null}
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
              Template copied. Messages opened and this facility is logged as texted today.
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
          {copyFeedback === "failed" ? (
            <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-bold text-orange-800">
              Clipboard was blocked. The message is visible above so you can copy it manually.
            </p>
          ) : null}
          <Button tone="primary" className="mt-3 w-full" onClick={onCopyMessage}>
            <Clipboard size={15} /> Copy message
          </Button>
          {copyFeedback !== "placeholder_phone" ? (
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
                  {new Date(log.createdAt).toLocaleString()} - {friendlyValue(log.method)}
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
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {counts.map(({ status, label, count }) => (
        <div key={status} className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-black text-slate-950">{count}</p>
        </div>
      ))}
    </div>
  );
}

function OutreachQueueCard({
  facility,
  opportunity,
  status,
  latestLog,
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
  onReview: () => void;
  onTemplate: () => void;
  onLogStatus: (status: OutreachStatus, notes: string) => void;
  onAddRoute: () => void;
  onOpenRoute: () => void;
  onRemoveAddOn: () => void;
}) {
  const contact = primaryContact(facility);
  const canAddRoute = Boolean(opportunity);
  const actionButtons: React.ReactNode[] = [];

  if (status === "not_contacted") {
    actionButtons.push(
      <Button key="text" tone="primary" onClick={onTemplate}>
        <Send size={15} /> Text
      </Button>,
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
      <Button key="possible" onClick={() => onLogStatus("possible_add_on", "Facility may have a same-day add-on.")}>
        Possible
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
          {latestLog ? `${new Date(latestLog.createdAt).toLocaleTimeString()} - ${friendlyValue(latestLog.status)}` : "No update logged today"}
        </p>
      </button>
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
  return (
    <div id={`${idPrefix}-import-row-controls-${row.id}`}>
      <label className="mt-3 block text-xs font-bold uppercase text-slate-500" htmlFor={`${idPrefix}-${row.id}-action`}>
        Action
      </label>
      <select
        id={`${idPrefix}-${row.id}-action`}
        value={row.action}
        onChange={(event) => onUpdateRow(row.id, { action: event.target.value as ImportReviewRow["action"] })}
        className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-900"
      >
        <option value="needs_review">Needs review</option>
        <option value="use_existing">Use selected existing facility</option>
        <option value="create_new">Create new facility</option>
        <option value="skip">Skip row</option>
      </select>
      {row.action === "needs_review" || row.action === "use_existing" ? (
        <FacilityMatchSelect row={row} facilities={facilities} idPrefix={idPrefix} onUpdateRow={onUpdateRow} />
      ) : null}
      <label className="mt-3 block text-xs font-bold uppercase text-slate-500" htmlFor={`${idPrefix}-${row.id}-address`}>
        Edit address
      </label>
      <input
        id={`${idPrefix}-${row.id}-address`}
        value={row.address}
        onChange={(event) => onUpdateRow(row.id, { address: event.target.value })}
        className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-900"
      />
    </div>
  );
}

function ImportReviewCards({
  rows,
  facilities,
  facilityById,
  expandedRowIds,
  onToggleRowExpansion,
  onUpdateRow,
}: {
  rows: ImportReviewRow[];
  facilities: Facility[];
  facilityById: Map<string, Facility>;
  expandedRowIds: Record<string, boolean>;
  onToggleRowExpansion: (rowId: string) => void;
  onUpdateRow: (rowId: string, patch: Partial<ImportReviewRow>) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 lg:hidden">
        Parse a schedule to review each stop as a mobile card.
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:hidden">
      {rows.map((row, index) => {
        const matchName = row.matchedFacilityId ? facilityById.get(row.matchedFacilityId)?.name : undefined;
        const confidenceTone = row.confidence >= 75 ? "green" : row.confidence >= 45 ? "orange" : "slate";
        const issue = importRowBlockingReason(row);
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
              issue && row.action !== "skip" && "border-orange-300",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-slate-500">Stop {index + 1}</p>
                <h3 className="mt-1 truncate text-base font-black text-slate-950">{row.facilityName}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {row.appointmentTime || "Time missing"} - {row.studyCount ?? 0} studies
                </p>
              </div>
              <Badge tone={confidenceTone}>{row.confidence}% match</Badge>
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
            {issue ? <p className="mt-2 text-xs font-semibold text-orange-700">{issue}</p> : null}
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
    <main className="mx-auto max-w-2xl px-4 py-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-green-700">Tentative add-on</p>
          <h2 className="mt-1 text-xl font-black text-green-950">Added tentatively</h2>
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

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
  const [scheduleText, setScheduleText] = useState(sampleSchedule);
  const [reviewRows, setReviewRows] = useState<ImportReviewRow[]>([]);
  const [expandedImportRowIds, setExpandedImportRowIds] = useState<Record<string, boolean>>({});
  const [manualStatus, setManualStatus] = useState<OutreachStatus>("texted");
  const [dogfoodChecked, setDogfoodChecked] = useState<Record<string, boolean>>({});
  const [dogfoodNotes, setDogfoodNotes] = useState("");
  const [showMessage, setShowMessage] = useState(false);
  const [copyFeedbackByFacilityId, setCopyFeedbackByFacilityId] = useState<Record<string, TextFeedback>>({});
  const [textPickerFacilityId, setTextPickerFacilityId] = useState<string>();
  const [pendingTextContactByFacilityId, setPendingTextContactByFacilityId] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const idCounterRef = useRef(0);

  function nextId(prefix: string) {
    idCounterRef.current += 1;
    return `${prefix}-${Date.now()}-${idCounterRef.current}`;
  }

  useEffect(() => {
    const stored = loadStoredState();
    if (stored) {
      window.requestAnimationFrame(() => {
        setFacilities(stored.facilities);
        setRouteStops(stored.routeStops);
        setOutreachLogs(stored.outreachLogs);
        setDogfoodChecked(stored.dogfoodChecked ?? {});
        setDogfoodNotes(stored.dogfoodNotes ?? "");
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
  const selectedOpportunity =
    opportunities.find((item) => item.facility.id === selectedFacilityId) ??
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
  const textPickerContacts = textPickerFacility ? phoneContacts(textPickerFacility) : [];
  const todayQueue = facilities
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
    })
    .sort((a, b) => {
      const aOrder = todayStatusOrder.indexOf(a.status);
      const bOrder = todayStatusOrder.indexOf(b.status);
      return aOrder - bOrder || (a.opportunity?.addedDriveMinutes ?? 999) - (b.opportunity?.addedDriveMinutes ?? 999);
    });
  const todayCounts = todayStatusSummary([...todayStatusByFacilityId.values()]);
  const currentRouteStatusCounts = todayStatusSummary(
    orderedRouteStops
      .map((stop) => todayStatusByFacilityId.get(stop.facilityId))
      .filter((status): status is TodayStatus => Boolean(status)),
  );
  const importBlockingRows = reviewRows.filter((row) => importRowBlockingReason(row));
  const importSummary = {
    useExisting: reviewRows.filter((row) => row.action === "use_existing").length,
    createNew: reviewRows.filter((row) => row.action === "create_new").length,
    skipped: reviewRows.filter((row) => row.action === "skip").length,
    unresolved: importBlockingRows.length,
    confirmed: reviewRows.filter((row) => row.action !== "skip" && !importRowBlockingReason(row)).length,
  };
  const canConfirmImport = reviewRows.length > 0 && importSummary.confirmed > 0 && importSummary.unresolved === 0;
  const confirmImportLabel =
    importSummary.unresolved > 0
      ? `Resolve ${importSummary.unresolved} ${importSummary.unresolved === 1 ? "Row" : "Rows"} Before Confirming`
      : `Confirm ${importSummary.confirmed} ${importSummary.confirmed === 1 ? "Stop" : "Stops"}`;
  const currentRouteFacilities = orderedRouteFacilities(routeStops, facilities);
  const currentRouteMapsUrl = buildGoogleMapsDirectionsUrl(currentRouteFacilities);
  const currentRouteMapsWarning = googleMapsWaypointWarning(currentRouteFacilities.length);
  const currentRouteSplitUrls = splitGoogleMapsDirectionsUrls(currentRouteFacilities);
  const detourRankByFacilityId = new Map(
    [...opportunities]
      .sort((a, b) => a.addedDriveMinutes - b.addedDriveMinutes || b.score - a.score)
      .map((opportunity, index) => [opportunity.facility.id, index + 1]),
  );
  const featuredOpportunity = [...opportunities]
    .filter((opportunity) => opportunity.group !== "Not Worth It Today")
    .sort((a, b) => a.addedDriveMinutes - b.addedDriveMinutes || b.score - a.score)[0];

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
              lastContacted: todayIsoDate(),
              doNotContact: status === "do_not_contact" ? true : item.doNotContact,
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

  function updateDogfoodTask(taskId: string, checked: boolean) {
    setDogfoodChecked((current) => ({ ...current, [taskId]: checked }));
  }

  function updateReviewRow(rowId: string, patch: Partial<ImportReviewRow>) {
    setReviewRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function updateContactPhone(facilityId: string, contactId: string, phone: string) {
    const normalizedPhone = phone.trim() || undefined;
    setFacilities((current) =>
      current.map((facility) =>
        facility.id === facilityId
          ? {
              ...facility,
              contacts: facility.contacts.map((contact) =>
                contact.id === contactId ? { ...contact, phone: normalizedPhone } : contact,
              ),
            }
          : facility,
      ),
    );
    setCopyFeedbackByFacilityId((current) => {
      const next = { ...current };
      delete next[facilityId];
      return next;
    });
  }

  function parseImportSchedule() {
    setReviewRows(parseScheduleText(scheduleText, facilities));
    setExpandedImportRowIds({});
  }

  function toggleImportRowExpansion(rowId: string) {
    setExpandedImportRowIds((current) => ({ ...current, [rowId]: !current[rowId] }));
  }

  function confirmImportedRoute() {
    if (!canConfirmImport) return;
    const result = applyImportRows(reviewRows, facilities);
    setFacilities(result.facilities);
    setRouteStops(result.routeStops);
    openRouteHome(result.routeStops[0]?.facilityId ?? selectedFacilityId);
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
    const contacts = phoneContacts(facility);
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

    if (contacts.length > 1) {
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

    const canOpenSms = typeof navigator !== "undefined" && canAttemptSms(navigator.userAgent);
    if (!canOpenSms) {
      setPendingTextContactByFacilityId((current) => ({ ...current, [facilityId]: contact.id }));
      await copySafeMessage(facilityId, "fallback_copied");
      openFacilityReview(facilityId, true, activeTab);
      return;
    }

    await copySafeMessage(facilityId, "opened");
    logOutreach(facilityId, "texted", "text", `Opened Messages to ${contact.name}. Template copied as fallback.`, contact.name);
    window.location.href = buildSmsUrl(contact.phone, safeMessage());
  }

  function markTexted(facilityId: string) {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;
    const pendingContactId = pendingTextContactByFacilityId[facilityId];
    const contact = facility.contacts.find((item) => item.id === pendingContactId) ?? primaryContact(facility);
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
    setReviewRows([]);
    setScheduleText(sampleSchedule);
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
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-[500] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-600 text-white">
              <MapPinned size={22} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">Near My Route</h1>
              <p className="text-xs font-medium text-slate-500">Route-aware MBSS facility opportunities</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {(["Near My Route", "Facilities", "Import Schedule", "Outreach"] as AppTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => selectTopLevelTab(tab)}
                className={cx(
                  "rounded-md px-3 py-2 text-[13px] font-bold transition",
                  activeTab === tab ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:bg-white",
                )}
              >
                {tab}
              </button>
            ))}
          </nav>
          <Button tone="ghost" onClick={resetDemo}>
            <RotateCcw size={15} /> Reset demo
          </Button>
        </div>
      </header>

      {activeTab === "Near My Route" ? (
        <>
        {routeView.kind === "review" ? (
          <main className="mx-auto max-w-2xl px-4 py-4 xl:hidden">
            <Button tone="ghost" onClick={() => closeFacilityReview(routeView)}>
              <ArrowLeft size={15} /> {reviewBackLabel(routeView)}
            </Button>
            <DetailDrawer
              className="mt-3 rounded-xl border border-slate-200"
              facility={selectedFacility}
              opportunity={selectedOpportunity}
              todayStatus={selectedTodayStatus}
              outreachLogs={selectedOutreachLogs}
              showMessage={showMessage}
              onCloseMessage={() => setShowMessage(false)}
              onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged call attempt.")}
              onStartText={() => selectedFacility && void startTextFlow(selectedFacility.id)}
              onCopyMessage={() => selectedFacility && void copySafeMessage(selectedFacility.id)}
              onMarkTexted={() => selectedFacility && markTexted(selectedFacility.id)}
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
        ) : null}

        <main className={cx(
          "mx-auto flex max-w-[1800px] flex-col px-4 py-4 xl:h-[calc(100vh-74px)]",
          routeView.kind === "review" && "hidden xl:flex",
          routeView.kind === "confirmation" && "hidden",
        )}>
          <section className="mb-3 hidden gap-2 rounded-xl border border-slate-200 bg-white p-3 lg:grid lg:grid-cols-[auto_220px_1fr] lg:items-center">
            <Button tone="primary" onClick={() => selectTopLevelTab("Import Schedule")} className="w-full lg:w-auto">
              <Clipboard size={15} /> Import Schedule
            </Button>
            <label className="flex h-10 items-center gap-3 rounded-md border border-slate-200 px-3 text-[13px] font-bold text-slate-600">
              Max detour
              <select
                value={maxDetourMinutes}
                onChange={(event) => setMaxDetourMinutes(Number(event.target.value))}
                className="ml-auto border-0 bg-transparent text-sm font-black text-slate-950 outline-none"
              >
                {[5, 10, 15, 20, 30].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-2 md:grid-cols-4">
              <Toggle
                label="Due for follow-up"
                checked={notContactedRecentlyOnly}
                onChange={setNotContactedRecentlyOnly}
              />
              <Toggle label="Known contacts only" checked={knownContactsOnly} onChange={setKnownContactsOnly} />
              <Toggle
                label="Same-day friendly only"
                checked={sameDayFriendlyOnly}
                onChange={setSameDayFriendlyOnly}
              />
              <label className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                Due after
                <input
                  type="number"
                  min="1"
                  value={followUpThresholdDays}
                  onChange={(event) => setFollowUpThresholdDays(Number(event.target.value))}
                  className="h-9 w-16 rounded-md border border-slate-200 px-2 text-sm font-bold text-slate-900"
                />
              </label>
            </div>
          </section>
          <div className="flex min-h-0 flex-1 flex-col gap-0 xl:flex-row">
          <section className="flex w-full shrink-0 flex-col gap-3 rounded-l-xl border border-slate-200 bg-slate-50 p-3 xl:w-[440px] xl:overflow-y-auto">
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

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-950">Today status</h2>
                <Badge tone="blue">{currentRouteStatusCounts.reduce((sum, item) => sum + item.count, 0)} on route</Badge>
              </div>
              <div className="mt-3">
                <TodayStatusStrip counts={todayCounts} />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-950">Tomorrow&apos;s Route</h2>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => openMapsUrl(currentRouteMapsUrl)}>
                    <ExternalLink size={15} /> Open in Google Maps
                  </Button>
                  <Button onClick={() => selectTopLevelTab("Import Schedule")}>
                    <Clipboard size={15} /> Import Schedule
                  </Button>
                </div>
              </div>
              {currentRouteMapsWarning ? (
                <p className="mt-2 rounded-md border border-yellow-200 bg-yellow-50 px-2 py-1 text-xs font-semibold text-yellow-800">
                  {currentRouteMapsWarning}
                </p>
              ) : null}
              {currentRouteSplitUrls.length > 0 ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {currentRouteSplitUrls.map((url, index) => (
                    <Button key={url} onClick={() => openMapsUrl(url)}>
                      <ExternalLink size={15} /> Open leg {index + 1}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 space-y-2">
                {orderedRouteStops.map((stop) => {
                  const facility = facilityById.get(stop.facilityId);
                  if (!facility) return null;
                  const status = todayStatusByFacilityId.get(facility.id) ?? "not_contacted";
                  return (
                      <button
                        key={stop.id}
                        type="button"
                        onClick={() => openFacilityReview(facility.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-200 hover:bg-blue-50"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-black text-white">
                        {stop.order}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-900">{facility.name}</span>
                        <span className="text-xs text-slate-500">
                          {stop.appointmentTime ?? "Time TBD"} - {stop.studyCount ?? 0} studies - {friendlyValue(stop.status)}
                        </span>
                      </span>
                      <Badge tone={todayStatusTone(status)}>{todayStatusLabel(status)}</Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            <details className="rounded-lg border border-slate-200 bg-white p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-black text-slate-950">
                Today route checklist ({dogfoodTasks.filter((task) => dogfoodChecked[task.id]).length}/{dogfoodTasks.length})
              </summary>
              <div className="mt-3">
                <DogfoodChecklist
                  checked={dogfoodChecked}
                  notes={dogfoodNotes}
                  className="border-0 p-0"
                  onToggle={updateDogfoodTask}
                  onNotesChange={setDogfoodNotes}
                />
              </div>
            </details>
            <div className="hidden lg:block">
              <DogfoodChecklist
                checked={dogfoodChecked}
                notes={dogfoodNotes}
                onToggle={updateDogfoodTask}
                onNotesChange={setDogfoodNotes}
              />
            </div>

            <details className="rounded-lg border border-slate-200 bg-white p-3 lg:hidden">
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

            <div className="hidden rounded-lg border border-slate-200 bg-white p-3 lg:block">
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

            <details className="rounded-lg border border-slate-200 bg-white p-3 lg:hidden">
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

          <section className="relative min-h-[560px] flex-1 overflow-hidden border-x border-slate-200 bg-white xl:min-h-0">
            <RouteMap
              facilities={facilities}
              routeStops={routeStops}
              opportunities={opportunities}
              outreachLogs={outreachLogs}
              selectedFacilityId={selectedFacilityId}
              onSelectFacility={(facilityId) => openFacilityReview(facilityId)}
            />
          </section>

          <DetailDrawer
            className="hidden xl:block"
            facility={selectedFacility}
            opportunity={selectedOpportunity}
            todayStatus={selectedTodayStatus}
            outreachLogs={selectedOutreachLogs}
            showMessage={showMessage}
            onCloseMessage={() => setShowMessage(false)}
            onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged call attempt.")}
            onStartText={() => selectedFacility && void startTextFlow(selectedFacility.id)}
            onCopyMessage={() => selectedFacility && void copySafeMessage(selectedFacility.id)}
            onMarkTexted={() => selectedFacility && markTexted(selectedFacility.id)}
            onUpdateContactPhone={(contactId, phone) => selectedFacility && updateContactPhone(selectedFacility.id, contactId, phone)}
            onLogStatus={(status, notes) => selectedFacility && logTodayResponse(selectedFacility.id, status, notes)}
            onAddRoute={() => selectedFacility && addTentatively(selectedFacility.id)}
            onRemoveAddOn={() => selectedFacility && removeTodayAddOn(selectedFacility.id)}
            onPreviewRoute={() => selectedOpportunity && previewRouteWithAddOn(selectedOpportunity)}
            onOpenRoute={() => selectedFacility && openRouteHome(selectedFacility.id)}
            copyFeedback={selectedFacility ? copyFeedbackByFacilityId[selectedFacility.id] : undefined}
          />
          </div>
        </main>
        </>
      ) : null}

      {activeTab === "Facilities" ? (
        <main className="mx-auto grid max-w-[1800px] gap-4 px-4 py-4 xl:grid-cols-[1fr_380px]">
          <section className="rounded-xl border border-slate-200 bg-white">
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
                      "rounded-lg border bg-white p-3 shadow-sm",
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
                    <Button className="mt-3 w-full" tone="primary" onClick={() => openFacilityReview(facility.id)}>
                      Review fit
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
                      Review fit
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
            onCloseMessage={() => setShowMessage(false)}
            onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged from Facilities view.")}
            onStartText={() => selectedFacility && void startTextFlow(selectedFacility.id)}
            onCopyMessage={() => selectedFacility && void copySafeMessage(selectedFacility.id)}
            onMarkTexted={() => selectedFacility && markTexted(selectedFacility.id)}
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
        <main className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[420px_1fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-black">Import Schedule</h2>
            <p className="mt-1 text-sm text-slate-500">
              Paste tomorrow&apos;s stops as time, facility, address, and study count. Patient details do not belong here.
            </p>
            <textarea
              value={scheduleText}
              onChange={(event) => setScheduleText(event.target.value)}
              className="mt-4 min-h-64 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm leading-6"
            />
            <div className="mt-3 flex gap-2">
              <Button tone="primary" onClick={parseImportSchedule}>
                Parse Schedule
              </Button>
              <Button onClick={() => setScheduleText(sampleSchedule)}>Use sample</Button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-black">Review imported stops</h2>
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
            <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-black text-slate-950">{importSummary.useExisting}</p>
                <p className="text-[11px] font-bold uppercase text-slate-500">Existing</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-black text-slate-950">{importSummary.createNew}</p>
                <p className="text-[11px] font-bold uppercase text-slate-500">New</p>
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
            {importSummary.unresolved > 0 ? (
              <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
                Resolve uncertain rows before confirming. Confirm is blocked until you keep a match, create a real facility, or skip the row.
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
                rows={reviewRows}
                facilities={facilities}
                facilityById={facilityById}
                expandedRowIds={expandedImportRowIds}
                onToggleRowExpansion={toggleImportRowExpansion}
                onUpdateRow={updateReviewRow}
              />
            </div>
            <div className="mt-4 hidden overflow-x-auto lg:block">
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
                      const issue = importRowBlockingReason(row);
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
                                <input
                                  aria-label={`Address for ${row.facilityName}`}
                                  value={row.address}
                                  onChange={(event) => updateReviewRow(row.id, { address: event.target.value })}
                                  className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                                />
                                {row.action === "create_new" ? (
                                  <p className="mt-1 text-xs text-slate-500">Blank address blocks confirmation.</p>
                                ) : null}
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
        <main className="mx-auto max-w-6xl px-4 py-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-black">Outreach</h2>
            <p className="mt-1 text-sm text-slate-500">
              Work today&apos;s facility responses first. Templates intentionally avoid PHI.
            </p>
            <div className="mt-4">
              <TodayStatusStrip counts={todayCounts} />
            </div>
            <h3 className="mt-5 text-sm font-black text-slate-950">Current-day response queue</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {todayQueue.map(({ facility, opportunity, status, latestLog }) => (
                <OutreachQueueCard
                  key={facility.id}
                  facility={facility}
                  opportunity={opportunity}
                  status={status}
                  latestLog={latestLog}
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
                      <td className="px-4 py-3">{new Date(log.createdAt).toLocaleString()}</td>
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
