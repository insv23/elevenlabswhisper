import { useCallback, useReducer } from "react";
import { audioService } from "../services/audio.service";
import { transcriptionService } from "../services/transcription.service";

type State = {
  status: "idle" | "recording" | "transcribing" | "success" | "error";
  transcript?: string;
  error?: string;
};

type Action =
  | { type: "RECORD_START" }
  | { type: "TRANSCRIBE_START" }
  | { type: "SUCCESS"; payload: string }
  | { type: "ERROR"; payload: string }
  | { type: "RESET" };

const initialState: State = { status: "idle" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "RECORD_START":
      return { status: "recording" };
    case "TRANSCRIBE_START":
      return { ...state, status: "transcribing" };
    case "SUCCESS":
      return { status: "success", transcript: action.payload };
    case "ERROR":
      return { status: "error", error: action.payload };
    case "RESET":
      return { status: "idle" };
    default:
      return state;
  }
}

export function useTranscription() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const startRecording = useCallback(async () => {
    try {
      dispatch({ type: "RECORD_START" });
      await audioService.start();
    } catch (e) {
      const err = e as Error;
      dispatch({ type: "ERROR", payload: err.message || "Failed to start recording." });
    }
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    try {
      const filePath = await audioService.stop();
      dispatch({ type: "TRANSCRIBE_START" });
      const text = await transcriptionService.transcribe(filePath);
      dispatch({ type: "SUCCESS", payload: text || "" });
    } catch (e) {
      const err = e as Error;
      dispatch({ type: "ERROR", payload: err.message || "Transcription failed." });
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    try {
      await audioService.cancel();
      dispatch({ type: "RESET" });
    } catch (e) {
      const err = e as Error;
      dispatch({ type: "ERROR", payload: err.message || "Cancel failed." });
    }
  }, []);

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return { state, startRecording, stopAndTranscribe, cancelRecording, reset } as const;
}

