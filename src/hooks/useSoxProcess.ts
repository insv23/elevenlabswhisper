import { useCallback, useEffect, useRef, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildRecordingFilename } from "../lib/recordings";

export type ProcState = "idle" | "recording" | "saving";

export class RecordingError extends Error {
  code?: string;
  cause?: unknown;
  constructor(message: string, code?: string, cause?: unknown) {
    super(message);
    this.name = "RecordingError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export const WAV_HEADER_SIZE = 44;

function waitForClose(proc: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve) => {
    proc.once("close", () => resolve());
  });
}

export function useSoxProcess(soxPath: string, recordingsDir: string) {
  const [state, setState] = useState<ProcState>("idle");
  const procRef = useRef<ChildProcessWithoutNullStreams | null>(null);
  const outputRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    if (state !== "idle") return { outputPath: outputRef.current } as { outputPath: string | null };
    const filename = buildRecordingFilename();
    const outputPath = path.join(recordingsDir, filename);
    outputRef.current = outputPath;

    const args = [
      "-d",
      "-t",
      "wav",
      "--channels",
      "1",
      "--rate",
      "16000",
      "--encoding",
      "signed-integer",
      "--bits",
      "16",
      outputPath,
    ];

    try {
      const proc = spawn(soxPath, args);
      procRef.current = proc;
      setState("recording");
      return { outputPath };
    } catch (e) {
      throw new RecordingError((e as Error).message || "Failed to spawn sox", "SOX_SPAWN_FAILED", e);
    }
  }, [state, recordingsDir, soxPath]);

  const stopAndSave = useCallback(async () => {
    if (state !== "recording")
      return { outputPath: outputRef.current, size: 0 } as {
        outputPath: string | null;
        size: number;
      };
    const proc = procRef.current;
    if (!proc)
      return { outputPath: outputRef.current, size: 0 } as {
        outputPath: string | null;
        size: number;
      };
    setState("saving");

    try {
      if (!proc.killed) {
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
      await waitForClose(proc);
    } finally {
      if (procRef.current === proc) procRef.current = null;
    }

    const out = outputRef.current;
    if (!out) throw new RecordingError("Missing output path", "SAVE_FAILED");
    try {
      const stats = await fs.promises.stat(out);
      if (stats.size <= WAV_HEADER_SIZE) {
        await fs.promises.unlink(out).catch(() => undefined);
        throw new RecordingError("No audio captured", "EMPTY_RECORDING");
      }
      return { outputPath: out, size: stats.size };
    } finally {
      setState("idle");
    }
  }, [state]);

  const cancel = useCallback(async () => {
    if (state !== "recording") return;
    const proc = procRef.current;
    if (!proc) return;
    try {
      if (!proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      await waitForClose(proc);
    } finally {
      if (procRef.current === proc) procRef.current = null;
      const out = outputRef.current;
      if (out) {
        await fs.promises.unlink(out).catch(() => undefined);
      }
      setState("idle");
    }
  }, [state]);

  useEffect(() => {
    return () => {
      const p = procRef.current;
      if (p && !p.killed) {
        try {
          p.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          if (p && !p.killed) {
            try {
              p.kill("SIGKILL");
            } catch {
              /* ignore */
            }
          }
        }, 400);
      }
      procRef.current = null;
    };
  }, []);

  return { state, start, stopAndSave, cancel } as const;
}
