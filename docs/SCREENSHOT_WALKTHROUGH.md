# Screenshot Walkthrough

Use the screenshot walkthrough when you want a fresh visual review of the current local demo app state. It is developer-only and runs against a local Next dev server with browser LocalStorage reset in the Playwright context.

## Command

```bash
npm run screenshots:walkthrough
```

By default the script starts this checkout's own `next dev` server on `3018`, or the next free local port if `3018` is occupied, and stops that server when finished. The actual URL is recorded in `manifest.json`. To target an already running local app:

```bash
SCREENSHOT_BASE_URL=http://localhost:3000 npm run screenshots:walkthrough
```

The workflow refreshes:

```text
output/screenshots/latest
```

Desktop screenshots are written directly in that folder. Mobile screenshots are written under:

```text
output/screenshots/latest/mobile
```

It also archives the same run under:

```text
output/screenshots/runs/<timestamp>
```

Pass `--no-archive` or set `SCREENSHOTS_ARCHIVE=0` to keep only `latest`:

```bash
npm run screenshots:walkthrough -- --no-archive
```

## What It Captures

The walkthrough captures PHI-safe synthetic states for:

- Home route dashboard
- Import Schedule entry
- Van Packet paste state
- Van Packet review state
- Safe facility-label review rows
- Private route stop protection
- Location review
- Confirmed route/map state
- Outreach Text First state
- Placeholder-phone protection
- Possible add-on state
- Tentative add-on confirmation

Each run writes `manifest.json` beside the screenshots. The manifest lists the filename, route/page, purpose, timestamp, viewport, and test-state notes for each desktop and mobile image.

## Sharing With AI Or Review

Share the contents of `output/screenshots/latest` and point reviewers to `output/screenshots/latest/manifest.json` first. The manifest explains which app state each image represents and calls out synthetic state setup.

## PHI Safety

Do not paste real schedules, patient names, clinical details, DOBs, MRNs, referring MDs, real phone numbers, real emails, private/home-health addresses, or facility-contact data into this workflow. The checked-in script supplies only synthetic/demo data and reserved-looking test contact state. Generated screenshots are ignored by git.
