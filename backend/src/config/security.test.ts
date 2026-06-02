import assert from "node:assert/strict";
import test from "node:test";
import { isProcessKillEnabled } from "./security";

test("process kill is disabled by default", () => {
  assert.equal(isProcessKillEnabled({}), false);
});

test("process kill requires explicit true string", () => {
  assert.equal(isProcessKillEnabled({ ENABLE_PROCESS_KILL: "true" }), true);
  assert.equal(isProcessKillEnabled({ ENABLE_PROCESS_KILL: "false" }), false);
  assert.equal(isProcessKillEnabled({ ENABLE_PROCESS_KILL: "TRUE" }), false);
});
