import type { Facility, OutreachLog, OutreachStatus, RouteStop } from "./types";
import { daysSince } from "./routeCalculations";
import { todayIsoDate } from "./format";

export type TodayStatus =
  | "not_contacted"
  | "texted_today"
  | "waiting"
  | "no_patients_today"
  | "possible_add_on"
  | "added"
  | "do_not_contact";

export const todayStatusOrder: TodayStatus[] = [
  "not_contacted",
  "texted_today",
  "waiting",
  "possible_add_on",
  "no_patients_today",
  "added",
  "do_not_contact",
];

export function todayStatusLabel(status: TodayStatus) {
  switch (status) {
    case "not_contacted":
      return "Not contacted";
    case "texted_today":
      return "Texted today";
    case "waiting":
      return "Waiting";
    case "no_patients_today":
      return "No patients today";
    case "possible_add_on":
      return "Possible add-on";
    case "added":
      return "Added";
    case "do_not_contact":
      return "Do not contact";
  }
}

export function todayStatusTone(status: TodayStatus): "blue" | "orange" | "green" | "red" | "slate" {
  if (status === "texted_today" || status === "waiting") return "blue";
  if (status === "possible_add_on" || status === "added") return "green";
  if (status === "no_patients_today") return "orange";
  if (status === "do_not_contact") return "red";
  return "slate";
}

export function todayStatusColor(status: TodayStatus) {
  switch (status) {
    case "not_contacted":
      return "#64748b";
    case "texted_today":
      return "#2563eb";
    case "waiting":
      return "#7c3aed";
    case "no_patients_today":
      return "#f97316";
    case "possible_add_on":
      return "#16a34a";
    case "added":
      return "#059669";
    case "do_not_contact":
      return "#991b1b";
  }
}

export function todayStatusFromOutreachStatus(status: OutreachStatus): TodayStatus {
  switch (status) {
    case "texted":
      return "texted_today";
    case "called":
    case "no_answer":
    case "follow_up_later":
      return "waiting";
    case "no_patients_today":
      return "no_patients_today";
    case "possible_add_on":
    case "added_to_route":
      return "possible_add_on";
    case "do_not_contact":
      return "do_not_contact";
  }
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function latestTodayLog(
  facilityId: string,
  outreachLogs: OutreachLog[],
  today = todayIsoDate(),
) {
  return outreachLogs
    .filter((log) => log.facilityId === facilityId && localDateKey(log.createdAt) === today)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function hasTodayAddOnStop(facilityId: string, routeStops: RouteStop[]) {
  return routeStops.some((stop) => stop.facilityId === facilityId && stop.source === "today_add_on");
}

export function deriveTodayStatus({
  facility,
  outreachLogs,
  routeStops,
  today = todayIsoDate(),
}: {
  facility: Facility;
  outreachLogs: OutreachLog[];
  routeStops: RouteStop[];
  today?: string;
}): TodayStatus {
  const log = latestTodayLog(facility.id, outreachLogs, today);
  if (facility.doNotContact || log?.status === "do_not_contact") return "do_not_contact";
  if (hasTodayAddOnStop(facility.id, routeStops)) return "added";

  if (log) return todayStatusFromOutreachStatus(log.status);

  if (facility.lastContacted && daysSince(facility.lastContacted) === 0) return "texted_today";
  return "not_contacted";
}

export function todayStatusSummary(statuses: TodayStatus[]) {
  return todayStatusOrder.map((status) => ({
    status,
    label: todayStatusLabel(status),
    count: statuses.filter((item) => item === status).length,
  }));
}
