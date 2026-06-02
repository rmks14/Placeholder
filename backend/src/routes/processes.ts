import { Router } from "express";
import { getRequestIp } from "../audit";
import { requireRole } from "../middleware/auth";
import {
  getManagedProcessActions,
  getProcesses,
  killProcess,
  restartProcess,
} from "../services/processes";

export const processesRouter = Router();

processesRouter.get("/processes", async (req, res) => {
  if (!requireRole(req, res, ["viewer", "operator", "admin"])) {
    return;
  }

  res.json({ processes: await getProcesses() });
});

processesRouter.get("/process-actions", (req, res) => {
  if (!requireRole(req, res, ["operator", "admin"])) {
    return;
  }

  res.json({ processes: getManagedProcessActions() });
});

processesRouter.post("/process-actions/:id/restart", (req, res) => {
  const session = requireRole(req, res, ["operator", "admin"]);

  if (!session) {
    return;
  }

  const processRecord = restartProcess(
    req.params.id,
    session.user.username,
    getRequestIp(req),
  );

  if (!processRecord) {
    res.status(404).json({ message: "Process action was not found." });
    return;
  }

  res.json({
    message: `${processRecord.name} restarted.`,
    process: processRecord,
  });
});

processesRouter.post("/processes/:id/restart", (req, res) => {
  const session = requireRole(req, res, ["operator", "admin"]);

  if (!session) {
    return;
  }

  const processRecord = restartProcess(
    req.params.id,
    session.user.username,
    getRequestIp(req),
  );

  if (!processRecord) {
    res.status(404).json({ message: "Process was not found." });
    return;
  }

  res.json({
    message: `${processRecord.name} restarted.`,
    process: processRecord,
  });
});

processesRouter.delete("/processes/:id", (req, res) => {
  const session = requireRole(req, res, ["operator", "admin"]);

  if (!session) {
    return;
  }

  const result = killProcess(req.params.id, session.user.username, getRequestIp(req));

  res.status(result.status).json({ message: result.message });
});
