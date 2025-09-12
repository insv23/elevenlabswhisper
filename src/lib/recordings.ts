import fs from "node:fs";

export class RecordingsError extends Error {
  code?: string;
  cause?: unknown;
  constructor(message: string, code?: string, cause?: unknown) {
    super(message);
    this.name = "RecordingsError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export async function ensureRecordingsDir(dir: string): Promise<string> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  } catch (err) {
    throw new RecordingsError("Failed to prepare recordings directory", "RECORDINGS_DIR_UNWRITABLE", err);
  }
}

export function buildRecordingFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Recording_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours(),
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.wav`;
}
