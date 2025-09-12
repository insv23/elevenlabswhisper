import { Action, ActionPanel, Detail, Toast, showToast } from "@raycast/api";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import fs from "node:fs";
import { useRecordingSetup } from "./hooks/useRecordingSetup";
import { useSoxProcess, WAV_HEADER_SIZE } from "./hooks/useSoxProcess";
import { RECORDINGS_DIR } from "./config/paths";
import { renderSyntheticWave } from "./lib/waveform/ascii";

export default function Command(): ReactElement {
  // Local UI state is derived instead of mirrored
  const [waveformSeed, setWaveformSeed] = useState<number>(0);
  const autoStartedRef = useRef<boolean>(false);

  // Setup: resolve SoX, check availability, ensure recordings dir
  const setup = useRecordingSetup();
  const { state: procState, start, stopAndSave, cancel } = useSoxProcess(setup.soxPath || "sox", RECORDINGS_DIR);

  // Derive overall UI state from setup + process
  const uiState = setup.status === "ready" ? procState : setup.status; // "configuring" | "error" | ProcState

  const startRecording = useCallback(async () => {
    if (procState !== "idle" || setup.status !== "ready") return;
    try {
      await start();
      await showToast({
        style: Toast.Style.Animated,
        title: "Recording…",
        message: "Press Enter to stop, Cmd+. to cancel",
      });
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: "Recording Failed",
        message: "Ensure SoX is installed and microphone permission is granted",
      });
    }
  }, [procState, setup.status, start]);

  // Auto-start recording once when the command becomes idle for the first time
  useEffect(() => {
    if (setup.status === "ready" && procState === "idle" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      // fire and forget
      startRecording();
    }
  }, [setup.status, procState, startRecording]);

  const stopAndSaveUI = useCallback(async () => {
    if (procState !== "recording") return;
    try {
      const res = await stopAndSave();
      if (!res.outputPath) throw new Error("Missing output path");
      const stats = await fs.promises.stat(res.outputPath);
      if (stats.size <= WAV_HEADER_SIZE) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Recording Failed",
          message: "No audio captured. Please try again.",
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: "Recording saved",
          message: res.outputPath,
        });
      }
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e?.code === "EMPTY_RECORDING") {
        await showToast({
          style: Toast.Style.Failure,
          title: "Recording Failed",
          message: "No audio captured. Please try again.",
        });
      } else {
        console.error("Failed to finalize recording:", err);
        await showToast({
          style: Toast.Style.Failure,
          title: "Save Failed",
          message: e?.message || "Could not access recorded file",
        });
      }
    } finally {
      // useSoxProcess will transition state back to "idle"
    }
  }, [procState, stopAndSave]);

  const cancelRecording = useCallback(async () => {
    if (procState !== "recording") return;
    await cancel();
  }, [procState, cancel]);

  const actionsForIdle = (
    <ActionPanel>
      <Action title="Start Recording" onAction={startRecording} />
    </ActionPanel>
  );

  // Animate ASCII waveform while recording
  useEffect(() => {
    if (uiState !== "recording") return;
    const id = setInterval(() => setWaveformSeed((v) => v + 1), 150);
    return () => clearInterval(id);
  }, [uiState]);

  const actionsForRecording = (
    <ActionPanel>
      <Action title="Stop and Save" onAction={stopAndSaveUI} />
      <Action title="Cancel Recording" onAction={cancelRecording} shortcut={{ modifiers: ["cmd"], key: "." }} />
    </ActionPanel>
  );

  if (uiState === "configuring") {
    return <Detail isLoading={true} markdown="Preparing recording environment…" />;
  }

  if (uiState === "recording") {
    return <Detail markdown={renderSyntheticWave(waveformSeed)} actions={actionsForRecording} />;
  }

  if (uiState === "saving") {
    return <Detail isLoading={true} markdown="Finalizing recording…" />;
  }

  if (uiState === "error") {
    const errorText =
      setup.error instanceof Error
        ? setup.error.message
        : setup.error
          ? String(setup.error)
          : "Failed to prepare recordings directory";
    return <Detail markdown={`Error: ${errorText || "Unknown error"}`} actions={actionsForIdle} />;
  }

  // idle
  return <Detail markdown="Ready to record audio." actions={actionsForIdle} />;
}
