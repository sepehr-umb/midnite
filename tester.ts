/**
 * Independent tester for the Midnight reminder extension.
 *
 * This module is intentionally separate from the extension implementation.
 * It simulates dates, prior reminder state, and runtime conditions, then
 * exercises the real extension logic to verify guard rails and criteria.
 */

import {
	MidnightReminder,
	decide,
	dayKey,
	isWithinWindow,
	REMINDER_MESSAGE,
	type ReminderDecision,
} from "./midnight.js";
import {
	CHECK_INTERVAL_MS,
	ReminderController,
	formatPreview,
	type ReminderHost,
	type ReminderState,
	type TimerHandle,
} from "./controller.js";

export interface TestScenario {
	/** Human-readable name for the scenario. */
	name: string;
	/** Simulated local wall-clock time. */
	now: Date;
	/** Day key of the last notification (undefined = never reminded). */
	lastNotifiedDay?: string;
	/** Whether the session is interactive (UI mode). */
	interactive?: boolean;
	/** Expected outcome. */
	expected: {
		notify: boolean;
		keepChecking: boolean;
		message?: string;
	};
}

export interface ScenarioResult {
	scenario: TestScenario;
	passed: boolean;
	actual: ReminderDecision & { notifiedMessage?: string };
	errors: string[];
}

/**
 * Build a local Date for a given hour/minute on an arbitrary fixed day.
 * Month is 0-indexed; Sep 15 2026 local time by default.
 */
export function at(hour: number, minute = 0, day = 15): Date {
	return new Date(2026, 8, day, hour, minute, 0, 0);
}

/**
 * Create a fake {@link ReminderHost} driven by the given scenario values.
 */
function makeFakeHost(scenario: TestScenario) {
	const notifications: Array<{ message: string; type: string }> = [];
	let state: ReminderState = {
		lastNotifiedDay: scenario.lastNotifiedDay,
	};
	const activeTimers = new Set<TimerHandle>();
	const callbacks = new Map<TimerHandle, () => void>();
	let nextId = 1;

	const host: ReminderHost = {
		now: () => scenario.now,
		notify: (message, type) => notifications.push({ message, type }),
		loadState: () => ({ ...state }),
		saveState: (s) => {
			state = { ...s };
		},
		isInteractive: () => scenario.interactive ?? true,
		setTimer: (fn, ms) => {
			const handle: TimerHandle = { id: nextId++ };
			activeTimers.add(handle);
			callbacks.set(handle, fn);
			return handle;
		},
		clearTimer: (handle) => {
			activeTimers.delete(handle);
			callbacks.delete(handle);
		},
	};

	const fireAllTimers = () => {
		for (const cb of [...callbacks.values()]) cb();
	};

	const harness = { host, notifications, get state() { return state; }, activeTimers, fireAllTimers };
	return harness;
}

/**
 * Run the pure core logic (`decide`) against a single scenario.
 */
export function runCoreScenario(scenario: TestScenario): ScenarioResult {
	const actual = decide(scenario.now, scenario.lastNotifiedDay);
	const errors: string[] = [];

	if (actual.notify !== scenario.expected.notify) {
		errors.push(
			`expected notify=${scenario.expected.notify}, got notify=${actual.notify}`,
		);
	}
	if (actual.keepChecking !== scenario.expected.keepChecking) {
		errors.push(
			`expected keepChecking=${scenario.expected.keepChecking}, got keepChecking=${actual.keepChecking}`,
		);
	}

	return {
		scenario,
		passed: errors.length === 0,
		actual,
		errors,
	};
}

/**
 * Run the full controller (lifecycle + host interactions) against a single scenario.
 */
export function runControllerScenario(scenario: TestScenario): ScenarioResult {
	const harness = makeFakeHost(scenario);
	const { host, notifications, activeTimers, fireAllTimers } = harness;

	const controller = new ReminderController(host);
	controller.start();

	// If a timer was armed and the scenario expects eventual notification,
	// simulate the timer firing once.
	if (activeTimers.size > 0) {
		fireAllTimers();
	}

	const actual: ScenarioResult["actual"] = {
		notify: notifications.length > 0,
		dayKey: dayKey(scenario.now),
		keepChecking: activeTimers.size > 0,
		notifiedMessage: notifications[0]?.message,
	};

	const errors: string[] = [];

	if (actual.notify !== scenario.expected.notify) {
		errors.push(
			`expected notify=${scenario.expected.notify}, got notify=${actual.notify}`,
		);
	}
	if (actual.keepChecking !== scenario.expected.keepChecking) {
		errors.push(
			`expected keepChecking=${scenario.expected.keepChecking}, got keepChecking=${actual.keepChecking}`,
		);
	}
	if (scenario.expected.message && actual.notifiedMessage !== scenario.expected.message) {
		errors.push(
			`expected message="${scenario.expected.message}", got "${actual.notifiedMessage}"`,
		);
	}

	// Guard-rail: state must only contain lastNotifiedDay when notification happened
	if (actual.notify && !harness.state.lastNotifiedDay) {
		errors.push("notification fired but state was not persisted");
	}
	if (!actual.notify && harness.state.lastNotifiedDay && harness.state.lastNotifiedDay !== scenario.lastNotifiedDay) {
		errors.push("state was mutated even though no notification fired");
	}

	return {
		scenario,
		passed: errors.length === 0,
		actual,
		errors,
	};
}

/**
 * Run the `formatPreview` path independently and verify it does not mutate state.
 */
export function runPreviewScenario(scenario: TestScenario): ScenarioResult {
	const harness = makeFakeHost(scenario);
	const { host, notifications } = harness;
	const before = { ...harness.state };

	formatPreview((message, type) => notifications.push({ message, type }), host);

	const actual: ScenarioResult["actual"] = {
		notify: notifications.length > 0,
		dayKey: dayKey(scenario.now),
		keepChecking: false,
		notifiedMessage: notifications[0]?.message,
	};

	const errors: string[] = [];

	// Preview must always emit the message
	if (!actual.notify) {
		errors.push("preview did not emit a message");
	}
	if (actual.notifiedMessage !== REMINDER_MESSAGE) {
		errors.push(
			`preview message mismatch: expected "${REMINDER_MESSAGE}", got "${actual.notifiedMessage}"`,
		);
	}
	// Guard-rail: preview must never mutate state
	if (JSON.stringify(harness.state) !== JSON.stringify(before)) {
		errors.push("preview mutated reminder state — it must be read-only");
	}

	return {
		scenario,
		passed: errors.length === 0,
		actual,
		errors,
	};
}

/** Convenience: all canonical scenarios the user specified. */
export function getCanonicalScenarios(): TestScenario[] {
	return [
		{
			name: "23:59, no prior reminder → No reminder",
			now: at(23, 59),
			lastNotifiedDay: undefined,
			expected: { notify: false, keepChecking: true },
		},
		{
			name: "00:00, no reminder for this date → Remind",
			now: at(0, 0),
			lastNotifiedDay: undefined,
			expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
		},
		{
			name: "00:01, already reminded today → No duplicate",
			now: at(0, 1),
			lastNotifiedDay: dayKey(at(0, 1)), // "2026-09-15"
			expected: { notify: false, keepChecking: false },
		},
		{
			name: "05:59, no reminder today → Remind",
			now: at(5, 59),
			lastNotifiedDay: undefined,
			expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
		},
		{
			name: "06:00 or noon → No reminder",
			now: at(6, 0),
			lastNotifiedDay: undefined,
			expected: { notify: false, keepChecking: true },
		},
		{
			name: "Midnight on the next date → Remind again",
			now: at(0, 0, 16), // next day
			lastNotifiedDay: dayKey(at(0, 0, 15)), // yesterday
			expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
		},
	];
}

/** Run every canonical scenario through the controller and return results. */
export function runAllControllerTests(): ScenarioResult[] {
	return getCanonicalScenarios().map(runControllerScenario);
}

/** Run every canonical scenario through the pure core and return results. */
export function runAllCoreTests(): ScenarioResult[] {
	return getCanonicalScenarios().map(runCoreScenario);
}

/** Format results as a human-readable report. */
export function formatReport(results: ScenarioResult[]): string {
	const lines: string[] = [];
	let passed = 0;
	let failed = 0;

	for (const r of results) {
		if (r.passed) {
			passed++;
			lines.push(`✅  ${r.scenario.name}`);
		} else {
			failed++;
			lines.push(`❌  ${r.scenario.name}`);
			for (const e of r.errors) lines.push(`      → ${e}`);
		}
	}

	lines.push("");
	lines.push(`Results: ${passed} passed, ${failed} failed (${results.length} total)`);
	return lines.join("\n");
}
