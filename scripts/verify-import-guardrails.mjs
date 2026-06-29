import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.IMPORT_GUARDRAILS_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";

const realisticRoute = `8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies
10:15 AM Park Manor Westchase, 11910 Richmond Ave, Houston, TX, 1 study
1:00 PM, Lakeside Rehab, 9440 Bellaire Blvd, Houston, TX, 2 studies`;

const guardrailRoute = `10:15 AM, Park Manor, Houston, TX, 1 study
11:00 AM, Cypress Care, 100 New Rd, Houston, TX, 1 study`;

async function clickButton(page, name) {
  const buttons = page.getByRole("button", { name });
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

async function hasVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) return true;
  }
  return false;
}

async function resetAndOpenImport(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.facilities), "hydrated defaults");
  await clickButton(page, "Import Schedule");
}

async function runHappyPath(page) {
  await resetAndOpenImport(page);
  const initial = await storedState(page);
  const initialFacilityCount = initial.facilities.length;

  await page.locator("textarea").fill(realisticRoute);
  await clickButton(page, "Parse Schedule");
  await page.getByText("Memorial SNF").first().waitFor();
  assert.equal(await page.getByText("No likely match").count(), 0);
  assert.equal(await page.getByText("Resolve uncertain rows before confirming.").count(), 0);

  const confirm = page.getByRole("button", { name: "Confirm 3 Stops" }).first();
  assert.equal(await confirm.isEnabled(), true);
  await confirm.click();

  const state = await waitForStoredState(
    page,
    (current) =>
      current.facilities.length === initialFacilityCount &&
      current.routeStops.length === 3 &&
      current.routeStops.every((stop) => ["memorial-snf", "park-manor-westchase", "lakeside-rehab"].includes(stop.facilityId)),
    "confirmed route reuses existing facilities",
  );
  assert.equal(state.facilities.length, initialFacilityCount);
}

async function runGuardrailPath(page) {
  await resetAndOpenImport(page);
  const initial = await storedState(page);
  const initialFacilityCount = initial.facilities.length;

  await page.locator("textarea").fill(guardrailRoute);
  await clickButton(page, "Parse Schedule");
  await page.getByText("Resolve uncertain rows before confirming.").first().waitFor();
  const blocked = page.getByRole("button", { name: "Resolve 2 Rows Before Confirming" }).first();
  assert.equal(await blocked.isDisabled(), true);

  const parkCard = page.locator("article").filter({ hasText: "Park Manor" }).first();
  await parkCard.locator("select").first().selectOption("skip");

  const cypressCard = page.locator("article").filter({ hasText: "Cypress Care" }).first();
  await cypressCard.locator("select").first().selectOption("create_new");

  const confirm = page.getByRole("button", { name: "Confirm 1 Stop" }).first();
  assert.equal(await confirm.isEnabled(), true);
  await confirm.click();

  const state = await waitForStoredState(
    page,
    (current) =>
      current.facilities.length === initialFacilityCount + 1 &&
      current.facilities.some((facility) => facility.name === "Cypress Care") &&
      current.routeStops.length === 1,
    "single explicit create-new import",
  );
  assert.equal(state.routeStops.length, 1);
}

async function runDesktopGuardrailCheck(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await resetAndOpenImport(page);
  await page.locator("textarea").fill("10:15 AM, Park Manor, Houston, TX, 1 study");
  await clickButton(page, "Parse Schedule");
  await page.getByText("Resolve uncertain rows before confirming.").first().waitFor();
  const blocked = page.getByRole("button", { name: "Resolve 1 Row Before Confirming" }).first();
  assert.equal(await blocked.isDisabled(), true);
  assert.equal(await hasVisible(page.getByLabel("Search existing facilities")), true);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await runHappyPath(page);
  await runGuardrailPath(page);
  await runDesktopGuardrailCheck(page);
  console.log("Import guardrails browser validation passed.");
} finally {
  await browser.close();
}
