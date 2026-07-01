import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.CONTACT_SETUP_URL ?? "http://localhost:3018";
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
  const deadline = Date.now() + 7_000;
  while (Date.now() < deadline) {
    const state = await storedState(page);
    if (state && predicate(state)) return state;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for stored state: ${label}`);
}

async function openFreshOutreach(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.facilities), "hydrated defaults");
  await clickVisible(page, "Outreach");
  const textFirst = await firstVisible(page.getByTestId("text-first-card"), "Text First card");
  await textFirst.getByRole("heading", { name: "Encompass Rehab Westchase" }).waitFor();
  return textFirst;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();

  let textFirst = await openFreshOutreach(page);
  await textFirst.getByText("Needs real phone").waitFor();
  await textFirst.getByTestId("contact-setup-encompass-westchase").waitFor();
  await textFirst.getByLabel("Phone for Lisa").fill("713-867-5309");
  await waitForStoredState(
    page,
    (state) =>
      state.facilities
        .find((facility) => facility.id === "encompass-westchase")
        ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "713-867-5309",
    "Lisa phone saved from Text First",
  );
  await textFirst.getByText("Ready to text").waitFor();
  assert.equal(await textFirst.getByText("Needs real phone").count(), 0);

  await clickVisible(textFirst, "Text");
  await page.getByText("Template copied. Open Messages on your phone, then mark this facility texted.").first().waitFor();
  await clickVisible(page, "Mark texted");
  await waitForStoredState(
    page,
    (state) =>
      state.outreachLogs.some(
        (log) => log.facilityId === "encompass-westchase" && log.status === "texted" && log.contactName === "Lisa",
      ),
    "saved Lisa phone used for Messages handoff",
  );

  textFirst = await openFreshOutreach(page);
  const setup = textFirst.getByTestId("contact-setup-encompass-westchase");
  await clickVisible(setup, "Add contact");
  const newContactId = await waitForStoredState(
    page,
    (state) => state.facilities.find((item) => item.id === "encompass-westchase")?.contacts.find((contact) => contact.name === "New contact")?.id,
    "new contact id created",
  ).then((state) => state.facilities.find((item) => item.id === "encompass-westchase").contacts.find((contact) => contact.name === "New contact").id);
  const kenEditor = setup.getByTestId(`contact-editor-${newContactId}`);
  await kenEditor.getByLabel("Contact name for New contact").fill("Ken");
  await kenEditor.getByLabel("Role for Ken").fill("Rehab Manager");
  await kenEditor.getByLabel("Phone for Ken").fill("713-867-5310");
  await kenEditor.getByLabel("Preferred method for Ken").selectOption("call");
  await waitForStoredState(
    page,
    (state) => {
      const facility = state.facilities.find((item) => item.id === "encompass-westchase");
      const ken = facility?.contacts.find((contact) => contact.name === "Ken");
      return ken?.phone === "713-867-5310" && ken?.preferredMethod === "call" && ken?.primary !== true;
    },
    "call-preferred Ken saved without changing text readiness",
  );
  await kenEditor.getByLabel("Preferred method for Ken").selectOption("text");
  await kenEditor.getByRole("radio", { name: "Recommended" }).check();
  await waitForStoredState(
    page,
    (state) => {
      const facility = state.facilities.find((item) => item.id === "encompass-westchase");
      const ken = facility?.contacts.find((contact) => contact.name === "Ken");
      const lisa = facility?.contacts.find((contact) => contact.id === "c-encompass-lisa");
      return ken?.phone === "713-867-5310" && ken?.primary === true && ken?.preferredMethod === "text" && lisa?.primary === false;
    },
    "new recommended contact saved",
  );
  await textFirst.getByText("Ready to text").waitFor();

  await clickVisible(textFirst, "Text");
  await page.getByText("Template copied. Open Messages on your phone, then mark this facility texted.").first().waitFor();
  assert.equal(await page.getByText("Choose text contact").count(), 0);
  await clickVisible(page, "Mark texted");
  await waitForStoredState(
    page,
    (state) =>
      state.outreachLogs.some(
        (log) => log.facilityId === "encompass-westchase" && log.status === "texted" && log.contactName === "Ken",
      ),
    "recommended Ken contact used for Messages handoff",
  );

  textFirst = await openFreshOutreach(page);
  const needsPhoneQueue = page.getByTestId("needs-phone-queue");
  const westHoustonCard = needsPhoneQueue.locator("article").filter({ hasText: "West Houston LTACH" }).first();
  await westHoustonCard.getByText("No phone saved").waitFor();
  await clickVisible(westHoustonCard.getByTestId("contact-setup-west-houston-ltach"), "Add contact");
  const westHoustonNewId = await waitForStoredState(
    page,
    (state) => state.facilities.find((item) => item.id === "west-houston-ltach")?.contacts.find((contact) => contact.name === "New contact")?.id,
    "West Houston contact id created",
  ).then((state) => state.facilities.find((item) => item.id === "west-houston-ltach").contacts.find((contact) => contact.name === "New contact").id);
  const westHoustonEditor = westHoustonCard.getByTestId(`contact-editor-${westHoustonNewId}`);
  await westHoustonEditor.getByLabel("Contact name for New contact").fill("Nora");
  await westHoustonEditor.getByLabel("Role for Nora").fill("SLP Lead");
  await westHoustonEditor.getByLabel("Preferred method for Nora").selectOption("text");
  await westHoustonEditor.getByRole("radio", { name: "Recommended" }).check();
  await westHoustonEditor.getByLabel("Phone for Nora").fill("713-867-5320");
  await waitForStoredState(
    page,
    (state) => {
      const facility = state.facilities.find((item) => item.id === "west-houston-ltach");
      const nora = facility?.contacts.find((contact) => contact.name === "Nora");
      return nora?.phone === "713-867-5320" && nora?.preferredMethod === "text" && nora?.primary === true;
    },
    "queue card contact setup saved",
  );
  const promotedTextFirst = await firstVisible(page.getByTestId("text-first-card"), "promoted queue contact Text First card");
  await promotedTextFirst.getByRole("heading", { name: "West Houston LTACH" }).waitFor();
  await promotedTextFirst.getByText("Ready to text").waitFor();

  console.log("Contact setup browser validation passed.");
} finally {
  await browser.close();
}
