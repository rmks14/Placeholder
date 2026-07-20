import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const secureSecret = "correct-horse-battery-staple-with-extra-entropy-123456";

async function getAvailablePort() {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  return port;
}

function waitForOutput(
  child: ReturnType<typeof spawn>,
  pattern: RegExp,
  timeoutMs = 10_000,
) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for backend startup. Output: ${output}`));
    }, timeoutMs);
    const failOnExit = (code: number | null) => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited before startup with code ${code}. Output: ${output}`));
    };

    function inspect(chunk: Buffer) {
      output += chunk.toString();

      if (pattern.test(output)) {
        clearTimeout(timeout);
        child.stdout?.off("data", inspect);
        child.stderr?.off("data", inspect);
        child.off("exit", failOnExit);
        resolve();
      }
    }

    child.stdout?.on("data", inspect);
    child.stderr?.on("data", inspect);
    child.once("exit", failOnExit);
  });
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 10_000) {
  return new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for backend shutdown."));
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

test("the production backend starts safely and exits cleanly on SIGTERM", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daemondeck-index-"));
  const databasePath = path.join(directory, "daemondeck.sqlite");
  const port = await getAvailablePort();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      'import "./src/index.ts"; process.on("message", (message) => { if (message === "shutdown") process.emit("SIGTERM"); });',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTH_TOKEN_SECRET: secureSecret,
        DATABASE_PATH: databasePath,
        DEMO_MODE: "false",
        INITIAL_ADMIN_EMAIL: "admin@example.com",
        INITIAL_ADMIN_PASSWORD: "a-long-bootstrap-password-123",
        INITIAL_ADMIN_USERNAME: "admin",
        NODE_ENV: "production",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );

  t.after(() => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    fs.rmSync(directory, { force: true, recursive: true });
  });

  await waitForOutput(child, /Backend running on/);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const exit = waitForExit(child);
  child.send("shutdown");
  assert.equal(await exit, 0);
  assert.equal(fs.existsSync(databasePath), true);
});
