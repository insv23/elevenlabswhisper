import { useCallback, useEffect, useSyncExternalStore } from "react";
import { recordingStore, type RecordingState } from "../store/recording.store";
import { recorderController } from "../controllers/recorder.controller";

type UiStatus = "idle" | "recording" | "transcribing" | "success" | "error";

type UiState = {
  status: UiStatus;
  transcript?: string;
  error?: string;
};

function toUiStatus(storeStatus: RecordingState['status']): UiStatus {
  switch (storeStatus) {
    case "idle":
      return "idle";
    case "starting":
    case "recording":
      return "recording";
    case "stopping":
    case "transcribing":
      return "transcribing";
    case "success":
      return "success";
    case "error":
      return "error";
  }
}

export function useTranscription() {
  const storeState = useSyncExternalStore(
    recordingStore.subscribe.bind(recordingStore),
    recordingStore.get.bind(recordingStore)
  );

  const state: UiState = {
    status: toUiStatus(storeState.status),
    transcript: storeState.transcript,
    error: storeState.error
  };

  useEffect(() => {
    recorderController.initialize().catch((e) => {
      console.error('Controller initialization failed:', e);
    });
  }, []);

  const startRecording = useCallback(async () => {
    await recorderController.requestStart();
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    await recorderController.requestStop();
  }, []);

  const reset = useCallback(() => {
    recorderController.requestReset();
  }, []);

  return { state, startRecording, stopAndTranscribe, reset } as const;
}
