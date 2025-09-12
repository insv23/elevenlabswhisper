import { useEffect, useRef, useState } from "react";
import { RECORDINGS_DIR } from "../config/paths";
import { resolveSoxPath, type ResolveResult, type SoxError } from "../lib/sox";
import { ensureRecordingsDir } from "../lib/recordings";

export type SetupStatus = "configuring" | "ready" | "error";

export type SetupError = (SoxError & { code?: string }) | Error;

export function useRecordingSetup() {
  const [status, setStatus] = useState<SetupStatus>("configuring");
  const [error, setError] = useState<SetupError | undefined>(undefined);
  const [sox, setSox] = useState<ResolveResult | undefined>(undefined);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        const soxResolved = await resolveSoxPath();
        await ensureRecordingsDir(RECORDINGS_DIR);
        if (mountedRef.current) {
          setSox(soxResolved);
          setStatus("ready");
        }
      } catch (e) {
        if (mountedRef.current) {
          setError(e as SetupError);
          setStatus("error");
        }
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    status,
    error,
    soxPath: sox?.path,
    soxSource: sox?.source,
    recordingsDir: RECORDINGS_DIR,
  } as const;
}
