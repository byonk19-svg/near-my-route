import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.VAN_PACKET_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";
const sourceMapLink =
  "https://www.google.com/maps/dir/900+Example+Start,+Houston,+TX/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX/100+Example+St,+Houston,+TX/999+Alias+Test+Rd,+Houston,+TX/Park+Manor+Westchase,+11910+Richmond+Ave,+Houston,+TX/900+Example+Start,+Houston,+TX";
const packetText = `NAME OF TEAM MEMBERS
Elaine; Jordan

VAN NAME
Northwest Van

MEET DETAILS
Meet point = 900 Example Start, Houston, TX.

SPECIAL INSTRUCTIONS
Use side entrance and avoid blocking parking.
Make a jump drive for facility education.
Call coordinator 713-555-1212 before arrival.
Patient: PRIVATE_DETAIL
DOB 1/1/1960
Referring MD: PRIVATE_DETAIL

MAP LINK
${sourceMapLink}`;
const pdfTableText = `HOUSTON VAN 1
TIME FACILITY SPOKE WITH SLP PATIENT NAME REFERRING MD STATUS COMMENTS
MEMORIAL SNF
12620 MEMORIAL DR, HOUSTON, TX
TIME FACILITY
HOME HEALTH
100 EXAMPLE ST, HOUSTON, TX
Patient: PRIVATE_DETAIL
Referring MD: PRIVATE_DETAIL
TIME FACILITY STATUS COMMENTS
WESTCHASE OUTPOST (999 ALIAS TEST RD, HOUSTON, TX)
TIME FACILITY
PARK MANOR WESTCHASE
11910 RICHMOND AVENUE, HOUSTON, TX`;

async function clickVisible(pageOrLocator, name) {
  const buttons = pageOrLocator.getByRole("button", { name });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible()) {
      await button.click();
      return;
    }
  }
  throw new Error(`No visible button named ${String(name)}`);
}

async function firstVisible(locator, label) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) return item;
  }
  throw new Error(`No visible locator found: ${label}`);
}

async function storedState(page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  }, storageKey);
}

async function waitForStoredState(page, predicate, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await storedState(page);
    if (state && predicate(state)) return state;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for stored state: ${label}`);
}

async function isInViewport(locator, page) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  return Boolean(box && viewport && box.y >= 0 && box.y + box.height <= viewport.height);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.facilities), "hydrated defaults");

  await clickVisible(page, "Import route");
  await clickVisible(page, "Van Packet");
  await clickVisible(page, "Parse Van Packet");
  const sampleReviewHeading = page.getByRole("heading", { name: "Review imported stops" });
  await sampleReviewHeading.waitFor();
  assert.equal(
    await isInViewport(sampleReviewHeading, page),
    true,
    "parsing the sample Van Packet should move the user to the Step 2 review section",
  );

  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.facilities), "hydrated defaults");
  const initialState = await storedState(page);
  const initialFacilityCount = initialState.facilities.length;

  await clickVisible(page, "Import Schedule");
  await clickVisible(page, "Van Packet");
  await page.getByLabel("Email body and map link").fill(packetText);
  await page.getByLabel("PDF table text").fill(pdfTableText);
  await clickVisible(page, "Parse Van Packet");

  const summary = page.getByTestId("van-packet-summary");
  await summary.getByText("Northwest Van").waitFor();
  assert.equal(
    await isInViewport(page.getByRole("heading", { name: "Review imported stops" }), page),
    true,
    "parsing a Van Packet should move the user to the Step 2 review section",
  );
  await summary.getByText("Map stops: 6").waitFor();
  await summary.getByText("Private stop hints: 1").waitFor();
  await summary.getByText("Route start/end: 2 skipped").waitFor();
  await summary.getByText("Used for stop review hints").waitFor();
  await summary.getByText("Review safe notes").waitFor();
  assert.equal(await summary.getByText("PRIVATE_DETAIL").count(), 0);
  assert.equal(await summary.getByText("713-555-1212").count(), 0);
  assert.equal(await page.getByLabel("Email body and map link").inputValue(), "");
  assert.equal(await page.getByLabel("PDF table text").inputValue(), "");
  assert.equal(await page.getByText("TIME FACILITY").count(), 0);

  await page.getByText("Route start/end", { exact: true }).waitFor();
  await page.getByText("Duplicate return point skipped").waitFor();
  await page.getByTestId("import-review-card-1").getByRole("heading", { name: "Memorial SNF" }).waitFor();
  await page.getByTestId("import-review-card-2").getByRole("heading", { name: "Private route stop 3" }).waitFor();
  const aliasCard = page.getByTestId("import-review-card-3");
  await aliasCard.getByRole("heading", { name: "999 Alias Test Rd" }).waitFor();
  await firstVisible(
    aliasCard.getByText("PDF label hint. Select the facility to remember this alias."),
    "initial alias review hint",
  );
  await aliasCard.getByLabel("Existing facility").selectOption("park-manor-westchase");
  const rememberAliasCheckbox = await firstVisible(
    aliasCard.getByLabel('Remember "WESTCHASE OUTPOST" as an alias for this facility'),
    "remember alias checkbox",
  );
  await rememberAliasCheckbox.check();
  await page.getByTestId("import-review-card-4").getByRole("heading", { name: "Park Manor Westchase" }).waitFor();
  await clickVisible(page, "Confirm 4 Stops");

  let state = await waitForStoredState(
    page,
    (nextState) =>
      nextState.routeStops?.length === 4 &&
      nextState.routeStops?.some((stop) => stop.source === "private_route_stop" && stop.privateLocation?.name === "Private route stop 3") &&
      nextState.facilities
        ?.find((facility) => facility.id === "park-manor-westchase")
        ?.aliases?.includes("WESTCHASE OUTPOST"),
    "van packet route with private stop",
  );
  assert.equal(state.facilities.length, initialFacilityCount);
  assert.equal(state.facilities.some((facility) => facility.name === "Private route stop 3"), false);
  assert.equal(
    state.facilities.find((facility) => facility.id === "park-manor-westchase")?.aliases?.includes("WESTCHASE OUTPOST"),
    true,
  );
  assert.equal(state.routeStops.every((stop) => stop.sourceMapLink === sourceMapLink), true);

  await page.getByRole("button", { name: "Open original map link" }).first().waitFor();
  const blockedMapsButton = await firstVisible(
    page.getByRole("button", { name: "Confirm locations for Maps" }),
    "blocked app-generated Google Maps handoff",
  );
  assert.equal(await blockedMapsButton.isDisabled(), true);
  await page.getByText("No route add-ons match these filters").first().waitFor();

  await clickVisible(page, "Outreach");
  await page.getByTestId("text-first-card").getByRole("heading", { name: "No uncontacted facility needs a text right now" }).waitFor();
  assert.equal(await page.getByText("Private route stop 3").count(), 0);

  await clickVisible(page, "Near My Route");
  const queue = await firstVisible(page.getByTestId("location-confirmation-queue"), "location confirmation queue");
  await queue.getByText("Private route stop 3").waitFor();
  await queue.getByLabel("Latitude for Private route stop 3").fill("29.7066");
  await queue.getByLabel("Longitude for Private route stop 3").fill("-95.5492");
  await clickVisible(queue, "Confirm Location");

  state = await waitForStoredState(
    page,
    (nextState) =>
      nextState.routeStops?.some(
        (stop) =>
          stop.source === "private_route_stop" &&
          stop.privateLocation?.name === "Private route stop 3" &&
          stop.privateLocation?.locationStatus === "confirmed",
      ),
    "confirmed private route stop",
  );
  assert.equal(state.facilities.length, initialFacilityCount);
  await page.getByRole("button", { name: "Open in Google Maps" }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Confirm locations for Maps" }).count(), 0);
  assert.equal(await page.getByText("No route add-ons match these filters").count(), 0);

  await clickVisible(page, "Import Schedule");
  await page.getByLabel("Email body and map link").fill(packetText);
  await page.getByLabel("PDF table text").fill(pdfTableText);
  await clickVisible(page, "Parse Van Packet");
  const learnedAliasCard = page.getByTestId("import-review-card-3");
  await learnedAliasCard.getByRole("heading", { name: "Park Manor Westchase" }).waitFor();
  assert.equal(await learnedAliasCard.getByLabel("Edit address").count(), 0);
  await (await firstVisible(learnedAliasCard.getByText("Show original text"), "learned alias original text disclosure")).click();
  await firstVisible(learnedAliasCard.getByText(/999 Alias Test Rd/), "learned alias original address");
  await firstVisible(
    learnedAliasCard.getByText("Possible known facility label. Confirm the facility to remember this alias."),
    "learned alias review hint",
  );
  await firstVisible(learnedAliasCard.getByText("Park Manor Westchase"), "learned alias matched facility");
  await firstVisible(learnedAliasCard.getByText("55% match"), "learned alias confidence");

  console.log("Van packet import browser validation passed.");
} finally {
  await browser.close();
}
