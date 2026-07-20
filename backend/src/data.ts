import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { runtimeConfig } from "./config";
import type {
  AlertRule,
  AuditStatus,
  LogEntry,
  LogLevel,
  Role,
  ServiceRecord,
  User,
} from "./types";

type UserRow = {
  email: string;
  id: string;
  name: string;
  password_hash: string;
  role: Role;
  username: string;
};

type AlertRuleRow = {
  condition: string;
  enabled: 0 | 1;
  id: string;
  name: string;
};

type LogEntryRow = {
  action: string | null;
  created_at: string;
  id: string;
  ip_address: string | null;
  level: LogLevel;
  message: string;
  status: AuditStatus | null;
};

type TableInfoRow = {
  name: string;
};

export type UserRoleUpdateResult =
  | { status: "not_found" }
  | { status: "last_admin" }
  | { status: "updated"; user: User };

const defaultDatabasePath = path.resolve(process.cwd(), "data", "daemondeck.sqlite");
const databasePath = runtimeConfig.databasePath
  ? path.resolve(runtimeConfig.databasePath)
  : defaultDatabasePath;

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    condition TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'critical')),
    message TEXT NOT NULL,
    action TEXT,
    status TEXT CHECK (status IS NULL OR status IN ('success', 'failure', 'blocked')),
    ip_address TEXT,
    created_at TEXT NOT NULL
  );
`);

function ensureActivityLogColumn(name: string, sql: string) {
  const columns = db.prepare("PRAGMA table_info(activity_logs)").all() as TableInfoRow[];

  if (!columns.some((column) => column.name === name)) {
    db.exec(sql);
  }
}

ensureActivityLogColumn(
  "action",
  "ALTER TABLE activity_logs ADD COLUMN action TEXT",
);
ensureActivityLogColumn(
  "status",
  "ALTER TABLE activity_logs ADD COLUMN status TEXT",
);
ensureActivityLogColumn(
  "ip_address",
  "ALTER TABLE activity_logs ADD COLUMN ip_address TEXT",
);

const demoUsers = [
  {
    email: "demo@example.com",
    id: "user-1",
    name: "Demo User",
    role: "admin" as const,
    username: "demo",
  },
  {
    email: "viewer@example.com",
    id: "user-2",
    name: "Viewer User",
    role: "viewer" as const,
    username: "viewer",
  },
  {
    email: "operator@example.com",
    id: "user-3",
    name: "Operator User",
    role: "operator" as const,
    username: "operator",
  },
];

const demoAlertRules = [
  {
    condition: "Free memory below 15%",
    enabled: true,
    id: "alert-memory",
    name: "Low memory",
  },
  {
    condition: "System uptime below 5 minutes",
    enabled: false,
    id: "alert-uptime",
    name: "Recent restart",
  },
];

const legacyDemoUserIds = ["user-1", "user-2", "user-3"];

function nowIso() {
  return new Date().toISOString();
}

function mapUser(row: UserRow): User {
  return {
    email: row.email,
    id: row.id,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role,
    username: row.username,
  };
}

function mapAlertRule(row: AlertRuleRow): AlertRule {
  return {
    condition: row.condition,
    enabled: row.enabled === 1,
    id: row.id,
    name: row.name,
  };
}

function mapLogEntry(row: LogEntryRow): LogEntry {
  return {
    action: row.action,
    createdAt: row.created_at,
    id: row.id,
    ipAddress: row.ip_address,
    level: row.level,
    message: row.message,
    status: row.status,
  };
}

function getUserCount() {
  return (
    db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }
  ).count;
}

function getAdminCount() {
  return (
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as {
      count: number;
    }
  ).count;
}

function hasLegacyDemoUsers() {
  const placeholders = legacyDemoUserIds.map(() => "?").join(", ");
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM users WHERE id IN (${placeholders})`)
    .get(...legacyDemoUserIds) as { count: number };

  return row.count > 0;
}

function insertUser(user: {
  email: string;
  id: string;
  name: string;
  password: string;
  role: Role;
  username: string;
}) {
  const createdAt = nowIso();

  db.prepare(`
    INSERT INTO users (
      id,
      name,
      username,
      email,
      role,
      password_hash,
      created_at,
      updated_at
    )
    VALUES (@id, @name, @username, @email, @role, @passwordHash, @createdAt, @updatedAt)
  `).run({
    ...user,
    createdAt,
    passwordHash: bcrypt.hashSync(user.password, 12),
    updatedAt: createdAt,
  });
}

function seedDatabase() {
  if (runtimeConfig.isProductionLike && hasLegacyDemoUsers()) {
    throw new Error(
      "Legacy demo accounts were found in this production database. Remove or migrate user-1, user-2, and user-3 before starting DaemonDeck in production.",
    );
  }

  if (getUserCount() === 0) {
    if (runtimeConfig.demoMode) {
      for (const user of demoUsers) {
        insertUser({ ...user, password: "password123" });
      }
    } else if (runtimeConfig.bootstrapAdmin) {
      insertUser({
        ...runtimeConfig.bootstrapAdmin,
        id: crypto.randomUUID(),
        role: "admin",
      });
    } else {
      throw new Error(
        "No users exist. Set INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD, or set DEMO_MODE=true with NODE_ENV=development or test.",
      );
    }
  }

  const alertCount = db.prepare("SELECT COUNT(*) AS count FROM alert_rules").get() as {
    count: number;
  };

  if (runtimeConfig.demoMode && alertCount.count === 0) {
    const insertAlertRule = db.prepare(`
      INSERT INTO alert_rules (
        id,
        name,
        condition,
        enabled,
        created_at,
        updated_at
      )
      VALUES (@id, @name, @condition, @enabled, @createdAt, @updatedAt)
    `);
    const createdAt = nowIso();

    for (const alertRule of demoAlertRules) {
      insertAlertRule.run({
        ...alertRule,
        createdAt,
        enabled: alertRule.enabled ? 1 : 0,
        updatedAt: createdAt,
      });
    }
  }

  const logCount = db.prepare("SELECT COUNT(*) AS count FROM activity_logs").get() as {
    count: number;
  };

  if (logCount.count === 0) {
    db.prepare(`
      INSERT INTO activity_logs (
        id,
        level,
        message,
        action,
        status,
        ip_address,
        created_at
      )
      VALUES (@id, @level, @message, @action, @status, @ipAddress, @createdAt)
    `).run({
      action: "system.startup",
      createdAt: nowIso(),
      id: crypto.randomUUID(),
      ipAddress: null,
      level: "info",
      message: "Dashboard API started",
      status: "success",
    });
  }
}

seedDatabase();

export const services: ServiceRecord[] = [
  { id: "api", name: "API server", status: "running", lastRestartedAt: null },
  { id: "worker", name: "Background worker", status: "running", lastRestartedAt: null },
  { id: "scheduler", name: "Task scheduler", status: "running", lastRestartedAt: null },
];

export function getUsers() {
  const rows = db
    .prepare("SELECT id, name, username, email, role, password_hash FROM users ORDER BY name")
    .all() as UserRow[];

  return rows.map(mapUser);
}

export function getUserById(id: string) {
  const row = db
    .prepare("SELECT id, name, username, email, role, password_hash FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;

  return row ? mapUser(row) : null;
}

export function getUserByIdentifier(identifier: string) {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const row = db
    .prepare(
      `
        SELECT id, name, username, email, role, password_hash
        FROM users
        WHERE lower(email) = ? OR lower(username) = ?
      `,
    )
    .get(normalizedIdentifier, normalizedIdentifier) as UserRow | undefined;

  return row ? mapUser(row) : null;
}

const updateUserRoleTransaction = db.transaction((id: string, role: Role): UserRoleUpdateResult => {
  const user = getUserById(id);

  if (!user) {
    return { status: "not_found" };
  }

  if (user.role === "admin" && role !== "admin" && getAdminCount() <= 1) {
    return { status: "last_admin" };
  }

  db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(
    role,
    nowIso(),
    id,
  );

  const updatedUser = getUserById(id);

  return updatedUser ? { status: "updated", user: updatedUser } : { status: "not_found" };
});

export function updateUserRole(id: string, role: Role) {
  return updateUserRoleTransaction(id, role);
}

export function getAlertRules() {
  const rows = db
    .prepare("SELECT id, name, condition, enabled FROM alert_rules ORDER BY name")
    .all() as AlertRuleRow[];

  return rows.map(mapAlertRule);
}

export function getAlertRuleById(id: string) {
  const row = db
    .prepare("SELECT id, name, condition, enabled FROM alert_rules WHERE id = ?")
    .get(id) as AlertRuleRow | undefined;

  return row ? mapAlertRule(row) : null;
}

export function updateAlertRuleEnabled(id: string, enabled: boolean) {
  db.prepare("UPDATE alert_rules SET enabled = ?, updated_at = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    nowIso(),
    id,
  );

  return getAlertRuleById(id);
}

export function getActivityLogs() {
  const rows = db
    .prepare(
      `
        SELECT id, level, message, action, status, ip_address, created_at
        FROM activity_logs
        ORDER BY created_at DESC
        LIMIT 100
      `,
    )
    .all() as LogEntryRow[];

  return rows.map(mapLogEntry);
}

export function addLog(
  message: string,
  level: LogLevel = "info",
  details: {
    action?: string;
    ipAddress?: string | null;
    status?: AuditStatus;
  } = {},
) {
  db.prepare(`
    INSERT INTO activity_logs (
      id,
      level,
      message,
      action,
      status,
      ip_address,
      created_at
    )
    VALUES (@id, @level, @message, @action, @status, @ipAddress, @createdAt)
  `).run({
    action: details.action || null,
    createdAt: nowIso(),
    id: crypto.randomUUID(),
    ipAddress: details.ipAddress || null,
    level,
    message,
    status: details.status || null,
  });
}

let databaseClosed = false;

export function closeDatabase() {
  if (databaseClosed) {
    return;
  }

  db.close();
  databaseClosed = true;
}
