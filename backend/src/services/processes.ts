import * as si from "systeminformation";
import { isProcessKillEnabled } from "../config/security";
import { addLog, services } from "../data";
import type { ProcessRecord } from "../types";

export async function getProcesses(): Promise<ProcessRecord[]> {
  const data = await si.processes();

  return data.list
    .filter((processRecord) => processRecord.pid > 0)
    .map((processRecord) => ({
      command: processRecord.command || processRecord.name,
      cpuUsagePercent: roundPercent(processRecord.cpu),
      id: String(processRecord.pid),
      lastRestartedAt: null,
      memoryUsagePercent: roundPercent(processRecord.mem),
      name: processRecord.name || String(processRecord.pid),
      pid: processRecord.pid,
      startTime: processRecord.started,
      status: processRecord.state || "unknown",
      user: processRecord.user || "unknown",
    }))
    .sort((a, b) => b.cpuUsagePercent - a.cpuUsagePercent)
    .slice(0, 100);
}

export async function getProcessCounts() {
  const data = await si.processes();

  return {
    all: data.all,
    running: data.running,
  };
}

export function getActiveServiceCount() {
  return services.filter((service) => service.status === "running").length;
}

export function getManagedProcessActions() {
  return services;
}

export function restartProcess(
  processId: string,
  username: string,
  ipAddress?: string | null,
) {
  const service = services.find((candidate) => candidate.id === processId);

  if (!service) {
    addLog(`${username} tried to restart unknown process action ${processId}`, "warning", {
      action: "process.restart",
      ipAddress,
      status: "failure",
    });
    return null;
  }

  service.status = "running";
  service.lastRestartedAt = new Date().toISOString();
  addLog(`${username} restarted ${service.name}`, "warning", {
    action: "process.restart",
    ipAddress,
    status: "success",
  });

  return service;
}

export function killProcess(
  processId: string,
  username: string,
  ipAddress?: string | null,
) {
  const pid = Number(processId);

  if (!Number.isInteger(pid) || pid <= 0) {
    addLog(`${username} tried to kill invalid process ${processId}`, "warning", {
      action: "process.kill",
      ipAddress,
      status: "failure",
    });
    return { message: "Process ID must be a positive integer.", status: 400 };
  }

  if (!isProcessKillEnabled()) {
    addLog(`${username} tried to kill process ${pid}, but process kill is disabled`, "warning", {
      action: "process.kill",
      ipAddress,
      status: "blocked",
    });
    return {
      message: "Process kill is disabled. Set ENABLE_PROCESS_KILL=true to enable it.",
      status: 403,
    };
  }

  if (pid === process.pid) {
    addLog(`${username} tried to kill the dashboard API process`, "critical", {
      action: "process.kill",
      ipAddress,
      status: "blocked",
    });
    return { message: "Refusing to stop the dashboard API process.", status: 400 };
  }

  try {
    process.kill(pid, "SIGTERM");
    addLog(`${username} sent SIGTERM to process ${pid}`, "critical", {
      action: "process.kill",
      ipAddress,
      status: "success",
    });

    return { message: `Process ${pid} was sent SIGTERM.`, status: 200 };
  } catch (caughtError) {
    const code =
      caughtError && typeof caughtError === "object" && "code" in caughtError
        ? String(caughtError.code)
        : "";

    if (code === "ESRCH") {
      addLog(`${username} tried to kill missing process ${pid}`, "warning", {
        action: "process.kill",
        ipAddress,
        status: "failure",
      });
      return { message: "Process was not found.", status: 404 };
    }

    addLog(`${username} tried to kill process ${pid}, but it failed`, "critical", {
      action: "process.kill",
      ipAddress,
      status: "failure",
    });
    return { message: "Process could not be stopped.", status: 500 };
  }
}

function roundPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(Math.max(0, value) * 100) / 100;
}
