import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.MESSAGES_FLOW_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";
const approvedMessage =
  "Hi! It's Elaine, SLP with Professional Imaging. We'll be doing MBSSs in your area this morning. Do you have anyone appropriate you'd like us to consider adding today?";

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
  const textFirstCard = await firstVisible(page.getByTestId("text-first-card"), "Text First card");
  await textFirstCard.getByRole("heading", { name: "Encompass Rehab Westchase" }).waitFor();

  const before = await storedState(page);
  const beforeTextedCount = before.outreachLogs.filter(
    (log) => log.facilityId === "encompass-westchase" && log.status === "texted",
  ).length;

  await clickVisibleButton(textFirstCard, "Text");

  await page.getByRole("heading", { name: "Safe outreach template" }).first().waitFor();
  await page.getByText("This contact still has a placeholder 555 number. Edit the phone number before opening Messages.").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Mark texted" }).count(), 0);
  const blockedState = await storedState(page);
  assert.equal(
    blockedState.outreachLogs.filter((log) => log.facilityId === "encompass-westchase" && log.status === "texted").length,
    beforeTextedCount,
    "placeholder contacts must not log Texted today",
  );

  await page.getByLabel("Phone for Lisa").first().fill("abc");
  await waitForStoredState(
    page,
    (state) =>
      state.facilities
        .find((facility) => facility.id === "encompass-westchase")
        ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "abc",
    "invalid phone persisted",
  );
  await clickVisibleButton(page, "Open Messages");
  await page.getByText("This contact does not have a dialable phone number. Enter a real phone number before opening Messages.").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Mark texted" }).count(), 0);
  const invalidState = await storedState(page);
  assert.equal(
    invalidState.outreachLogs.filter((log) => log.facilityId === "encompass-westchase" && log.status === "texted").length,
    beforeTextedCount,
    "invalid phones must not log Texted today",
  );

  await page.getByLabel("Phone for Lisa").first().fill("713-867-5309");
  await waitForStoredState(
    page,
    (state) =>
      state.facilities
        .find((facility) => facility.id === "encompass-westchase")
        ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "713-867-5309",
    "edited phone persisted",
  );
  assert.equal(await page.getByRole("button", { name: "Mark texted" }).count(), 0);
  const editedState = await storedState(page);
  assert.equal(
    editedState.outreachLogs.filter((log) => log.facilityId === "encompass-westchase" && log.status === "texted").length,
    beforeTextedCount,
    "editing a placeholder phone must not unlock manual Texted today logging before retry",
  );

  await clickVisibleButton(page, "Open Messages");

  await page
    .getByText("Template copied. Open Messages on your phone, then mark this facility texted.")
    .first()
    .waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), approvedMessage);
  const fallbackState = await storedState(page);
  assert.equal(
    fallbackState.outreachLogs.filter((log) => log.facilityId === "encompass-westchase" && log.status === "texted").length,
    beforeTextedCount,
    "desktop fallback must not log Texted today before explicit confirmation",
  );

  await clickVisibleButton(page, "Mark texted");
  const after = await waitForStoredState(
    page,
    (state) =>
      state.outreachLogs.filter((log) => log.facilityId === "encompass-westchase" && log.status === "texted").length ===
      beforeTextedCount + 1,
    "manual texted confirmation",
  );
  const latest = after.outreachLogs.find((log) => log.facilityId === "encompass-westchase" && log.status === "texted");
  assert.equal(latest.contactName, "Lisa");

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  });
  await mobileContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const mobilePage = await mobileContext.newPage();

  await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
  await mobilePage.evaluate(() => window.localStorage.clear());
  await mobilePage.reload({ waitUntil: "networkidle" });
  await waitForStoredState(mobilePage, (state) => Array.isArray(state.outreachLogs), "mobile hydrated defaults");

  await clickVisibleButton(mobilePage, "Outreach");
  const mobileTextFirst = await firstVisible(mobilePage.getByTestId("text-first-card"), "mobile Text First card");
  await mobileTextFirst.getByRole("heading", { name: "Encompass Rehab Westchase" }).waitFor();
  await clickVisibleButton(mobileTextFirst, "Text");
  await mobilePage
    .getByText("This contact still has a placeholder 555 number. Edit the phone number before opening Messages.")
    .first()
    .waitFor();
  await mobilePage.getByLabel("Phone for Lisa").first().fill("713-867-5309");
  await waitForStoredState(
    mobilePage,
    (state) =>
      state.facilities
        .find((facility) => facility.id === "encompass-westchase")
        ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "713-867-5309",
    "mobile edited phone persisted",
  );
  const beforeMobileOpen = await storedState(mobilePage);
  const beforeMobileTextedCount = beforeMobileOpen.outreachLogs.filter(
    (log) => log.facilityId === "encompass-westchase" && log.status === "texted",
  ).length;

  await clickVisibleButton(mobilePage, "Open Messages");
  await mobilePage
    .getByText("Template copied and Messages opened. Return here after sending, then mark this facility texted.")
    .first()
    .waitFor();
  assert.equal(await mobilePage.evaluate(() => navigator.clipboard.readText()), approvedMessage);
  await mobilePage.waitForTimeout(500);
  const afterMobileOpen = await storedState(mobilePage);
  assert.equal(
    afterMobileOpen.outreachLogs.filter((log) => log.facilityId === "encompass-westchase" && log.status === "texted").length,
    beforeMobileTextedCount,
    "mobile Messages handoff must not log Texted today before explicit confirmation",
  );

  console.log("Open Messages fallback browser validation passed.");
} finally {
  await browser.close();
}
