"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Check,
  Clipboard,
  Filter,
  MapPinned,
  MessageSquareText,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Send,
} from "lucide-react";
import { initialFacilities, initialOutreachLogs, initialRouteStops } from "@/lib/mockData";
import { calculateRouteOpportunities } from "@/lib/routeCalculations";
import { applyImportRows, parseScheduleText } from "@/lib/scheduleImport";
import { clearStoredState, loadStoredState, saveStoredState } from "@/lib/storage";
import type { Facility, ImportReviewRow, Opportunity, OutreachLog, OutreachStatus } from "@/lib/types";
import { formatDaysAgo, friendlyValue, primaryContact, safeMessage, todayIsoDate } from "@/lib/format";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-500">Loading map...</div>,
});

const sampleSchedule = `8:30 AM, Memorial SNF, 12620 Memorial Dr, 2 studies
10:15 AM, Park Manor Westchase, 11910 Richmond Ave, 1 study
1:00 PM, Lakeside Rehab, 9440 Bellaire Blvd, 2 studies`;

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

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Button({
  children,
  tone = "secondary",
  className,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
        tone === "primary" && "bg-blue-600 text-white hover:bg-blue-700",
        tone === "secondary" && "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        tone === "ghost" && "text-slate-600 hover:bg-slate-100",
        tone === "danger" && "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
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
  selected,
  onSelect,
  onAsk,
  onMarkContacted,
  onAddTentatively,
}: {
  opportunity: Opportunity;
  selected: boolean;
  onSelect: () => void;
  onAsk: () => void;
  onMarkContacted: () => void;
  onAddTentatively: () => void;
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
          <div>
            <h3 className="text-sm font-bold text-slate-950">{opportunity.facility.name}</h3>
            <p className="mt-1 text-xl font-black tracking-tight text-orange-600">
              +{opportunity.addedDriveMinutes} min off route
            </p>
          </div>
          <Badge tone={opportunity.group === "Not Worth It Today" ? "slate" : "orange"}>
            {opportunity.group}
          </Badge>
        </div>
        <div className="mt-2 space-y-1 text-[13px] text-slate-600">
          <p>{opportunity.bestInsertionLabel}</p>
          <p>
            {opportunity.nearestStopDistanceMiles} mi from {opportunity.nearestStopName}
          </p>
          <p>Last contacted: {formatDaysAgo(opportunity.facility.lastContacted)}</p>
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
        <Button tone="primary" onClick={onAsk}>
          <MessageSquareText size={15} /> Ask for Add-ons
        </Button>
        <Button onClick={onMarkContacted}>
          <Check size={15} /> Mark Contacted
        </Button>
        <Button onClick={onAddTentatively}>
          <Plus size={15} /> Add Tentatively
        </Button>
        <Button onClick={onSelect}>
          <MapPinned size={15} /> Details
        </Button>
      </div>
    </article>
  );
}

function DetailDrawer({
  facility,
  opportunity,
  outreachLogs,
  showMessage,
  onCloseMessage,
  onAsk,
  onCall,
  onMarkContacted,
  onAddRoute,
  onDoNotContact,
}: {
  facility?: Facility;
  opportunity?: Opportunity;
  outreachLogs: OutreachLog[];
  showMessage: boolean;
  onCloseMessage: () => void;
  onAsk: () => void;
  onCall: () => void;
  onMarkContacted: () => void;
  onAddRoute: () => void;
  onDoNotContact: () => void;
}) {
  if (!facility) {
    return (
      <aside className="hidden w-[360px] shrink-0 border-l border-slate-200 bg-white p-4 xl:block">
        <div className="grid h-full place-items-center rounded-lg border border-dashed border-slate-200 text-center text-sm text-slate-500">
          Select a facility to view contacts, notes, and route fit.
        </div>
      </aside>
    );
  }

  const contact = primaryContact(facility);
  const message = safeMessage(contact?.name);

  return (
    <aside className="w-full shrink-0 border-t border-slate-200 bg-white p-4 xl:w-[380px] xl:border-l xl:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-950">{facility.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{facility.address}</p>
        </div>
        {facility.doNotContact ? <Badge tone="red">Do Not Contact</Badge> : null}
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
                <p className="mt-1 text-slate-600">{item.phone ?? item.email ?? "No contact method saved"}</p>
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
          <Button tone="primary" className="mt-3 w-full" onClick={onMarkContacted}>
            <Clipboard size={15} /> Copy and Mark Texted
          </Button>
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
                  {new Date(log.createdAt).toLocaleString()} · {friendlyValue(log.method)}
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

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button tone="primary" onClick={onAsk}>
          <Send size={15} /> Ask for Add-ons
        </Button>
        <Button onClick={onCall}>
          <Phone size={15} /> Call
        </Button>
        <Button onClick={onMarkContacted}>
          <Check size={15} /> Mark Contacted
        </Button>
        <Button onClick={onAddRoute}>
          <Plus size={15} /> Add to Route
        </Button>
        <Button tone="danger" className="col-span-2" onClick={onDoNotContact}>
          <Ban size={15} /> Do Not Contact
        </Button>
      </div>
    </aside>
  );
}

export default function NearMyRouteApp() {
  const [facilities, setFacilities] = useState(initialFacilities);
  const [routeStops, setRouteStops] = useState(initialRouteStops);
  const [outreachLogs, setOutreachLogs] = useState(initialOutreachLogs);
  const [activeTab, setActiveTab] = useState("Near My Route");
  const [selectedFacilityId, setSelectedFacilityId] = useState("encompass-westchase");
  const [maxDetourMinutes, setMaxDetourMinutes] = useState(10);
  const [notContactedRecentlyOnly, setNotContactedRecentlyOnly] = useState(false);
  const [knownContactsOnly, setKnownContactsOnly] = useState(false);
  const [sameDayFriendlyOnly, setSameDayFriendlyOnly] = useState(false);
  const [facilitySearch, setFacilitySearch] = useState("");
  const [facilityTypeFilter, setFacilityTypeFilter] = useState("All");
  const [contactStatusFilter, setContactStatusFilter] = useState("All");
  const [lastContactedOlderThan, setLastContactedOlderThan] = useState(14);
  const [scheduleText, setScheduleText] = useState(sampleSchedule);
  const [reviewRows, setReviewRows] = useState<ImportReviewRow[]>([]);
  const [manualStatus, setManualStatus] = useState<OutreachStatus>("texted");
  const [showMessage, setShowMessage] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const idCounterRef = useRef(0);

  function nextId(prefix: string) {
    idCounterRef.current += 1;
    return `${prefix}-${idCounterRef.current}`;
  }

  useEffect(() => {
    const stored = loadStoredState();
    if (stored) {
      window.requestAnimationFrame(() => {
        setFacilities(stored.facilities);
        setRouteStops(stored.routeStops);
        setOutreachLogs(stored.outreachLogs);
        setHydrated(true);
      });
    } else {
      window.requestAnimationFrame(() => setHydrated(true));
    }
  }, []);

  useEffect(() => {
    if (hydrated) saveStoredState({ facilities, routeStops, outreachLogs });
  }, [facilities, routeStops, outreachLogs, hydrated]);

  const opportunities = useMemo(
    () =>
      calculateRouteOpportunities(routeStops, facilities, {
        maxDetourMinutes,
        averageSpeedMph: 28,
        excludeRecentlyContactedDays: notContactedRecentlyOnly ? 14 : undefined,
        knownContactsOnly,
        sameDayFriendlyOnly,
      }),
    [facilities, knownContactsOnly, maxDetourMinutes, notContactedRecentlyOnly, routeStops, sameDayFriendlyOnly],
  );

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId);
  const selectedOpportunity = opportunities.find((item) => item.facility.id === selectedFacilityId);
  const selectedOutreachLogs = outreachLogs
    .filter((log) => log.facilityId === selectedFacilityId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const orderedRouteStops = [...routeStops].sort((a, b) => a.order - b.order);
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));

  function selectFacility(facilityId: string) {
    setSelectedFacilityId(facilityId);
    setShowMessage(false);
  }

  function logOutreach(facilityId: string, status: OutreachStatus, method: OutreachLog["method"], notes?: string) {
    const facility = facilities.find((item) => item.id === facilityId);
    const contact = facility ? primaryContact(facility) : undefined;
    const now = new Date().toISOString();
    const log: OutreachLog = {
      id: nextId("log"),
      facilityId,
      createdAt: now,
      method,
      contactName: contact?.name,
      status,
      notes,
    };

    setOutreachLogs((current) => [log, ...current]);
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
  }

  async function markTexted(facilityId: string) {
    const facility = facilities.find((item) => item.id === facilityId);
    const contact = facility ? primaryContact(facility) : undefined;
    if (navigator.clipboard && facility) {
      await navigator.clipboard.writeText(safeMessage(contact?.name));
    }
    logOutreach(facilityId, "texted", "text", "Copied safe add-on request template.");
    setShowMessage(false);
  }

  function addTentatively(facilityId: string) {
    if (routeStops.some((stop) => stop.facilityId === facilityId)) return;
    const afterStopId = opportunities.find((item) => item.facility.id === facilityId)?.bestInsertionAfterStopId;
    const afterStop = routeStops.find((stop) => stop.id === afterStopId);
    const order = afterStop ? afterStop.order + 0.5 : routeStops.length + 1;
    const nextStops = [
      ...routeStops,
      {
        id: nextId("stop"),
        facilityId,
        order,
        status: "tentative" as const,
        notes: "Tentative add-on. Confirm study time separately from added drive time.",
      },
    ]
      .sort((a, b) => a.order - b.order)
      .map((stop, index) => ({ ...stop, order: index + 1 }));
    setRouteStops(nextStops);
    logOutreach(facilityId, "added_to_route", "other", "Added tentatively to tomorrow's route.");
  }

  function doNotContact(facilityId: string) {
    setFacilities((current) =>
      current.map((facility) =>
        facility.id === facilityId ? { ...facility, doNotContact: true, lastContacted: todayIsoDate() } : facility,
      ),
    );
    logOutreach(facilityId, "do_not_contact", "other", "Marked as do not contact.");
  }

  function resetDemo() {
    clearStoredState();
    setFacilities(initialFacilities);
    setRouteStops(initialRouteStops);
    setOutreachLogs(initialOutreachLogs);
    setSelectedFacilityId("encompass-westchase");
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
      (contactStatusFilter === "Do not contact" && facility.doNotContact);
    const olderThan = formatDaysAgo(facility.lastContacted) === "Never" || Number(formatDaysAgo(facility.lastContacted).split(" ")[0]) >= lastContactedOlderThan;

    return matchesSearch && matchesType && matchesContact && olderThan;
  });

  const groupedOpportunities = opportunityGroups.map((group) => ({
    group,
    items: opportunities.filter((item) => item.group === group),
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
            {["Near My Route", "Facilities", "Import Schedule", "Outreach"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
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
        <main className="mx-auto flex max-w-[1800px] flex-col px-4 py-4 xl:h-[calc(100vh-74px)]">
          <section className="mb-3 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-[auto_220px_1fr] lg:items-center">
            <Button tone="primary" onClick={() => setActiveTab("Import Schedule")} className="w-full lg:w-auto">
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
            <div className="grid gap-2 md:grid-cols-3">
              <Toggle
                label="Not contacted recently"
                checked={notContactedRecentlyOnly}
                onChange={setNotContactedRecentlyOnly}
              />
              <Toggle label="Known contacts only" checked={knownContactsOnly} onChange={setKnownContactsOnly} />
              <Toggle
                label="Same-day friendly only"
                checked={sameDayFriendlyOnly}
                onChange={setSameDayFriendlyOnly}
              />
            </div>
          </section>
          <div className="flex min-h-0 flex-1 flex-col gap-0 xl:flex-row">
          <section className="flex w-full shrink-0 flex-col gap-3 rounded-l-xl border border-slate-200 bg-slate-50 p-3 xl:w-[440px] xl:overflow-y-auto">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-950">Tomorrow&apos;s Route</h2>
                <Button tone="primary" onClick={() => setActiveTab("Import Schedule")}>
                  <Clipboard size={15} /> Import Schedule
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {orderedRouteStops.map((stop) => {
                  const facility = facilityById.get(stop.facilityId);
                  if (!facility) return null;
                  return (
                    <button
                      key={stop.id}
                      type="button"
                      onClick={() => selectFacility(facility.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:border-blue-200 hover:bg-blue-50"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-black text-white">
                        {stop.order}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-900">{facility.name}</span>
                        <span className="text-xs text-slate-500">
                          {stop.appointmentTime} · {stop.studyCount ?? 0} studies · {friendlyValue(stop.status)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
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
                  label="Show only facilities not contacted recently"
                  checked={notContactedRecentlyOnly}
                  onChange={setNotContactedRecentlyOnly}
                />
                <Toggle label="Show known contacts only" checked={knownContactsOnly} onChange={setKnownContactsOnly} />
                <Toggle
                  label="Show same-day friendly only"
                  checked={sameDayFriendlyOnly}
                  onChange={setSameDayFriendlyOnly}
                />
              </div>
            </div>

            <div className="space-y-4">
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
                          selected={selectedFacilityId === opportunity.facility.id}
                          onSelect={() => selectFacility(opportunity.facility.id)}
                          onAsk={() => {
                            selectFacility(opportunity.facility.id);
                            setShowMessage(true);
                          }}
                          onMarkContacted={() => logOutreach(opportunity.facility.id, "texted", "text", "Marked contacted from opportunity card.")}
                          onAddTentatively={() => addTentatively(opportunity.facility.id)}
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
              selectedFacilityId={selectedFacilityId}
              onSelectFacility={selectFacility}
            />
          </section>

          <DetailDrawer
            facility={selectedFacility}
            opportunity={selectedOpportunity}
            outreachLogs={selectedOutreachLogs}
            showMessage={showMessage}
            onCloseMessage={() => setShowMessage(false)}
            onAsk={() => setShowMessage(true)}
            onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged call attempt.")}
            onMarkContacted={() => selectedFacility && markTexted(selectedFacility.id)}
            onAddRoute={() => selectedFacility && addTentatively(selectedFacility.id)}
            onDoNotContact={() => selectedFacility && doNotContact(selectedFacility.id)}
          />
          </div>
        </main>
      ) : null}

      {activeTab === "Facilities" ? (
        <main className="mx-auto grid max-w-[1800px] gap-4 px-4 py-4 xl:grid-cols-[1fr_380px]">
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-4">
              <h2 className="text-lg font-black">Facilities</h2>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px_180px_180px]">
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
                  {["All", "Known contacts", "No contact", "Do not contact"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  Older than
                  <input
                    type="number"
                    min="0"
                    value={lastContactedOlderThan}
                    onChange={(event) => setLastContactedOlderThan(Number(event.target.value))}
                    className="h-10 w-20 rounded-md border border-slate-200 px-2 text-sm text-slate-900"
                  />
                  days
                </label>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Facility name</th>
                    <th className="px-4 py-3">Address</th>
                    <th className="px-4 py-3">City/area</th>
                    <th className="px-4 py-3">Facility type</th>
                    <th className="px-4 py-3">Contact person</th>
                    <th className="px-4 py-3">Last contacted</th>
                    <th className="px-4 py-3">Last visited</th>
                    <th className="px-4 py-3">Same-day</th>
                    <th className="px-4 py-3">Volume</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFacilities.map((facility) => {
                    const contact = primaryContact(facility);
                    return (
                      <tr
                        key={facility.id}
                        onClick={() => selectFacility(facility.id)}
                        className={cx("cursor-pointer hover:bg-blue-50", selectedFacilityId === facility.id && "bg-blue-50")}
                      >
                        <td className="px-4 py-3 font-bold text-slate-950">{facility.name}</td>
                        <td className="px-4 py-3 text-slate-600">{facility.address}</td>
                        <td className="px-4 py-3 text-slate-600">{facility.city}</td>
                        <td className="px-4 py-3">{facility.facilityType}</td>
                        <td className="px-4 py-3">{contact ? `${contact.name}, ${contact.role ?? "SLP"}` : "No contact"}</td>
                        <td className="px-4 py-3">{formatDaysAgo(facility.lastContacted)}</td>
                        <td className="px-4 py-3">{formatDaysAgo(facility.lastVisited)}</td>
                        <td className="px-4 py-3">{friendlyValue(facility.sameDayFriendly)}</td>
                        <td className="px-4 py-3">{friendlyValue(facility.typicalVolume)}</td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-slate-500">{facility.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <DetailDrawer
            facility={selectedFacility}
            opportunity={selectedOpportunity}
            outreachLogs={selectedOutreachLogs}
            showMessage={showMessage}
            onCloseMessage={() => setShowMessage(false)}
            onAsk={() => setShowMessage(true)}
            onCall={() => selectedFacility && logOutreach(selectedFacility.id, "called", "call", "Logged from Facilities view.")}
            onMarkContacted={() => selectedFacility && markTexted(selectedFacility.id)}
            onAddRoute={() => selectedFacility && addTentatively(selectedFacility.id)}
            onDoNotContact={() => selectedFacility && doNotContact(selectedFacility.id)}
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
              <Button tone="primary" onClick={() => setReviewRows(parseScheduleText(scheduleText, facilities))}>
                Parse Schedule
              </Button>
              <Button onClick={() => setScheduleText(sampleSchedule)}>Use sample</Button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">Review imported stops</h2>
              <Button
                tone="primary"
                onClick={() => {
                  const result = applyImportRows(reviewRows, facilities);
                  setFacilities(result.facilities);
                  setRouteStops(result.routeStops);
                  setActiveTab("Near My Route");
                  setSelectedFacilityId(result.routeStops[0]?.facilityId ?? selectedFacilityId);
                }}
              >
                Confirm Route
              </Button>
            </div>
            <div className="mt-4 overflow-x-auto">
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
                    reviewRows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-3">
                          <p className="font-bold text-slate-950">{row.facilityName}</p>
                          <p className="text-xs text-slate-500">
                            {row.appointmentTime} · {row.studyCount ?? 0} studies
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          {row.matchedFacilityId ? facilityById.get(row.matchedFacilityId)?.name : "No likely match"}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={row.confidence >= 75 ? "green" : row.confidence >= 45 ? "orange" : "slate"}>
                            {row.confidence}%
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={row.action}
                            onChange={(event) =>
                              setReviewRows((current) =>
                                current.map((item) =>
                                  item.id === row.id ? { ...item, action: event.target.value as ImportReviewRow["action"] } : item,
                                ),
                              )
                            }
                            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
                          >
                            <option value="use_existing">Use existing facility</option>
                            <option value="create_new">Create new facility</option>
                            <option value="skip">Skip row</option>
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            value={row.address}
                            onChange={(event) =>
                              setReviewRows((current) =>
                                current.map((item) => (item.id === row.id ? { ...item, address: event.target.value } : item)),
                              )
                            }
                            className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                          />
                        </td>
                      </tr>
                    ))
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
              Track facility-level contact attempts. Templates intentionally avoid PHI.
            </p>
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
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-black">Manual log</h3>
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
                    setActiveTab("Near My Route");
                    setShowMessage(true);
                  }}
                >
                  <MessageSquareText size={15} /> Open Template
                </Button>
              </div>
            </div>
          </section>
        </main>
      ) : null}
    </div>
  );
}
