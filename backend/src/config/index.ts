import dotenv from "dotenv";
import { loadRuntimeConfig } from "./runtime";

dotenv.config();

export const runtimeConfig = loadRuntimeConfig();

if (runtimeConfig.usesEphemeralAuthTokenSecret) {
  console.warn(
    "AUTH_TOKEN_SECRET is missing, weak, or a placeholder. Generated an ephemeral local/test secret; sessions will end when the backend restarts.",
  );
}
