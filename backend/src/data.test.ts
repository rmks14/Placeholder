import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const secureSecret = "correct-horse-battery-staple-with-extra-entropy-123456";
const bootstrapPassword = "a-long-bootstrap-password-123";

const inspectDatabaseScript = `
  import bcrypt from "bcryptjs";
  const dataModule = await import("./src/data.ts");
  const data = dataModule.default || dataModule;

  const checkedUser = data.getUserByIdentifier(process.env.CHECK_USERNAME || "");
  console.log(JSON.stringify({
    alertCount: data.getAlertRules().length,
    passwordMatches: checkedUser
      ? bcrypt.compareSync(process.env.CHECK_PASSWORD || "", checkedUser.passwordHash)
      : false,
    users: data.getUsers().map((user) => ({
      email: user.email,
      id: user.id,
      role: user.role,
      username: user.username,
    })),
  }));
  data.closeDatabase();
  data.closeDatabase();
`;

type DatabaseSnapshot = {
  alertCount: number;
  passwordMatches: boolean;
  users: Array<{
    email: string;
    id: string;
    role: string;
    username: string;
  }>;
};

function runDatabase(env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", inspectDatabaseScript],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        AUTH_TOKEN_SECRET: secureSecret,
        CHECK_PASSWORD: "",
        CHECK_USERNAME: "",
        DEMO_MODE: "false",
        INITIAL_ADMIN_EMAIL: "",
        INITIAL_ADMIN_NAME: "",
        INITIAL_ADMIN_PASSWORD: "",
        INITIAL_ADMIN_USERNAME: "",
        NODE_ENV: "test",
        ...env,
      },
    },
  );
}

function parseSnapshot(result: ReturnType<typeof runDatabase>) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout) as DatabaseSnapshot;
}

function withTemporaryDatabase(
  callback: (databasePath: string) => void,
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daemondeck-data-"));

  try {
    callback(path.join(directory, "daemondeck.sqlite"));
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}

test("a fresh production database creates only the explicit bootstrap administrator", () => {
  withTemporaryDatabase((databasePath) => {
    const first = parseSnapshot(
      runDatabase({
        CHECK_PASSWORD: bootstrapPassword,
        CHECK_USERNAME: "admin",
        DATABASE_PATH: databasePath,
        INITIAL_ADMIN_EMAIL: "admin@example.com",
        INITIAL_ADMIN_NAME: "Primary Administrator",
        INITIAL_ADMIN_PASSWORD: bootstrapPassword,
        INITIAL_ADMIN_USERNAME: "admin",
        NODE_ENV: "production",
      }),
    );

    assert.equal(first.users.length, 1);
    assert.equal(first.users[0]?.email, "admin@example.com");
    assert.match(first.users[0]?.id || "", /^[0-9a-f-]{36}$/i);
    assert.equal(first.users[0]?.role, "admin");
    assert.equal(first.users[0]?.username, "admin");
    assert.equal(first.alertCount, 0);
    assert.equal(first.passwordMatches, true);

    const second = parseSnapshot(
      runDatabase({
        CHECK_PASSWORD: bootstrapPassword,
        CHECK_USERNAME: "admin",
        DATABASE_PATH: databasePath,
        INITIAL_ADMIN_EMAIL: "replacement@example.com",
        INITIAL_ADMIN_PASSWORD: "a-different-bootstrap-password-456",
        INITIAL_ADMIN_USERNAME: "replacement",
        NODE_ENV: "production",
      }),
    );

    assert.equal(second.users.length, 1);
    assert.equal(second.users[0]?.username, "admin");
    assert.equal(second.passwordMatches, true);
  });
});

test("demo users and demo alert rules require explicit local demo mode", () => {
  withTemporaryDatabase((databasePath) => {
    const snapshot = parseSnapshot(
      runDatabase({
        CHECK_PASSWORD: "password123",
        CHECK_USERNAME: "demo",
        DATABASE_PATH: databasePath,
        DEMO_MODE: "true",
        NODE_ENV: "development",
      }),
    );

    assert.equal(snapshot.users.length, 3);
    assert.deepEqual(
      snapshot.users.map((user) => user.username).sort(),
      ["demo", "operator", "viewer"],
    );
    assert.equal(snapshot.alertCount, 2);
    assert.equal(snapshot.passwordMatches, true);
  });
});

test("invalid production configuration fails before a database file is created", () => {
  withTemporaryDatabase((databasePath) => {
    const result = runDatabase({
      AUTH_TOKEN_SECRET: "",
      DATABASE_PATH: databasePath,
      NODE_ENV: "production",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AUTH_TOKEN_SECRET must be set in a production-like environment/);
    assert.equal(fs.existsSync(databasePath), false);
  });
});

test("production rejects demo mode before a database file is created", () => {
  withTemporaryDatabase((databasePath) => {
    const result = runDatabase({
      DATABASE_PATH: databasePath,
      DEMO_MODE: "true",
      NODE_ENV: "production",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEMO_MODE=true.*development or test/);
    assert.equal(fs.existsSync(databasePath), false);
  });
});

test("production fails closed when a legacy demo database is detected", () => {
  withTemporaryDatabase((databasePath) => {
    parseSnapshot(
      runDatabase({
        DATABASE_PATH: databasePath,
        DEMO_MODE: "true",
        NODE_ENV: "development",
      }),
    );

    const result = runDatabase({
      DATABASE_PATH: databasePath,
      INITIAL_ADMIN_EMAIL: "admin@example.com",
      INITIAL_ADMIN_PASSWORD: bootstrapPassword,
      INITIAL_ADMIN_USERNAME: "admin",
      NODE_ENV: "production",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Legacy demo accounts were found/);
  });
});
