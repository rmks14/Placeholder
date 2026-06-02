import { createServer } from "node:http";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { metricsRouter } from "./routes/metrics";
import { processesRouter } from "./routes/processes";
import { attachLiveMetrics } from "./services/liveMetrics";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 5000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
const server = createServer(app);

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(cors({ origin: clientUrl }));
app.use(express.json({ limit: "100kb" }));

app.get("/", (_req, res) => {
  res.json({ message: "Backend is running" });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api", metricsRouter);
app.use("/api", processesRouter);
app.use("/api", adminRouter);

attachLiveMetrics(server);

server.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
