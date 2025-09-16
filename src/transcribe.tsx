import {
	Action,
	ActionPanel,
	Detail,
	Form,
	Keyboard,
	Toast,
	Clipboard,
	getPreferenceValues,
	openExtensionPreferences,
	showToast,
	popToRoot,
} from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	useTranscriptionActions,
	useTranscriptionState,
} from "./store/transcription.store";
import { renderSyntheticWave } from "./utils/waveform";
import type { Preferences } from "./types/preferences";
import { audioService, SoxError } from "./services/audio.service";

type SystemCheckResult =
	| { hasError: false }
	| {
			hasError: true;
			title: string;
			message: string;
			solution: string;
			action?: string;
			actionHandler?: () => void;
	  };

export default function Command() {
	const state = useTranscriptionState();
	const {
		startRecording,
		stopAndTranscribe,
		retryTranscription,
		cancelRecording,
		reset,
	} = useTranscriptionActions();
	const [waveformSeed, setWaveformSeed] = useState(0);
	const [sessionKey, setSessionKey] = useState(0);
	const [systemCheck, setSystemCheck] = useState<{
		status: "pending" | "ok" | "error";
		error?: SoxError;
	}>(() => ({ status: "pending" }));
	const autoStartedRef = useRef(false);

	useEffect(() => {
		let cancelled = false;
		const runCheck = async () => {
			try {
				await audioService.ensureSoxAvailable();
				if (!cancelled) setSystemCheck({ status: "ok" });
			} catch (error) {
				const normalized =
					error instanceof SoxError
						? error
						: new SoxError(
								"Audio service check failed.",
								"SOX_CHECK_FAILED",
								error,
							);
				if (!cancelled) setSystemCheck({ status: "error", error: normalized });
			}
		};
		void runCheck();
		return () => {
			cancelled = true;
		};
	}, []);

	const systemCheckResult = useMemo<SystemCheckResult>(() => {
		const prefs = getPreferenceValues<Preferences>();
		const provider = prefs.provider ?? "elevenlabs";

		if (provider === "elevenlabs" && !prefs.elevenlabsApiKey?.trim()) {
			return {
				hasError: true,
				title: "API Key Required",
				message:
					"ElevenLabs API Key is missing. Please configure it in preferences.",
				solution: "Open extension preferences and add your ElevenLabs API key",
				action: "Open Preferences",
				actionHandler: openExtensionPreferences,
			};
		}

		if (provider === "ai302" && !prefs.ai302ApiKey?.trim()) {
			return {
				hasError: true,
				title: "API Key Required",
				message:
					"302.ai API Key is missing. Please configure it in preferences.",
				solution: "Open extension preferences and add your 302.ai API key",
				action: "Open Preferences",
				actionHandler: openExtensionPreferences,
			};
		}

		if (systemCheck.status === "pending") {
			return {
				hasError: true,
				title: "Checking Audio Dependencies",
				message: "Please wait while we verify the SoX executable.",
				solution: "No action required. This will finish automatically.",
			};
		}

		if (systemCheck.status === "error") {
			const code = systemCheck.error?.code;
			switch (code) {
				case "SOX_NOT_FOUND":
					return {
						hasError: true,
						title: "SoX Not Found",
						message:
							"SoX executable could not be located. Install it or set its absolute path in preferences.",
						solution:
							"Install via `brew install sox`, then configure the executable path if needed.",
						action: "Open Preferences",
						actionHandler: openExtensionPreferences,
					};
				case "PREF_NOT_ABSOLUTE":
					return {
						hasError: true,
						title: "Invalid SoX Path",
						message: "The configured SoX executable path must be absolute.",
						solution: "Update the SoX path in preferences to an absolute path.",
						action: "Open Preferences",
						actionHandler: openExtensionPreferences,
					};

				default:
					return {
						hasError: true,
						title: "SoX Unavailable",
						message: systemCheck.error?.message ?? "Failed to execute SoX.",
						solution:
							"Run `sox --version` in Terminal to verify installation and permissions.",
					};
			}
		}

		return { hasError: false };
	}, [systemCheck]);

	useEffect(() => {
		switch (state.status) {
			case "idle":
				showToast(
					Toast.Style.Success,
					"Ready to Record",
					"Press Enter to start transcribing",
				);
				break;
			case "recording":
				showToast(
					Toast.Style.Animated,
					"Recording…",
					"Press Enter to stop, Cmd+Z to cancel",
				);
				break;
			case "transcribing":
				showToast(
					Toast.Style.Animated,
					"Transcribing…",
					"Uploading and processing audio",
				);
				break;
			case "transcribing_success":
				showToast(Toast.Style.Success, "Transcription Complete");
				setSessionKey(Date.now());
				break;
			case "transcribing_error":
				showToast(Toast.Style.Failure, "Transcription Failed", state.error);
				break;
		}
	}, [state.status, state.error]);

	useEffect(() => {
		if (
			state.status === "idle" &&
			systemCheck.status === "ok" &&
			!systemCheckResult.hasError &&
			!autoStartedRef.current
		) {
			autoStartedRef.current = true;
			startRecording();
		}
	}, [
		state.status,
		systemCheck.status,
		systemCheckResult.hasError,
		startRecording,
	]);

	const handleCancel = () => {
		void cancelRecording();
		autoStartedRef.current = true;
	};

	const handleReset = () => {
		autoStartedRef.current = false;
		reset();
	};

	useEffect(() => {
		if (state.status !== "recording") return;
		const interval = setInterval(() => setWaveformSeed((s) => s + 1), 150);
		return () => clearInterval(interval);
	}, [state.status]);

	if (systemCheckResult.hasError) {
		const actions =
			systemCheckResult.action && systemCheckResult.actionHandler ? (
				<ActionPanel>
					<Action
						title={systemCheckResult.action}
						onAction={systemCheckResult.actionHandler}
					/>
				</ActionPanel>
			) : undefined;

		return (
			<Detail
				markdown={`## ${systemCheckResult.title}\n\n${systemCheckResult.message}\n\n**Solution:** ${systemCheckResult.solution}`}
				actions={actions}
			/>
		);
	}

	if (
		state.status === "transcribing_success" &&
		state.transcript !== undefined
	) {
		return (
			<Form
				key={sessionKey}
				actions={
					<ActionPanel>
						<Action.SubmitForm
							title="Paste Edited Transcript"
							onSubmit={async (values: { transcript?: string }) => {
								const text = values?.transcript ?? "";
								await popToRoot();
								await Clipboard.paste(text);
							}}
						/>
						<Action.SubmitForm
							title="Copy Edited Transcript"
							onSubmit={(values: { transcript?: string }) =>
								Clipboard.copy(values?.transcript ?? "")
							}
						/>
						<Action
							title="Start New Recording"
							onAction={handleReset}
							shortcut={Keyboard.Shortcut.Common.New}
						/>
					</ActionPanel>
				}
			>
				<Form.TextArea
					id="transcript"
					title="Transcript"
					defaultValue={state.transcript}
					storeValue={false}
				/>
			</Form>
		);
	}

	const getMarkdown = () => {
		switch (state.status) {
			case "recording":
				return renderSyntheticWave(waveformSeed);
			case "transcribing":
				return "## Transcribing...\n\nPlease wait while we process your audio.";
			case "transcribing_error":
				return `## Transcription Failed\n\n${
					state.error || "An error occurred during transcription."
				}\n\nYou can try again or start a new recording.`;
			case "idle":
				if (state.error?.includes("Recording failed:")) {
					return `## Recording Failed\n\n${state.error}\n\nPlease check your audio settings and try again.`;
				}
				return "## Ready to Record\n\nPress **Enter** to start a new recording.";
			default:
				return "";
		}
	};

	const getActions = () => {
		switch (state.status) {
			case "recording":
				return (
					<ActionPanel>
						<Action title="Stop and Transcribe" onAction={stopAndTranscribe} />
						<Action
							title="Cancel Recording"
							onAction={handleCancel}
							shortcut={{ modifiers: ["cmd"], key: "z" }}
						/>
					</ActionPanel>
				);
			case "transcribing_error":
				return (
					<ActionPanel>
						<Action title="Retry Transcription" onAction={retryTranscription} />
						<Action
							title="Start New Recording"
							onAction={handleReset}
							shortcut={Keyboard.Shortcut.Common.New}
						/>
					</ActionPanel>
				);
			case "idle":
				return (
					<ActionPanel>
						<Action title="Start New Recording" onAction={startRecording} />
					</ActionPanel>
				);
			default:
				return null;
		}
	};

	return (
		<Detail
			isLoading={state.status === "transcribing"}
			markdown={getMarkdown()}
			actions={getActions()}
		/>
	);
}
