import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getRequestIp } from "../audit";
import { addLog, getUserByIdentifier } from "../data";
import {
  createJwt,
  getBearerToken,
  getSessionFromToken,
  publicUser,
  requireSession,
  revokeToken,
  sessionExpiresAt,
} from "../middleware/auth";
import { loginBodySchema, parseBody } from "../validation";

export const authRouter = Router();

const loginRateLimit = rateLimit({
  legacyHeaders: false,
  limit: 10,
  message: { message: "Too many login attempts. Try again later." },
  standardHeaders: true,
  windowMs: 15 * 60 * 1000,
  handler: (req, res) => {
    addLog("Login rate limit exceeded", "warning", {
      action: "auth.login",
      ipAddress: getRequestIp(req),
      status: "blocked",
    });
    res.status(429).json({ message: "Too many login attempts. Try again later." });
  },
});

authRouter.post("/login", loginRateLimit, (req, res) => {
  const ipAddress = getRequestIp(req);
  const body = parseBody(loginBodySchema, req.body);

  if (!body) {
    addLog("Rejected login request with invalid body", "warning", {
      action: "auth.login",
      ipAddress,
      status: "failure",
    });
    res.status(400).json({ message: "Email/username and password are required." });
    return;
  }

  const identifier = body.identifier.toLowerCase();
  const user = getUserByIdentifier(identifier);

  if (!user || !bcrypt.compareSync(body.password, user.passwordHash)) {
    addLog(`Failed sign-in for ${identifier}`, "warning", {
      action: "auth.login",
      ipAddress,
      status: "failure",
    });
    res.status(401).json({ message: "Invalid email/username or password." });
    return;
  }

  const { token, payload } = createJwt(user);
  addLog(`${user.username} signed in`, "info", {
    action: "auth.login",
    ipAddress,
    status: "success",
  });

  res.json({
    token,
    user: publicUser(user),
    sessionExpiresAt: sessionExpiresAt(payload),
  });
});

authRouter.get("/me", (req, res) => {
  const session = requireSession(req, res);

  if (!session) {
    return;
  }

  res.json({
    user: publicUser(session.user),
    sessionExpiresAt: sessionExpiresAt(session.payload),
  });
});

authRouter.post("/logout", (req, res) => {
  const token = getBearerToken(req);
  const session = token ? getSessionFromToken(token) : null;

  if (session) {
    revokeToken(session.payload);
    addLog(`${session.user.username} signed out`, "info", {
      action: "auth.logout",
      ipAddress: getRequestIp(req),
      status: "success",
    });
  }

  res.json({ message: "Logged out." });
});
