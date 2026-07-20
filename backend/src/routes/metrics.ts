import { Router } from "express";
import { getActivityLogs } from "../data";
import { requireRole } from "../middleware/auth";
import { asyncRoute } from "../middleware/errors";
import {
  getCpuMetrics,
  getDiskMetrics,
  getMemoryMetrics,
  getMetrics,
  getServerOverview,
} from "../services/systemMetrics";

export const metricsRouter = Router();

metricsRouter.get("/server/overview", asyncRoute(async (req, res) => {
  if (!requireRole(req, res, ["viewer", "operator", "admin"])) {
    return;
  }

  res.json(await getServerOverview());
}));

metricsRouter.get("/metrics", asyncRoute(async (req, res) => {
  if (!requireRole(req, res, ["viewer", "operator", "admin"])) {
    return;
  }

  res.json(await getMetrics());
}));

metricsRouter.get("/metrics/cpu", asyncRoute(async (req, res) => {
  if (!requireRole(req, res, ["viewer", "operator", "admin"])) {
    return;
  }

  res.json(await getCpuMetrics());
}));

metricsRouter.get("/metrics/memory", asyncRoute(async (req, res) => {
  if (!requireRole(req, res, ["viewer", "operator", "admin"])) {
    return;
  }

  res.json(await getMemoryMetrics());
}));

metricsRouter.get("/metrics/disk", asyncRoute(async (req, res) => {
  if (!requireRole(req, res, ["viewer", "operator", "admin"])) {
    return;
  }

  res.json(await getDiskMetrics());
}));

metricsRouter.get("/logs", (req, res) => {
  if (!requireRole(req, res, ["viewer", "operator", "admin"])) {
    return;
  }

  res.json({ logs: getActivityLogs() });
});
