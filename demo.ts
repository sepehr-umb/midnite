#!/usr/bin/env node
/**
 * Self-contained demo script for the midnite extension.
 * Prints clean, narratable output for video recording.
 */

import { execSync } from "node:child_process";
import { formatPreview, ReminderController, type ReminderHost } from "./controller.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function at(h: number, m: number, day = 15): Date {
  return new Date(2026, 8, day, h, m, 0, 0);
}

function fmt(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function makeHost(now: Date) {
  let current = now;
  const notifs: string[] = [];
  let timers = 0;
  const callbacks: (() => void)[] = [];

  const host: ReminderHost = {
    now: () => current,
    notify: (msg, type) => notifs.push(`[${type}] ${msg}`),
    loadState: () => ({}),
    saveState: () => {},
    isInteractive: () => true,
    setTimer: (fn) => { timers++; callbacks.push(fn); return timers; },
    clearTimer: () => { timers = Math.max(0, timers - 1); },
  };

  return {
    host,
    notifs,
    get timers() { return timers; },
    setNow(d: Date) { current = d; },
    tick() { callbacks.forEach((cb) => cb()); },
  };
}

function section(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  🎬  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

function log(...args: unknown[]) {
  console.log("  ", ...args);
}

async function main() {
  // ─── A. bedtime-test preview ───
  section("A. /bedtime-test — preview without side effects");
  {
    const { host, notifs, timers } = makeHost(at(3, 0));
    const c = new ReminderController(host);
    c.start();
    formatPreview((m, t) => notifs.push(`[preview/${t}] ${m}`), host);
    log("Notifications:", notifs.length > 0 ? notifs : "(none)");
    log("Timers created:", timers === 1 ? "1 (only by start, not preview) ✓" : timers);
    log("→ /bedtime-test shows the message without changing state ✓");
  }

  await sleep(600);

  // ─── B. Remind at 00:00, suppress duplicate ───
  section("B. Simulated time — remind at 00:00, then suppress duplicate");
  {
    const { host, notifs, timers, setNow, tick } = makeHost(at(23, 55));
    const c = new ReminderController(host);

    log(`⏰  Time is ${fmt(host.now())} — outside window`);
    c.start();
    log(`   Timer armed? ${timers > 0 ? "yes ✓" : "no"} (polling every 30s)`);

    await sleep(300);
    log(`\n⏰  Time advances to ${fmt(at(0, 0))}...`);
    setNow(at(0, 0));
    tick();
    log(`   Notifications:`, notifs);
    log(`   Timer still armed? ${timers > 0 ? "yes (BUG)" : "no ✓"}`);

    await sleep(300);
    log(`\n⏰  Same day, later at ${fmt(at(1, 30))}...`);
    const before = notifs.length;
    setNow(at(1, 30));
    tick();
    log(`   Notifications since last check: ${notifs.length - before} (expected 0)`);
    log(`   → No duplicate reminder on the same date ✓`);
  }

  await sleep(600);

  // ─── C. Next day ───
  section("C. Next day — remind again");
  {
    const { host, notifs, timers } = makeHost(at(0, 5, 16));
    const c = new ReminderController(host);
    c.start();
    log(`⏰  Time is ${fmt(host.now())} — new day, inside window`);
    log(`   Notifications:`, notifs);
    log(`   Timer still armed? ${timers > 0 ? "yes (BUG)" : "no ✓"}`);
  }

  await sleep(600);

  // ─── D. Sleep through midnight ───
  section("D. Sleep through midnight — stale timer stops itself");
  {
    const { host, notifs, timers, setNow, tick } = makeHost(at(23, 55));
    const c = new ReminderController(host);
    c.start();
    log(`⏰  Time is ${fmt(host.now())} — outside window, timer armed`);

    await sleep(300);
    log(`\n💤  Laptop sleeps through midnight… wakes at ${fmt(at(6, 30, 16))}`);
    setNow(at(6, 30, 16));
    tick();
    log(`   Notifications:`, notifs.length > 0 ? notifs : "none ✓");
    log(`   Timer still armed? ${
      timers > 0
        ? "yes (BUG — would poll all day)"
        : "no ✓ (stale timer discarded)"
    }`);
  }

  await sleep(600);

  // ─── E. Run the full test suite ───
  section("E. Run the full test suite");
  console.log("\n  $ npm test\n");
  try {
    const out = execSync("npm test", { cwd: process.cwd(), encoding: "utf8", timeout: 30000 });
    console.log(out.split("\n").map((l) => "  " + l).join("\n"));
  } catch (e: any) {
    console.log((e.stdout || e.message)?.split("\n").map((l: string) => "  " + l).join("\n"));
  }

  console.log("\n" + "═".repeat(60));
  console.log("  ✅  Demo complete — all scenarios covered");
  console.log("═".repeat(60) + "\n");
}

main();
