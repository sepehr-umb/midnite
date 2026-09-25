import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep integration tests hermetic: never read/write the real extension state.
process.env.PI_MIDNITE_STATE_FILE = join(mkdtempSync(join(tmpdir(), "midnite-test-")), "state.json");
