import type { Request } from "express";

export function getRequestIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}
