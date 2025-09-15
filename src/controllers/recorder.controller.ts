import { type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { recordingStore } from "../store/recording.store";
import { audioService, WAV_HEADER_SIZE } from "../services/audio.service";
import { transcriptionService } from "../services/transcription.service";
import { storageService } from "../services/storage.service";

class RecorderController {
  private currentProc: ChildProcessWithoutNullStreams | null = null;
  private transitionLock = false;
  private currentFilePath: string | null = null;

  // In-flight promises for single-flight semantics
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (recordingStore.get().status !== 'idle') return;
    
    try {
      await audioService.initialize();
    } catch (error) {
      recordingStore.set({ 
        status: 'error', 
        error: (error as Error)?.message || 'Initialization failed' 
      });
      throw error;
    }
  }

  async requestStart(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    
    const currentState = recordingStore.get();
    if (this.transitionLock || currentState.status !== 'idle') {
      return;
    }

    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    this.transitionLock = true;
    
    try {
      recordingStore.set({ 
        status: 'starting', 
        error: undefined, 
        transcript: undefined 
      });

      await storageService.ensureRecordingsDir();
      const filename = storageService.getRecordingFilename();
      const outputPath = path.join(storageService.recordingsDir, filename);
      this.currentFilePath = outputPath;

      const { proc } = await audioService.start({ outputPath });
      this.currentProc = proc;

      // Monitor process for unexpected exits
      proc.on('error', (error) => {
        this.handleProcessError(error);
      });

      proc.on('exit', (code, signal) => {
        if (recordingStore.get().status === 'recording' && code !== 0) {
          this.handleProcessError(new Error(`Sox exited unexpectedly: code=${code}, signal=${signal}`));
        }
      });

      recordingStore.set({ status: 'recording', filePath: outputPath });
    } catch (error) {
      recordingStore.set({ 
        status: 'error', 
        error: (error as Error)?.message || 'Failed to start recording' 
      });
      this.cleanup();
      throw error;
    } finally {
      this.transitionLock = false;
    }
  }

  async requestStop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    
    const currentState = recordingStore.get();
    if (!this.currentProc || currentState.status !== 'recording') {
      return;
    }

    this.stopPromise = this.doStop().finally(() => {
      this.stopPromise = null;
    });
    
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    if (!this.currentProc || !this.currentFilePath) return;
    
    const proc = this.currentProc;
    const filePath = this.currentFilePath;
    
    recordingStore.set({ status: 'stopping' });

    try {
      await audioService.stop(proc);
      this.currentProc = null;
      
      // Check if recording is valid
      const size = await storageService.getFileSize(filePath).catch(() => 0);
      if (size <= WAV_HEADER_SIZE) {
        await storageService.deleteFile(filePath).catch(() => {});
        recordingStore.set({ 
          status: 'error', 
          error: 'No audio was captured. The recording is empty.' 
        });
        this.currentFilePath = null;
        return;
      }

      // Start transcription
      recordingStore.set({ status: 'transcribing' });
      await this.doTranscribe(filePath);
    } catch (error) {
      recordingStore.set({ 
        status: 'error', 
        error: (error as Error)?.message || 'Failed to stop recording' 
      });
      this.cleanup();
    }
  }



  private async doTranscribe(filePath: string): Promise<void> {
    try {
      const text = await transcriptionService.transcribe(filePath);
      recordingStore.set({ 
        status: 'success', 
        transcript: text || '' 
      });
      this.currentFilePath = null;
    } catch (error) {
      recordingStore.set({ 
        status: 'error', 
        error: (error as Error)?.message || 'Transcription failed' 
      });
    }
  }

  async requestCancel(): Promise<void> {
    if (this.currentProc) {
      const proc = this.currentProc;
      const filePath = this.currentFilePath;
      
      try {
        await audioService.cancel(proc);
      } catch {
        // ignore cancel errors
      }
      
      this.currentProc = null;
      if (filePath) {
        await storageService.deleteFile(filePath).catch(() => {});
        this.currentFilePath = null;
      }
    }
    
    recordingStore.set({ status: 'idle' });
  }

  async requestReset(): Promise<void> {
    if (this.currentProc) {
      await this.requestCancel();
    }
    recordingStore.reset();
  }

  private handleProcessError(error: Error): void {
    console.error('Process error:', error);
    this.cleanup();
    recordingStore.set({ 
      status: 'error', 
      error: error.message || 'Recording process failed' 
    });
  }

  private cleanup(): void {
    if (this.currentProc) {
      try {
        this.currentProc.kill('SIGKILL');
      } catch {}
      this.currentProc = null;
    }

    if (this.currentFilePath) {
      storageService.deleteFile(this.currentFilePath).catch(() => {});
      this.currentFilePath = null;
    }
  }
}

export const recorderController = new RecorderController();
