import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { keepServerAwake } from "../../mac/server-power.js";

test("background hosting stays awake through window closure and a cancelled quit, without keeping the screen on", () => {
  const app = new EventEmitter();
  const assertions = new Map();
  keepServerAwake(app, {
    start(type) { assertions.set(0, type); return 0; },
    stop(id) { assert.equal(assertions.delete(id), true); },
  });
  assert.deepEqual([...assertions.values()], ["prevent-app-suspension"]);
  app.emit("window-all-closed");
  app.emit("before-quit", { preventDefault() {} });
  assert.equal(assertions.size, 1, "hosting must remain awake until the application actually quits");
  app.emit("will-quit");
  assert.equal(assertions.size, 0);
  app.emit("will-quit"); // Cleanup cannot stop an already released assertion.
});
