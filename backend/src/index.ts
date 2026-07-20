import { createServer } from "node:http";
import { createApp, createReadinessController } from "./app";
import { runtimeConfig } from "./config";
import { closeDatabase } from "./data";
import {
  createShutdownController,
  installShutdownHandlers,
} from "./serverLifecycle";
import { attachLiveMetrics } from "./services/liveMetrics";

const readiness = createReadinessController();
const app = createApp(readiness);
const server = createServer(app);
const liveMetrics = attachLiveMetrics(server);
const shutdownController = createShutdownController({
  closeDatabase,
  closeLiveMetrics: liveMetrics.close,
  server,
  setReady: readiness.setReady,
});

server.once("error", (error) => {
  console.error("Backend server failed to start.", error);
  void shutdownController.shutdown().then(
    () => process.exit(1),
    (shutdownError) => {
      console.error("Backend cleanup after startup failure failed.", shutdownError);
      process.exit(1);
    },
  );
});

installShutdownHandlers(shutdownController);

server.listen(runtimeConfig.port, () => {
  console.log(`Backend running on http://localhost:${runtimeConfig.port}`);
});
