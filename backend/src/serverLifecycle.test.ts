import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { createShutdownController } from "./serverLifecycle";

test("shutdown is idempotent and closes live metrics before the database", async () => {
  const events: string[] = [];
  const server = {
    close(callback: (error?: Error) => void) {
      events.push("server.close");
      setImmediate(() => callback());
      return this;
    },
  } as unknown as Server;
  const controller = createShutdownController({
    closeDatabase: () => events.push("database.close"),
    closeLiveMetrics: async () => {
      events.push("live.close");
    },
    server,
    setReady: (ready) => events.push(`ready:${ready}`),
  });

  const firstShutdown = controller.shutdown();
  const secondShutdown = controller.shutdown();

  assert.equal(firstShutdown, secondShutdown);
  assert.equal(controller.isShuttingDown(), true);
  await firstShutdown;
  assert.deepEqual(events, [
    "ready:false",
    "server.close",
    "live.close",
    "database.close",
  ]);
});

test("shutdown closes the database even when the HTTP server reports an error", async () => {
  let databaseClosed = 0;
  const controller = createShutdownController({
    closeDatabase: () => {
      databaseClosed += 1;
    },
    closeLiveMetrics: async () => undefined,
    server: {
      close(callback: (error?: Error) => void) {
        callback(new Error("close failed"));
        return this;
      },
    } as unknown as Server,
    setReady: () => undefined,
  });

  await assert.rejects(controller.shutdown(), /close failed/);
  assert.equal(databaseClosed, 1);
});

test("shutdown waits for the HTTP server before closing the database after live cleanup fails", async () => {
  const events: string[] = [];
  const controller = createShutdownController({
    closeDatabase: () => events.push("database.close"),
    closeLiveMetrics: async () => {
      events.push("live.failed");
      throw new Error("live metrics failed");
    },
    server: {
      close(callback: (error?: Error) => void) {
        events.push("server.close");
        setTimeout(() => {
          events.push("server.closed");
          callback();
        }, 10);
        return this;
      },
    } as unknown as Server,
    setReady: () => undefined,
  });

  await assert.rejects(controller.shutdown(), /live metrics failed/);
  assert.deepEqual(events, [
    "server.close",
    "live.failed",
    "server.closed",
    "database.close",
  ]);
});

test("shutdown forces remaining HTTP connections at its deadline", async () => {
  let forceClosed = 0;
  const controller = createShutdownController({
    closeDatabase: () => undefined,
    closeLiveMetrics: async () => undefined,
    server: {
      close(callback: (error?: Error) => void) {
        setTimeout(() => callback(), 25);
        return this;
      },
      closeAllConnections() {
        forceClosed += 1;
      },
    } as unknown as Server,
    setReady: () => undefined,
    shutdownTimeoutMs: 5,
  });

  await controller.shutdown();
  assert.equal(forceClosed, 1);
});
