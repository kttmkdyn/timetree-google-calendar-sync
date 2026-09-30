import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseIcsFile } from "./ics-parser.js";
import { GCalClient } from "./gcal-client.js";
import { SyncEngine } from "./sync-engine.js";

async function main(): Promise<void> {
  console.log("=== Family TimeTree → Google Calendar Sync ===\n");

  const email = requireEnv("TIMETREE_EMAIL");
  const password = requireEnv("TIMETREE_PASSWORD");
  const calendarCode = requireEnv("TIMETREE_CALENDAR_CODE");
  const credentialsPath = requireEnv("GOOGLE_APPLICATION_CREDENTIALS");

  const credentials = JSON.parse(
    readFileSync(credentialsPath, "utf-8")
  ) as Record<string, unknown>;

  console.log("Exporting Family calendar from TimeTree...");

  execSync(
    [
      "timetree-exporter",
      "-e", email,
      "-c", calendarCode,
      "--split-by-label",
      "-o", "/tmp/family",
    ].join(" "),
    {
      env: {
        ...process.env,
        TIMETREE_PASSWORD: password,
      },
      stdio: "inherit",
    }
  );

  const targets = [
    {
      label: "ともこ",
      icsPath: "/tmp/family_ともこ.ics",
      calendarId: requireEnv("FAMILY_TOMOKO_CALENDAR_ID"),
    },
    {
      label: "ふたり",
      icsPath: "/tmp/family_ふたり.ics",
      calendarId: requireEnv("FAMILY_FUTARI_CALENDAR_ID"),
    },
  ];

  for (const target of targets) {
    console.log(`\n=== Syncing ${target.label} ===`);

    if (!existsSync(target.icsPath)) {
      throw new Error(`ICS file not found: ${target.icsPath}`);
    }

    const events = parseIcsFile(target.icsPath);
    console.log(`  Found ${events.length} events.`);

    const gcal = new GCalClient(credentials, target.calendarId);

    console.log("Fetching synced events from Google Calendar...");
    const syncedEvents = await gcal.listSyncedEvents();

    const engine = new SyncEngine(gcal);
    const diff = engine.computeDiff(events, syncedEvents);

    console.log(
      `Diff: ${diff.toCreate.length} to create, ` +
      `${diff.toUpdate.length} to update, ` +
      `${diff.toDelete.length} to delete`
    );

    const result = await engine.applyDiff(diff);

    console.log(
      `Sync complete: created=${result.created}, ` +
      `updated=${result.updated}, ` +
      `deleted=${result.deleted}, ` +
      `errors=${result.errors}`
    );

    if (result.errors > 0) {
      process.exitCode = 1;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

main().catch((err) => {
  console.error("::error::Family sync failed:", err);
  process.exitCode = 1;
});
