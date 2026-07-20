import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfigurationError,
  isPlaceholderAuthTokenSecret,
  loadRuntimeConfig,
} from "./runtime";

const secureSecret = "correct-horse-battery-staple-with-extra-entropy-123456";

test("production rejects missing, weak, and placeholder token secrets", () => {
  for (const authTokenSecret of [
    undefined,
    "   ",
    "too-short",
    "change-this-local-docker-secret",
    "replace-with-a-long-random-secret",
  ]) {
    assert.throws(
      () =>
        loadRuntimeConfig({
          NODE_ENV: "production",
          ...(authTokenSecret === undefined
            ? {}
            : { AUTH_TOKEN_SECRET: authTokenSecret }),
        }),
      ConfigurationError,
    );
  }
});

test("production accepts a strong non-placeholder token secret", () => {
  const config = loadRuntimeConfig({
    AUTH_TOKEN_SECRET: secureSecret,
    NODE_ENV: "production",
  });

  assert.equal(config.authTokenSecret, secureSecret);
  assert.equal(config.usesEphemeralAuthTokenSecret, false);
});

test("development generates an ephemeral secret instead of using a repository default", () => {
  const firstConfig = loadRuntimeConfig({ NODE_ENV: "development" });
  const secondConfig = loadRuntimeConfig({ NODE_ENV: "development" });

  assert.equal(firstConfig.usesEphemeralAuthTokenSecret, true);
  assert.equal(secondConfig.usesEphemeralAuthTokenSecret, true);
  assert.notEqual(firstConfig.authTokenSecret, secondConfig.authTokenSecret);
  assert.ok(Buffer.byteLength(firstConfig.authTokenSecret) >= 32);
  assert.notEqual(firstConfig.authTokenSecret, "dev-only-change-me");
});

test("demo mode is allowed only in explicit development or test environments", () => {
  for (const nodeEnv of [undefined, "production", "staging", "Development"]) {
    assert.throws(
      () =>
        loadRuntimeConfig({
          AUTH_TOKEN_SECRET: secureSecret,
          DEMO_MODE: "true",
          ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
        }),
      ConfigurationError,
    );
  }

  assert.equal(
    loadRuntimeConfig({
      DEMO_MODE: "true",
      NODE_ENV: "development",
    }).demoMode,
    true,
  );
  assert.equal(
    loadRuntimeConfig({
      DEMO_MODE: "true",
      NODE_ENV: "test",
    }).demoMode,
    true,
  );
});

test("unknown environments require a configured token secret", () => {
  assert.throws(
    () => loadRuntimeConfig({ NODE_ENV: "staging" }),
    ConfigurationError,
  );
});

test("demo mode cannot be combined with bootstrap administrator settings", () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        AUTH_TOKEN_SECRET: secureSecret,
        DEMO_MODE: "true",
        INITIAL_ADMIN_EMAIL: "admin@example.com",
        INITIAL_ADMIN_PASSWORD: "a-long-bootstrap-password-123",
        INITIAL_ADMIN_USERNAME: "admin",
      }),
    ConfigurationError,
  );
});

test("bootstrap administrator settings must be complete and strong", () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        AUTH_TOKEN_SECRET: secureSecret,
        INITIAL_ADMIN_USERNAME: "admin",
      }),
    ConfigurationError,
  );

  assert.throws(
    () =>
      loadRuntimeConfig({
        AUTH_TOKEN_SECRET: secureSecret,
        INITIAL_ADMIN_EMAIL: "admin@example.com",
        INITIAL_ADMIN_PASSWORD: "not-long-enough",
        INITIAL_ADMIN_USERNAME: "admin",
      }),
    ConfigurationError,
  );

  assert.throws(
    () =>
      loadRuntimeConfig({
        AUTH_TOKEN_SECRET: secureSecret,
        INITIAL_ADMIN_EMAIL: "admin@example.com",
        INITIAL_ADMIN_PASSWORD: "a".repeat(73),
        INITIAL_ADMIN_USERNAME: "admin",
      }),
    ConfigurationError,
  );

  const config = loadRuntimeConfig({
    AUTH_TOKEN_SECRET: secureSecret,
    INITIAL_ADMIN_EMAIL: "ADMIN@example.com",
    INITIAL_ADMIN_NAME: "Primary Administrator",
    INITIAL_ADMIN_PASSWORD: "a-long-bootstrap-password-123",
    INITIAL_ADMIN_USERNAME: "ADMIN",
  });

  assert.deepEqual(config.bootstrapAdmin, {
    email: "admin@example.com",
    name: "Primary Administrator",
    password: "a-long-bootstrap-password-123",
    username: "admin",
  });
});

test("placeholder detection catches known and patterned values", () => {
  assert.equal(isPlaceholderAuthTokenSecret("change-this-local-docker-secret"), true);
  assert.equal(isPlaceholderAuthTokenSecret("replace-with-a-real-secret"), true);
  assert.equal(isPlaceholderAuthTokenSecret(secureSecret), false);
});
