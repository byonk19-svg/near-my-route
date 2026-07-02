import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.VAN_PACKET_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";
const sourceMapLink =
  "https://www.google.com/maps/dir/Memorial+SNF,+12620+Memorial+Dr,+Houston,+TX/Home+Health,+100+Example+St,+Houston,+TX/Park+Manor+Westchase,+11910+Richmond+Ave,+Houston,+TX";
const packetText = `NAME OF TEAM MEMBERS
Elaine; Jordan

VAN NAME
Northwest Van

MEET DETAILS
Meet at office at 7:30 AM.

SPECIAL INSTRUCTIONS
Bring van binder.
Patient: PRIVATE_DETAIL
DOB 1/1/1960
Referring MD: PRIVATE_DETAIL

MAP LINK
${sourceMapLink}`;

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

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.facilities), "hydrated defaults");
  const initialState = await storedState(page);
  const initialFacilityCount = initialState.facilities.length;

  await clickVisible(page, "Import Schedule");
  await clickVisible(page, "Van Packet");
  await page.locator("textarea").fill(packetText);
  await clickVisible(page, "Parse Van Packet");

  const summary = page.getByTestId("van-packet-summary");
  await summary.getByText("Northwest Van").waitFor();
  await summary.getByText("Map stops: 3").waitFor();
  assert.equal(await summary.getByText("PRIVATE_DETAIL").count(), 0);

  await page.getByTestId("import-review-card-1").getByRole("heading", { name: "Memorial SNF" }).waitFor();
  await page.getByTestId("import-review-card-2").getByRole("heading", { name: "Private route stop 2" }).waitFor();
  await page.getByTestId("import-review-card-3").getByRole("heading", { name: "Park Manor Westchase" }).waitFor();
  await clickVisible(page, "Confirm 3 Stops");

  let state = await waitForStoredState(
    page,
    (nextState) =>
      nextState.routeStops?.length === 3 &&
      nextState.routeStops?.some((stop) => stop.source === "private_route_stop" && stop.privateLocation?.name === "Private route stop 2"),
    "van packet route with private stop",
  );
  assert.equal(state.facilities.length, initialFacilityCount);
  assert.equal(state.facilities.some((facility) => facility.name === "Private route stop 2"), false);
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
  assert.equal(await page.getByText("Private route stop 2").count(), 0);

  await clickVisible(page, "Near My Route");
  const queue = page.getByTestId("location-confirmation-queue");
  await queue.getByText("Private route stop 2").waitFor();
  await queue.getByLabel("Latitude for Private route stop 2").fill("29.7066");
  await queue.getByLabel("Longitude for Private route stop 2").fill("-95.5492");
  await clickVisible(queue, "Confirm Location");

  state = await waitForStoredState(
    page,
    (nextState) =>
      nextState.routeStops?.some(
        (stop) =>
          stop.source === "private_route_stop" &&
          stop.privateLocation?.name === "Private route stop 2" &&
          stop.privateLocation?.locationStatus === "confirmed",
      ),
    "confirmed private route stop",
  );
  assert.equal(state.facilities.length, initialFacilityCount);
  await page.getByRole("button", { name: "Open in Google Maps" }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Confirm locations for Maps" }).count(), 0);
  assert.equal(await page.getByText("No route add-ons match these filters").count(), 0);

  console.log("Van packet import browser validation passed.");
} finally {
  await browser.close();
}
