"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Facility, Opportunity, RouteStop } from "@/lib/types";
import { routeLineFacilities } from "@/lib/routeCalculations";
import { outreachRecencyLabel, outreachRecencyState, type OutreachRecencyState } from "@/lib/outreachRecency";

type RouteMapProps = {
  facilities: Facility[];
  routeStops: RouteStop[];
  opportunities: Opportunity[];
  followUpThresholdDays: number;
  selectedFacilityId?: string;
  onSelectFacility: (facilityId: string) => void;
};

const TypedMapContainer = MapContainer as unknown as (props: {
  center: [number, number];
  zoom: number;
  scrollWheelZoom?: boolean;
  className?: string;
  children: ReactNode;
}) => ReactNode;
const TypedTileLayer = TileLayer as unknown as (props: {
  attribution: string;
  url: string;
}) => ReactNode;
const TypedPolyline = Polyline as unknown as (props: {
  positions: Array<[number, number]>;
  pathOptions?: Record<string, string | number>;
}) => ReactNode;
const TypedCircleMarker = CircleMarker as unknown as (props: {
  center: [number, number];
  radius: number;
  pathOptions?: Record<string, string | number>;
  eventHandlers?: { click?: () => void };
  children?: ReactNode;
}) => ReactNode;
const TypedTooltip = Tooltip as unknown as (props: {
  permanent?: boolean;
  direction?: string;
  offset?: [number, number];
  className?: string;
  children: ReactNode;
}) => ReactNode;
const TypedPopup = Popup as unknown as (props: { children: ReactNode }) => ReactNode;

function hasValidCoordinates(facility?: Facility): facility is Facility {
  return Boolean(
    facility &&
      Number.isFinite(facility.lat) &&
      Number.isFinite(facility.lng) &&
      Math.abs(facility.lat) <= 90 &&
      Math.abs(facility.lng) <= 180,
  );
}

function Recenter({ facility }: { facility?: Facility }) {
  const map = useMap();

  useEffect(() => {
    if (hasValidCoordinates(facility)) {
      try {
        map.flyTo([facility.lat, facility.lng], 13, { duration: 0.5 });
      } catch {
        // Imported or persisted facilities can be incomplete; route workflow should keep running.
      }
    }
  }, [facility, map]);

  return null;
}

const outreachLegend: Array<{ state: OutreachRecencyState; color: string }> = [
  { state: "never_contacted", color: "#64748b" },
  { state: "due_for_follow_up", color: "#eab308" },
  { state: "contacted_recently", color: "#16a34a" },
  { state: "contacted_today", color: "#2563eb" },
  { state: "do_not_contact", color: "#991b1b" },
];

function facilityColor(facility: Facility, followUpThresholdDays: number, selected?: boolean) {
  if (selected) return "#111827";
  const state = outreachRecencyState(facility, followUpThresholdDays);
  if (state === "do_not_contact") return "#991b1b";
  if (state === "contacted_today") return "#2563eb";
  if (state === "contacted_recently") return "#16a34a";
  if (state === "due_for_follow_up") return "#eab308";
  return "#64748b";
}

export default function RouteMap({
  facilities,
  routeStops,
  opportunities,
  followUpThresholdDays,
  selectedFacilityId,
  onSelectFacility,
}: RouteMapProps) {
  const routeFacilities = routeLineFacilities(routeStops, facilities).filter(hasValidCoordinates);
  const routeFacilityIds = new Set(routeStops.map((stop) => stop.facilityId));
  const opportunityByFacilityId = new Map(
    opportunities.map((opportunity) => [opportunity.facility.id, opportunity]),
  );
  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId);
  const center: [number, number] = routeFacilities[1]
    ? [routeFacilities[1].lat, routeFacilities[1].lng]
    : [29.735, -95.57];

  return (
    <div className="relative h-full w-full">
    <TypedMapContainer center={center} zoom={11} scrollWheelZoom className="h-full w-full">
      <TypedTileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter facility={selectedFacility} />
      {routeFacilities.length > 1 ? (
        <TypedPolyline
          positions={routeFacilities.map((facility) => [facility.lat, facility.lng])}
          pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.72 }}
        />
      ) : null}
      {routeStops.map((stop) => {
        const facility = facilities.find((item) => item.id === stop.facilityId);
        if (!hasValidCoordinates(facility)) return null;

        return (
          <TypedCircleMarker
            key={stop.id}
            center={[facility.lat, facility.lng]}
            radius={13}
            pathOptions={{ color: "#1d4ed8", fillColor: "#2563eb", fillOpacity: 1, weight: 2 }}
            eventHandlers={{ click: () => onSelectFacility(facility.id) }}
          >
            <TypedTooltip permanent direction="center" className="pin-label">
              {stop.order}
            </TypedTooltip>
            <TypedPopup>
              <strong>{facility.name}</strong>
              <br />
              Stop #{stop.order} · {stop.appointmentTime}
            </TypedPopup>
          </TypedCircleMarker>
        );
      })}
      {facilities
        .filter((facility) => hasValidCoordinates(facility) && !routeFacilityIds.has(facility.id))
        .map((facility) => {
          const opportunity = opportunityByFacilityId.get(facility.id);
          const selected = facility.id === selectedFacilityId;
          const recencyState = outreachRecencyState(facility, followUpThresholdDays);
          const color = facilityColor(facility, followUpThresholdDays, selected);

          return (
            <TypedCircleMarker
              key={facility.id}
              center={[facility.lat, facility.lng]}
              radius={selected ? 10 : opportunity && opportunity.addedDriveMinutes <= 15 ? 8 : 5}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: facility.doNotContact || opportunity?.group === "Not Worth It Today" ? 0.5 : 0.9,
                weight: selected ? 4 : 2,
              }}
              eventHandlers={{ click: () => onSelectFacility(facility.id) }}
            >
              <TypedTooltip direction="top" offset={[0, -8]}>
                {facility.name}
                {opportunity ? ` · +${opportunity.addedDriveMinutes} min` : ""}
                {` · ${outreachRecencyLabel(recencyState)}`}
              </TypedTooltip>
              <TypedPopup>
                <strong>{facility.name}</strong>
                <br />
                {opportunity
                  ? `${opportunity.bestInsertionLabel} · +${opportunity.addedDriveMinutes} min`
                  : facility.address}
                <br />
                {outreachRecencyLabel(recencyState)}
              </TypedPopup>
            </TypedCircleMarker>
          );
        })}
    </TypedMapContainer>
    <div className="pointer-events-none absolute bottom-3 left-3 z-[450] rounded-md border border-slate-200 bg-white/95 p-2 text-[11px] font-semibold text-slate-700 shadow-sm">
      <div className="grid gap-1">
        {outreachLegend.map((item) => (
          <div key={item.state} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span>{outreachRecencyLabel(item.state)}</span>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}
