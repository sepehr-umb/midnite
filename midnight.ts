/**
 * Pure, dependency-free core logic for the Midnight reminder extension.
 *
 * Everything here is deliberately free of Pi imports so it can be unit
 * tested in isolation and reasoned about without a live agent runtime.
 */

/** Inclusive start hour (00:00). */
export const WINDOW_START_HOUR = 0;
/** Inclusive end hour (05:59); the window closes at 06:00. */
export const WINDOW_END_HOUR = 6;

/** The exact reminder text shown to the user. */
export const REMINDER_MESSAGE = "It is after midnight. Consider saving your work and getting some sleep.";

/**
 * Returns true only while the local wall-clock time is between 00:00
 * (inclusive) and 05:59:59.999 (inclusive). 23:59 and 06:00 return false.
 */
export function isWithinWindow(date: Date): boolean {
	const hour = date.getHours();
	return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/**
 * Local calendar day key, e.g. "2026-09-25".
 *
 * This is the *entire* memory footprint of the extension: knowing which local
 * day the user was last notified is sufficient to suppress re-notification
 * until the next day. No timestamps, durations, or counters are stored.
 */
export function dayKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export interface ReminderDecision {
	/** Whether the reminder should be shown right now. */
	notify: boolean;
	/** Local day key that should be persisted when `notify` is true. */
	dayKey: string;
	/** Whether the check interval should keep running. */
	keepChecking: boolean;
}

/**
 * Decide whether to remind at `now`, given the last day the user was notified.
 *
 * Rules:
 * - Notify only inside the 00:00–05:59 window.
 * - Notify at most once per local day (using the minimal day key).
 * - Once notified for the day, stop checking to conserve resources.
 */
/**
 * Stateful, session-scoped reminder controller.
 *
 * Holds only the last local day key the user was notified on. `check()` is
 * idempotent within a day and returns whether the polling loop should keep
 * running, so callers can stop their timers once the job is done.
 */
export class MidnightReminder {
	private lastDay: string | undefined;

	constructor(lastNotifiedDay?: string) {
		this.lastDay = lastNotifiedDay;
	}

	get lastNotifiedDay(): string | undefined {
		return this.lastDay;
	}

	/**
	 * Evaluate `now` and advance internal state. When a notification is due the
	 * current day is recorded immediately, guaranteeing at-most-once delivery
	 * even if the caller's notification mechanism is fire-and-forget.
	 */
	check(now: Date): ReminderDecision {
		const decision = decide(now, this.lastDay);
		if (decision.notify) {
			this.lastDay = decision.dayKey;
		}
		return decision;
	}
}

export function decide(now: Date, lastNotifiedDay: string | undefined): ReminderDecision {
	const today = dayKey(now);

	if (lastNotifiedDay === today) {
		return { notify: false, dayKey: today, keepChecking: false };
	}

	if (!isWithinWindow(now)) {
		// Outside the window: keep checking in case the window arrives later
		// (e.g. Pi starts before midnight and runs through it).
		return { notify: false, dayKey: today, keepChecking: true };
	}

	return { notify: true, dayKey: today, keepChecking: false };
}
