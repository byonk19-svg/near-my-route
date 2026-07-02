import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.LOCATION_CONFIRMATION_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";
const routeText = `8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies
11:00 AM, Cypress Care, 100 New Rd, Houston, TX, 1 study`;

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

  await clickVisible(page, "Import Schedule");
  await page.locator("textarea").fill(routeText);
  await clickVisible(page, "Parse Schedule");

  const cypressCard = page.getByTestId("import-review-card-2");
  await cypressCard.getByRole("button", { name: "Create new facility" }).click();
  await page.getByText("New facility locations must be confirmed before add-on ranking.").first().waitFor();
  await clickVisible(page, "Confirm 2 Stops");

  await waitForStoredState(
    page,
    (state) =>
      state.routeStops?.length === 2 &&
      state.facilities?.some((facility) => facility.name === "Cypress Care" && facility.locationStatus === "needs_confirmation"),
    "new unconfirmed route stop",
  );

  await page.getByText("Route includes unconfirmed locations: Cypress Care.").first().waitFor();
  const blockedMapsButton = await firstVisible(
    page.getByRole("button", { name: "Confirm locations for Maps" }),
    "blocked Google Maps handoff",
  );
  assert.equal(await blockedMapsButton.isDisabled(), true);
  await page.getByText("No route add-ons match these filters").first().waitFor();

  const queue = page.getByTestId("location-confirmation-queue");
  await queue.getByText("Cypress Care").waitFor();
  await queue
    .getByText("These are placeholder Houston coordinates. Open the address in Google Maps, then replace latitude and longitude before confirming.")
    .waitFor();
  const addressLookup = queue.getByRole("link", { name: "Open address in Google Maps" });
  await addressLookup.waitFor();
  assert.match(await addressLookup.getAttribute("href"), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  const blankMapsUrlButton = queue.getByRole("button", { name: "Paste Maps URL first" });
  await blankMapsUrlButton.waitFor();
  assert.equal(await blankMapsUrlButton.isDisabled(), true);
  await queue.getByLabel("Latitude for Cypress Care").fill("");
  await clickVisible(queue, "Confirm Location");
  await queue.getByText("Enter a valid latitude before confirming this location.").waitFor();
  await queue.getByLabel("Latitude for Cypress Care").fill("29.7604");
  await clickVisible(queue, "Confirm Location");
  await queue.getByText("Edit the fallback coordinates before confirming this location.").waitFor();
  await queue
    .getByLabel("Google Maps URL for Cypress Care")
    .fill("https://www.google.com/maps/place/Cypress+Care/@29.1,-95.1,17z/data=!3d29.7066!4d-95.5492");
  await queue.getByRole("button", { name: "Use coordinates from URL" }).waitFor();
  await clickVisible(queue, "Use coordinates from URL");
  await queue.getByText("Coordinates added from Google Maps URL. Confirm the pin is correct before saving.").waitFor();
  assert.equal(await queue.getByLabel("Latitude for Cypress Care").inputValue(), "29.7066");
  assert.equal(await queue.getByLabel("Longitude for Cypress Care").inputValue(), "-95.5492");
  assert.equal(
    await queue
      .getByText("These are placeholder Houston coordinates. Open the address in Google Maps, then replace latitude and longitude before confirming.")
      .count(),
    0,
  );
  await clickVisible(queue, "Confirm Location");

  const confirmed = await waitForStoredState(
    page,
    (state) => state.facilities?.some((facility) => facility.name === "Cypress Care" && facility.locationStatus === "confirmed"),
    "confirmed imported location",
  );
  const cypress = confirmed.facilities.find((facility) => facility.name === "Cypress Care");
  assert.equal(cypress.locationSource, "import");
  assert.equal(cypress.lat, 29.7066);
  assert.equal(cypress.lng, -95.5492);

  await page.getByRole("button", { name: "Open in Google Maps" }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Confirm locations for Maps" }).count(), 0);
  assert.equal(await page.getByText("No route add-ons match these filters").count(), 0);

  await page.evaluate(() => {
    window.__locationConfirmationOpenedUrls = [];
    window.open = (url) => {
      window.__locationConfirmationOpenedUrls.push(String(url));
      return null;
    };
  });
  await clickVisible(page, "Open in Google Maps");
  const openedUrls = await page.evaluate(() => window.__locationConfirmationOpenedUrls ?? []);
  assert.equal(openedUrls.length, 1);
  assert.match(openedUrls[0], /^https:\/\/www\.google\.com\/maps\/dir\//);

  await clickVisible(page, "Outreach");
  const textFirstCard = await firstVisible(page.getByTestId("text-first-card"), "Text First card");
  assert.equal(await textFirstCard.getByRole("heading", { name: "No uncontacted facility needs a text right now" }).count(), 0);

  console.log("Location confirmation browser validation passed.");
} finally {
  await browser.close();
}
