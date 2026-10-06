/**
 * Testable wiring layer for the Midnight reminder.
 *
 * All side effects are injected through {@link ReminderHost} so the lifecycle
 * (startup check, 30s polling, persistence, shutdown cleanup, preview) can be
 * exercised under fake time without a live Pi runtime.
 */
import { dayKey, isWithinWindow, MidnightReminder, REMINDER_MESSAGE } from "./midnight.js";

/** Poll interval for the midnight check, in milliseconds. */
export const CHECK_INTERVAL_MS = 30_000;

/** The complete persisted state. Deliberately tiny: one day key. */
export interface ReminderState {
	lastNotifiedDay?: string;
}

/** Opaque timer handle. The host decides its concrete representation. */
export type TimerHandle = unknown;

/**
 * Environment the controller runs against. The real extension supplies Pi
 * bindings; tests supply deterministic fakes.
 */
export interface ReminderHost {
	now(): Date;
	notify(message: string, type: "info" | "warning" | "error"): void;
	loadState(): ReminderState;
	saveState(state: ReminderState): void;
	/** True only in interactive modes where a reminder makes sense. */
	isInteractive(): boolean;
	setTimer(fn: () => void, ms: number): TimerHandle;
	clearTimer(handle: TimerHandle): void;
}

type Notify = (message: string, type: "info" | "warning" | "error") => void;

/**
 * Preview the reminder message without mutating reminder state. Used by the
 * `/bedtime-test` command.
 */
export function formatPreview(notify: Notify, host: ReminderHost): void {
	void host;
	notify(REMINDER_MESSAGE, "info");
}

/**
 * Owns the reminder lifecycle for a single session.
 *
 * Construct one per `session_start` and call {@link stop} on
 * `session_shutdown`. `start()` is safe to call repeatedly: it tears down any
 * previous timer first, so reloads and session replacement never accumulate
 * timers or leak old session contexts.
 */
export class ReminderController {
	private timer: TimerHandle | undefined;
	private timerSetDay: string | undefined;
	private readonly reminder: MidnightReminder;

	constructor(private readonly host: ReminderHost) {
		this.reminder = new MidnightReminder(host.loadState().lastNotifiedDay);
	}

	/** Run the immediate startup check and, if still needed, poll every 30s. */
	start(): void {
		if (!this.host.isInteractive()) return;

		// Never accumulate timers across reloads / restarts.
		this.stop();
		this.tick();
	}

	/** Idempotently clear the polling timer. Safe to call on shutdown. */
	stop(): void {
		if (this.timer !== undefined) {
			this.host.clearTimer(this.timer);
			this.timer = undefined;
		}
		this.timerSetDay = undefined;
	}

	private tick(): void {
		const decision = this.reminder.check(this.host.now());

		if (decision.notify) {
			// Persist first so at-most-once holds even if notify is fire-and-forget.
			this.host.saveState({ lastNotifiedDay: decision.dayKey });
			this.host.notify(REMINDER_MESSAGE, "warning");
		}

		if (decision.keepChecking && this.timer === undefined) {
			this.timer = this.host.setTimer(() => {
				const setDay = this.timerSetDay;
				this.stop();

				// Guard against timers that fire after the laptop slept through
				// the midnight window. If the timer was set on a different day
				// and we're now outside the window, the window has passed.
				const now = this.host.now();
				const today = dayKey(now);
				if (setDay && setDay !== today && !isWithinWindow(now)) {
					return;
				}

				this.tick();
			}, CHECK_INTERVAL_MS);
			this.timerSetDay = dayKey(this.host.now());
		} else if (!decision.keepChecking) {
			// Already notified today or window closed for good: stop polling.
			this.stop();
		}
	}
}
