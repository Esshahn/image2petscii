export interface Palette {
  name: string;
  values: string[];
}

export interface PaletteData {
  color_names: string[];
  palettes: Record<string, Palette>;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export async function loadPaletteData(url: string): Promise<PaletteData> {
  const resp = await fetch(url);
  return resp.json();
}
