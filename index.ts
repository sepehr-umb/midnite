/**
 * Midnight reminder — a Pi extension.
 *
 * Between 00:00 and 05:59 local time, remind the user once per day to save
 * their work and get some sleep. The reminder is non-blocking: it never
 * prevents tool use, never terminates Pi, and never makes a model call.
 *
 * Design highlights:
 * - Startup performs an immediate check, so launching (or resuming) Pi inside
 *   the window reminds right away.
 * - A 30s interval covers the case where Pi is already open when midnight
 *   arrives.
 * - Once reminded for a local day, the day key is persisted to a tiny JSON
 *   file and the interval is stopped to conserve resources.
 * - `session_shutdown` always clears the timer, and `start()` clears any prior
 *   timer first, so reloads and session switches never accumulate timers.
 * - Non-interactive modes (`print`, `json`) never notify or create timers.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CHECK_INTERVAL_MS,
	ReminderController,
	type ReminderHost,
	type ReminderState,
	type TimerHandle,
	formatPreview,
} from "./controller.js";

/** Tiny persistent footprint: a single day key lives next to this file. */
const STATE_FILE =
	process.env.PI_MIDNITE_STATE_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "state.json");

function loadState(): ReminderState {
	try {
		const raw = readFileSync(STATE_FILE, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && typeof (parsed as ReminderState).lastNotifiedDay === "string") {
			return { lastNotifiedDay: (parsed as ReminderState).lastNotifiedDay };
		}
	} catch {
		// Missing/corrupt file simply means "never notified".
	}
	return {};
}

function saveState(state: ReminderState): void {
	try {
		mkdirSync(dirname(STATE_FILE), { recursive: true });
		writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
	} catch {
		// Persistence is best-effort; a failed write only risks a duplicate
		// reminder in a future session, never a crash.
	}
}

/** Adapt Pi's context to the injected {@link ReminderHost}. */
function makeHost(ctx: ExtensionContext): ReminderHost {
	return {
		now: () => new Date(),
		notify: (message, type) => ctx.ui.notify(message, type),
		loadState,
		saveState,
		isInteractive: () => ctx.hasUI,
		setTimer: (fn, ms): TimerHandle => {
			const handle = setInterval(fn, ms);
			// Do not keep the process alive purely for a reminder timer.
			handle.unref?.();
			return handle;
		},
		clearTimer: (handle) => {
			clearInterval(handle as NodeJS.Timeout);
		},
	};
}

export default function (pi: ExtensionAPI) {
	let controller: ReminderController | undefined;

	pi.on("session_start", (_event, ctx) => {
		// Guard terminal/UI-dependent behavior: no timers or notifications in
		// print/JSON modes.
		if (!ctx.hasUI) return;

		// A fresh controller per session avoids reusing an old session context;
		// start() also clears any timer the previous controller left behind.
		controller = new ReminderController(makeHost(ctx));
		controller.start();
	});

	pi.on("session_shutdown", () => {
		controller?.stop();
		controller = undefined;
	});

	pi.registerCommand("bedtime-test", {
		description: "Preview the midnight reminder without changing reminder state",
		handler: async (_args, ctx) => {
			formatPreview((message, type) => ctx.ui.notify(message, type), makeHost(ctx));
		},
	});
}

export { CHECK_INTERVAL_MS };
