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
	useNavigation,
	popToRoot,
} from "@raycast/api";

import { useEffect, useMemo, useState } from "react";
import { useTranscription } from "./hooks/useTranscription";
import { renderSyntheticWave } from "./utils/waveform";
import type { Preferences } from "./types/preferences";

export default function Command() {
	const { pop } = useNavigation();
	const { state, startRecording, stopAndTranscribe, reset } =
		useTranscription();
	const [waveformSeed, setWaveformSeed] = useState(0);
	const [sessionKey, setSessionKey] = useState(0);

	// 检查偏好设置是否缺失
	const missingPrefReason = useMemo(() => {
		const prefs = getPreferenceValues<Preferences>();
		const provider = prefs.provider ?? "elevenlabs";
		if (provider === "elevenlabs" && !prefs.elevenlabsApiKey?.trim()) {
			return "Missing ElevenLabs API Key";
		}
		if (provider === "ai302" && !prefs.ai302ApiKey?.trim()) {
			return "Missing 302.ai API Key";
		}
		return undefined;
	}, []);

	// 状态机副作用处理
	useEffect(() => {
		switch (state.status) {
			case "recording":
				showToast(
					Toast.Style.Animated,
					"Recording…",
					"Press Enter to stop, Esc to cancel",
				);
				break;
			case "transcribing":
				showToast(
					Toast.Style.Animated,
					"Transcribing…",
					"Uploading and processing audio",
				);
				break;
			case "success":
				showToast(Toast.Style.Success, "Transcription Complete");
				// 更新会话 key，强制成功态表单重挂载，以应用新的 defaultValue
				setSessionKey(Date.now());
				break;
			case "error":
				showToast(Toast.Style.Failure, "Error", state.error);
				break;
		}
	}, [state.status, state.error]);

	// 自动开始录音
	useEffect(() => {
		if (state.status === "idle" && !missingPrefReason) {
			startRecording();
		}
	}, [state.status, missingPrefReason, startRecording]);

	// 录音时更新波形图动画
	useEffect(() => {
		if (state.status !== "recording") return;
		const interval = setInterval(() => setWaveformSeed((s) => s + 1), 150);
		return () => clearInterval(interval);
	}, [state.status]);

	// 渲染缺失偏好设置的视图
	if (missingPrefReason) {
		return (
			<Detail
				markdown={`## Configuration Required\n\n${missingPrefReason}.\n\nPlease press **Enter** to open the extension preferences.`}
				actions={
					<ActionPanel>
						<Action
							title="Open Preferences"
							onAction={openExtensionPreferences}
						/>
					</ActionPanel>
				}
			/>
		);
	}

	// 渲染转录结果视图
	if (state.status === "success" && state.transcript !== undefined) {
		return (
			<Form
				key={sessionKey}
				actions={
					<ActionPanel>
						<Action.SubmitForm
							title="Paste Edited Transcript"
							onSubmit={async (values: { transcript?: string }) => {
								const text = values?.transcript ?? "";
								await popToRoot(); // 退回到 Raycast root, 保证下一次打开该插件是自动开始录音
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
							onAction={reset}
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

	// 渲染主视图 (idle, recording, transcribing, error)
	const getMarkdown = () => {
		switch (state.status) {
			case "recording":
				return renderSyntheticWave(waveformSeed);
			case "transcribing":
				return "## Transcribing...\n\nPlease wait while we process your audio.";
			case "error":
				return `## Error\n\n${state.error}\n\nPress **Enter** to try again.`;
			case "idle":
				return "## Ready to Record\n\nPress **Enter** to start a new recording.";
		}
	};

	const getActions = () => {
		switch (state.status) {
			case "recording":
				return (
					<ActionPanel>
						<Action title="Stop and Transcribe" onAction={stopAndTranscribe} />
					</ActionPanel>
				);
			case "error":
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
