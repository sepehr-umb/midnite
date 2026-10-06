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

// ─── Re-exports for consumers ───
export { REMINDER_MESSAGE, dayKey, isWithinWindow } from "./midnight.js";

// ─── Interfaces ───

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
		/** Whether a notification should fire. */
		notify: boolean;
		/** Whether the polling timer should still be active. */
		keepChecking: boolean;
		/** Expected notification text (only when notify is true). */
		message?: string;
	};
}

export interface ScenarioResult {
	scenario: TestScenario;
	passed: boolean;
	actual: ReminderDecision & { notifiedMessage?: string };
	errors: string[];
}

export interface NumberedTest {
	/** 1-based test identifier. */
	id: number;
	/** Short descriptive name. */
	name: string;
	/** "canonical" or "edge-case". */
	category: string;
	/** Execute the test and return pass/fail with errors. */
	run: () => { passed: boolean; errors: string[] };
}

// ─── Date builder ───

/** Build a local Date for a given hour/minute on an arbitrary fixed day. */
export function at(hour: number, minute = 0, day = 15): Date {
	return new Date(2026, 8, day, hour, minute, 0, 0);
}

// ─── Fake Host Harness ───

interface FakeHostHarness {
	host: ReminderHost;
	notifications: Array<{ message: string; type: string }>;
	get state(): ReminderState;
	activeTimers: Set<TimerHandle>;
	fireAllTimers(): void;
	setNow(d: Date): void;
}

function makeFakeHost(scenario: TestScenario): FakeHostHarness {
	const notifications: Array<{ message: string; type: string }> = [];
	let state: ReminderState = { lastNotifiedDay: scenario.lastNotifiedDay };
	const activeTimers = new Set<TimerHandle>();
	const callbacks = new Map<TimerHandle, () => void>();
	let nextId = 1;
	let currentNow = scenario.now;

	const host: ReminderHost = {
		now: () => currentNow,
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

	const setNow = (d: Date) => {
		currentNow = d;
	};

	return { host, notifications, get state() { return state; }, activeTimers, fireAllTimers, setNow };
}

// ─── Existing scenario runners ───

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

	return { scenario, passed: errors.length === 0, actual, errors };
}

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

	return { scenario, passed: errors.length === 0, actual, errors };
}

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

	if (!actual.notify) {
		errors.push("preview did not emit a message");
	}
	if (actual.notifiedMessage !== REMINDER_MESSAGE) {
		errors.push(
			`preview message mismatch: expected "${REMINDER_MESSAGE}", got "${actual.notifiedMessage}"`,
		);
	}
	if (JSON.stringify(harness.state) !== JSON.stringify(before)) {
		errors.push("preview mutated reminder state — it must be read-only");
	}

	return { scenario, passed: errors.length === 0, actual, errors };
}

// ─── Canonical scenarios ───

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
			lastNotifiedDay: dayKey(at(0, 1)),
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
			now: at(0, 0, 16),
			lastNotifiedDay: dayKey(at(0, 0, 15)),
			expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
		},
	];
}

export function runAllCoreTests(): ScenarioResult[] {
	return getCanonicalScenarios().map(runCoreScenario);
}

export function runAllControllerTests(): ScenarioResult[] {
	return getCanonicalScenarios().map(runControllerScenario);
}

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

// ─── Numbered test cases (canonical + edge cases) ───

export function getAllNumberedTests(): NumberedTest[] {
	return [
		// ===== 1–6: Canonical acceptance scenarios =====
		{
			id: 1,
			name: "23:59, no prior reminder → No reminder",
			category: "canonical",
			run: () => {
				const result = runControllerScenario({
					name: "#1",
					now: at(23, 59),
					lastNotifiedDay: undefined,
					expected: { notify: false, keepChecking: true },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 2,
			name: "00:00, no reminder for this date → Remind",
			category: "canonical",
			run: () => {
				const result = runControllerScenario({
					name: "#2",
					now: at(0, 0),
					lastNotifiedDay: undefined,
					expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 3,
			name: "00:01, already reminded today → No duplicate",
			category: "canonical",
			run: () => {
				const result = runControllerScenario({
					name: "#3",
					now: at(0, 1),
					lastNotifiedDay: dayKey(at(0, 1)),
					expected: { notify: false, keepChecking: false },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 4,
			name: "05:59, no reminder today → Remind",
			category: "canonical",
			run: () => {
				const result = runControllerScenario({
					name: "#4",
					now: at(5, 59),
					lastNotifiedDay: undefined,
					expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 5,
			name: "06:00 or noon → No reminder",
			category: "canonical",
			run: () => {
				const result = runControllerScenario({
					name: "#5",
					now: at(6, 0),
					lastNotifiedDay: undefined,
					expected: { notify: false, keepChecking: true },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 6,
			name: "Midnight on the next date → Remind again",
			category: "canonical",
			run: () => {
				const result = runControllerScenario({
					name: "#6",
					now: at(0, 0, 16),
					lastNotifiedDay: dayKey(at(0, 0, 15)),
					expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},

		// ===== 7–16: Edge cases & guard rails =====
		{
			id: 7,
			name: "Sleep through midnight → timer should stop (not poll all day)",
			category: "edge-case",
			run: () => {
				const harness = makeFakeHost({
					name: "#7",
					now: at(23, 30),
					expected: { notify: false, keepChecking: true },
				});
				const controller = new ReminderController(harness.host);
				controller.start();
				// Simulate laptop sleeping through the window until 06:30 next day
				harness.setNow(at(6, 30, 16));
				harness.fireAllTimers();
				const leaked = harness.activeTimers.size;
				return {
					passed: leaked === 0,
					errors: leaked === 0
						? []
						: [
								`BUG: ${leaked} timer(s) still active after missing window. ` +
								`Extension will poll every ${CHECK_INTERVAL_MS}ms all day instead of sleeping until next midnight.`,
							],
				};
			},
		},
		{
			id: 8,
			name: "Empty string lastNotifiedDay treated as never reminded",
			category: "edge-case",
			run: () => {
				const result = runCoreScenario({
					name: "#8",
					now: at(1, 0),
					lastNotifiedDay: "",
					expected: { notify: true, keepChecking: false },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 9,
			name: "Garbage lastNotifiedDay treated as stale",
			category: "edge-case",
			run: () => {
				const result = runCoreScenario({
					name: "#9",
					now: at(1, 0),
					lastNotifiedDay: "not-a-date",
					expected: { notify: true, keepChecking: false },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 10,
			name: "saveState failure → no crash, no infinite retry",
			category: "edge-case",
			run: () => {
				const harness = makeFakeHost({
					name: "#10",
					now: at(1, 0),
					expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
				});
				let saveCalls = 0;
				harness.host.saveState = () => {
					saveCalls++;
					throw new Error("disk full");
				};
				const controller = new ReminderController(harness.host);
				let threw = false;
				let errorMsg = "";
				try {
					controller.start();
				} catch (e: any) {
					threw = true;
					errorMsg = e.message;
				}
				const errors: string[] = [];
				if (!threw) {
					errors.push("saveState threw but exception was not propagated — controller should surface errors");
				} else if (errorMsg !== "disk full") {
					errors.push(`Unexpected error message: ${errorMsg}`);
				}
				if (saveCalls !== 1) {
					errors.push(`saveState called ${saveCalls} time(s), expected exactly 1`);
				}
				if (harness.activeTimers.size > 0) {
					errors.push(
						`${harness.activeTimers.size} timer(s) still active after saveState threw — potential retry loop`,
					);
				}
				return { passed: errors.length === 0, errors };
			},
		},
		{
			id: 11,
			name: "dayKey handles year boundary (Dec 31 → Jan 1)",
			category: "edge-case",
			run: () => {
				const dec31 = dayKey(new Date(2026, 11, 31, 2, 0));
				const jan01 = dayKey(new Date(2027, 0, 1, 2, 0));
				const errors: string[] = [];
				if (dec31 !== "2026-12-31") errors.push(`Dec 31 expected "2026-12-31", got "${dec31}"`);
				if (jan01 !== "2027-01-01") errors.push(`Jan 01 expected "2027-01-01", got "${jan01}"`);
				return { passed: errors.length === 0, errors };
			},
		},
		{
			id: 12,
			name: "Millisecond precision: 05:59:59.999 vs 06:00:00.000",
			category: "edge-case",
			run: () => {
				const almost = new Date(2026, 8, 15, 5, 59, 59, 999);
				const exact = new Date(2026, 8, 15, 6, 0, 0, 0);
				const errors: string[] = [];
				if (!isWithinWindow(almost)) errors.push("05:59:59.999 should be inside the window");
				if (isWithinWindow(exact)) errors.push("06:00:00.000 should be outside the window");
				return { passed: errors.length === 0, errors };
			},
		},
		{
			id: 13,
			name: "Future lastNotifiedDay from clock drift → still reminds",
			category: "edge-case",
			run: () => {
				const result = runCoreScenario({
					name: "#13",
					now: at(1, 0),
					lastNotifiedDay: "2099-01-01",
					expected: { notify: true, keepChecking: false },
				});
				return { passed: result.passed, errors: result.errors };
			},
		},
		{
			id: 14,
			name: "Controller restart after stop doesn't leak timers",
			category: "edge-case",
			run: () => {
				const harness = makeFakeHost({
					name: "#14",
					now: at(23, 0),
					expected: { notify: false, keepChecking: true },
				});
				const controller = new ReminderController(harness.host);
				controller.start();
				controller.stop();
				controller.start();
				const count = harness.activeTimers.size;
				return {
					passed: count === 1,
					errors: count === 1 ? [] : [`Expected 1 active timer after restart, found ${count}`],
				};
			},
		},
		{
			id: 15,
			name: "notify() throws → state still persisted + no crash",
			category: "edge-case",
			run: () => {
				const harness = makeFakeHost({
					name: "#15",
					now: at(1, 0),
					expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
				});
				harness.host.notify = () => {
					throw new Error("UI crashed");
				};
				const controller = new ReminderController(harness.host);
				let threw = false;
				let errorMsg = "";
				try {
					controller.start();
				} catch (e: any) {
					threw = true;
					errorMsg = e.message;
				}
				const errors: string[] = [];
				if (!threw) {
					errors.push("notify() threw but exception was swallowed");
				} else if (errorMsg !== "UI crashed") {
					errors.push(`Unexpected error: ${errorMsg}`);
				}
				// saveState is called BEFORE notify, so at-most-once is preserved
				if (!harness.state.lastNotifiedDay) {
					errors.push("state was NOT persisted — at-most-once guarantee broken on retry");
				}
				if (harness.activeTimers.size > 0) {
					errors.push("timer armed after notify threw — potential retry loop");
				}
				return { passed: errors.length === 0, errors };
			},
		},
		{
			id: 16,
			name: "Preview works even with corrupted / garbage state",
			category: "edge-case",
			run: () => {
				const harness = makeFakeHost({
					name: "#16",
					now: at(2, 0),
					lastNotifiedDay: "garbage!@#$",
					expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
				});
				const before = JSON.stringify(harness.state);
				const result = runPreviewScenario({
					name: "#16",
					now: at(2, 0),
					lastNotifiedDay: "garbage!@#$",
					expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
				});
				const errors = [...result.errors];
				if (JSON.stringify(harness.state) !== before) {
					errors.push("preview mutated the corrupted state");
				}
				return { passed: errors.length === 0, errors };
			},
		},
	];
}

export function runNumberedTest(id: number): {
	test: NumberedTest | undefined;
	result: { passed: boolean; errors: string[] };
} {
	const all = getAllNumberedTests();
	const test = all.find((t) => t.id === id);
	if (!test) {
		return { test: undefined, result: { passed: false, errors: [`No test found with id ${id}`] } };
	}
	return { test, result: test.run() };
}
