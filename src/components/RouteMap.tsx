"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Facility, Opportunity, OutreachLog, RouteLocation, RouteStop } from "@/lib/types";
import { routeLineFacilities } from "@/lib/routeCalculations";
import { hasConfirmedLocation } from "@/lib/locationTrust";
import {
  deriveTodayStatus,
  todayStatusColor,
  todayStatusLabel,
  todayStatusOrder,
  type TodayStatus,
} from "@/lib/todayStatus";

type RouteMapProps = {
  facilities: Facility[];
  routeStops: RouteStop[];
  opportunities: Opportunity[];
  outreachLogs: OutreachLog[];
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

function hasValidCoordinates(facility?: RouteLocation): facility is RouteLocation {
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
        map.invalidateSize({ animate: false });
        map.setView([facility.lat, facility.lng], 13, { animate: false });
      } catch {
        // Imported or persisted facilities can be incomplete; route workflow should keep running.
      }
    }
  }, [facility, map]);

  return null;
}

const todayLegend: Array<{ state: TodayStatus; color: string }> = todayStatusOrder.map((state) => ({
  state,
  color: todayStatusColor(state),
}));

function facilityColor(status: TodayStatus, selected?: boolean) {
  if (selected) return "#111827";
  return todayStatusColor(status);
}

export default function RouteMap({
  facilities,
  routeStops,
  opportunities,
  outreachLogs,
  selectedFacilityId,
  onSelectFacility,
}: RouteMapProps) {
  const routeFacilities = routeLineFacilities(routeStops, facilities).filter(
    (location) => hasValidCoordinates(location) && hasConfirmedLocation(location),
  );
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
        const location = stop.privateLocation ?? facility;
        if (!hasValidCoordinates(location) || !hasConfirmedLocation(location)) return null;
        const status = facility ? deriveTodayStatus({ facility, outreachLogs, routeStops }) : undefined;
        const routeColor = stop.source === "today_add_on" ? todayStatusColor("added") : "#2563eb";

        return (
          <TypedCircleMarker
            key={stop.id}
            center={[location.lat, location.lng]}
            radius={13}
            pathOptions={{ color: routeColor, fillColor: routeColor, fillOpacity: 1, weight: 2 }}
            eventHandlers={facility ? { click: () => onSelectFacility(facility.id) } : undefined}
          >
            <TypedTooltip permanent direction="center" className="pin-label">
              {stop.order}
            </TypedTooltip>
            <TypedPopup>
              <strong>{location.name}</strong>
              <br />
              Stop #{stop.order} - {stop.appointmentTime}
              <br />
              {status ? todayStatusLabel(status) : "Private route stop"}
              {facility ? (
                <>
                  <br />
                  <button
                    type="button"
                    onClick={() => onSelectFacility(facility.id)}
                    className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    Review
                  </button>
                </>
              ) : null}
            </TypedPopup>
          </TypedCircleMarker>
        );
      })}
      {facilities
        .filter((facility) => hasValidCoordinates(facility) && !routeFacilityIds.has(facility.id))
        .map((facility) => {
          const opportunity = opportunityByFacilityId.get(facility.id);
          const selected = facility.id === selectedFacilityId;
          const status = deriveTodayStatus({ facility, outreachLogs, routeStops });
          const color = facilityColor(status, selected);

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
                {opportunity ? ` - +${opportunity.addedDriveMinutes} min` : ""}
                {` - ${todayStatusLabel(status)}`}
              </TypedTooltip>
              <TypedPopup>
                <strong>{facility.name}</strong>
                <br />
                {opportunity
                  ? `${opportunity.bestInsertionLabel} - +${opportunity.addedDriveMinutes} min`
                  : facility.address}
                <br />
                {todayStatusLabel(status)}
                <br />
                <button
                  type="button"
                  onClick={() => onSelectFacility(facility.id)}
                  className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"
                >
                  Review
                </button>
              </TypedPopup>
            </TypedCircleMarker>
          );
        })}
    </TypedMapContainer>
    <div className="pointer-events-none absolute bottom-3 left-3 z-[450] rounded-md border border-slate-200 bg-white/95 p-2 text-[11px] font-semibold text-slate-700 shadow-sm">
      <div className="grid gap-1">
        {todayLegend.map((item) => (
          <div key={item.state} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span>{todayStatusLabel(item.state)}</span>
          </div>
        ))}
      </div>
    </div>
    <div className="absolute right-3 top-3 z-[450] grid max-w-[190px] gap-1 rounded-md border border-slate-200 bg-white/95 p-2 text-xs font-semibold text-slate-700 shadow-sm lg:hidden">
      <p className="text-[10px] font-black uppercase text-slate-500">Review stop</p>
      {[...routeStops]
        .sort((a, b) => a.order - b.order)
        .map((stop) => {
          const facility = facilities.find((item) => item.id === stop.facilityId);
          const location = stop.privateLocation ?? facility;
          if (!location) return null;

          return (
            <button
              key={stop.id}
              type="button"
              disabled={!facility}
              onClick={() => facility && onSelectFacility(facility.id)}
              className="truncate rounded border border-slate-200 bg-white px-2 py-1 text-left hover:border-blue-200 hover:bg-blue-50"
            >
              {stop.order}. {location.name}
            </button>
          );
        })}
    </div>
    </div>
  );
}
