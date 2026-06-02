import { Router } from "express";
import { getRequestIp } from "../audit";
import {
  addLog,
  getAlertRuleById,
  getAlertRules,
  getUserById,
  getUsers,
  updateAlertRuleEnabled,
  updateUserRole,
} from "../data";
import { publicUser, requireRole } from "../middleware/auth";
import {
  alertUpdateBodySchema,
  parseBody,
  roleBodySchema,
  systemActionBodySchema,
} from "../validation";

export const adminRouter = Router();

adminRouter.get("/admin/users", (req, res) => {
  if (!requireRole(req, res, ["admin"])) {
    return;
  }

  res.json({ users: getUsers().map(publicUser) });
});

adminRouter.patch("/admin/users/:id/role", (req, res) => {
  const session = requireRole(req, res, ["admin"]);

  if (!session) {
    return;
  }

  const ipAddress = getRequestIp(req);
  const body = parseBody(roleBodySchema, req.body);

  if (!body) {
    addLog(`${session.user.username} submitted invalid role update`, "warning", {
      action: "admin.user.role.update",
      ipAddress,
      status: "failure",
    });
    res.status(400).json({ message: "Role must be viewer, operator, or admin." });
    return;
  }

  const user = getUserById(req.params.id);

  if (!user) {
    addLog(`${session.user.username} tried to update missing user ${req.params.id}`, "warning", {
      action: "admin.user.role.update",
      ipAddress,
      status: "failure",
    });
    res.status(404).json({ message: "User was not found." });
    return;
  }

  const updatedUser = updateUserRole(user.id, body.role);

  if (!updatedUser) {
    addLog(`${session.user.username} could not update ${user.username}`, "warning", {
      action: "admin.user.role.update",
      ipAddress,
      status: "failure",
    });
    res.status(404).json({ message: "User was not found." });
    return;
  }

  addLog(`${session.user.username} changed ${updatedUser.username} to ${body.role}`, "warning", {
    action: "admin.user.role.update",
    ipAddress,
    status: "success",
  });

  res.json({ user: publicUser(updatedUser) });
});

adminRouter.get("/admin/alerts", (req, res) => {
  if (!requireRole(req, res, ["admin"])) {
    return;
  }

  res.json({ alerts: getAlertRules() });
});

adminRouter.patch("/admin/alerts/:id", (req, res) => {
  const session = requireRole(req, res, ["admin"]);

  if (!session) {
    return;
  }

  const ipAddress = getRequestIp(req);
  const body = parseBody(alertUpdateBodySchema, req.body);

  if (!body) {
    addLog(`${session.user.username} submitted invalid alert update`, "warning", {
      action: "admin.alert.update",
      ipAddress,
      status: "failure",
    });
    res.status(400).json({ message: "Alert enabled must be true or false." });
    return;
  }

  const alert = getAlertRuleById(req.params.id);

  if (!alert) {
    addLog(`${session.user.username} tried to update missing alert ${req.params.id}`, "warning", {
      action: "admin.alert.update",
      ipAddress,
      status: "failure",
    });
    res.status(404).json({ message: "Alert rule was not found." });
    return;
  }

  const updatedAlert = updateAlertRuleEnabled(alert.id, body.enabled);

  if (!updatedAlert) {
    addLog(`${session.user.username} could not update ${alert.name}`, "warning", {
      action: "admin.alert.update",
      ipAddress,
      status: "failure",
    });
    res.status(404).json({ message: "Alert rule was not found." });
    return;
  }

  addLog(
    `${session.user.username} ${
      updatedAlert.enabled ? "enabled" : "disabled"
    } ${updatedAlert.name}`,
    "warning",
    {
      action: "admin.alert.update",
      ipAddress,
      status: "success",
    },
  );

  res.json({ alert: updatedAlert });
});

adminRouter.post("/admin/system-actions", (req, res) => {
  const session = requireRole(req, res, ["admin"]);

  if (!session) {
    return;
  }

  const ipAddress = getRequestIp(req);
  const body = parseBody(systemActionBodySchema, req.body);

  if (!body) {
    addLog(`${session.user.username} submitted invalid system action`, "warning", {
      action: "admin.system.action",
      ipAddress,
      status: "failure",
    });
    res.status(400).json({ message: "Unsupported system action." });
    return;
  }

  addLog(`${session.user.username} ran system action: ${body.action}`, "critical", {
    action: "admin.system.action",
    ipAddress,
    status: "success",
  });
  res.json({ message: `System action queued: ${body.action}` });
});
