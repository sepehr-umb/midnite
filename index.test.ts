import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import register from "./index.js";
import { REMINDER_MESSAGE } from "./midnight.js";

beforeEach(() => {
	// Start each test from "never notified".
	rmSync(process.env.PI_MIDNITE_STATE_FILE as string, { force: true });
});

afterEach(() => {
	vi.useRealTimers();
});

interface FakePi {
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>;
	commands: Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>;
}

function makePi(): FakePi {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }>();
	const pi = {
		on: (event: string, handler: (e: unknown, c: ExtensionContext) => unknown) => {
			handlers.set(event, handler);
			return () => handlers.delete(event);
		},
		registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
			commands.set(name, options);
		},
	} as unknown as ExtensionAPI;
	register(pi);
	return { handlers, commands };
}

function makeCtx(hasUI: boolean, notifications: Array<{ message: string; type: string }>): ExtensionContext {
	return {
		hasUI,
		mode: hasUI ? "tui" : "print",
		ui: {
			notify: (message: string, type: string) => notifications.push({ message, type }),
		},
	} as unknown as ExtensionContext;
}

describe("extension wiring", () => {
	it("registers the bedtime-test command", () => {
		const { commands } = makePi();
		expect(commands.has("bedtime-test")).toBe(true);
	});

	it("starts a timer outside the window when interactive", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 15, 23, 0, 0));
		const notifications: Array<{ message: string; type: string }> = [];
		const { handlers } = makePi();
		handlers.get("session_start")!({}, makeCtx(true, notifications));
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		handlers.get("session_shutdown")!({}, makeCtx(true, notifications));
		vi.useRealTimers();
	});

	it("does not create timers in noninteractive mode", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 15, 1, 0, 0));
		const notifications: Array<{ message: string; type: string }> = [];
		const { handlers } = makePi();
		handlers.get("session_start")!({}, makeCtx(false, notifications));
		expect(vi.getTimerCount()).toBe(0);
		expect(notifications).toHaveLength(0);
		vi.useRealTimers();
	});

	it("clears timers on shutdown", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 15, 23, 0, 0));
		const notifications: Array<{ message: string; type: string }> = [];
		const { handlers } = makePi();
		handlers.get("session_start")!({}, makeCtx(true, notifications));
		handlers.get("session_shutdown")!({}, makeCtx(true, notifications));
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});

	it("bedtime-test previews the exact message and does not schedule timers", async () => {
		const notifications: Array<{ message: string; type: string }> = [];
		const { commands } = makePi();
		await commands.get("bedtime-test")!.handler("", makeCtx(true, notifications));
		expect(notifications).toEqual([{ message: REMINDER_MESSAGE, type: "info" }]);
	});

	it("notifies immediately on startup inside the window", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 15, 2, 0, 0));
		const notifications: Array<{ message: string; type: string }> = [];
		const { handlers } = makePi();
		handlers.get("session_start")!({}, makeCtx(true, notifications));
		expect(notifications).toHaveLength(1);
		expect(notifications[0].message).toBe(REMINDER_MESSAGE);
		handlers.get("session_shutdown")!({}, makeCtx(true, notifications));
		vi.useRealTimers();
	});
});
