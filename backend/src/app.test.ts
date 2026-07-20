import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const secureSecret = "correct-horse-battery-staple-with-extra-entropy-123456";

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("the application returns JSON errors and exposes shutdown readiness", async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "daemondeck-app-"));

  process.env.AUTH_TOKEN_SECRET = secureSecret;
  process.env.DATABASE_PATH = path.join(dataDirectory, "test.sqlite");
  process.env.DEMO_MODE = "true";
  process.env.NODE_ENV = "test";

  const { createApp, createReadinessController } = await import("./app");
  const { closeDatabase, getUserByIdentifier, updateUserRole } = await import("./data");
  const { createJwt } = await import("./middleware/auth");
  const readiness = createReadinessController();
  const server = createServer(createApp(readiness));
  const admin = getUserByIdentifier("demo");
  assert.ok(admin);

  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await close(server);
    closeDatabase();
    fs.rmSync(dataDirectory, { force: true, recursive: true });
  });

  const unknownEndpoint = await fetch(`${baseUrl}/api/not-a-real-endpoint`);
  assert.equal(unknownEndpoint.status, 404);
  assert.equal(unknownEndpoint.headers.get("content-type")?.includes("application/json"), true);
  assert.deepEqual(await unknownEndpoint.json(), {
    message: "API endpoint GET /not-a-real-endpoint was not found.",
  });

  const malformedJson = await fetch(`${baseUrl}/api/auth/login`, {
    body: "{",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(malformedJson.status, 400);
  assert.deepEqual(await malformedJson.json(), {
    message: "Invalid JSON request body.",
  });

  const oversizedBody = await fetch(`${baseUrl}/api/auth/login`, {
    body: JSON.stringify({ padding: "x".repeat(102_400) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(oversizedBody.status, 413);
  assert.deepEqual(await oversizedBody.json(), {
    message: "Request body is too large.",
  });

  const selfDemotion = await fetch(`${baseUrl}/api/admin/users/${admin.id}/role`, {
    body: JSON.stringify({ role: "viewer" }),
    headers: {
      authorization: `Bearer ${createJwt(admin).token}`,
      "content-type": "application/json",
    },
    method: "PATCH",
  });
  assert.equal(selfDemotion.status, 409);
  assert.deepEqual(await selfDemotion.json(), {
    message: "Administrators cannot remove their own admin role.",
  });
  assert.equal(getUserByIdentifier("demo")?.role, "admin");
  assert.deepEqual(updateUserRole(admin.id, "viewer"), { status: "last_admin" });
  assert.equal(getUserByIdentifier("demo")?.role, "admin");

  readiness.setReady(false);
  const shuttingDown = await fetch(`${baseUrl}/api/health`);
  assert.equal(shuttingDown.status, 503);
  assert.deepEqual(await shuttingDown.json(), { status: "shutting_down" });

  const requestDuringShutdown = await fetch(`${baseUrl}/api/auth/login`, {
    body: JSON.stringify({ identifier: "demo", password: "password123" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(requestDuringShutdown.status, 503);
  assert.deepEqual(await requestDuringShutdown.json(), {
    message: "Server is shutting down.",
  });
});
