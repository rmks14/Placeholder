import crypto from "node:crypto";

export type BootstrapAdmin = {
  email: string;
  name: string;
  password: string;
  username: string;
};

export type RuntimeConfig = {
  authTokenSecret: string;
  bootstrapAdmin: BootstrapAdmin | null;
  clientUrl: string;
  databasePath: string | undefined;
  demoMode: boolean;
  isProductionLike: boolean;
  port: number;
  sessionTtlMinutes: number;
  trustProxy: boolean;
  usesEphemeralAuthTokenSecret: boolean;
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const minimumAuthTokenSecretLength = 32;
const minimumBootstrapPasswordLength = 16;
const maximumBootstrapPasswordBytes = 72;
const knownPlaceholderSecrets = new Set([
  "change-this-local-docker-secret",
  "dev-only-change-me",
  "replace-with-a-long-random-docker-secret",
  "replace-with-a-long-random-local-secret",
  "replace-with-a-long-random-secret",
]);

function readTrimmed(env: NodeJS.ProcessEnv, name: string) {
  return env[name]?.trim() || "";
}

function parseBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
) {
  const value = readTrimmed(env, name);

  if (!value) {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new ConfigurationError(`${name} must be true or false.`);
}

function parsePositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
) {
  const value = readTrimmed(env, name);

  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }

  return parsed;
}

export function isPlaceholderAuthTokenSecret(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  return (
    knownPlaceholderSecrets.has(normalizedValue) ||
    normalizedValue.startsWith("replace-with-")
  );
}

function readBootstrapAdmin(env: NodeJS.ProcessEnv): BootstrapAdmin | null {
  const username = readTrimmed(env, "INITIAL_ADMIN_USERNAME");
  const email = readTrimmed(env, "INITIAL_ADMIN_EMAIL");
  const password = env.INITIAL_ADMIN_PASSWORD || "";
  const name = readTrimmed(env, "INITIAL_ADMIN_NAME") || username;
  const hasAnyValue = Boolean(username || email || password || readTrimmed(env, "INITIAL_ADMIN_NAME"));

  if (!hasAnyValue) {
    return null;
  }

  if (!username || !email || !password) {
    throw new ConfigurationError(
      "INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD must be set together.",
    );
  }

  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    throw new ConfigurationError(
      "INITIAL_ADMIN_USERNAME must be 3-64 characters using letters, numbers, dots, underscores, or hyphens.",
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConfigurationError("INITIAL_ADMIN_EMAIL must be a valid email address.");
  }

  if (password.length < minimumBootstrapPasswordLength) {
    throw new ConfigurationError(
      `INITIAL_ADMIN_PASSWORD must be at least ${minimumBootstrapPasswordLength} characters.`,
    );
  }

  if (Buffer.byteLength(password, "utf8") > maximumBootstrapPasswordBytes) {
    throw new ConfigurationError(
      `INITIAL_ADMIN_PASSWORD must be at most ${maximumBootstrapPasswordBytes} UTF-8 bytes because bcrypt ignores later bytes.`,
    );
  }

  return {
    email: email.toLowerCase(),
    name,
    password,
    username: username.toLowerCase(),
  };
}

function readAuthTokenSecret(
  env: NodeJS.ProcessEnv,
  isProductionLike: boolean,
) {
  const configuredSecret = readTrimmed(env, "AUTH_TOKEN_SECRET");
  const isUsable =
    configuredSecret.length >= minimumAuthTokenSecretLength &&
    !isPlaceholderAuthTokenSecret(configuredSecret);

  if (isUsable) {
    return {
      secret: configuredSecret,
      usesEphemeralAuthTokenSecret: false,
    };
  }

  if (isProductionLike) {
    const reason = !configuredSecret
      ? "must be set"
      : isPlaceholderAuthTokenSecret(configuredSecret)
        ? "must not use a placeholder value"
        : `must be at least ${minimumAuthTokenSecretLength} characters`;

    throw new ConfigurationError(
      `AUTH_TOKEN_SECRET ${reason} in a production-like environment.`,
    );
  }

  return {
    secret: crypto.randomBytes(48).toString("base64url"),
    usesEphemeralAuthTokenSecret: true,
  };
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const environment = readTrimmed(env, "NODE_ENV");
  const isExplicitlyLocalEnvironment =
    environment === "development" || environment === "test";
  // Treat an omitted, misspelled, or deployment-specific environment as
  // production-like. This makes the insecure conveniences opt-in instead of
  // allowing a typo such as NODE_ENV=staging to enable demo accounts.
  const isProductionLike = !isExplicitlyLocalEnvironment;
  const demoMode = parseBoolean(env, "DEMO_MODE", false);

  if (demoMode && !isExplicitlyLocalEnvironment) {
    throw new ConfigurationError(
      "DEMO_MODE=true is allowed only when NODE_ENV is explicitly development or test.",
    );
  }

  const auth = readAuthTokenSecret(env, isProductionLike);
  const bootstrapAdmin = readBootstrapAdmin(env);

  if (demoMode && bootstrapAdmin) {
    throw new ConfigurationError(
      "DEMO_MODE=true cannot be combined with INITIAL_ADMIN_* settings.",
    );
  }

  return Object.freeze({
    authTokenSecret: auth.secret,
    bootstrapAdmin,
    clientUrl: readTrimmed(env, "CLIENT_URL") || "http://localhost:5173",
    databasePath: readTrimmed(env, "DATABASE_PATH") || undefined,
    demoMode,
    isProductionLike,
    port: parsePositiveInteger(env, "PORT", 5000),
    sessionTtlMinutes: parsePositiveInteger(env, "SESSION_TTL_MINUTES", 60),
    trustProxy: parseBoolean(env, "TRUST_PROXY", false),
    usesEphemeralAuthTokenSecret: auth.usesEphemeralAuthTokenSecret,
  });
}
