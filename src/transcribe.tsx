import {
	Action,
	ActionPanel,
	Detail,
	Toast,
	showToast,
	environment,
	getPreferenceValues,
} from "@raycast/api";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactElement,
} from "react";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type CommandState = "configuring" | "idle" | "recording" | "saving" | "error";

const RECORDINGS_DIR = path.join(environment.supportPath, "Recordings");
const WAV_HEADER_SIZE = 44;

function formatTimestamp(d: Date) {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(
		d.getMinutes(),
	)}-${pad(d.getSeconds())}`;
}

export default function Command(): ReactElement {
  const [state, setState] = useState<CommandState>("configuring");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [waveformSeed, setWaveformSeed] = useState<number>(0);

  const soxProcessRef = useRef<ChildProcessWithoutNullStreams | null>(null);
  const outputFileRef = useRef<string | null>(null);
  const soxPathRef = useRef<string>("sox");
  const autoStartedRef = useRef<boolean>(false);

	// Prepare recordings directory
	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				// Resolve sox path from preferences or common locations
				try {
					const prefs = getPreferenceValues<Preferences>();
					const prefPath = (prefs as any)?.soxExecutablePath?.trim?.() || "";
					const candidates = [
						prefPath && path.isAbsolute(prefPath) ? prefPath : undefined,
						"/opt/homebrew/bin/sox",
						"/usr/local/bin/sox",
						"sox",
					].filter(Boolean) as string[];

					const absolute = candidates.find((c) => path.isAbsolute(c) && fs.existsSync(c));
					soxPathRef.current = absolute || candidates[candidates.length - 1];
				} catch (e) {
					console.warn("Failed to read preferences for soxExecutablePath:", e);
					soxPathRef.current = "sox";
				}

				await fs.promises.mkdir(RECORDINGS_DIR, { recursive: true });
				if (mounted) setState("idle");
			} catch (err) {
				console.error("Failed to prepare recordings directory:", err);
				if (mounted) {
					setErrorMessage(
						"Failed to prepare recordings directory. Check permissions and disk space.",
					);
					setState("error");
					await showToast({
						style: Toast.Style.Failure,
						title: "Setup Failed",
						message: "Cannot create recordings directory",
					});
				}
			}
		})();

		return () => {
			mounted = false;
			const p = soxProcessRef.current;
			if (p && !p.killed) {
				try {
					process.kill(p.pid!, "SIGKILL");
				} catch {
					/* ignore */
				}
				soxProcessRef.current = null;
			}
		};
  }, []);

  const startRecording = useCallback(async () => {
		if (state !== "idle") return;

		const filename = `Recording_${formatTimestamp(new Date())}.wav`;
		const outputPath = path.join(RECORDINGS_DIR, filename);
		outputFileRef.current = outputPath;

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
			const proc = spawn(soxPathRef.current, args);
			soxProcessRef.current = proc;
			setState("recording");

			await showToast({
				style: Toast.Style.Animated,
				title: "Recording…",
				message: "Press Enter or Space to stop, Cmd+. to cancel",
			});

			proc.stderr.on("data", (data) => {
				console.log(`sox stderr: ${data.toString()}`);
			});

			proc.on("error", async (err: NodeJS.ErrnoException) => {
				console.error("sox process error:", err);
				if (soxProcessRef.current === proc) soxProcessRef.current = null;
				const isENOENT = err?.code === "ENOENT";
				setErrorMessage(
					isENOENT
						? `SoX not found at '${soxPathRef.current}'. Set the absolute path in preferences or install SoX.`
						: `Recording failed: ${err?.message || "Unknown error"}`,
				);
				setState("error");
				await showToast({
					style: Toast.Style.Failure,
					title: isENOENT ? "SoX Not Found" : "Recording Failed",
					message: isENOENT
						? "Set SoX path in preferences or install via Homebrew."
						: "Ensure microphone permission is granted.",
				});
			});
		} catch (err) {
			const e = err as Error;
			console.error("Failed to spawn sox:", e);
			setErrorMessage(`Failed to start recording: ${e.message}`);
			setState("error");
			await showToast({
				style: Toast.Style.Failure,
				title: "Recording Failed",
				message:
					"Ensure SoX is installed (brew install sox) and microphone permission is granted",
			});
		}
  }, [state]);

  // Auto-start recording once when the command becomes idle for the first time
  useEffect(() => {
    if (state === "idle" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      // fire and forget
      startRecording();
    }
  }, [state, startRecording]);

  const waitForClose = (proc: ChildProcessWithoutNullStreams) =>
    new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
    });

	const stopAndSave = useCallback(async () => {
		if (state !== "recording") return;
		const proc = soxProcessRef.current;
		if (!proc) return;
		setState("saving");

		try {
			if (!proc.killed) {
				try {
					process.kill(proc.pid!, "SIGTERM");
				} catch {
					/* ignore ESRCH */
				}
			}
			await waitForClose(proc);
		} finally {
			if (soxProcessRef.current === proc) soxProcessRef.current = null;
		}

		const out = outputFileRef.current;
		try {
			if (!out) throw new Error("Missing output path");
			const stats = await fs.promises.stat(out);
			if (stats.size <= WAV_HEADER_SIZE) {
				// Empty/too short
				await fs.promises.unlink(out).catch(() => undefined);
				await showToast({
					style: Toast.Style.Failure,
					title: "Recording Failed",
					message: "No audio captured. Please try again.",
				});
			} else {
				await showToast({
					style: Toast.Style.Success,
					title: "Recording saved",
					message: out,
				});
			}
		} catch (err) {
			console.error("Failed to finalize recording:", err);
			await showToast({
				style: Toast.Style.Failure,
				title: "Save Failed",
				message: "Could not access recorded file",
			});
		} finally {
			setState("idle");
		}
	}, [state]);

	const cancelRecording = useCallback(async () => {
		if (state !== "recording") return;
		const proc = soxProcessRef.current;
		if (!proc) return;

		try {
			if (!proc.killed) {
				try {
					process.kill(proc.pid!, "SIGKILL");
				} catch {
					/* ignore */
				}
			}
			await waitForClose(proc);
		} finally {
			if (soxProcessRef.current === proc) soxProcessRef.current = null;
			const out = outputFileRef.current;
			if (out) {
				await fs.promises.unlink(out).catch(() => undefined);
			}
			setState("idle");
		}
  }, [state]);

  const actionsForIdle = (
    <ActionPanel>
      <Action title="Start Recording" onAction={startRecording} />
    </ActionPanel>
  );

  // Update the waveform seed periodically while recording to animate the ASCII waveform
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setWaveformSeed((v) => v + 1), 150);
    return () => clearInterval(id);
  }, [state]);

  const generateWaveformMarkdown = useCallback(() => {
    const waveformHeight = 18;
    const waveformWidth = 105;
    let waveform = "```\n";
    waveform += "RECORDING AUDIO...  PRESS ENTER TO STOP\n\n";

    for (let y = 0; y < waveformHeight; y++) {
      let line = "";
      for (let x = 0; x < waveformWidth; x++) {
        const baseAmplitude1 = Math.sin((x / waveformWidth) * Math.PI * 4) * 0.3;
        const baseAmplitude2 = Math.sin((x / waveformWidth) * Math.PI * 8) * 0.15;
        const baseAmplitude3 = Math.sin((x / waveformWidth) * Math.PI * 2) * 0.25;
        const baseAmplitude = baseAmplitude1 + baseAmplitude2 + baseAmplitude3;
        const randomFactor = Math.sin(x + waveformSeed * 0.35) * 0.2;
        const amplitude = baseAmplitude + randomFactor;
        const normalizedAmplitude = (amplitude + 0.7) * waveformHeight * 0.5;
        const distFromCenter = Math.abs(y - waveformHeight / 2);
        const shouldDraw = distFromCenter < normalizedAmplitude;

        if (shouldDraw) {
          const intensity = 1 - distFromCenter / Math.max(normalizedAmplitude, 1e-6);
          if (intensity > 0.8) line += "█";
          else if (intensity > 0.6) line += "▓";
          else if (intensity > 0.4) line += "▒";
          else if (intensity > 0.2) line += "░";
          else line += "·";
        } else {
          line += " ";
        }
      }
      waveform += line + "\n";
    }
    waveform += "```";
    return waveform;
  }, [waveformSeed]);

  const actionsForRecording = (
    <ActionPanel>
      <Action title="Stop and Save" onAction={stopAndSave} />
      <Action
        title="Cancel Recording"
        onAction={cancelRecording}
        shortcut={{ modifiers: ["cmd"], key: "." }}
      />
    </ActionPanel>
  );

	if (state === "configuring") {
		return (
			<Detail isLoading={true} markdown="Preparing recording environment…" />
		);
	}

  if (state === "recording") {
    return (
      <Detail
        markdown={generateWaveformMarkdown()}
        actions={actionsForRecording}
      />
    );
  }

	if (state === "saving") {
		return <Detail isLoading={true} markdown="Finalizing recording…" />;
	}

	if (state === "error") {
		return (
			<Detail
				markdown={`Error: ${errorMessage || "Unknown error"}`}
				actions={actionsForIdle}
			/>
		);
	}

	// idle
	return <Detail markdown="Ready to record audio." actions={actionsForIdle} />;
}
