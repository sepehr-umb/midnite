#!/usr/bin/env node
/**
 * CLI runner for the independent Midnight reminder test suite.
 *
 * Usage:
 *   npx tsx test-runner.ts --list              # List all tests
 *   npx tsx test-runner.ts 7                   # Run test #7
 *   npx tsx test-runner.ts 1 2 3 4 5 6         # Run multiple tests
 *   npx tsx test-runner.ts --all               # Run every test
 *   npx tsx test-runner.ts --failed            # Re-run only failed tests
 */

import { getAllNumberedTests, runNumberedTest } from "./tester.js";

const args = process.argv.slice(2);

function listTests() {
	const tests = getAllNumberedTests();
	console.log("\n📋  Midnight Reminder — Independent Test Runner\n");
	console.log(`Total tests: ${tests.length}\n`);
	for (const t of tests) {
		const badge = t.category === "canonical" ? "📗" : "📙";
		console.log(`  ${badge}  ${String(t.id).padStart(2)}  ${t.name}`);
	}
	console.log("\nCommands:");
	console.log("  npx tsx test-runner.ts --list              Show this list");
	console.log("  npx tsx test-runner.ts 7                   Run test #7");
	console.log("  npx tsx test-runner.ts 1 2 3 4 5 6         Run tests 1 through 6");
	console.log("  npx tsx test-runner.ts --all               Run every test");
	console.log("  npx tsx test-runner.ts --failed          Re-run tests that failed\n");
}

function runSingle(id: number): boolean {
	const { test, result } = runNumberedTest(id);
	if (!test) {
		console.log(`\n❌  Test #${id} not found`);
		return false;
	}
	const badge = result.passed ? "✅" : "❌";
	const catBadge = test.category === "canonical" ? "📗" : "📙";
	console.log(`\n${badge}  Test #${test.id}  ${catBadge} [${test.category}]`);
	console.log(`     ${test.name}`);
	if (result.errors.length > 0) {
		for (const e of result.errors) {
			console.log(`     → ${e}`);
		}
	}
	return result.passed;
}

function runAll() {
	const tests = getAllNumberedTests();
	console.log("\n🧪  Running all tests...\n");
	let passed = 0;
	let failed = 0;
	const failedIds: number[] = [];

	for (const test of tests) {
		const result = test.run();
		const badge = result.passed ? "✅" : "❌";
		const catBadge = test.category === "canonical" ? "📗" : "📙";
		console.log(`${badge}  #${String(test.id).padStart(2)}  ${catBadge} ${test.name}`);
		if (!result.passed) {
			failed++;
			failedIds.push(test.id);
			for (const e of result.errors) {
				console.log(`      → ${e}`);
			}
		} else {
			passed++;
		}
	}

	console.log(`\n📊  Results: ${passed} passed, ${failed} failed (${tests.length} total)\n`);
	if (failedIds.length > 0) {
		console.log(`Re-run failed tests with:`);
		console.log(`  npx tsx test-runner.ts ${failedIds.join(" ")}\n`);
	}
	return failed === 0;
}

function runFailed() {
	const tests = getAllNumberedTests();
	const failedIds = tests.filter((t) => !t.run().passed).map((t) => t.id);
	if (failedIds.length === 0) {
		console.log("\n✅  All tests are currently passing. Nothing to re-run.\n");
		return true;
	}
	console.log(`\n🔁  Re-running ${failedIds.length} failed test(s): ${failedIds.join(", ")}\n`);
	let allPassed = true;
	for (const id of failedIds) {
		if (!runSingle(id)) allPassed = false;
	}
	console.log("");
	return allPassed;
}

// ─── Main ───

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	listTests();
} else if (args[0] === "--list" || args[0] === "-l") {
	listTests();
} else if (args[0] === "--all" || args[0] === "-a") {
	const ok = runAll();
	process.exitCode = ok ? 0 : 1;
} else if (args[0] === "--failed" || args[0] === "-f") {
	const ok = runFailed();
	process.exitCode = ok ? 0 : 1;
} else {
	const ids = args.map(Number).filter((n) => !isNaN(n) && n > 0);
	if (ids.length === 0) {
		console.log("Invalid arguments. Use --list to see available tests.");
		process.exit(1);
	}
	let allPassed = true;
	for (const id of ids) {
		if (!runSingle(id)) allPassed = false;
	}
	console.log("");
	process.exitCode = allPassed ? 0 : 1;
}
