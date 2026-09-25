import { describe, expect, it, vi } from "vitest";
import {
	CHECK_INTERVAL_MS,
	ReminderController,
	type ReminderHost,
	type ReminderState,
	type TimerHandle,
	formatPreview,
} from "./controller.js";
import { REMINDER_MESSAGE } from "./midnight.js";

function at(hour: number, minute = 0, day = 15): Date {
	return new Date(2026, 8, day, hour, minute, 0, 0);
}

interface Harness {
	host: ReminderHost;
	notifications: Array<{ message: string; type: string }>;
	state: ReminderState;
	activeTimers: Set<TimerHandle>;
	scheduledDelays: number[];
	runAllTimers(): void;
	setNow(d: Date): void;
	setInteractive(v: boolean): void;
}

function makeHarness(initial: ReminderState = {}, interactive = true): Harness {
	let current = at(23, 59);
	let isInteractive = interactive;
	const notifications: Array<{ message: string; type: string }> = [];
	let state: ReminderState = { ...initial };
	const activeTimers = new Set<TimerHandle>();
	const scheduledDelays: number[] = [];
	const callbacks = new Map<TimerHandle, () => void>();
	let nextId = 1;

	const host: ReminderHost = {
		now: () => current,
		notify: (message, type) => notifications.push({ message, type }),
		loadState: () => ({ ...state }),
		saveState: (s) => {
			state = { ...s };
		},
		isInteractive: () => isInteractive,
		setTimer: (fn, ms) => {
			const handle: TimerHandle = { id: nextId++ };
			activeTimers.add(handle);
			callbacks.set(handle, fn);
			scheduledDelays.push(ms);
			return handle;
		},
		clearTimer: (handle) => {
			activeTimers.delete(handle);
			callbacks.delete(handle);
		},
	};

	return {
		host,
		notifications,
		get state() {
			return state;
		},
		activeTimers,
		scheduledDelays,
		runAllTimers: () => {
			for (const cb of [...callbacks.values()]) cb();
		},
		setNow: (d) => {
			current = d;
		},
		setInteractive: (v) => {
			isInteractive = v;
		},
	} as Harness;
}

describe("ReminderController.start (startup check + timer)", () => {
	it("notifies on startup inside the window, persists, and stops the timer", () => {
		const h = makeHarness();
		h.setNow(at(0, 10));
		const c = new ReminderController(h.host);
		c.start();
		expect(h.notifications).toEqual([{ message: REMINDER_MESSAGE, type: "warning" }]);
		expect(h.state.lastNotifiedDay).toBe("2026-09-15");
		expect(h.activeTimers.size).toBe(0);
	});

	it("arms a 30s check timer when outside the window", () => {
		const h = makeHarness();
		h.setNow(at(23, 59));
		const c = new ReminderController(h.host);
		c.start();
		expect(h.notifications).toHaveLength(0);
		expect(h.activeTimers.size).toBe(1);
		expect(h.scheduledDelays).toEqual([CHECK_INTERVAL_MS]);
	});

	it("fires after midnight via the interval check", () => {
		const h = makeHarness();
		h.setNow(at(23, 59));
		new ReminderController(h.host).start();
		h.setNow(at(0, 0));
		h.runAllTimers();
		expect(h.notifications).toHaveLength(1);
		expect(h.activeTimers.size).toBe(0);
	});

	it("does not notify twice on subsequent ticks within the same day", () => {
		const h = makeHarness();
		h.setNow(at(0, 0));
		new ReminderController(h.host).start();
		// New session same day, already persisted.
		new ReminderController(h.host).start();
		expect(h.notifications).toHaveLength(1);
	});

	it("skips notification and timer creation when noninteractive", () => {
		const h = makeHarness({}, false);
		h.setNow(at(1, 0));
		new ReminderController(h.host).start();
		expect(h.notifications).toHaveLength(0);
		expect(h.activeTimers.size).toBe(0);
		expect(h.state.lastNotifiedDay).toBeUndefined();
	});

	it("re-checks after a resume pause inside the window", () => {
		const h = makeHarness();
		h.setNow(at(3, 0));
		new ReminderController(h.host).start();
		expect(h.notifications).toHaveLength(1);
	});
});

describe("ReminderController lifecycle", () => {
	it("clears the timer on stop", () => {
		const h = makeHarness();
		h.setNow(at(23, 0));
		const c = new ReminderController(h.host);
		c.start();
		expect(h.activeTimers.size).toBe(1);
		c.stop();
		expect(h.activeTimers.size).toBe(0);
	});

	it("stop is idempotent", () => {
		const h = makeHarness();
		h.setNow(at(23, 0));
		const c = new ReminderController(h.host);
		c.start();
		c.stop();
		expect(() => c.stop()).not.toThrow();
		expect(h.activeTimers.size).toBe(0);
	});

	it("does not accumulate timers when restarted (reload/new session)", () => {
		const h = makeHarness();
		h.setNow(at(23, 0));
		const c = new ReminderController(h.host);
		c.start();
		c.start();
		c.start();
		expect(h.activeTimers.size).toBe(1);
	});
});

describe("preview", () => {
	it("previews the exact message without touching state", () => {
		const h = makeHarness();
		h.setNow(at(3, 0));
		new ReminderController(h.host).start();
		const before = { ...h.state };
		formatPreview((m, t) => h.notifications.push({ message: m, type: t }), h.host);
		expect(h.state).toEqual(before);
		expect(h.notifications.at(-1)).toEqual({ message: REMINDER_MESSAGE, type: "info" });
	});

	it("preview does not create or alter timers", () => {
		const h = makeHarness();
		h.setNow(at(23, 0));
		const c = new ReminderController(h.host);
		c.start();
		const timers = h.activeTimers.size;
		formatPreview(() => {}, h.host);
		expect(h.activeTimers.size).toBe(timers);
	});
});

describe("persistence is minimal", () => {
	it("saves only the day key", () => {
		const h = makeHarness();
		h.setNow(at(0, 30));
		const saveSpy = vi.spyOn(h.host, "saveState");
		new ReminderController(h.host).start();
		expect(saveSpy).toHaveBeenCalledTimes(1);
		expect(Object.keys(saveSpy.mock.calls[0][0])).toEqual(["lastNotifiedDay"]);
	});
});
