import { FormEvent, lazy, Suspense, useEffect, useState } from "react";

const MetricTrendChart = lazy(() => import("./MetricTrendChart"));

const configuredApiUrl = import.meta.env.VITE_API_URL;
const apiUrl =
  configuredApiUrl && configuredApiUrl.length > 0
    ? configuredApiUrl
    : import.meta.env.DEV
      ? "http://localhost:5000"
      : "";
const tokenStorageKey = "daemondeck-token";
const refreshIntervals = [
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
] as const;

type Role = "viewer" | "operator" | "admin";
type RefreshIntervalMs = (typeof refreshIntervals)[number]["value"];

type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
};

type AuthResponse = {
  token: string;
  user: User;
  sessionExpiresAt: string;
  message?: string;
};

type SessionResponse = {
  user: User;
  sessionExpiresAt: string;
};

type ServerOverview = {
  activeServiceCount: number;
  cpuUsagePercent: number;
  criticalAlertCount: number;
  currentTime: string;
  diskUsagePercent: number;
  health: "Healthy" | "Warning" | "Critical";
  hostname: string;
  kernel: string;
  memoryUsagePercent: number;
  operatingSystem: string;
  platform: string;
  runningProcessCount: number;
  uptimeSeconds: number;
  warningAlertCount: number;
};

type HealthStatus = "Healthy" | "Warning" | "Critical";

type UsageThresholds = {
  warning: number;
  critical: number;
};

type MetricProcess = {
  command: string;
  cpuUsagePercent: number;
  id: string;
  memoryUsagePercent: number;
  name: string;
  pid: number;
  status: string;
  user: string;
};

type CpuMetrics = {
  cpuUsagePercent: number;
  loadAverage: number[];
  perCoreUsage: Array<{
    core: number;
    usagePercent: number;
  }>;
  status: HealthStatus;
  thresholds: UsageThresholds;
  topProcesses: MetricProcess[];
};

type MemoryMetrics = {
  availableMemory: number;
  freeMemory: number;
  memoryUsagePercent: number;
  status: HealthStatus;
  swapFree: number;
  swapTotal: number;
  swapUsagePercent: number;
  swapUsed: number;
  thresholds: UsageThresholds;
  topProcesses: MetricProcess[];
  totalMemory: number;
  usedMemory: number;
};

type DiskPartition = {
  available: number;
  filesystem: string;
  mount: string;
  status: HealthStatus;
  total: number;
  type: string;
  usagePercent: number;
  used: number;
};

type DiskMetrics = {
  available: number;
  partitions: DiskPartition[];
  status: HealthStatus;
  thresholds: UsageThresholds;
  total: number;
  usagePercent: number;
  used: number;
};

type TrendPoint = {
  cpu: number;
  disk: number;
  memory: number;
  time: string;
};

type LiveMetricsMessage = {
  cpu: CpuMetrics;
  currentTime: string;
  disk: DiskMetrics;
  memory: MemoryMetrics;
  type: "metrics";
};

type LogEntry = {
  action: string | null;
  id: string;
  ipAddress: string | null;
  level: "info" | "warning" | "critical";
  message: string;
  status: "success" | "failure" | "blocked" | null;
  createdAt: string;
};

type ProcessRecord = {
  command: string;
  cpuUsagePercent: number;
  id: string;
  memoryUsagePercent: number;
  name: string;
  pid: number;
  startTime: string;
  status: string;
  user: string;
  lastRestartedAt: string | null;
};

type ManagedProcessAction = {
  id: string;
  lastRestartedAt: string | null;
  name: string;
  status: string;
};

type AlertRule = {
  id: string;
  name: string;
  condition: string;
  enabled: boolean;
};

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T | null>;

function App() {
  const [route, setRoute] = useState(() => window.location.pathname || "/");
  const [token, setToken] = useState(() => localStorage.getItem(tokenStorageKey));
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    function handlePopState() {
      setRoute(window.location.pathname || "/");
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(tokenStorageKey);

    if (!storedToken) {
      setLoading(false);
      return;
    }

    void restoreSession(storedToken);
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user && route !== "/login") {
      navigate("/login", true);
      return;
    }

    if (user && (route === "/" || route === "/login")) {
      navigate("/dashboard", true);
    }
  }, [loading, route, user]);

  function navigate(nextRoute: string, replace = false) {
    if (window.location.pathname !== nextRoute) {
      if (replace) {
        window.history.replaceState(null, "", nextRoute);
      } else {
        window.history.pushState(null, "", nextRoute);
      }
    }

    setRoute(nextRoute);
  }

  async function restoreSession(storedToken: string) {
    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      if (response.status === 401) {
        clearSession("Your session expired. Please sign in again.");
        return;
      }

      if (!response.ok) {
        throw new Error("Could not restore session.");
      }

      const data = (await response.json()) as SessionResponse;
      setToken(storedToken);
      setUser(data.user);
      setSessionExpiresAt(data.sessionExpiresAt);
    } catch {
      clearSession("Could not restore your session. Please sign in again.");
    } finally {
      setLoading(false);
    }
  }

  function saveSession(
    nextToken: string,
    nextUser: User,
    nextSessionExpiresAt: string,
  ) {
    localStorage.setItem(tokenStorageKey, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setSessionExpiresAt(nextSessionExpiresAt);
    setNotice("");
    setError("");
    navigate("/dashboard", true);
  }

  function clearSession(message = "") {
    localStorage.removeItem(tokenStorageKey);
    setToken(null);
    setUser(null);
    setSessionExpiresAt("");
    setNotice("");
    setError(message);
  }

  function clearMessages() {
    setNotice("");
    setError("");
  }

  async function login(identifier: string, password: string) {
    clearMessages();

    const response = await fetch(`${apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = (await response.json()) as Partial<AuthResponse>;

    if (!response.ok || !data.token || !data.user || !data.sessionExpiresAt) {
      throw new Error(data.message || "Login failed.");
    }

    saveSession(data.token, data.user, data.sessionExpiresAt);
  }

  async function logout() {
    if (token) {
      await fetch(`${apiUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }

    clearSession();
    navigate("/login", true);
  }

  async function apiRequest<T>(path: string, init: RequestInit = {}) {
    if (!token) {
      clearSession("Your session expired. Please sign in again.");
      navigate("/login", true);
      return null;
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers,
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      clearSession("Your session expired. Please sign in again.");
      navigate("/login", true);
      return null;
    }

    if (!response.ok) {
      throw new Error(data.message || "Request failed.");
    }

    return data as T;
  }

  async function checkSession() {
    clearMessages();

    const data = await apiRequest<SessionResponse>("/api/auth/me");

    if (!data) {
      return;
    }

    setUser(data.user);
    setSessionExpiresAt(data.sessionExpiresAt);
    setNotice("Session is active.");
  }

  async function checkBackend() {
    clearMessages();

    try {
      const response = await fetch(`${apiUrl}/api/health`);

      if (!response.ok) {
        throw new Error("Backend returned an error.");
      }

      const data = (await response.json()) as { status: string };
      setNotice(`Backend health: ${data.status}`);
    } catch {
      setError("Could not connect to the backend.");
    }
  }

  if (loading) {
    return (
      <main className="page">
        <section className="panel">
          <p className="eyebrow">DaemonDeck</p>
          <h1>Checking session</h1>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <LoginPage
        error={error}
        onClearMessages={clearMessages}
        onLogin={login}
      />
    );
  }

  return (
    <DashboardPage
      apiRequest={apiRequest}
      error={error}
      navigate={navigate}
      notice={notice}
      onCheckBackend={checkBackend}
      onCheckSession={checkSession}
      onLogout={logout}
      route={route}
      sessionExpiresAt={sessionExpiresAt}
      token={token}
      user={user}
    />
  );
}

function LoginPage({
  error,
  onClearMessages,
  onLogin,
}: {
  error: string;
  onClearMessages: () => void;
  onLogin: (identifier: string, password: string) => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const visibleError = loginError || error;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLoginError("");
    onClearMessages();

    try {
      await onLogin(identifier.trim(), password);
    } catch (caughtError) {
      setLoginError(
        caughtError instanceof Error ? caughtError.message : "Could not sign in.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">DaemonDeck</p>
        <h1>Sign in</h1>
        <p className="description">Use one of the local demo accounts.</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Email or username
            <input
              autoComplete="username"
              onChange={(event) => {
                setIdentifier(event.target.value);
                setLoginError("");
                onClearMessages();
              }}
              placeholder="demo"
              required
              type="text"
              value={identifier}
            />
          </label>

          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event) => {
                setPassword(event.target.value);
                setLoginError("");
                onClearMessages();
              }}
              placeholder="Enter password"
              required
              type="password"
              value={password}
            />
          </label>

          <button disabled={submitting} type="submit">
            {submitting ? "Signing in..." : "Login"}
          </button>
        </form>

        {visibleError && <p className="error">{visibleError}</p>}
      </section>
    </main>
  );
}

function DashboardPage({
  apiRequest,
  error,
  navigate,
  notice,
  onCheckBackend,
  onCheckSession,
  onLogout,
  route,
  sessionExpiresAt,
  token,
  user,
}: {
  apiRequest: ApiRequest;
  error: string;
  navigate: (nextRoute: string) => void;
  notice: string;
  onCheckBackend: () => Promise<void>;
  onCheckSession: () => Promise<void>;
  onLogout: () => Promise<void>;
  route: string;
  sessionExpiresAt: string;
  token: string | null;
  user: User;
}) {
  const canAdmin = user.role === "admin";
  const knownRoute =
    route === "/dashboard" ||
    route === "/dashboard/metrics" ||
    route === "/dashboard/logs" ||
    route === "/dashboard/processes" ||
    route === "/dashboard/admin";
  const tabs = [
    { label: "Overview", path: "/dashboard" },
    { label: "Metrics", path: "/dashboard/metrics" },
    { label: "Processes", path: "/dashboard/processes" },
    { label: "Logs", path: "/dashboard/logs" },
    ...(canAdmin ? [{ label: "Admin", path: "/dashboard/admin" }] : []),
  ];

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">DaemonDeck</p>
            <h1>Dashboard</h1>
          </div>

          <button className="secondary" onClick={onLogout}>
            Logout
          </button>
        </header>

        <nav className="tabs" aria-label="Dashboard sections">
          {tabs.map((tab) => (
            <button
              className={route === tab.path ? "tab active" : "tab"}
              key={tab.path}
              onClick={() => navigate(tab.path)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {route === "/dashboard" && (
          <OverviewPanel
            apiRequest={apiRequest}
            error={error}
            notice={notice}
            onCheckBackend={onCheckBackend}
            onCheckSession={onCheckSession}
            sessionExpiresAt={sessionExpiresAt}
            user={user}
          />
        )}
        {route === "/dashboard/metrics" && (
          <MetricsPanel apiRequest={apiRequest} token={token} />
        )}
        {route === "/dashboard/processes" && (
          <ProcessesPanel apiRequest={apiRequest} user={user} />
        )}
        {route === "/dashboard/logs" && <LogsPanel apiRequest={apiRequest} />}
        {route === "/dashboard/admin" && canAdmin && (
          <AdminPanel apiRequest={apiRequest} currentUser={user} />
        )}
        {route === "/dashboard/admin" && !canAdmin && (
          <MessagePanel message="You do not have permission to view this section." />
        )}
        {!knownRoute && <MessagePanel message="Dashboard section was not found." />}
      </section>
    </main>
  );
}

function OverviewPanel({
  apiRequest,
  error,
  notice,
  onCheckBackend,
  onCheckSession,
  sessionExpiresAt,
  user,
}: {
  apiRequest: ApiRequest;
  error: string;
  notice: string;
  onCheckBackend: () => Promise<void>;
  onCheckSession: () => Promise<void>;
  sessionExpiresAt: string;
  user: User;
}) {
  return (
    <>
      <section className="panel account-panel">
        <h2>Signed in as {user.name}</h2>
        <dl className="detail-list">
          <Detail label="Username" value={user.username} />
          <Detail label="Email" value={user.email} />
          <Detail label="Role" value={user.role} />
        </dl>
      </section>

      <ServerOverviewPanel apiRequest={apiRequest} />

      <section className="panel">
        <h2>Session</h2>
        <p className="description">
          This dashboard is visible while your JWT is valid.
        </p>
        {sessionExpiresAt && (
          <p className="description">
            Session expires {formatDateTime(sessionExpiresAt)}.
          </p>
        )}

        <div className="actions">
          <button onClick={onCheckSession}>Check session</button>
          <button className="secondary" onClick={onCheckBackend}>
            Check backend
          </button>
        </div>

        {notice && <p className="success">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </>
  );
}

function ServerOverviewPanel({ apiRequest }: { apiRequest: ApiRequest }) {
  const [overview, setOverview] = useState<ServerOverview | null>(null);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadOverview() {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest<ServerOverview>("/api/server/overview");

      if (data) {
        setOverview(data);
        setLastUpdatedAt(new Date());
      }
    } catch (caughtError) {
      setOverview(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not load server overview.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Server Overview</h2>
        <button className="secondary" disabled={loading} onClick={loadOverview}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="muted">
        Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt.toISOString()) : "Never"}
      </p>

      {overview ? (
        <>
          <div className="card-grid">
            <StatCard
              className={getHealthClass(overview.health)}
              label="Health"
              value={overview.health}
            />
            <StatCard label="CPU" value={`${overview.cpuUsagePercent}%`} />
            <StatCard label="Memory" value={`${overview.memoryUsagePercent}%`} />
            <StatCard label="Disk" value={`${overview.diskUsagePercent}%`} />
            <StatCard label="Uptime" value={formatUptime(overview.uptimeSeconds)} />
            <StatCard label="Processes" value={String(overview.runningProcessCount)} />
            <StatCard label="Services" value={String(overview.activeServiceCount)} />
            <StatCard
              label="Alerts"
              value={`${overview.warningAlertCount} warning / ${overview.criticalAlertCount} critical`}
            />
          </div>

          <dl className="detail-list compact-details">
            <Detail label="Hostname" value={overview.hostname} />
            <Detail label="Operating system" value={overview.operatingSystem} />
            <Detail label="Platform" value={overview.platform} />
            <Detail label="Kernel" value={overview.kernel} />
            <Detail
              label="Current time"
              value={formatDateTime(overview.currentTime)}
            />
          </dl>
        </>
      ) : (
        <p className="description">
          {loading ? "Loading server details..." : "Server details are not loaded yet."}
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

function StatCard({
  className = "",
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="stat-card">
      <dt>{label}</dt>
      <dd className={className}>{value}</dd>
    </div>
  );
}

function MetricsPanel({
  apiRequest,
  token,
}: {
  apiRequest: ApiRequest;
  token: string | null;
}) {
  const [cpuMetrics, setCpuMetrics] = useState<CpuMetrics | null>(null);
  const [memoryMetrics, setMemoryMetrics] = useState<MemoryMetrics | null>(null);
  const [diskMetrics, setDiskMetrics] = useState<DiskMetrics | null>(null);
  const [history, setHistory] = useState<TrendPoint[]>([]);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [liveStatus, setLiveStatus] = useState("Connecting");
  const [refreshIntervalMs, setRefreshIntervalMs] =
    useState<RefreshIntervalMs>(5000);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const hasMetrics = Boolean(cpuMetrics || memoryMetrics || diskMetrics);

  function applyMetrics(
    cpuData: CpuMetrics,
    memoryData: MemoryMetrics,
    diskData: DiskMetrics,
    timestamp = new Date(),
  ) {
    setCpuMetrics(cpuData);
    setMemoryMetrics(memoryData);
    setDiskMetrics(diskData);
    setLastUpdatedAt(timestamp);
    setHistory((current) => [
      ...current.slice(-19),
      {
        cpu: cpuData.cpuUsagePercent,
        disk: diskData.usagePercent,
        memory: memoryData.memoryUsagePercent,
        time: new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(timestamp),
      },
    ]);
  }

  async function loadMetrics() {
    setLoading(true);
    setError("");

    try {
      const [cpuData, memoryData, diskData] = await Promise.all([
        apiRequest<CpuMetrics>("/api/metrics/cpu"),
        apiRequest<MemoryMetrics>("/api/metrics/memory"),
        apiRequest<DiskMetrics>("/api/metrics/disk"),
      ]);

      if (cpuData && memoryData && diskData) {
        applyMetrics(cpuData, memoryData, diskData);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not load metrics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMetrics();
  }, []);

  useEffect(() => {
    if (!liveEnabled) {
      setLiveStatus("Paused");
      return;
    }

    if (!token) {
      setLiveStatus("Disconnected");
      return;
    }

    let disposed = false;
    const ws = new WebSocket(getWebSocketUrl(token, refreshIntervalMs));

    ws.onopen = () => {
      if (disposed) {
        return;
      }

      setLiveStatus("Live");
      setError("");
    };

    ws.onmessage = (event) => {
      if (disposed) {
        return;
      }

      try {
        const data = JSON.parse(String(event.data)) as LiveMetricsMessage | { message?: string; type: "error" };

        if (data.type === "metrics") {
          applyMetrics(data.cpu, data.memory, data.disk, new Date(data.currentTime));
          return;
        }

        setError(data.message || "Live metrics stream returned an error.");
      } catch {
        setError("Live metrics stream returned invalid data.");
      }
    };

    ws.onerror = () => {
      if (disposed) {
        return;
      }

      setLiveStatus("Connection issue");
      void loadMetrics();
    };

    ws.onclose = () => {
      if (disposed) {
        return;
      }

      setLiveStatus("Disconnected");
    };

    return () => {
      disposed = true;
      ws.close();
    };
  }, [liveEnabled, refreshIntervalMs, token]);

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>System Metrics</h2>
        <div className="inline-actions">
          <label className="control-label">
            Refresh
            <select
              aria-label="Refresh interval"
              onChange={(event) =>
                setRefreshIntervalMs(Number(event.target.value) as RefreshIntervalMs)
              }
              value={refreshIntervalMs}
            >
              {refreshIntervals.map((interval) => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={liveEnabled ? "secondary active-action" : "secondary"}
            onClick={() => setLiveEnabled((current) => !current)}
          >
            {liveEnabled ? "Live on" : "Live off"}
          </button>
          <button className="secondary" disabled={loading} onClick={loadMetrics}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      <div className="status-row">
        <p className="muted">Live status: {liveStatus}</p>
        <p className="muted">
          Last updated:{" "}
          {lastUpdatedAt ? formatDateTime(lastUpdatedAt.toISOString()) : "Never"}
        </p>
      </div>

      {loading && !hasMetrics && (
        <p className="description">Loading system metrics...</p>
      )}

      {!loading && !hasMetrics && !error && (
        <p className="description">
          Metrics have not loaded yet. Use refresh or resume live updates.
        </p>
      )}

      {hasMetrics && (
        <div className="metrics-stack">
          {history.length > 0 && (
            <section>
              <h3>Usage trends</h3>
              <Suspense fallback={<p className="muted">Loading chart...</p>}>
                <MetricTrendChart data={history} />
              </Suspense>
            </section>
          )}

          {cpuMetrics && (
            <>
              <section>
                <h3>CPU Monitoring</h3>
                <div className="card-grid">
                  <StatCard
                    className={getHealthClass(cpuMetrics.status)}
                    label="CPU usage"
                    value={`${round(cpuMetrics.cpuUsagePercent)}%`}
                  />
                  <StatCard
                    label="Load average"
                    value={cpuMetrics.loadAverage.map(round).join(", ")}
                  />
                  <StatCard
                    className={getHealthClass(cpuMetrics.status)}
                    label="Status"
                    value={cpuMetrics.status}
                  />
                </div>
              </section>

              <section>
                <h3>Per-core usage</h3>
                <div className="core-list">
                  {cpuMetrics.perCoreUsage.map((core) => (
                    <div className="core-row" key={core.core}>
                      <span>Core {core.core + 1}</span>
                      <div className="meter" aria-label={`Core ${core.core + 1} CPU usage`}>
                        <span
                          className={`meter-fill ${getUsageClass(
                            core.usagePercent,
                            cpuMetrics.thresholds,
                          )}`}
                          style={{ width: `${clampPercent(core.usagePercent)}%` }}
                        />
                      </div>
                      <strong>{round(core.usagePercent)}%</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3>Top CPU Processes</h3>
                <MetricProcessTable
                  processes={cpuMetrics.topProcesses}
                  thresholds={cpuMetrics.thresholds}
                  valueKey="cpuUsagePercent"
                  valueLabel="CPU"
                />
              </section>
            </>
          )}

          {memoryMetrics && (
            <>
              <section>
                <h3>Memory Monitoring</h3>
                <div className="card-grid">
                  <StatCard
                    className={getHealthClass(memoryMetrics.status)}
                    label="Memory usage"
                    value={`${round(memoryMetrics.memoryUsagePercent)}%`}
                  />
                  <StatCard
                    label="Used"
                    value={formatBytes(memoryMetrics.usedMemory)}
                  />
                  <StatCard
                    label="Free"
                    value={formatBytes(memoryMetrics.freeMemory)}
                  />
                  <StatCard
                    label="Status"
                    value={memoryMetrics.status}
                    className={getHealthClass(memoryMetrics.status)}
                  />
                </div>
              </section>

              <section>
                <h3>Used/free memory</h3>
                <div className="memory-meter">
                  <div className="meter" aria-label="Memory usage">
                    <span
                      className={`meter-fill ${getUsageClass(
                        memoryMetrics.memoryUsagePercent,
                        memoryMetrics.thresholds,
                      )}`}
                      style={{ width: `${clampPercent(memoryMetrics.memoryUsagePercent)}%` }}
                    />
                  </div>
                  <p className="muted">
                    {formatBytes(memoryMetrics.usedMemory)} used /{" "}
                    {formatBytes(memoryMetrics.totalMemory)} total
                  </p>
                </div>
              </section>

              <section>
                <h3>Swap usage</h3>
                <div className="card-grid">
                  <StatCard
                    label="Swap used"
                    value={
                      memoryMetrics.swapTotal > 0
                        ? `${round(memoryMetrics.swapUsagePercent)}%`
                        : "Not configured"
                    }
                  />
                  <StatCard
                    label="Swap detail"
                    value={
                      memoryMetrics.swapTotal > 0
                        ? `${formatBytes(memoryMetrics.swapUsed)} / ${formatBytes(
                            memoryMetrics.swapTotal,
                          )}`
                        : "-"
                    }
                  />
                </div>
              </section>

              <section>
                <h3>Top Memory Processes</h3>
                <MetricProcessTable
                  processes={memoryMetrics.topProcesses}
                  thresholds={memoryMetrics.thresholds}
                  valueKey="memoryUsagePercent"
                  valueLabel="Memory"
                />
              </section>
            </>
          )}

          {diskMetrics && (
            <>
              <section>
                <h3>Disk Monitoring</h3>
                <div className="card-grid">
                  <StatCard
                    className={getHealthClass(diskMetrics.status)}
                    label="Disk usage"
                    value={`${round(diskMetrics.usagePercent)}%`}
                  />
                  <StatCard label="Used" value={formatBytes(diskMetrics.used)} />
                  <StatCard
                    label="Available"
                    value={formatBytes(diskMetrics.available)}
                  />
                  <StatCard
                    className={getHealthClass(diskMetrics.status)}
                    label="Status"
                    value={diskMetrics.status}
                  />
                </div>
              </section>

              <section>
                <h3>Mounted partitions</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Mount</th>
                        <th>Filesystem</th>
                        <th>Total</th>
                        <th>Used</th>
                        <th>Available</th>
                        <th>Usage</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diskMetrics.partitions.map((partition) => (
                        <tr
                          className={`row-${partition.status.toLowerCase()}`}
                          key={`${partition.filesystem}-${partition.mount}`}
                        >
                          <td>{partition.mount}</td>
                          <td>{partition.filesystem || partition.type}</td>
                          <td>{formatBytes(partition.total)}</td>
                          <td>{formatBytes(partition.used)}</td>
                          <td>{formatBytes(partition.available)}</td>
                          <td
                            className={getUsageClass(
                              partition.usagePercent,
                              diskMetrics.thresholds,
                            )}
                          >
                            {round(partition.usagePercent)}%
                          </td>
                          <td className={getHealthClass(partition.status)}>
                            {partition.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

function MetricProcessTable({
  processes,
  thresholds,
  valueKey,
  valueLabel,
}: {
  processes: MetricProcess[];
  thresholds: UsageThresholds;
  valueKey: "cpuUsagePercent" | "memoryUsagePercent";
  valueLabel: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>PID</th>
            <th>Name</th>
            <th>User</th>
            <th>{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {processes.length > 0 ? (
            processes.map((processRecord) => (
              <tr key={processRecord.id}>
                <td>{processRecord.pid}</td>
                <td>{processRecord.name}</td>
                <td>{processRecord.user}</td>
                <td
                  className={getUsageClass(
                    processRecord[valueKey],
                    thresholds,
                  )}
                >
                  {round(processRecord[valueKey])}%
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="empty-cell" colSpan={4}>
                No process data available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LogsPanel({ apiRequest }: { apiRequest: ApiRequest }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadLogs() {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest<{ logs: LogEntry[] }>("/api/logs");

      if (data) {
        setLogs(data.logs);
        setLastUpdatedAt(new Date());
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not load logs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Logs</h2>
        <button className="secondary" disabled={loading} onClick={loadLogs}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="muted">
        Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt.toISOString()) : "Never"}
      </p>

      <div className="stack">
        {logs.map((log) => (
          <article className={`log-line log-${log.level}`} key={log.id}>
            <div>
              <strong>{log.message}</strong>
              <p className="muted">{formatDateTime(log.createdAt)}</p>
            </div>
            <div className="log-meta">
              {log.action && <span>{log.action}</span>}
              {log.status && <span>{log.status}</span>}
              {log.ipAddress && <span>{log.ipAddress}</span>}
            </div>
          </article>
        ))}
      </div>

      {loading && logs.length === 0 && <p className="description">Loading logs...</p>}
      {!loading && logs.length === 0 && !error && (
        <p className="description">No audit logs are available yet.</p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ProcessesPanel({
  apiRequest,
  user,
}: {
  apiRequest: ApiRequest;
  user: User;
}) {
  const [processes, setProcesses] = useState<ProcessRecord[]>([]);
  const [managedActions, setManagedActions] = useState<ManagedProcessAction[]>([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"cpu" | "memory">("cpu");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [selectedProcess, setSelectedProcess] = useState<ProcessRecord | null>(null);
  const canManageProcesses = user.role === "operator" || user.role === "admin";
  const visibleProcesses = [...processes]
    .filter((processRecord) =>
      processRecord.name.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sortBy === "cpu"
        ? b.cpuUsagePercent - a.cpuUsagePercent
        : b.memoryUsagePercent - a.memoryUsagePercent,
    );

  async function loadProcesses() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const [processData, actionData] = await Promise.all([
        apiRequest<{ processes: ProcessRecord[] }>("/api/processes"),
        canManageProcesses
          ? apiRequest<{ processes: ManagedProcessAction[] }>("/api/process-actions")
          : Promise.resolve(null),
      ]);

      if (processData) {
        setProcesses(processData.processes);
        setLastUpdatedAt(new Date());
      }

      if (actionData) {
        setManagedActions(actionData.processes);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not load processes.");
    } finally {
      setLoading(false);
    }
  }

  async function killProcess(processRecord: ProcessRecord) {
    const confirmed = window.confirm(
      [
        "This will send SIGTERM to a real process on the host.",
        "",
        `Name: ${processRecord.name}`,
        `PID: ${processRecord.pid}`,
        `User: ${processRecord.user}`,
        "",
        "Stopping the wrong process can interrupt applications, jobs, or the dashboard host.",
        "Continue only if you understand the impact.",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");
    setPendingAction(`kill-${processRecord.pid}`);

    try {
      const data = await apiRequest<{ message: string }>(
        `/api/processes/${processRecord.pid}`,
        { method: "DELETE" },
      );

      if (data) {
        setMessage(data.message);
        await loadProcesses();
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not stop process.");
    } finally {
      setPendingAction("");
    }
  }

  async function restartManagedAction(action: ManagedProcessAction) {
    setError("");
    setMessage("");
    setPendingAction(`restart-${action.id}`);

    try {
      const data = await apiRequest<{ message: string }>(
        `/api/process-actions/${action.id}/restart`,
        { method: "POST" },
      );

      if (data) {
        setMessage(data.message);
        await loadProcesses();
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not restart process.");
    } finally {
      setPendingAction("");
    }
  }

  useEffect(() => {
    void loadProcesses();
  }, []);

  return (
    <>
      <section className="panel">
      <div className="panel-heading">
        <h2>Process Monitoring</h2>
        <button className="secondary" disabled={loading} onClick={loadProcesses}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="muted">
        Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt.toISOString()) : "Never"}
      </p>
      <p className="description">
        {canManageProcesses
          ? "Operator actions are available for running processes."
          : "Viewer access is read-only."}
      </p>

      {canManageProcesses && managedActions.length > 0 && (
        <section className="action-panel">
          <h3>Managed restart actions</h3>
          <div className="stack">
            {managedActions.map((action) => (
              <div className="row" key={action.id}>
                <div>
                  <strong>{action.name}</strong>
                  <p className="muted">
                    {action.status}
                    {action.lastRestartedAt
                      ? ` - restarted ${formatDateTime(action.lastRestartedAt)}`
                      : ""}
                  </p>
                </div>
                <button
                  disabled={pendingAction === `restart-${action.id}`}
                  onClick={() => void restartManagedAction(action)}
                >
                  {pendingAction === `restart-${action.id}` ? "Restarting..." : "Restart"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="table-controls">
        <input
          aria-label="Search processes"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search process name"
          type="search"
          value={search}
        />
        <select
          aria-label="Sort processes"
          onChange={(event) => setSortBy(event.target.value as "cpu" | "memory")}
          value={sortBy}
        >
          <option value="cpu">Sort by CPU</option>
          <option value="memory">Sort by memory</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PID</th>
              <th>Name</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>User</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleProcesses.map((processRecord) => (
              <tr key={processRecord.id}>
                <td>{processRecord.pid}</td>
                <td>{processRecord.name}</td>
                <td>{round(processRecord.cpuUsagePercent)}%</td>
                <td>{round(processRecord.memoryUsagePercent)}%</td>
                <td>{processRecord.user}</td>
                <td>{processRecord.status}</td>
                <td>
                  <div className="inline-actions compact-actions">
                    <button
                      className="secondary"
                      onClick={() => setSelectedProcess(processRecord)}
                    >
                      Details
                    </button>
                    {canManageProcesses && (
                      <button
                        className="danger"
                        disabled={pendingAction === `kill-${processRecord.pid}`}
                        onClick={() => void killProcess(processRecord)}
                      >
                        {pendingAction === `kill-${processRecord.pid}` ? "Killing..." : "Kill"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && processes.length === 0 && (
        <p className="description">Loading process list...</p>
      )}
      {!loading && processes.length === 0 && !error && (
        <p className="description">No running processes were returned.</p>
      )}
      {!loading && processes.length > 0 && visibleProcesses.length === 0 && !error && (
        <p className="description">No processes match the current search.</p>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
    {selectedProcess && (
      <ProcessDetailsModal
        onClose={() => setSelectedProcess(null)}
        processRecord={selectedProcess}
      />
    )}
    </>
  );
}

function ProcessDetailsModal({
  onClose,
  processRecord,
}: {
  onClose: () => void;
  processRecord: ProcessRecord;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="modal-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Process details</p>
            <h2>{processRecord.name}</h2>
          </div>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <dl className="detail-list compact-details">
          <Detail label="PID" value={String(processRecord.pid)} />
          <Detail label="CPU usage" value={`${round(processRecord.cpuUsagePercent)}%`} />
          <Detail
            label="Memory usage"
            value={`${round(processRecord.memoryUsagePercent)}%`}
          />
          <Detail label="User" value={processRecord.user} />
          <Detail label="Status" value={processRecord.status} />
          <Detail label="Started" value={formatDateTime(processRecord.startTime)} />
        </dl>

        <div className="command-block">
          <strong>Command</strong>
          <code>{processRecord.command || processRecord.name}</code>
        </div>
      </section>
    </div>
  );
}

function AdminPanel({
  apiRequest,
  currentUser,
}: {
  apiRequest: ApiRequest;
  currentUser: User;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadAdminData() {
    setError("");

    try {
      const [usersData, alertsData] = await Promise.all([
        apiRequest<{ users: User[] }>("/api/admin/users"),
        apiRequest<{ alerts: AlertRule[] }>("/api/admin/alerts"),
      ]);

      if (usersData) {
        setUsers(usersData.users);
      }

      if (alertsData) {
        setAlerts(alertsData.alerts);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not load admin data.");
    }
  }

  async function changeRole(userId: string, role: Role) {
    setError("");
    setMessage("");

    try {
      const data = await apiRequest<{ user: User }>("/api/admin/users/" + userId + "/role", {
        body: JSON.stringify({ role }),
        method: "PATCH",
      });

      if (data) {
        setUsers((current) =>
          current.map((candidate) =>
            candidate.id === data.user.id ? data.user : candidate,
          ),
        );
        setMessage("User role updated.");
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not update role.");
    }
  }

  async function toggleAlert(alert: AlertRule) {
    setError("");
    setMessage("");

    try {
      const data = await apiRequest<{ alert: AlertRule }>("/api/admin/alerts/" + alert.id, {
        body: JSON.stringify({ enabled: !alert.enabled }),
        method: "PATCH",
      });

      if (data) {
        setAlerts((current) =>
          current.map((candidate) =>
            candidate.id === data.alert.id ? data.alert : candidate,
          ),
        );
        setMessage("Alert rule updated.");
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not update alert.");
    }
  }

  async function runSystemAction(action: string) {
    setError("");
    setMessage("");

    try {
      const data = await apiRequest<{ message: string }>("/api/admin/system-actions", {
        body: JSON.stringify({ action }),
        method: "POST",
      });

      if (data) {
        setMessage(data.message);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not run action.");
    }
  }

  useEffect(() => {
    void loadAdminData();
  }, []);

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Users</h2>
          <button className="secondary" onClick={loadAdminData}>
            Refresh
          </button>
        </div>
        <div className="stack">
          {users.map((account) => (
            <div className="row" key={account.id}>
              <div>
                <strong>{account.name}</strong>
                <p className="muted">
                  {account.username} - {account.role}
                </p>
              </div>
              <div className="inline-actions">
                {(["viewer", "operator", "admin"] as Role[]).map((role) => (
                  <button
                    className={account.role === role ? "secondary active-action" : "secondary"}
                    disabled={account.id === currentUser.id}
                    key={role}
                    onClick={() => void changeRole(account.id, role)}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Alert Rules</h2>
        <div className="stack spaced">
          {alerts.map((alert) => (
            <div className="row" key={alert.id}>
              <div>
                <strong>{alert.name}</strong>
                <p className="muted">{alert.condition}</p>
              </div>
              <button className="secondary" onClick={() => void toggleAlert(alert)}>
                {alert.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>System Actions</h2>
        <div className="actions">
          <button onClick={() => void runSystemAction("run-audit")}>
            Run audit
          </button>
          <button className="secondary" onClick={() => void runSystemAction("clear-cache")}>
            Clear cache
          </button>
          <button className="secondary" onClick={() => void runSystemAction("maintenance-check")}>
            Maintenance check
          </button>
        </div>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </>
  );
}

function Detail({
  className = "",
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={className}>{value}</dd>
    </div>
  );
}

function MessagePanel({ message }: { message: string }) {
  return (
    <section className="panel">
      <h2>Unavailable</h2>
      <p className="description">{message}</p>
    </section>
  );
}

function formatUptime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatBytes(value: number) {
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function getWebSocketUrl(token: string, intervalMs: RefreshIntervalMs) {
  if (!apiUrl) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";

    return `${protocol}://${window.location.host}/api/live/metrics?token=${encodeURIComponent(
      token,
    )}&intervalMs=${intervalMs}`;
  }

  const baseUrl = apiUrl.toLowerCase().startsWith("https")
    ? apiUrl.replace(/^https/i, "wss")
    : apiUrl.replace(/^http/i, "ws");

  return `${baseUrl}/api/live/metrics?token=${encodeURIComponent(
    token,
  )}&intervalMs=${intervalMs}`;
}

function round(value: number) {
  return String(Math.round(value * 100) / 100);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function getHealthClass(health: HealthStatus) {
  return `health-${health.toLowerCase()}`;
}

function getUsageClass(value: number, threshold: UsageThresholds) {
  if (value > threshold.critical) {
    return "health-critical";
  }

  if (value > threshold.warning) {
    return "health-warning";
  }

  return "health-healthy";
}

export default App;
