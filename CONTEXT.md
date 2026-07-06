# Near My Route Domain Context

A personal geography-first record of facilities visited during MBSS van work, used to reconnect with facility SLPs when Elaine is scheduled nearby.

## Language

**Facility**:
A physical care location Elaine has visited or may revisit for MBSS-related work. A Facility includes its SLP contact information as part of the same record.
_Avoid_: Site, stop, account

**SLP Contact**:
An SLP associated with a Facility who may be contacted about possible MBSS consults. A Facility can have multiple SLP Contacts.
_Avoid_: Contact, provider

**Primary SLP Contact**:
The SLP Contact Elaine currently considers the best first person to contact for a Facility. The Primary SLP Contact can change as Elaine learns more about the Facility.
_Avoid_: Owner, assigned SLP

**Outreach Message**:
A facility-level message Elaine sends to an SLP Contact to ask whether the Facility has anyone appropriate to consider adding to the current MBSS route. An Outreach Message must avoid patient names and clinical details.
_Avoid_: Patient message, referral request

**Visit**:
A dated instance of Elaine going to a Facility for MBSS-related work.
_Avoid_: Appointment, trip

**Van Packet**:
A daily route packet represented in the app by pasted email body/map link text and optional copied PDF table text. The app uses it to build facility-level import review rows and route-only private stops.
_Avoid_: Patient packet, chart packet

**Import Review Row**:
A parsed row that must be resolved before confirming a route. It can use an existing Facility, create a new Facility, become a Private Route Stop, or be skipped.
_Avoid_: Lead, referral row

**Import Review**:
The workflow after parsing a Schedule or Van Packet where parsed route items are resolved before confirming a route.
_Avoid_: Lead review, referral review

**Private Route Stop**:
A route-only stop, usually for Home Health or another private/residential address, that can exist on the current route but must not become a Facility or outreach candidate.
_Avoid_: Facility, site, account

**Route Anchor**:
A meet/start/return point from the source route. It may be shown for context and skipped from normal facility review.
_Avoid_: Facility, add-on candidate

**Location Review**:
The confirmation workflow for imported, changed, fallback, or private route locations before they can drive route ranking or app-generated Maps handoff.
_Avoid_: Geocoding, route approval

**Facility Alias**:
A local alternate facility label learned from import review, used to improve future matching while still requiring review when the alias is not supported by address evidence.
_Avoid_: Patient label, contact alias
