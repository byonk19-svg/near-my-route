import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.DOGFOOD_ROUTE_URL ?? "http://localhost:3018";
const storageKey = "near-my-route-state-v1";
const approvedMessage =
  "Hi! It's Elaine, SLP with Professional Imaging. We'll be doing MBSSs in your area this morning. Do you have anyone appropriate you'd like us to consider adding today?";
const routeText = `8:30 AM Memorial SNF, 12620 Memorial Dr, Houston, TX, 2 studies
10:15 AM Park Manor Westchase, 11910 Richmond Ave, Houston, TX, 1 study
1:00 PM Lakeside Rehab, 9440 Bellaire Blvd, Houston, TX, 2 studies`;

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

async function clickVisibleTab(page, name) {
  const buttons = page.getByRole("button", { name });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isVisible()) {
      await button.evaluate((node) => node.click());
      return;
    }
  }
  throw new Error(`No visible tab named ${String(name)}`);
}

async function firstVisible(locator, label) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) return item;
  }
  throw new Error(`No visible locator found: ${label}`);
}

async function checkVisible(page, name) {
  const checkboxes = page.getByRole("checkbox", { name });
  const count = await checkboxes.count();
  for (let index = 0; index < count; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (await checkbox.isVisible()) {
      await checkbox.check();
      return;
    }
  }
  throw new Error(`No visible checkbox named ${String(name)}`);
}

async function assertVisibleChecked(page, name) {
  const checkboxes = page.getByRole("checkbox", { name });
  const count = await checkboxes.count();
  for (let index = 0; index < count; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (await checkbox.isVisible()) {
      assert.equal(await checkbox.isChecked(), true, `${String(name)} should stay checked after reload`);
      return;
    }
  }
  throw new Error(`No visible checkbox named ${String(name)}`);
}

async function fillVisibleTextbox(page, name, value) {
  const textboxes = page.getByRole("textbox", { name });
  const count = await textboxes.count();
  for (let index = 0; index < count; index += 1) {
    const textbox = textboxes.nth(index);
    if (await textbox.isVisible()) {
      await textbox.fill(value);
      return;
    }
  }
  throw new Error(`No visible textbox named ${String(name)}`);
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

function countLogs(state, facilityId, status) {
  return (state.outreachLogs ?? []).filter((log) => log.facilityId === facilityId && log.status === status).length;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.routeStops), "hydrated defaults");

  await clickVisible(page, "Import route");
  await page.locator("textarea").first().fill(routeText);
  await clickVisible(page, "Parse Schedule");
  await page.getByTestId("import-review-card-1").waitFor();
  await page.getByText("Matched existing facility").first().waitFor();
  assert.equal(await page.getByText("Resolve uncertain rows before confirming.").count(), 0);
  await clickVisible(page, /Confirm 3 Stops/);
  await page.getByRole("heading", { name: "Tomorrow's Route" }).first().waitFor();

  let state = await waitForStoredState(
    page,
    (nextState) => (nextState.routeStops ?? []).length === 3,
    "imported three route stops",
  );
  assert.deepEqual(
    state.routeStops.map((stop) => stop.facilityId),
    ["memorial-snf", "park-manor-westchase", "lakeside-rehab"],
  );

  await clickVisibleTab(page, "Outreach");
  const textFirst = await firstVisible(page.getByTestId("text-first-card"), "Text First card");
  await textFirst.getByRole("heading", { name: "Encompass Rehab Westchase" }).waitFor();
  await textFirst.getByText("+3 min detour").waitFor();
  assert.equal(await textFirst.getByText("Needs real phone").count(), 1);
  await textFirst.getByText("Same-day friendly").waitFor();
  await textFirst.getByText("High volume").waitFor();
  assert.equal(await textFirst.getByText("Memorial SNF").count(), 0);

  const blockedText = textFirst.getByRole("button", { name: "Enter real phone first" });
  await blockedText.waitFor();
  assert.equal(await blockedText.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Mark texted" }).count(), 0);

  await page.getByLabel("Phone for Lisa").first().fill("713-867-5309");
  await waitForStoredState(
    page,
    (nextState) =>
      nextState.facilities
        .find((facility) => facility.id === "encompass-westchase")
        ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "713-867-5309",
    "edited phone persisted",
  );

  await clickVisible(textFirst, "Text");
  await page.getByRole("heading", { name: "Safe outreach template" }).first().waitFor();
  await assertApprovedTemplate(page);
  await page
    .getByText("Template copied. Open Messages on your phone, then mark this facility texted.")
    .first()
    .waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), approvedMessage);
  state = await storedState(page);
  const beforeTextedCount = countLogs(state, "encompass-westchase", "texted");
  await clickVisible(page, "Mark texted");
  await waitForStoredState(
    page,
    (nextState) => countLogs(nextState, "encompass-westchase", "texted") === beforeTextedCount + 1,
    "manual texted confirmation",
  );

  await clickVisible(page, "Possible add-on");
  await waitForStoredState(
    page,
    (nextState) => countLogs(nextState, "encompass-westchase", "possible_add_on") >= 1,
    "possible add-on reply",
  );

  await clickVisible(page, "Add to route");
  await page.getByRole("heading", { name: "Added to tentative route" }).waitFor();
  await waitForStoredState(
    page,
    (nextState) =>
      (nextState.routeStops ?? []).some(
        (stop) => stop.facilityId === "encompass-westchase" && stop.status === "tentative",
      ),
    "tentative stop added",
  );

  await clickVisible(page, "Remove tentative stop");
  await waitForStoredState(
    page,
    (nextState) => !(nextState.routeStops ?? []).some((stop) => stop.facilityId === "encompass-westchase"),
    "tentative stop removed",
  );

  await page.evaluate(() => {
    window.__dogfoodOpenedUrls = [];
    window.open = (url) => {
      window.__dogfoodOpenedUrls.push(String(url));
      return null;
    };
  });
  await clickVisible(page, "Open in Google Maps");
  const openedUrls = await page.evaluate(() => window.__dogfoodOpenedUrls ?? []);
  assert.equal(openedUrls.length, 1);
  assert.match(openedUrls[0], /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.match(openedUrls[0], /origin=29\.7728%2C-95\.5585/);
  assert.match(openedUrls[0], /destination=29\.7066%2C-95\.5492/);
  assert.match(openedUrls[0], /waypoints=29\.7299%2C-95\.5887/);

  await (await firstVisible(page.locator("summary").filter({ hasText: "Demo tools" }), "demo tools")).click();
  for (const label of [
    "Import tomorrow's route",
    "Review text candidates",
    "Log every reply",
    "Add tentative stop",
    "Remove tentative stop if needed",
    "Open Google Maps",
    "Capture friction",
  ]) {
    await checkVisible(page, label);
  }
  await fillVisibleTextbox(page, "Dogfood notes", "PHI-free dogfood route passed automated workflow coverage.");
  await waitForStoredState(
    page,
    (nextState) => nextState.dogfoodNotes === "PHI-free dogfood route passed automated workflow coverage.",
    "dogfood notes saved",
  );

  await page.reload({ waitUntil: "networkidle" });
  state = await waitForStoredState(
    page,
    (nextState) =>
      (nextState.routeStops ?? []).map((stop) => stop.facilityId).join(",") ===
        "memorial-snf,park-manor-westchase,lakeside-rehab" &&
      countLogs(nextState, "encompass-westchase", "texted") === beforeTextedCount + 1 &&
      countLogs(nextState, "encompass-westchase", "possible_add_on") >= 1 &&
      nextState.facilities
        .find((facility) => facility.id === "encompass-westchase")
        ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "713-867-5309" &&
      nextState.dogfoodNotes === "PHI-free dogfood route passed automated workflow coverage." &&
      Object.values(nextState.dogfoodChecked ?? {}).every(Boolean),
    "dogfood state restored after reload",
  );
  assert.equal(Object.keys(state.dogfoodChecked ?? {}).length, 7, "all checklist items should persist");

  await page.getByRole("heading", { name: "Tomorrow's Route" }).first().waitFor();
  await page.getByText("Memorial SNF").first().waitFor();
  await (await firstVisible(page.locator("summary").filter({ hasText: "Demo tools" }), "demo tools")).click();
  for (const label of [
    "Import tomorrow's route",
    "Review text candidates",
    "Log every reply",
    "Add tentative stop",
    "Remove tentative stop if needed",
    "Open Google Maps",
    "Capture friction",
  ]) {
    await assertVisibleChecked(page, label);
  }
  const notes = page.getByRole("textbox", { name: "Dogfood notes" });
  const notesCount = await notes.count();
  let foundPersistedNotes = false;
  for (let index = 0; index < notesCount; index += 1) {
    const note = notes.nth(index);
    if ((await note.isVisible()) && (await note.inputValue()) === "PHI-free dogfood route passed automated workflow coverage.") {
      foundPersistedNotes = true;
      break;
    }
  }
  assert.equal(foundPersistedNotes, true, "dogfood notes should stay visible after reload");

  await fillVisibleTextbox(page, "Dogfood notes", "Patient DOB 1/2/1940 was pasted by mistake.");
  await page
    .getByText("Dogfood notes must stay workflow-only. Remove patient names, clinical details, DOBs, MRNs, or diagnoses before saving.")
    .first()
    .waitFor();
  state = await storedState(page);
  assert.equal(
    state.dogfoodNotes,
    "PHI-free dogfood route passed automated workflow coverage.",
    "PHI-like dogfood notes should not overwrite the safe persisted note",
  );

  await page.evaluate(
    ({ key, unsafeNote }) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error("No stored dogfood state to seed");
      window.localStorage.setItem(key, JSON.stringify({ ...JSON.parse(raw), dogfoodNotes: unsafeNote }));
    },
    { key: storageKey, unsafeNote: "John Smith appeared in the pasted schedule." },
  );
  await page.reload({ waitUntil: "networkidle" });
  await (await firstVisible(page.locator("summary").filter({ hasText: "Demo tools" }), "demo tools")).click();
  await firstVisible(
    page.getByText("Dogfood notes must stay workflow-only. Remove patient names, clinical details, DOBs, MRNs, or diagnoses before saving."),
    "legacy PHI-like dogfood note warning",
  );
  state = await waitForStoredState(
    page,
    (nextState) => nextState.dogfoodNotes === "",
    "legacy PHI-like dogfood note cleared during hydration",
  );
  assert.equal(state.dogfoodNotes, "", "legacy PHI-like dogfood notes should be removed from persisted state");

  await clickVisibleTab(page, "Facilities");
  await page.getByPlaceholder("Search by name or address").fill("Northwest");
  await page.getByRole("heading", { name: "Northwest Care Center" }).waitFor();
  await clickVisible(page, "Review fit");
  await page.getByText("Do not contact").first().waitFor();
  await clickVisible(page, "Clear do not contact");
  state = await waitForStoredState(
    page,
    (nextState) => {
      const facility = nextState.facilities.find((item) => item.id === "inactive-northwest");
      const latest = nextState.outreachLogs.find((log) => log.facilityId === "inactive-northwest");
      return facility?.doNotContact === false && latest?.status === "do_not_contact_cleared";
    },
    "do-not-contact cleared",
  );
  assert.equal(state.facilities.find((item) => item.id === "inactive-northwest")?.doNotContact, false);
  await page.getByText("Not contacted").first().waitFor();

  console.log("Dogfood route browser validation passed.");
} finally {
  await browser.close();
}

async function assertApprovedTemplate(page) {
  const textareas = page.getByRole("textbox");
  const count = await textareas.count();
  for (let index = 0; index < count; index += 1) {
    const textarea = textareas.nth(index);
    if ((await textarea.isVisible()) && (await textarea.inputValue()) === approvedMessage) return;
  }
  throw new Error("Approved PHI-safe outreach template was not visible.");
}
