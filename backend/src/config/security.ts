export function isProcessKillEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.ENABLE_PROCESS_KILL === "true";
}
