import { describe, expect, it } from "vitest";
import { REMINDER_MESSAGE, MidnightReminder, dayKey, decide, isWithinWindow } from "./midnight.js";

/** Build a local Date for a given hour/minute on an arbitrary fixed day. */
function at(hour: number, minute = 0, day = 15): Date {
	// Month is 0-indexed; Sep 15 2026 local time.
	return new Date(2026, 8, day, hour, minute, 0, 0);
}

describe("isWithinWindow", () => {
	it("is false at 23:59 the previous day", () => {
		expect(isWithinWindow(at(23, 59))).toBe(false);
	});

	it("is false exactly at 06:00", () => {
		expect(isWithinWindow(at(6, 0))).toBe(false);
	});

	it("is false just before midnight at 23:00", () => {
		expect(isWithinWindow(at(23, 0))).toBe(false);
	});

	it("is true exactly at 00:00", () => {
		expect(isWithinWindow(at(0, 0))).toBe(true);
	});

	it("is true during the window", () => {
		expect(isWithinWindow(at(3, 30))).toBe(true);
	});

	it("is true at the last minute 05:59", () => {
		expect(isWithinWindow(at(5, 59))).toBe(true);
	});
});

describe("dayKey", () => {
	it("formats a local zero-padded calendar day", () => {
		expect(dayKey(new Date(2026, 0, 5, 13, 0, 0))).toBe("2026-01-05");
	});

	it("uses the local day, not UTC", () => {
		const d = new Date(2026, 8, 15, 1, 0, 0);
		expect(dayKey(d)).toBe("2026-09-15");
	});
});

describe("decide", () => {
	it("notifies inside the window when never notified", () => {
		const d = decide(at(0, 30), undefined);
		expect(d.notify).toBe(true);
		expect(d.dayKey).toBe("2026-09-15");
		expect(d.keepChecking).toBe(false);
	});

	it("does not notify once already notified today", () => {
		const d = decide(at(2, 0), "2026-09-15");
		expect(d.notify).toBe(false);
		expect(d.keepChecking).toBe(false);
	});

	it("does not notify outside the window", () => {
		expect(decide(at(23, 59), undefined).notify).toBe(false);
		expect(decide(at(6, 0), undefined).notify).toBe(false);
	});

	it("keeps checking outside the window so it can fire after midnight", () => {
		expect(decide(at(23, 59), undefined).keepChecking).toBe(true);
	});

	it("notifies again on a new day even if notified yesterday", () => {
		const d = decide(at(0, 10, 16), "2026-09-15");
		expect(d.notify).toBe(true);
		expect(d.dayKey).toBe("2026-09-16");
	});
});

describe("MidnightReminder", () => {
	it("exposes the exact reminder message", () => {
		expect(REMINDER_MESSAGE).toBe("It is after midnight. Consider saving your work and getting some sleep.");
	});

	it("notifies once, then suppresses repeats and signals stop", () => {
		const r = new MidnightReminder();
		const first = r.check(at(0, 5));
		expect(first.notify).toBe(true);
		expect(r.lastNotifiedDay).toBe("2026-09-15");

		const second = r.check(at(1, 5));
		expect(second.notify).toBe(false);
		expect(second.keepChecking).toBe(false);
	});

	it("starts from a persisted day key", () => {
		const r = new MidnightReminder("2026-09-15");
		expect(r.check(at(2, 0)).notify).toBe(false);
	});

	it("can notify again the next day", () => {
		const r = new MidnightReminder("2026-09-15");
		const d = r.check(at(0, 5, 16));
		expect(d.notify).toBe(true);
		expect(r.lastNotifiedDay).toBe("2026-09-16");
	});
});
