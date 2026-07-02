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

async function visibleCount(locator) {
  let visible = 0;
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) visible += 1;
  }
  return visible;
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) return item;
  }
  throw new Error("No visible locator match");
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

  const memorialCard = page.getByTestId("import-review-card-1");
  const parkCard = page.getByTestId("import-review-card-2");
  await memorialCard.getByText("99% match").first().waitFor();
  assert.equal(await memorialCard.getByText("Matched existing facility").isVisible(), true);
  const memorialChange = memorialCard.getByRole("button", { name: "Change match for Memorial SNF" });
  assert.equal(await memorialChange.isVisible(), true);
  assert.equal(await memorialChange.getAttribute("aria-expanded"), "false");
  assert.equal(await visibleCount(memorialCard.getByLabel("Action")), 0);
  assert.equal(await visibleCount(memorialCard.getByLabel("Search existing facilities")), 0);
  assert.equal(await visibleCount(memorialCard.getByLabel("Existing facility")), 0);
  assert.equal(await visibleCount(memorialCard.getByLabel("Edit address")), 0);
  assert.equal(await visibleCount(memorialCard.getByText("Show original text")), 0);

  await memorialChange.focus();
  await page.keyboard.press("Enter");
  assert.equal(await memorialChange.getAttribute("aria-expanded"), "true");
  assert.equal(await memorialCard.getByLabel("Action").isVisible(), true);
  assert.equal(await memorialCard.getByLabel("Search existing facilities").isVisible(), true);
  assert.equal(await memorialCard.getByLabel("Existing facility").isVisible(), true);
  assert.equal(await memorialCard.getByLabel("Edit address").isVisible(), true);
  assert.equal(await memorialCard.getByText("Show original text").isVisible(), true);
  assert.equal(await visibleCount(parkCard.getByLabel("Action")), 0);

  await page.keyboard.press("Enter");
  assert.equal(await memorialChange.getAttribute("aria-expanded"), "false");
  assert.equal(await visibleCount(memorialCard.getByLabel("Action")), 0);

  await memorialChange.click();
  assert.equal(await memorialChange.getAttribute("aria-expanded"), "true");
  await clickButton(page, "Parse Schedule");
  const resetMemorialCard = page.getByTestId("import-review-card-1");
  const resetMemorialChange = resetMemorialCard.getByRole("button", { name: "Change match for Memorial SNF" });
  assert.equal(await resetMemorialChange.getAttribute("aria-expanded"), "false");
  assert.equal(await visibleCount(resetMemorialCard.getByLabel("Action")), 0);

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

  const parkCard = page.getByTestId("import-review-card-1");
  assert.equal(await visibleCount(parkCard.getByRole("button", { name: /Change match/ })), 0);
  assert.equal(await parkCard.getByLabel("Action").isVisible(), true);
  assert.equal(await parkCard.getByLabel("Search existing facilities").isVisible(), true);
  assert.equal(await parkCard.getByLabel("Existing facility").isVisible(), true);
  assert.equal(await parkCard.getByLabel("Edit address").isVisible(), true);
  await parkCard.getByRole("button", { name: "Skip" }).click();

  const cypressCard = page.getByTestId("import-review-card-2");
  assert.equal(await cypressCard.getByLabel("Action").isVisible(), true);
  assert.equal(await cypressCard.getByLabel("Search existing facilities").isVisible(), true);
  assert.equal(await cypressCard.getByLabel("Existing facility").isVisible(), true);
  assert.equal(await cypressCard.getByLabel("Edit address").isVisible(), true);
  await cypressCard.getByRole("button", { name: "Create new facility" }).click();
  await cypressCard.getByLabel("New facility name").fill("Cypress Care North");
  await page.getByText("New facility locations must be confirmed before add-on ranking.").first().waitFor();
  assert.equal(await page.getByText("Resolve uncertain rows before confirming.").count(), 0);

  const confirm = page.getByRole("button", { name: "Confirm 1 Stop" }).first();
  assert.equal(await confirm.isEnabled(), true);
  await confirm.click();

  const state = await waitForStoredState(
    page,
    (current) =>
      current.facilities.length === initialFacilityCount + 1 &&
      current.facilities.some((facility) => facility.name === "Cypress Care North") &&
      current.routeStops.length === 1,
    "single explicit create-new import",
  );
  assert.equal(state.routeStops.length, 1);
  const newFacility = state.facilities.find((facility) => facility.name === "Cypress Care North");
  assert.equal(newFacility?.locationStatus, "needs_confirmation");
  assert.equal(newFacility?.locationSource, "import");
  assert.match(newFacility?.notes ?? "", /Confirm location/);
}

async function runDesktopGuardrailCheck(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await resetAndOpenImport(page);
  await page.locator("textarea").fill(
    "8:30 AM, Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies\n10:15 AM, Park Manor, Houston, TX, 1 study",
  );
  await clickButton(page, "Parse Schedule");
  await page.getByText("Resolve uncertain rows before confirming.").first().waitFor();
  const blocked = page.getByRole("button", { name: "Resolve 1 Row Before Confirming" }).first();
  assert.equal(await blocked.isDisabled(), true);

  const memorialRow = page.getByTestId("import-review-row-1");
  const parkRow = page.getByTestId("import-review-row-2");
  const memorialChange = await firstVisible(memorialRow.getByRole("button", { name: "Change match for Memorial SNF" }));
  assert.equal(await memorialChange.getAttribute("aria-expanded"), "false");
  assert.equal(await visibleCount(memorialRow.getByLabel("Search existing facilities")), 0);
  assert.equal(await hasVisible(parkRow.getByLabel("Search existing facilities")), true);
  assert.equal(await hasVisible(parkRow.getByLabel("Action for Park Manor")), true);

  await memorialChange.click();
  assert.equal(await memorialChange.getAttribute("aria-expanded"), "true");
  assert.equal(await hasVisible(memorialRow.getByLabel("Search existing facilities")), true);
  assert.equal(await hasVisible(memorialRow.getByLabel("Action")), true);
  assert.equal(await hasVisible(parkRow.getByLabel("Search existing facilities")), true);
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
