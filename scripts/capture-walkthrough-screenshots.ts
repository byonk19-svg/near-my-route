import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";

const storageKey = "near-my-route-state-v1";
const defaultPort = "3018";
let baseUrl = process.env.SCREENSHOT_BASE_URL ?? `http://localhost:${defaultPort}`;
type Viewport = { width: number; height: number };
const desktopViewport: Viewport = { width: 1440, height: 1000 };
const mobileViewport: Viewport = { width: 390, height: 844 };
const screenshotRoot = path.join(process.cwd(), "output", "screenshots");
const latestDir = path.join(screenshotRoot, "latest");
const shouldArchive = !process.argv.includes("--no-archive") && process.env.SCREENSHOTS_ARCHIVE !== "0";
const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(screenshotRoot, "runs", runTimestamp);

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

MAP LINK
${sourceMapLink}`;

const pdfTableText = `HOUSTON VAN 1
MEMORIAL SNF
12620 MEMORIAL DR, HOUSTON, TX
HOME HEALTH
100 EXAMPLE ST, HOUSTON, TX
WESTCHASE OUTPOST
999 ALIAS TEST RD, HOUSTON, TX
PARK MANOR WESTCHASE
11910 RICHMOND AVENUE, HOUSTON, TX`;

type ManifestEntry = {
  filename: string;
  route: string;
  purpose: string;
  timestamp: string;
  viewport: Viewport;
  notes: string[];
};

const manifest: {
  generatedAt: string;
  baseUrl: string;
  latestDir: string;
  archivedDir?: string;
  phiSafety: string;
  screenshots: ManifestEntry[];
} = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  latestDir,
  archivedDir: shouldArchive ? runDir : undefined,
  phiSafety:
    "Synthetic/demo workflow only. Screenshots use facility-level labels, placeholder/synthetic contacts, and Example addresses; no patient details are supplied.",
  screenshots: [],
};

async function main() {
  const server = await ensureLocalServer();
  manifest.baseUrl = baseUrl;
  console.log(`Using screenshot app URL: ${baseUrl}`);

  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    await runWalkthrough(browser, {
      viewport: desktopViewport,
      outputDir: latestDir,
      manifestPrefix: "",
      deviceLabel: "Desktop",
    });
    await runWalkthrough(browser, {
      viewport: mobileViewport,
      outputDir: path.join(latestDir, "mobile"),
      manifestPrefix: "mobile/",
      deviceLabel: "Mobile",
      isMobile: true,
    });

    await writeManifest(latestDir);
    if (shouldArchive) {
      await rm(runDir, { recursive: true, force: true });
      await mkdir(path.dirname(runDir), { recursive: true });
      await cp(latestDir, runDir, { recursive: true });
    }

    console.log(`Screenshot walkthrough complete: ${latestDir}`);
    if (shouldArchive) console.log(`Archived run: ${runDir}`);
  } finally {
    await browser.close();
    if (server.started) {
      stopServerProcess(server.process);
    }
  }
}

async function runWalkthrough(
  browser: Browser,
  {
    viewport,
    outputDir,
    manifestPrefix,
    deviceLabel,
    isMobile = false,
  }: {
    viewport: Viewport;
    outputDir: string;
    manifestPrefix: string;
    deviceLabel: string;
    isMobile?: boolean;
  },
) {
  await mkdir(outputDir, { recursive: true });
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();
  try {
    await resetDemoState(page);
    await page.getByRole("heading", { name: "Tomorrow's Route" }).first().waitFor();
    await capture(page, outputDir, manifestPrefix, "01-home-route.png", "Near My Route", `${deviceLabel} home route dashboard with initial demo route and add-on map.`, [
      "Initial LocalStorage was cleared before loading demo state.",
      "Demo facilities use facility-level labels only.",
    ]);

    await clickVisible(page, "Import Schedule");
    await page.getByRole("heading", { name: "Import Schedule" }).waitFor();
    await capture(page, outputDir, manifestPrefix, "02-import-entry.png", "Import Schedule", `${deviceLabel} import mode entry before parsing any pasted route data.`, [
      "Default sample schedule remains synthetic and facility-level.",
    ]);

    await clickVisible(page, "Van Packet");
    await page.getByLabel("Email body and map link").fill(packetText);
    await page.getByLabel("PDF table text").fill(pdfTableText);
    await capture(page, outputDir, manifestPrefix, "03-van-packet-paste.png", "Import Schedule / Van Packet", `${deviceLabel} Van Packet paste state with synthetic packet text.`, [
      "Packet text uses Example addresses and contains no patient names, DOBs, MRNs, referring MDs, emails, or real phone numbers.",
      "HOME HEALTH appears only as a private-stop hint in synthetic PDF table text.",
    ]);

    await clickVisible(page, "Parse Van Packet");
    const summary = page.getByTestId("van-packet-summary");
    await summary.getByText("Northwest Van").waitFor();
    await summary.getByText("Map stops: 6").waitFor();
    await summary.getByText("Private stop hints: 1").waitFor();
    await summary.getByText("Route start/end: 2 skipped").waitFor();
    await page.getByTestId("import-review-card-2").getByRole("heading", { name: "Private route stop 3" }).waitFor();
    assert.equal(await page.getByLabel("Email body and map link").inputValue(), "");
    assert.equal(await page.getByLabel("PDF table text").inputValue(), "");
    await capture(page, outputDir, manifestPrefix, "04-van-packet-review.png", "Import Schedule / Van Packet", `${deviceLabel} Van Packet review state after parsing and clearing pasted text.`, [
      "Review rows show safe facility labels only.",
      "Private stop is represented as Private route stop 3, not as a facility contact or patient label.",
    ]);

    const aliasCard = await firstVisible(page.getByTestId("import-review-card-3"), "alias review card");
    await aliasCard.getByRole("heading", { name: "999 Alias Test Rd" }).waitFor();
    await capture(page, outputDir, manifestPrefix, "05-safe-facility-labels.png", "Import Schedule / Van Packet", `${deviceLabel} review rows showing safe facility labels and alias review.`, [
      "Alias candidate is a synthetic facility-style label.",
      "The private route stop stays separate from existing facilities.",
    ]);
    const existingFacilitySelect = await firstVisible(aliasCard.locator("select"), "alias facility select");
    await existingFacilitySelect.selectOption("park-manor-westchase");
    const rememberAlias = await firstVisible(aliasCard.locator('input[type="checkbox"]'), "remember alias checkbox");
    await rememberAlias.check();
    await clickVisible(page, "Confirm 4 Stops");
    await waitForStoredState(
      page,
      (state) =>
        state.routeStops?.length === 4 &&
        state.routeStops?.some(
          (stop) => stop.source === "private_route_stop" && stop.privateLocation?.name === "Private route stop 3",
        ),
      "van packet route with private route stop",
    );
    const blockedMapsButton = await firstVisible(
      page.getByRole("button", { name: "Confirm locations for Maps" }),
      "blocked Maps handoff",
    );
    assert.equal(await blockedMapsButton.isDisabled(), true);
    await page.getByText("No route add-ons match these filters").first().waitFor();
    await capture(page, outputDir, manifestPrefix, "06-private-route-stop-protection.png", "Near My Route", `${deviceLabel} private route stop protection after import.`, [
      "Generated Maps handoff is blocked until the private route stop location is confirmed.",
      "Add-on ranking is suppressed while an on-route location is unconfirmed.",
    ]);

    const queue = page.getByTestId("location-confirmation-queue");
    await queue.scrollIntoViewIfNeeded();
    await queue.getByText("Private route stop 3").waitFor();
    await capture(page, outputDir, manifestPrefix, "07-location-review.png", "Near My Route / Location review", `${deviceLabel} location review state for an imported private route stop.`, [
      "The private stop is marked On route and requires explicit coordinate confirmation.",
      "Coordinates shown before confirmation are synthetic placeholders.",
    ]);

    await queue.getByLabel("Latitude for Private route stop 3").fill("29.7066");
    await queue.getByLabel("Longitude for Private route stop 3").fill("-95.5492");
    await clickVisible(queue, "Confirm Location");
    await waitForStoredState(
      page,
      (state) =>
        state.routeStops?.some(
          (stop) =>
            stop.source === "private_route_stop" &&
            stop.privateLocation?.name === "Private route stop 3" &&
            stop.privateLocation?.locationStatus === "confirmed",
        ),
      "confirmed private route stop",
    );
    await page.locator(".leaflet-container").first().waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Open in Google Maps" }).first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Confirm locations for Maps" }).count(), 0);
    await capture(page, outputDir, manifestPrefix, "08-confirmed-route-map.png", "Near My Route", `${deviceLabel} route and map state after locations are confirmed enough for ranking.`, [
      "The route can now display add-on opportunities and generated Maps handoff controls.",
      "Route stop data remains facility-level plus synthetic private-stop coordinates.",
    ]);

    await clickVisible(page, "Outreach");
    const textFirst = await firstVisible(page.getByTestId("text-first-card"), "Text First card");
    await textFirst.getByRole("heading", { name: "Encompass Rehab Westchase" }).waitFor();
    await textFirst.getByText("Needs real phone").waitFor();
    await capture(page, outputDir, manifestPrefix, "09-outreach-text-first.png", "Outreach", `${deviceLabel} Text First queue state with placeholder-phone protection.`, [
      "Demo 555 contact data is shown as not ready and cannot open Messages.",
    ]);

    await clickVisible(textFirst, "Text");
    await page.getByRole("heading", { name: "Safe outreach template" }).first().waitFor();
    await firstVisible(
      page.getByText("This contact still has a placeholder 555 number. Edit the phone number before opening Messages."),
      "placeholder phone warning",
    );
    assert.equal(await visibleCount(page.getByRole("button", { name: "Mark texted" })), 0);
    await capture(page, outputDir, manifestPrefix, "10-placeholder-phone-protection.png", "Near My Route / Facility review", `${deviceLabel} safe outreach template blocked by placeholder phone.`, [
      "The app does not log Texted today until the user has a non-placeholder phone and explicitly marks texted.",
      "The visible template is the approved PHI-safe facility-level message.",
    ]);

    const lisaPhone = await firstVisible(page.getByLabel("Phone for Lisa"), "Lisa phone field");
    await lisaPhone.fill("000-000-0101");
    await waitForStoredState(
      page,
      (state) =>
        state.facilities
          ?.find((facility) => facility.id === "encompass-westchase")
          ?.contacts.find((contact) => contact.id === "c-encompass-lisa")?.phone === "000-000-0101",
      "synthetic non-placeholder phone saved",
    );
    await clickVisible(page, "Open Messages");
    await firstVisible(
      page.getByText("Template copied. Open Messages on your phone, then mark this facility texted."),
      "Messages fallback copied warning",
    );
    await clickVisible(page, "Mark texted");
    await clickVisible(page, "Possible add-on");
    await page.getByRole("button", { name: "Add to route" }).first().waitFor();
    await capture(page, outputDir, manifestPrefix, "11-possible-addon.png", "Near My Route / Facility review", `${deviceLabel} possible add-on state after explicit Texted and response logging.`, [
      "The phone value is synthetic and invalid for real-world assignment.",
      "This state is created only inside the local browser context for walkthrough screenshots.",
    ]);

    await clickVisible(page, "Add to route");
    await page.getByRole("heading", { name: "Added tentatively" }).waitFor();
    await capture(page, outputDir, manifestPrefix, "12-tentative-addon.png", "Near My Route / Tentative add-on", `${deviceLabel} tentative add-on confirmation with updated route order.`, [
      "The add-on remains tentative and reversible.",
      "No generated screenshots are intended for git tracking.",
    ]);
  } finally {
    await context.close();
  }
}

async function capture(page: Page, outputDir: string, manifestPrefix: string, filename: string, route: string, purpose: string, notes: string[]) {
  await settle(page);
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: true, animations: "disabled" });
  manifest.screenshots.push({
    filename: `${manifestPrefix}${filename}`,
    route,
    purpose,
    timestamp: new Date().toISOString(),
    viewport: page.viewportSize() ?? { width: 0, height: 0 },
    notes,
  });
}

async function writeManifest(directory: string) {
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function resetDemoState(page: Page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForStoredState(page, (state) => Array.isArray(state.facilities), "hydrated demo defaults");
}

async function clickVisible(pageOrLocator: Page | Locator, name: string | RegExp) {
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

async function firstVisible(locator: Locator, label: string) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) return item;
  }
  throw new Error(`No visible locator found: ${label}`);
}

async function visibleCount(locator: Locator) {
  let visible = 0;
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) visible += 1;
  }
  return visible;
}

type StoredState = {
  facilities?: Array<{
    id: string;
    contacts: Array<{ id: string; phone?: string }>;
  }>;
  routeStops?: Array<{
    source?: string;
    privateLocation?: { name?: string; locationStatus?: string };
  }>;
};

async function storedState(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredState) : undefined;
  }, storageKey);
}

async function waitForStoredState(page: Page, predicate: (state: StoredState) => unknown, label: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await storedState(page);
    if (state && predicate(state)) return state;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for stored state: ${label}`);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function ensureLocalServer(): Promise<
  | { started: false }
  | {
      started: true;
      process: ChildProcess;
    }
> {
  const hasExplicitBaseUrl = Boolean(process.env.SCREENSHOT_BASE_URL);
  if (hasExplicitBaseUrl && (await isReachable(baseUrl))) return { started: false };

  if (!hasExplicitBaseUrl) {
    const requestedPort = Number(new URL(baseUrl).port || defaultPort);
    const availablePort = await findAvailablePort(requestedPort);
    baseUrl = `http://localhost:${availablePort}`;
  }

  const url = new URL(baseUrl);
  const port = url.port || defaultPort;
  const isWindows = process.platform === "win32";
  const command = isWindows ? "cmd.exe" : "npm";
  const args = isWindows ? ["/d", "/s", "/c", `npm run dev -- --port ${port}`] : ["run", "dev", "--", "--port", port];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dev server exited before becoming reachable.\n${logs.join("").slice(-4_000)}`);
    }
    if (await isReachable(baseUrl)) return { started: true, process: child };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  child.kill();
  throw new Error(`Timed out waiting for dev server at ${baseUrl}.\n${logs.join("").slice(-4_000)}`);
}

async function isReachable(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findAvailablePort(startPort: number) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No available local port found from ${startPort} to ${startPort + 19}.`);
}

async function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

function stopServerProcess(processToStop: ChildProcess) {
  if (process.platform === "win32" && processToStop.pid) {
    spawnSync("taskkill", ["/PID", String(processToStop.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  processToStop.kill();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
