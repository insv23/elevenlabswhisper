import { runAppleScript } from "@raycast/utils";

export type MuteSnapshot = {
  originallyMuted: boolean;
  changed: boolean;
};

const parseBool = (s: string): boolean => {
  const v = String(s).trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1";
};

class SystemAudioService {
  async getMuted(): Promise<boolean> {
    try {
      const result = await runAppleScript("output muted of (get volume settings)");
      return parseBool(result);
    } catch (error) {
      // If AppleScript is not permitted or fails, assume not muted to minimize disruption
      console.warn("AppleScript getMuted failed:", error);
      throw error;
    }
  }

  async muteWithSnapshot(): Promise<MuteSnapshot> {
    const originallyMuted = await this.getMuted().catch((e) => {
      throw e;
    });

    if (originallyMuted) {
      return { originallyMuted: true, changed: false };
    }

    try {
      await runAppleScript("set volume output muted true");
      return { originallyMuted: false, changed: true };
    } catch (error) {
      console.warn("AppleScript mute failed:", error);
      throw error;
    }
  }

  async restoreFromSnapshot(snapshot: MuteSnapshot): Promise<"restored" | "noop" | "failed"> {
    try {
      if (!snapshot.changed) return "noop";
      // Only unmute if we actually muted earlier
      await runAppleScript("set volume output muted false");
      return "restored";
    } catch (error) {
      console.warn("AppleScript unmute failed:", error);
      return "failed";
    }
  }
}

export const systemAudio = new SystemAudioService();
