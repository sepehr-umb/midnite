# midnite

A [Pi](https://github.com/earendil-works/pi) extension that reminds you, **once
per day**, to save your work and get some sleep when it is after midnight.

> It is after midnight. Consider saving your work and getting some sleep.

The reminder is *non-blocking*. It does not prevent tools from running, does
not terminate Pi, and never makes a model call. It is just a notification — you
can ignore it and keep working.

## Behavior

- **Window:** only between **00:00 and 05:59:59** local time. `23:59` and `06:00`
  do **not** trigger a reminder.
- **On startup:** if Pi starts (or resumes) inside the window, the reminder is
  shown immediately.
- **While running:** a **30-second** interval check means the reminder appears
  within one minute of midnight when Pi was already open — no user prompt
  required.
- **Once per day:** after notifying, the local day key is persisted and the
  interval is stopped, so you are not reminded again until the next day. The
  persistent state is a single field (`{"lastNotifiedDay":"YYYY-MM-DD"}`),
  stored in `state.json` next to the extension.
- **Fresh session / reload** may remind again (a new session is a new context).
- **Non-interactive modes** (`--print`, JSON) never notify and never start a
  timer.
- **Shutdown:** the timer is always cleared on `session_shutdown` and before
  every `start()`, so reloads and session switches never accumulate timers or
  reuse an old session context.

## Install

The extension lives in Pi's user extension directory and is auto-discovered:

```
~/.pi/agent/extensions/midnite/
```

To run with a checkout directly:

```bash
pi --extension /path/to/midnite/index.ts
```

To install this copy:

```bash
cd ~/.pi/agent/extensions
ln -s /path/to/midnite midnite
```

## Commands

- `/bedtime-test` — preview the reminder message without changing any reminder
  state or creating timers.

## Running tests

```bash
# install dependencies
npm install

# run all tests once (CI / non-interactive)
npm test

# run tests in watch mode (re-run on file changes)
npm run test:watch

# run the custom CLI test runner (formatted numbered output)
npm run test:run

# re-run only previously failed tests via the CLI runner
npm run test:failed

# list all available numbered tests
npm run test:list
```

You can also run the CLI runner directly for more control:

```bash
# list all tests
npx tsx test-runner.ts --list

# run all numbered tests
npx tsx test-runner.ts --all

# run a specific test (e.g., test #7)
npx tsx test-runner.ts 7

# run multiple specific tests
npx tsx test-runner.ts 1 2 3

# re-run failed tests
npx tsx test-runner.ts --failed
```

## Building

```bash
# type-check the project
npx tsc --noEmit
```

No compile step is needed at runtime since Pi loads TypeScript directly. Run
type checking manually when making changes.

## Files

| File                | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `index.ts`          | Pi entry point: event wiring, state file, `/bedtime-test`.     |
| `controller.ts`     | Testable lifecycle: startup check, polling, persistence, stop. |
| `midnight.ts`       | Pure core: window check, day key, decision, message.           |
| `tester.ts`         | Independent test harness with numbered edge cases.             |
| `test-runner.ts`    | CLI runner for `tester.ts` (list, run, filter).                |
| `*.test.ts`         | Vitest suites for each layer.                                  |

## Architecture

The extension is split into three layers:

1. **`midnight.ts`** — Pure, side-effect-free logic. Contains the window check,
   day key formatting, and the decision engine. No Pi imports.
2. **`controller.ts`** — Injected lifecycle manager. Handles startup check,
   30s polling timer, state persistence, and clean shutdown. All side effects
   go through the `ReminderHost` interface so tests can swap in fakes.
3. **`index.ts`** — Pi-specific wiring. Adapts `ExtensionContext` to
   `ReminderHost`, manages the state JSON file, and registers the
   `/bedtime-test` command.

### Key design decisions

- **Minimal persistent state:** only `lastNotifiedDay` (a `"YYYY-MM-DD"` string)
  is saved. No timestamps, counters, or complex structures.
- **Timer safety:** `start()` always calls `stop()` first, so restarts and
  reloads never leak timers. `session_shutdown` also clears the timer.
- **Stale-timer guard:** if a laptop sleeps through the midnight window and
  the timer fires the next day after 06:00, the controller detects the stale
  timer and disarms itself instead of polling all day.
- **At-most-once notify:** `saveState` is called *before* `notify`, so even
  if the notification mechanism is fire-and-forget, a crash/restart won't
  re-deliver.
