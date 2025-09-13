export type RenderOptions = {
  width?: number;
  height?: number;
  message?: string;
  charset?: string[]; // dense -> sparse; expects at least 5 entries
};

// Classic waveform renderer with dense block characters and header message
export function renderSyntheticWave(seed = 0, opts: RenderOptions = {}): string {
  const height = opts.height ?? 18;
  const width = opts.width ?? 105;
  const message = opts.message ?? "RECORDING AUDIO...  PRESS ENTER TO STOP";
  const chars = opts.charset ?? ["█", "▓", "▒", "░", "·"]; // dense -> sparse

  let md = "```\n";
  md += `${message}\n\n`;

  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const base1 = Math.sin((x / width) * Math.PI * 4) * 0.3;
      const base2 = Math.sin((x / width) * Math.PI * 8) * 0.15;
      const base3 = Math.sin((x / width) * Math.PI * 2) * 0.25;
      const base = base1 + base2 + base3;
      const jitter = Math.sin(x + seed * 0.35) * 0.2;
      const amp = base + jitter; // roughly in [-0.9, 0.9]

      const norm = (amp + 0.7) * height * 0.5;
      const dist = Math.abs(y - height / 2);
      const draw = dist < norm;

      if (draw) {
        const intensity = 1 - dist / Math.max(norm, 1e-6);
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
