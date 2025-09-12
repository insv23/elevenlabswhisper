export type RenderOptions = {
  width?: number;
  height?: number;
  message?: string;
  charset?: string[]; // from dense to sparse; expects at least 5 entries
};

/**
 * Render a synthetic ASCII waveform wrapped in Markdown code fences.
 * Pure function depending only on the provided seed and options.
 */
export function renderSyntheticWave(seed: number, opts: RenderOptions = {}): string {
  const height = opts.height ?? 18;
  const width = opts.width ?? 105;
  const message = opts.message ?? "RECORDING AUDIO...  PRESS ENTER TO STOP";
  const chars = opts.charset ?? ["█", "▓", "▒", "░", "·"]; // dense -> sparse

  let md = "```\n";
  md += `${message}\n\n`;

  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const baseAmplitude1 = Math.sin((x / width) * Math.PI * 4) * 0.3;
      const baseAmplitude2 = Math.sin((x / width) * Math.PI * 8) * 0.15;
      const baseAmplitude3 = Math.sin((x / width) * Math.PI * 2) * 0.25;
      const baseAmplitude = baseAmplitude1 + baseAmplitude2 + baseAmplitude3;
      const randomFactor = Math.sin(x + seed * 0.35) * 0.2;
      const amplitude = baseAmplitude + randomFactor; // roughly in [-0.9, 0.9]

      const normalizedAmplitude = (amplitude + 0.7) * height * 0.5;
      const distFromCenter = Math.abs(y - height / 2);
      const shouldDraw = distFromCenter < normalizedAmplitude;

      if (shouldDraw) {
        const intensity = 1 - distFromCenter / Math.max(normalizedAmplitude, 1e-6);
        let ch = chars[chars.length - 1] ?? "·";
        if (intensity > 0.8) ch = chars[0] ?? "█";
        else if (intensity > 0.6) ch = chars[1] ?? "▓";
        else if (intensity > 0.4) ch = chars[2] ?? "▒";
        else if (intensity > 0.2) ch = chars[3] ?? "░";
        line += ch;
      } else {
        line += " ";
      }
    }
    md += `${line}\n`;
  }
  md += "```";
  return md;
}
