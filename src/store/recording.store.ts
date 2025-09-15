export type RecordingState = {
  status: 'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing' | 'success' | 'error';
  error?: string;
  filePath?: string;
  transcript?: string;
};

type Listener = () => void;

class RecordingStore {
  private state: RecordingState = { status: 'idle' };
  private listeners = new Set<Listener>();
  private cachedSnapshot: RecordingState | null = null;

  get(): RecordingState {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = { ...this.state };
    }
    return this.cachedSnapshot;
  }

  set(patch: Partial<RecordingState>): void {
    this.state = { ...this.state, ...patch };
    this.cachedSnapshot = null; // Invalidate cache
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.state = { status: 'idle' };
    this.cachedSnapshot = null; // Invalidate cache
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    });
  }
}

export const recordingStore = new RecordingStore();
