/**
 * Loads .env into process.env.
 *
 * There is no dotenv here because this project has no npm dependencies, and
 * Node's own --env-file flag would mean every entry point needs the flag
 * passed correctly or the service dies with a confusing "token is not set".
 * Importing this once is harder to get wrong.
 *
 * Real environment variables always win, so you can override anything for a
 * single run without editing the file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DEFAULT = join(fileURLToPath(new URL("../", import.meta.url)), ".env");

export function loadEnv(path = process.env.ENV_FILE || DEFAULT) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return false;          // no .env is fine; the caller validates what it needs
  }

  for (let line of raw.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip one layer of matching quotes, so a token with a '#' in it survives.
    const quoted = (value.startsWith('"') && value.endsWith('"')) ||
                   (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    else value = value.split(" #")[0].trim();

    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

loadEnv();
