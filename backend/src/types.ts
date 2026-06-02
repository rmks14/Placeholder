export type Role = "viewer" | "operator" | "admin";
export type HealthStatus = "Healthy" | "Warning" | "Critical";
export type LogLevel = "info" | "warning" | "critical";
export type AuditStatus = "success" | "failure" | "blocked";

export type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  passwordHash: string;
};

export type PublicUser = Omit<User, "passwordHash">;

export type JwtPayload = {
  sub: string;
  role: Role;
  exp: number;
  iat: number;
  jti: string;
};

export type CurrentSession = {
  user: User;
  payload: JwtPayload;
};

export type ServerOverview = {
  activeServiceCount: number;
  cpuUsagePercent: number;
  criticalAlertCount: number;
  currentTime: string;
  diskUsagePercent: number;
  health: HealthStatus;
  hostname: string;
  kernel: string;
  memoryUsagePercent: number;
  operatingSystem: string;
  platform: string;
  runningProcessCount: number;
  uptimeSeconds: number;
  warningAlertCount: number;
};

export type CpuCoreMetric = {
  core: number;
  usagePercent: number;
};

export type DiskPartition = {
  available: number;
  filesystem: string;
  mount: string;
  status: HealthStatus;
  total: number;
  type: string;
  usagePercent: number;
  used: number;
};

export type ProcessRecord = {
  command: string;
  cpuUsagePercent: number;
  id: string;
  lastRestartedAt: string | null;
  memoryUsagePercent: number;
  name: string;
  pid: number;
  startTime: string;
  status: string;
  user: string;
};

export type ServiceRecord = {
  id: string;
  name: string;
  status: "running" | "restarting";
  lastRestartedAt: string | null;
};

export type AlertRule = {
  id: string;
  name: string;
  condition: string;
  enabled: boolean;
};

export type LogEntry = {
  action: string | null;
  id: string;
  ipAddress: string | null;
  level: LogLevel;
  message: string;
  status: AuditStatus | null;
  createdAt: string;
};
