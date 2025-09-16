import { useEffect, useState } from "react";

export const useWaveformAnimation = (isRecording: boolean) => {
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const interval = setInterval(() => {
      setSeed((current) => current + 1);
    }, 150);

    return () => {
      clearInterval(interval);
    };
  }, [isRecording]);

  return seed;
};
