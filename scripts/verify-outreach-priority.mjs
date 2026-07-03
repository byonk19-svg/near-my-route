import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.OUTREACH_PRIORITY_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";

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
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.facilities), "hydrated defaults");

  await page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    state.facilities = state.facilities.map((facility) =>
      facility.id === "memorial-snf"
        ? {
            ...facility,
            contacts: facility.contacts.map((contact) =>
              contact.id === "c-memorial-amy" ? { ...contact, phone: "713-867-5309" } : contact,
            ),
          }
        : facility,
    );
    window.localStorage.setItem(key, JSON.stringify(state));
  }, storageKey);
  await page.reload({ waitUntil: "networkidle" });

  await clickVisible(page, "Outreach");
  const textFirst = await firstVisible(page.getByTestId("text-first-card"), "Text First card");
  await textFirst.getByRole("heading", { name: "Encompass Rehab Westchase" }).waitFor();
  assert.equal(await textFirst.getByText("Memorial SNF").count(), 0);
  await textFirst.getByText("+3 min detour").waitFor();
  assert.equal(await textFirst.getByText("Needs real phone").count(), 1);
  assert.ok(await textFirst.getByText("Same-day friendly").count() > 0);
  assert.ok(await textFirst.getByText("High volume").count() > 0);

  const readyQueue = page.getByTestId("ready-to-text-queue");
  assert.equal(await readyQueue.getByText("Encompass Rehab Westchase").count(), 0);
  assert.equal(await readyQueue.getByText("Memorial SNF").count(), 0);
  await page.getByText("Needs phone before texting").first().waitFor();

  const blockedText = textFirst.getByRole("button", { name: "Enter real phone first" });
  await blockedText.waitFor();
  assert.equal(await blockedText.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Mark texted" }).count(), 0);

  await page.getByLabel("Phone for Lisa").first().fill("713-867-5309");
  assert.equal(await page.getByRole("button", { name: "Mark texted" }).count(), 0);
  await waitForStoredState(
    page,
    (state) =>
      state.facilities
        .find((facility) => facility.id === "encompass-westchase")
        ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "713-867-5309",
    "edited Text First phone persisted",
  );

  await clickVisible(textFirst, "Text");
  await page
    .getByText("Template copied. Open Messages on your phone, then mark this facility texted.")
    .first()
    .waitFor();
  await clickVisible(page, "Mark texted");
  await waitForStoredState(
    page,
    (state) =>
      state.outreachLogs.some(
        (log) => log.facilityId === "encompass-westchase" && log.status === "texted" && log.contactName === "Lisa",
      ),
    "Text First handoff confirmed",
  );

  await page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    state.outreachLogs = [];
    state.facilities = state.facilities.map((facility) =>
      facility.id === "encompass-westchase"
        ? {
            ...facility,
            lastContacted: "2026-06-10",
            contacts: facility.contacts.map((contact) =>
              contact.id === "c-encompass-lisa" ? { ...contact, phone: "713-867-5309" } : contact,
            ),
          }
        : facility,
    );
    window.localStorage.setItem(key, JSON.stringify(state));
  }, storageKey);
  await page.reload({ waitUntil: "networkidle" });
  await clickVisible(page, "Outreach");
  const readyTextFirst = await firstVisible(page.getByTestId("text-first-card"), "ready Text First card");
  await readyTextFirst.getByRole("heading", { name: "Encompass Rehab Westchase" }).waitFor();
  await readyTextFirst.getByText("Ready to text").waitFor();
  assert.equal(await page.getByTestId("ready-to-text-queue").getByText("Encompass Rehab Westchase").count(), 0);

  await page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    state.facilities = state.facilities.map((facility) =>
      facility.id === "lakeside-rehab"
        ? { ...facility, locationStatus: "needs_confirmation", locationSource: "fallback" }
        : facility,
    );
    window.localStorage.setItem(key, JSON.stringify(state));
  }, storageKey);
  await page.reload({ waitUntil: "networkidle" });
  await clickVisible(page, "Outreach");
  await page.getByText("Route includes unconfirmed locations. Review locations before trusting add-on ranking or Maps handoff.").first().waitFor();
  const blockedTextFirst = await firstVisible(page.getByTestId("text-first-card"), "blocked Text First card");
  await blockedTextFirst.getByRole("heading", { name: "No uncontacted facility needs a text right now" }).waitFor();
  assert.equal(await page.getByTestId("ready-to-text-queue").getByText("Encompass Rehab Westchase").count(), 0);
  await clickVisible(page, "Near My Route");
  const blockedMapsButton = await firstVisible(
    page.getByRole("button", { name: "Confirm locations for Maps" }),
    "blocked Google Maps handoff",
  );
  assert.equal(await blockedMapsButton.isDisabled(), true);

  console.log("Outreach priority browser validation passed.");
} finally {
  await browser.close();
}
