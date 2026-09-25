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

## Command

- `/bedtime-test` — preview the reminder message without changing any reminder
  state or creating timers.

## Install

The extension lives in Pi's user extension directory and is auto-discovered:

```
~/.pi/agent/extensions/midnite/
```

To load a checkout directly:

```bash
pi --extension /path/to/midnite/index.ts
```

## Files

| File                | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `index.ts`          | Pi entry point: event wiring, state file, `/bedtime-test`.     |
| `controller.ts`     | Testable lifecycle: startup check, polling, persistence, stop. |
| `midnight.ts`       | Pure core: window check, day key, decision, message.           |
| `*.test.ts`         | Vitest suites for each layer.                                  |

## Development (TDD)

```bash
npm install
npm test        # vitest --run
npx tsc --noEmit
```

The suite is written red/green: pure core logic, injected-dependency lifecycle,
and the real extension factory are each covered by tests.
