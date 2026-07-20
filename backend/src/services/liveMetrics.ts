import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
  getSessionFromToken,
  subscribeToTokenRevocations,
} from "../middleware/auth";
import type { CurrentSession } from "../types";
import type { LiveMetricsController } from "../serverLifecycle";
import { getLiveMetrics } from "./systemMetrics";

const liveMetricsPath = "/api/live/metrics";
const allowedLiveMetricsIntervals = [5000, 10000, 30000, 60000] as const;
const sessionRevalidationIntervalMs = 5000;
const maximumTimerDelayMs = 2_147_483_647;

type LiveClient = {
  cleanup: () => void;
  tokenId: string;
};

type LiveUpgrade = {
  intervalMs: number;
  session: CurrentSession;
  token: string;
};

type SessionLookup =
  | { kind: "invalid" }
  | { kind: "unavailable" }
  | { kind: "valid"; session: CurrentSession };

function getLiveMetricsInterval(url: URL) {
  const requestedInterval = Number(url.searchParams.get("intervalMs"));

  return allowedLiveMetricsIntervals.includes(
    requestedInterval as (typeof allowedLiveMetricsIntervals)[number],
  )
    ? requestedInterval
    : 5000;
}

function closeUpgradeSocket(socket: Duplex, status: number, statusText: string) {
  // A rejected upgrade still needs an error listener: a client can reset the
  // TCP connection while the status response is being flushed.
  socket.once("error", () => undefined);

  try {
    socket.end(
      `HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } catch {
    socket.destroy();
  }
}

function getLiveSession(token: string): SessionLookup {
  try {
    const session = getSessionFromToken(token);
    return session ? { kind: "valid", session } : { kind: "invalid" };
  } catch (error) {
    console.error("Could not validate a live metrics session.", error);
    return { kind: "unavailable" };
  }
}

export function attachLiveMetrics(server: Server): LiveMetricsController {
  const wss = new WebSocketServer({ noServer: true });
  const liveUpgrades = new WeakMap<WebSocket, LiveUpgrade>();
  const clients = new Map<WebSocket, LiveClient>();
  let acceptingConnections = true;
  let closePromise: Promise<void> | null = null;
  let finishClose: (() => void) | null = null;
  const unsubscribeFromTokenRevocations = subscribeToTokenRevocations((tokenId) => {
    for (const [ws, client] of clients) {
      if (client.tokenId === tokenId) {
        closeForInvalidSession(ws, client);
      }
    }
  });

  function maybeFinishClose() {
    if (!finishClose || clients.size > 0) {
      return;
    }

    const finish = finishClose;
    finishClose = null;
    wss.close(() => finish());
  }

  function closeForInvalidSession(ws: WebSocket, client: LiveClient) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1008, "Session is no longer valid");
      return;
    }

    ws.terminate();
    client.cleanup();
  }

  function closeForUnavailableSession(ws: WebSocket, client: LiveClient) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1011, "Live metrics temporarily unavailable");
      return;
    }

    ws.terminate();
    client.cleanup();
  }

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url || "", "http://localhost");

    if (!acceptingConnections) {
      closeUpgradeSocket(socket, 503, "Service Unavailable");
      return;
    }

    if (url.pathname !== liveMetricsPath) {
      closeUpgradeSocket(socket, 404, "Not Found");
      return;
    }

    const token = url.searchParams.get("token");

    if (!token) {
      closeUpgradeSocket(socket, 401, "Unauthorized");
      return;
    }

    const lookup = getLiveSession(token);

    if (lookup.kind === "unavailable") {
      closeUpgradeSocket(socket, 503, "Service Unavailable");
      return;
    }

    if (lookup.kind === "invalid") {
      closeUpgradeSocket(socket, 401, "Unauthorized");
      return;
    }

    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        liveUpgrades.set(ws, {
          intervalMs: getLiveMetricsInterval(url),
          session: lookup.session,
          token,
        });
        wss.emit("connection", ws, req);
      });
    } catch (error) {
      console.error("Could not establish a live metrics connection.", error);
      closeUpgradeSocket(socket, 503, "Service Unavailable");
    }
  };

  // Keep this listener through the shutdown drain so an existing keep-alive
  // connection receives a deterministic 503 rather than an abandoned upgrade.
  server.on("upgrade", handleUpgrade);

  wss.on("connection", (ws) => {
    const liveUpgrade = liveUpgrades.get(ws);

    if (!liveUpgrade) {
      ws.close(1011, "Live metrics session unavailable");
      return;
    }

    const { intervalMs, session, token } = liveUpgrade;

    let closed = false;
    let expiryTimer: NodeJS.Timeout | null = null;
    let metricsTimer: NodeJS.Timeout | null = null;
    let revalidationTimer: NodeJS.Timeout | null = null;

    function cleanup() {
      if (closed) {
        return;
      }

      closed = true;

      if (expiryTimer) {
        clearTimeout(expiryTimer);
      }

      if (metricsTimer) {
        clearInterval(metricsTimer);
      }

      if (revalidationTimer) {
        clearInterval(revalidationTimer);
      }

      clients.delete(ws);
      maybeFinishClose();
    }

    const client: LiveClient = {
      cleanup,
      tokenId: session.payload.jti,
    };

    function validateSession() {
      if (closed) {
        return false;
      }

      const lookup = getLiveSession(token);

      if (lookup.kind === "invalid") {
        closeForInvalidSession(ws, client);
        return false;
      }

      if (lookup.kind === "unavailable") {
        closeForUnavailableSession(ws, client);
        return false;
      }

      return true;
    }

    function scheduleExpiryCheck(expirySeconds: number) {
      const remainingMs = expirySeconds * 1000 - Date.now();
      const delay = Math.min(Math.max(remainingMs, 0) + 25, maximumTimerDelayMs);

      expiryTimer = setTimeout(() => {
        if (closed) {
          return;
        }

        const lookup = getLiveSession(token);

        if (lookup.kind === "valid") {
          scheduleExpiryCheck(lookup.session.payload.exp);
        } else if (lookup.kind === "invalid") {
          closeForInvalidSession(ws, client);
        } else {
          closeForUnavailableSession(ws, client);
        }
      }, delay);
    }

    function sendJson(message: unknown) {
      if (closed || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        ws.send(JSON.stringify(message), (error) => {
          if (error) {
            ws.terminate();
            cleanup();
          }
        });
      } catch {
        ws.terminate();
        cleanup();
      }
    }

    async function sendMetrics() {
      if (closed || ws.readyState !== WebSocket.OPEN || !validateSession()) {
        return;
      }

      try {
        sendJson(await getLiveMetrics());
      } catch {
        sendJson({ message: "Could not load live metrics.", type: "error" });
      }
    }

    ws.on("close", cleanup);
    ws.on("error", () => {
      if (acceptingConnections) {
        console.warn("Live metrics WebSocket error; closing client connection.");
      }

      ws.terminate();
      cleanup();
    });

    clients.set(ws, client);
    scheduleExpiryCheck(session.payload.exp);
    revalidationTimer = setInterval(() => {
      validateSession();
    }, sessionRevalidationIntervalMs);
    void sendMetrics();
    metricsTimer = setInterval(() => void sendMetrics(), intervalMs);
  });

  return {
    close() {
      if (closePromise) {
        return closePromise;
      }

      acceptingConnections = false;
      unsubscribeFromTokenRevocations();

      closePromise = new Promise<void>((resolve) => {
        finishClose = resolve;

        const forceCloseTimer = setTimeout(() => {
          for (const [ws, client] of clients) {
            ws.terminate();
            client.cleanup();
          }
        }, 5_000);

        const resolveWhenClosed = finishClose;
        finishClose = () => {
          clearTimeout(forceCloseTimer);
          resolveWhenClosed?.();
        };

        for (const [ws] of clients) {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close(1001, "Server shutting down");
          }
        }

        maybeFinishClose();
      });

      return closePromise;
    },
  };
}
