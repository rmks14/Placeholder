import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { User } from "../types";

test("jsonwebtoken sessions verify and can be revoked", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "daemondeck-auth-"));
  let closeDatabase: (() => void) | null = null;

  process.env.AUTH_TOKEN_SECRET =
    "test-secret-that-is-at-least-thirty-two-bytes-long";
  process.env.DATABASE_PATH = path.join(dataDir, "test.sqlite");
  process.env.DEMO_MODE = "true";
  process.env.NODE_ENV = "test";
  process.env.SESSION_TTL_MINUTES = "60";

  t.after(() => {
    closeDatabase?.();
    fs.rmSync(dataDir, { force: true, recursive: true });
  });

  const { createJwt, revokeToken, verifyJwt } = await import("./auth");
  closeDatabase = (await import("../data")).closeDatabase;
  const user: User = {
    email: "demo@example.com",
    id: "user-1",
    name: "Demo User",
    passwordHash: "hash",
    role: "admin",
    username: "demo",
  };

  const { payload, token } = createJwt(user);
  const verifiedPayload = verifyJwt(token);

  assert.equal(verifiedPayload?.sub, user.id);
  assert.equal(verifiedPayload?.role, user.role);

  revokeToken(payload);
  assert.equal(verifyJwt(token), null);
});
