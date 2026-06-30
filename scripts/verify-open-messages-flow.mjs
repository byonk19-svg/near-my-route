import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.MESSAGES_FLOW_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";

async function clickVisibleButton(pageOrLocator, name) {
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
  await waitForStoredState(page, (state) => Array.isArray(state.outreachLogs), "hydrated defaults");

  await clickVisibleButton(page, "Outreach");
  const parkCard = await firstVisible(page.locator("article").filter({ hasText: "Park Manor Westchase" }), "Park Manor Westchase card");
  await parkCard.getByText("Park Manor Westchase").waitFor();

  const before = await storedState(page);
  const beforeTextedCount = before.outreachLogs.filter(
    (log) => log.facilityId === "park-manor-westchase" && log.status === "texted",
  ).length;

  await clickVisibleButton(parkCard, "Text");
  await page.getByText("Choose text contact").waitFor();
  const picker = page.locator("section").filter({ hasText: "Choose text contact" }).last();
  await picker.getByText("Maria", { exact: true }).waitFor();
  await picker.getByText("Ken", { exact: true }).waitFor();
  await picker.getByText("Recommended", { exact: true }).waitFor();
  await picker.getByText("Needs real phone", { exact: true }).first().waitFor();
  await clickVisibleButton(picker, "Ken");

  await page.getByRole("heading", { name: "Safe outreach template" }).first().waitFor();
  await page.getByText("This contact still has a placeholder 555 number. Edit the phone number before opening Messages.").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Mark texted" }).count(), 0);
  const blockedState = await storedState(page);
  assert.equal(
    blockedState.outreachLogs.filter((log) => log.facilityId === "park-manor-westchase" && log.status === "texted").length,
    beforeTextedCount,
    "placeholder contacts must not log Texted today",
  );

  await page.getByLabel("Phone for Ken").first().fill("713-867-5309");
  await waitForStoredState(
    page,
    (state) =>
      state.facilities
        .find((facility) => facility.id === "park-manor-westchase")
        ?.contacts.find((contact) => contact.id === "c-westchase-ken")?.phone === "713-867-5309",
    "edited phone persisted",
  );
  await clickVisibleButton(page, "Open Messages");
  const updatedPicker = page.locator("section").filter({ hasText: "Choose text contact" }).last();
  await updatedPicker.getByText("Ken", { exact: true }).waitFor();
  await clickVisibleButton(updatedPicker, "Ken");

  await page
    .getByText("Template copied. Open Messages on your phone, then mark this facility texted.")
    .first()
    .waitFor();
  const fallbackState = await storedState(page);
  assert.equal(
    fallbackState.outreachLogs.filter((log) => log.facilityId === "park-manor-westchase" && log.status === "texted").length,
    beforeTextedCount,
    "desktop fallback must not log Texted today before explicit confirmation",
  );

  await clickVisibleButton(page, "Mark texted");
  const after = await waitForStoredState(
    page,
    (state) =>
      state.outreachLogs.filter((log) => log.facilityId === "park-manor-westchase" && log.status === "texted").length ===
      beforeTextedCount + 1,
    "manual texted confirmation",
  );
  const latest = after.outreachLogs.find((log) => log.facilityId === "park-manor-westchase" && log.status === "texted");
  assert.equal(latest.contactName, "Ken");

  console.log("Open Messages fallback browser validation passed.");
} finally {
  await browser.close();
}
