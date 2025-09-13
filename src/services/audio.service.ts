import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getPreferenceValues } from "@raycast/api";
import path from "node:path";
import type { Preferences } from "../types/preferences";
import { storageService } from "./storage.service";

export class SoxError extends Error {
	constructor(
		message: string,
		public code?: string,
		public cause?: unknown,
	) {
		super(message);
		this.name = "SoxError";
	}
}

type ResolveResult = {
	path: string;
	source: "pref" | "homebrew-opt" | "homebrew-usr" | "path";
};
type CandidateSource = "homebrew-opt" | "homebrew-usr" | "path";

export const WAV_HEADER_SIZE = 44;

class AudioService {
	private soxPath: string | null = null;
	private proc: ChildProcessWithoutNullStreams | null = null;
	private currentRecordingPath: string | null = null;

	private async resolveSoxPath(): Promise<string> {
		if (this.soxPath) return this.soxPath;

		const prefs = getPreferenceValues<Preferences>();
		const prefPath = prefs?.soxExecutablePath?.trim();
		if (prefPath) {
			if (!path.isAbsolute(prefPath)) {
				throw new SoxError(
					"Preference 'soxExecutablePath' must be an absolute path",
					"PREF_NOT_ABSOLUTE",
				);
			}
			await this.checkSoxAvailable(prefPath);
			this.soxPath = prefPath;
			return prefPath;
		}

		const candidates: CandidateSource[] = [
			"homebrew-opt",
			"homebrew-usr",
			"path",
		];
		const candidatePaths: Record<CandidateSource, string> = {
			"homebrew-opt": "/opt/homebrew/bin/sox",
			"homebrew-usr": "/usr/local/bin/sox",
			path: "sox",
		};

		for (const c of candidates) {
			try {
				const soxCandPath = candidatePaths[c];
				await this.checkSoxAvailable(soxCandPath);
				this.soxPath = soxCandPath;
				return soxCandPath;
			} catch {
				// try next
			}
		}

		throw new SoxError(
			"SoX not found in common locations or PATH. Please install SoX or configure its path in preferences.",
			"SOX_NOT_FOUND",
		);
	}

	private async checkSoxAvailable(
		pathOrCmd: string,
		timeoutMs = 1200,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const child = spawn(pathOrCmd, ["--version"]);
			const timer = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* ignore */
				}
				reject(new SoxError("SoX check timed out", "SOX_CHECK_TIMEOUT"));
			}, timeoutMs);

			child.on("error", (err) => {
				clearTimeout(timer);
				reject(new SoxError("Failed to spawn SoX.", "SOX_SPAWN_FAILED", err));
			});

			child.on("exit", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve();
				else
					reject(
						new SoxError(
							"SoX is not executable or returned a non-zero exit code.",
							"SOX_NOT_EXECUTABLE",
						),
					);
			});
		});
	}

	async start(): Promise<string> {
		if (this.proc) {
			throw new SoxError(
				"Recording is already in progress.",
				"ALREADY_RECORDING",
			);
		}

		const sox = await this.resolveSoxPath();
		await storageService.ensureRecordingsDir();

		const filename = storageService.getRecordingFilename();
		const outputPath = path.join(storageService.recordingsDir, filename);
		this.currentRecordingPath = outputPath;

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
			this.proc = spawn(sox, args);
			this.proc.stderr.on("data", (data) => console.log(`sox stderr: ${data}`));
			return outputPath;
		} catch (e) {
			this.proc = null;
			throw new SoxError("Failed to start SoX process.", "SOX_SPAWN_FAILED", e);
		}
	}

	async stop(): Promise<string> {
		if (!this.proc)
			throw new SoxError(
				"No recording is currently in progress.",
				"NOT_RECORDING",
			);
		if (!this.currentRecordingPath)
			throw new SoxError("Output path is missing.", "MISSING_PATH");

		const proc = this.proc;
		const outputPath = this.currentRecordingPath;

		return new Promise((resolve, reject) => {
			proc.once("close", async () => {
				this.proc = null;
				this.currentRecordingPath = null;
				try {
					const size = await storageService.getFileSize(outputPath);
					if (size <= WAV_HEADER_SIZE) {
						await storageService.deleteFile(outputPath);
						reject(
							new SoxError(
								"No audio was captured. The recording is empty.",
								"EMPTY_RECORDING",
							),
						);
					} else {
						resolve(outputPath);
					}
				} catch (e) {
					reject(e);
				}
			});

			try {
				proc.kill("SIGTERM");
			} catch {
				/* ignore */
			}
		});
	}

	async cancel(): Promise<void> {
		if (!this.proc) return;
		const proc = this.proc;
		const outputPath = this.currentRecordingPath;
		this.proc = null;
		this.currentRecordingPath = null;

		proc.once("close", async () => {
			if (outputPath) await storageService.deleteFile(outputPath);
		});

		try {
			proc.kill("SIGKILL");
		} catch {
			/* ignore */
		}
	}
}

export const audioService = new AudioService();
