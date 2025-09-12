import path from "node:path";
import { spawn } from "node:child_process";
import { getPreferenceValues } from "@raycast/api";
import type { Preferences } from "../types/preferences";

export type ResolveResult = {
  path: string;
  source: "pref" | "homebrew-opt" | "homebrew-usr" | "path";
};

export class SoxError extends Error {
  code?: string;
  cause?: unknown;
  constructor(message: string, code?: string, cause?: unknown) {
    super(message);
    this.name = "SoxError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class SoxNotFoundError extends SoxError {
  constructor(message = "SoX not found", cause?: unknown) {
    super(message, "SOX_NOT_FOUND", cause);
    this.name = "SoxNotFoundError";
  }
}

export class SoxNotExecutableError extends SoxError {
  constructor(message = "SoX not executable", cause?: unknown) {
    super(message, "SOX_NOT_EXECUTABLE", cause);
    this.name = "SoxNotExecutableError";
  }
}

type Candidate = { path: string; source: ResolveResult["source"] };

/** Resolve a usable SoX path; falls back to command name when absolute not found. */
export async function resolveSoxPath(prefs?: Preferences): Promise<ResolveResult> {
  // 1) If preference provided: must be absolute; verify runnable; return.
  try {
    const p = prefs ?? getPreferenceValues<Preferences>();
    const prefPath = p?.soxExecutablePath?.trim?.();
    if (prefPath) {
      if (!path.isAbsolute(prefPath)) {
        throw new SoxError("Preference 'soxExecutablePath' must be an absolute path", "PREF_NOT_ABSOLUTE");
      }
      await checkSoxAvailable(prefPath);
      return { path: prefPath, source: "pref" };
    }
  } catch {
    // ignore reading prefs failure; proceed with fallbacks
  }

  // 2) No preference: try common Homebrew locations, then PATH.
  const candidates: Candidate[] = [
    { path: "/opt/homebrew/bin/sox", source: "homebrew-opt" },
    { path: "/usr/local/bin/sox", source: "homebrew-usr" },
    { path: "sox", source: "path" },
  ];

  const errors: unknown[] = [];
  for (const c of candidates) {
    try {
      await checkSoxAvailable(c.path);
      return c;
    } catch (err) {
      errors.push({ candidate: c.path, error: err });
    }
  }

  // 3) All failed: surface not found with context (kept in cause).
  throw new SoxNotFoundError("SoX not found in common locations or PATH", {
    attempts: errors,
  });
}

/** Ensure SoX is runnable by invoking `--version` with a timeout. */
export async function checkSoxAvailable(soxPath: string, timeoutMs = 1200): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(soxPath, ["--version"]);

    const to = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new SoxError("SoX check timed out", "SOX_CHECK_TIMEOUT"));
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      if (err?.code === "ENOENT") return reject(new SoxNotFoundError("SoX executable not found", err));
      reject(new SoxError(err?.message || "Failed to spawn SoX", err?.code, err));
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      if (code === 0 || code === null) return resolve();
      reject(new SoxNotExecutableError("SoX not executable or returned non-zero"));
    });
  });
}
