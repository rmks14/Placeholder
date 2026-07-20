import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";

const secureSecret = "correct-horse-battery-staple-with-extra-entropy-123456";

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function within<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Operation did not finish within ${timeoutMs}ms.`));
    }, timeoutMs);

    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function requestUpgrade(port: number, requestPath: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(
        [
          `GET ${requestPath} HTTP/1.1`,
          "Host: 127.0.0.1",
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("end", () => resolve(response));
    socket.once("error", reject);
  });
}

test("live metrics rejects unsafe upgrades, promptly revokes sessions, and drains cleanly", async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "daemondeck-live-"));

  process.env.AUTH_TOKEN_SECRET = secureSecret;
  process.env.DATABASE_PATH = path.join(dataDirectory, "test.sqlite");
  process.env.DEMO_MODE = "true";
  process.env.NODE_ENV = "test";

  const { closeDatabase, getUserByIdentifier } = await import("../data");
  const { createJwt, revokeToken } = await import("../middleware/auth");
  const { attachLiveMetrics } = await import("./liveMetrics");
  const user = getUserByIdentifier("demo");
  assert.ok(user);

  const server = createServer((_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  });
  const controller = attachLiveMetrics(server);
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `ws://127.0.0.1:${address.port}/api/live/metrics`;

  t.after(async () => {
    await controller.close();
    await closeServer(server);
    closeDatabase();
    fs.rmSync(dataDirectory, { force: true, recursive: true });
  });

  assert.match(
    await requestUpgrade(address.port, "/api/live/not-a-real-stream"),
    /^HTTP\/1\.1 404 Not Found\r\n/m,
  );
  assert.match(
    await requestUpgrade(address.port, "/api/live/metrics"),
    /^HTTP\/1\.1 401 Unauthorized\r\n/m,
  );

  const expiringToken = jwt.sign(
    { role: user.role, sub: user.id },
    secureSecret,
    {
      algorithm: "HS256",
      expiresIn: 2,
      jwtid: "short-lived-live-metrics-test",
    },
  );
  const expiringSocket = new WebSocket(`${baseUrl}?token=${expiringToken}&intervalMs=60000`);
  await waitForOpen(expiringSocket);
  const expiryResult = await within(waitForClose(expiringSocket), 3500);
  assert.equal(expiryResult.code, 1008);
  assert.equal(expiryResult.reason, "Session is no longer valid");

  const revokedSession = createJwt(user);
  const revokedSocket = new WebSocket(`${baseUrl}?token=${revokedSession.token}&intervalMs=60000`);
  await waitForOpen(revokedSocket);
  const revokedClose = waitForClose(revokedSocket);
  const revokedAt = Date.now();
  revokeToken(revokedSession.payload);

  const revokedResult = await within(revokedClose, 1500);
  assert.equal(revokedResult.code, 1008);
  assert.equal(revokedResult.reason, "Session is no longer valid");
  assert.ok(Date.now() - revokedAt < 1500);

  const resetSession = createJwt(user);
  const resetSocket = new WebSocket(`${baseUrl}?token=${resetSession.token}`);
  resetSocket.on("error", () => undefined);
  await waitForOpen(resetSocket);
  const resetClose = waitForClose(resetSocket);
  const clientSocket = (resetSocket as unknown as { _socket?: net.Socket })._socket;
  assert.ok(clientSocket);
  clientSocket.destroy(new Error("simulated client reset"));
  await within(resetClose, 1500);
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/`)).status, 200);

  const activeSession = createJwt(user);
  const activeSocket = new WebSocket(`${baseUrl}?token=${activeSession.token}&intervalMs=60000`);
  await waitForOpen(activeSocket);
  const shutdownClose = waitForClose(activeSocket);
  await controller.close();

  const shutdownResult = await within(shutdownClose, 1500);
  assert.equal(shutdownResult.code, 1001);
  assert.equal(shutdownResult.reason, "Server shutting down");
  assert.match(
    await requestUpgrade(address.port, "/api/live/metrics"),
    /^HTTP\/1\.1 503 Service Unavailable\r\n/m,
  );
});
