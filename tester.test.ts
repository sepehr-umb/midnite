import { describe, expect, it } from "vitest";
import {
	at,
	runCoreScenario,
	runControllerScenario,
	runPreviewScenario,
	getCanonicalScenarios,
	runAllCoreTests,
	runAllControllerTests,
	formatReport,
	REMINDER_MESSAGE,
	dayKey,
} from "./tester.js";

// ─────────────────────────────────────────────────────────────
// 1. Canonical scenarios (user-specified acceptance criteria)
// ─────────────────────────────────────────────────────────────

describe("canonical scenarios — pure core logic", () => {
	for (const scenario of getCanonicalScenarios()) {
		it(scenario.name, () => {
			const result = runCoreScenario(scenario);
			if (!result.passed) {
				throw new Error(
					`Scenario "${scenario.name}" failed:\n` +
					result.errors.map((e) => `  • ${e}`).join("\n"),
				);
			}
		});
	}
});

describe("canonical scenarios — controller with fake host", () => {
	for (const scenario of getCanonicalScenarios()) {
		it(scenario.name, () => {
			const result = runControllerScenario(scenario);
			if (!result.passed) {
				throw new Error(
					`Scenario "${scenario.name}" failed:\n` +
					result.errors.map((e) => `  • ${e}`).join("\n"),
				);
			}
		});
	}
});

// ─────────────────────────────────────────────────────────────
// 2. Guard-rail / edge-case extensions
// ─────────────────────────────────────────────────────────────

describe("guard rails and edge cases", () => {
	it("never reminds twice in the same day even with multiple checks", () => {
		const now = at(1, 0);
		const last = undefined;
		const first = runCoreScenario({
			name: "first check",
			now,
			lastNotifiedDay: last,
			expected: { notify: true, keepChecking: false },
		});
		expect(first.passed).toBe(true);

		const second = runCoreScenario({
			name: "second check same day",
			now,
			lastNotifiedDay: first.actual.dayKey,
			expected: { notify: false, keepChecking: false },
		});
		expect(second.passed).toBe(true);
	});

	it("does not remind outside the window (23:59–06:00)", () => {
		const outsideTimes = [
			at(23, 59),
			at(22, 0),
			at(6, 0),
			at(12, 0), // noon
			at(18, 30),
		];
		for (const t of outsideTimes) {
			const result = runCoreScenario({
				name: `outside window at ${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`,
				now: t,
				lastNotifiedDay: undefined,
				expected: { notify: false, keepChecking: true },
			});
			expect(result.passed).toBe(true);
		}
	});

	it("reminds at every minute inside the window when not yet reminded", () => {
		for (let h = 0; h < 6; h++) {
			for (let m = 0; m < 60; m++) {
				if (h === 5 && m === 59) continue; // covered by canonical
				const result = runCoreScenario({
					name: `inside window ${h}:${String(m).padStart(2, "0")}`,
					now: at(h, m),
					lastNotifiedDay: undefined,
					expected: { notify: true, keepChecking: false },
				});
				expect(result.passed).toBe(true);
			}
		}
	});

	it("controller does not create timers when non-interactive", () => {
		const result = runControllerScenario({
			name: "non-interactive outside window",
			now: at(23, 0),
			lastNotifiedDay: undefined,
			interactive: false,
			expected: { notify: false, keepChecking: false },
		});
		expect(result.passed).toBe(true);
	});

	it("controller does not notify when non-interactive even inside window", () => {
		const result = runControllerScenario({
			name: "non-interactive inside window",
			now: at(1, 0),
			lastNotifiedDay: undefined,
			interactive: false,
			expected: { notify: false, keepChecking: false },
		});
		expect(result.passed).toBe(true);
	});

	it("state is persisted with the exact day key of the notification", () => {
		const now = at(3, 30, 20); // Sep 20
		const result = runControllerScenario({
			name: "state persistence",
			now,
			lastNotifiedDay: undefined,
			expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
		});
		expect(result.passed).toBe(true);
		// dayKey is the local calendar day
		expect(result.actual.dayKey).toBe("2026-09-20");
	});

	it("preview always emits the exact reminder without mutating state", () => {
		const result = runPreviewScenario({
			name: "preview in window",
			now: at(2, 0),
			lastNotifiedDay: undefined,
			expected: { notify: true, keepChecking: false, message: REMINDER_MESSAGE },
		});
		expect(result.passed).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────
// 3. Batch / report-level assertions
// ─────────────────────────────────────────────────────────────

describe("batch test runners", () => {
	it("runAllCoreTests passes every canonical scenario", () => {
		const results = runAllCoreTests();
		const failed = results.filter((r) => !r.passed);
		if (failed.length > 0) {
			console.error(formatReport(results));
		}
		expect(failed).toHaveLength(0);
	});

	it("runAllControllerTests passes every canonical scenario", () => {
		const results = runAllControllerTests();
		const failed = results.filter((r) => !r.passed);
		if (failed.length > 0) {
			console.error(formatReport(results));
		}
		expect(failed).toHaveLength(0);
	});

	it("formatReport counts correctly when all pass", () => {
		const results = runAllCoreTests();
		const report = formatReport(results);
		expect(report).toContain(`${results.length} passed`);
		expect(report).toContain("0 failed");
	});
});
