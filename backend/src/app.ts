import cors from "cors";
import express from "express";
import helmet from "helmet";
import { runtimeConfig } from "./config";
import { apiErrorHandler, apiNotFoundHandler } from "./middleware/errors";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { metricsRouter } from "./routes/metrics";
import { processesRouter } from "./routes/processes";

export type ReadinessController = {
  isReady: () => boolean;
  setReady: (ready: boolean) => void;
};

export function createReadinessController(): ReadinessController {
  let ready = true;

  return {
    isReady: () => ready,
    setReady: (nextReady) => {
      ready = nextReady;
    },
  };
}

export function createApp(readiness: ReadinessController) {
  const app = express();

  if (runtimeConfig.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(helmet());
  app.use(cors({ origin: runtimeConfig.clientUrl }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (_req, res) => {
    res.json({ message: "Backend is running" });
  });

  app.get("/api/health", (_req, res) => {
    if (!readiness.isReady()) {
      res.status(503).json({ status: "shutting_down" });
      return;
    }

    res.json({ status: "ok" });
  });

  app.use("/api", (_req, res, next) => {
    if (!readiness.isReady()) {
      res.status(503).json({ message: "Server is shutting down." });
      return;
    }

    next();
  });

  app.use("/api/auth", authRouter);
  app.use("/api", metricsRouter);
  app.use("/api", processesRouter);
  app.use("/api", adminRouter);
  app.use("/api", apiNotFoundHandler);
  app.use(apiErrorHandler);

  return app;
}
