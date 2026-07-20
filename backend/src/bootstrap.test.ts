import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const secureSecret = "correct-horse-battery-staple-with-extra-entropy-123456";
const bootstrapPassword = "a-long-bootstrap-password-123";

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

test("a bootstrap administrator can sign in to a fresh production database", async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "daemondeck-bootstrap-"));

  process.env.AUTH_TOKEN_SECRET = secureSecret;
  process.env.DATABASE_PATH = path.join(dataDirectory, "test.sqlite");
  process.env.DEMO_MODE = "false";
  process.env.INITIAL_ADMIN_EMAIL = "admin@example.com";
  process.env.INITIAL_ADMIN_NAME = "Primary Administrator";
  process.env.INITIAL_ADMIN_PASSWORD = bootstrapPassword;
  process.env.INITIAL_ADMIN_USERNAME = "admin";
  process.env.NODE_ENV = "production";

  const { createApp, createReadinessController } = await import("./app");
  const { closeDatabase } = await import("./data");
  const server = createServer(createApp(createReadinessController()));
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  t.after(async () => {
    await close(server);
    closeDatabase();
    fs.rmSync(dataDirectory, { force: true, recursive: true });
  });

  const login = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
    body: JSON.stringify({ identifier: "admin", password: bootstrapPassword }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  assert.equal(login.status, 200);
  const session = (await login.json()) as {
    token: string;
    user: { email: string; role: string; username: string };
  };
  assert.equal(session.user.email, "admin@example.com");
  assert.equal(session.user.role, "admin");
  assert.equal(session.user.username, "admin");
  assert.ok(session.token.length > 0);

  const currentUser = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  assert.equal(currentUser.status, 200);
});
