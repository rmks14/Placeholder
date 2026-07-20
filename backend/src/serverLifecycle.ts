import type { Server } from "node:http";

export type LiveMetricsController = {
  close: () => Promise<void>;
};

type CloseableServer = Pick<Server, "close"> & {
  closeAllConnections?: () => void;
};

type ShutdownDependencies = {
  closeDatabase: () => void;
  closeLiveMetrics: LiveMetricsController["close"];
  server: CloseableServer;
  setReady: (ready: boolean) => void;
  shutdownTimeoutMs?: number;
};

function closeHttpServer(server: CloseableServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";

      if (error && code !== "ERR_SERVER_NOT_RUNNING") {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export type ShutdownController = {
  isShuttingDown: () => boolean;
  shutdown: () => Promise<void>;
};

export function createShutdownController(
  dependencies: ShutdownDependencies,
): ShutdownController {
  const shutdownTimeoutMs = dependencies.shutdownTimeoutMs ?? 15_000;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  function shutdown() {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shuttingDown = true;
    dependencies.setReady(false);

    shutdownPromise = (async () => {
      const forceCloseTimer = setTimeout(() => {
        dependencies.server.closeAllConnections?.();
      }, shutdownTimeoutMs);

      try {
        const httpServerClosed = closeHttpServer(dependencies.server);
        const liveMetricsClosed = Promise.resolve().then(() =>
          dependencies.closeLiveMetrics(),
        );
        const results = await Promise.allSettled([
          httpServerClosed,
          liveMetricsClosed,
        ]);
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );

        if (failure) {
          throw failure.reason;
        }
      } finally {
        clearTimeout(forceCloseTimer);
        dependencies.closeDatabase();
      }
    })();

    return shutdownPromise;
  }

  return {
    isShuttingDown: () => shuttingDown,
    shutdown,
  };
}

export function installShutdownHandlers(
  controller: ShutdownController,
  options: {
    exit?: (code?: number) => never;
    log?: (message: string, error?: unknown) => void;
    processRef?: NodeJS.Process;
  } = {},
) {
  const processRef = options.processRef ?? process;
  const log = options.log ?? ((message, error) => console.error(message, error));
  const exit = options.exit ?? ((code) => process.exit(code));

  function handleShutdown(signal: string) {
    if (controller.isShuttingDown()) {
      return;
    }

    console.log(`Received ${signal}; shutting down DaemonDeck.`);
    void controller.shutdown().then(
      () => exit(0),
      (error) => {
        log("DaemonDeck shutdown failed.", error);
        exit(1);
      },
    );
  }

  function handleFatalError(error: unknown) {
    log("Fatal backend error; shutting down DaemonDeck.", error);
    handleShutdown("fatal error");
  }

  const handleSigint = () => handleShutdown("SIGINT");
  const handleSigterm = () => handleShutdown("SIGTERM");

  processRef.once("SIGINT", handleSigint);
  processRef.once("SIGTERM", handleSigterm);
  processRef.once("uncaughtException", handleFatalError);
  processRef.once("unhandledRejection", handleFatalError);

  return () => {
    processRef.removeListener("SIGINT", handleSigint);
    processRef.removeListener("SIGTERM", handleSigterm);
    processRef.removeListener("uncaughtException", handleFatalError);
    processRef.removeListener("unhandledRejection", handleFatalError);
  };
}
