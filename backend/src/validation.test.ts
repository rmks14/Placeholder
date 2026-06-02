import assert from "node:assert/strict";
import test from "node:test";
import {
  alertUpdateBodySchema,
  loginBodySchema,
  roleBodySchema,
  systemActionBodySchema,
} from "./validation";

test("login body accepts trimmed credentials", () => {
  const result = loginBodySchema.safeParse({
    identifier: " demo ",
    password: "password123",
  });

  assert.equal(result.success, true);

  if (result.success) {
    assert.equal(result.data.identifier, "demo");
  }
});

test("login body rejects empty or extra fields", () => {
  assert.equal(
    loginBodySchema.safeParse({ identifier: "", password: "password123" })
      .success,
    false,
  );
  assert.equal(
    loginBodySchema.safeParse({
      identifier: "demo",
      password: "password123",
      remember: true,
    }).success,
    false,
  );
});

test("admin body schemas accept only supported actions", () => {
  assert.equal(roleBodySchema.safeParse({ role: "admin" }).success, true);
  assert.equal(roleBodySchema.safeParse({ role: "owner" }).success, false);
  assert.equal(alertUpdateBodySchema.safeParse({ enabled: true }).success, true);
  assert.equal(
    alertUpdateBodySchema.safeParse({ enabled: "true" }).success,
    false,
  );
  assert.equal(
    systemActionBodySchema.safeParse({ action: "run-audit" }).success,
    true,
  );
  assert.equal(
    systemActionBodySchema.safeParse({ action: "reboot-host" }).success,
    false,
  );
});
