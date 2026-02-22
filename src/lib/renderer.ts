import type { CharBitmap } from "./charset";
import type { ConversionResult } from "./converter";
import type { RGB } from "./colors";

/**
 * Render a PETSCII conversion result onto a canvas.
 * Each cell is drawn as 8x8 pixels using the charset bitmap and assigned colors.
 */
export function renderPetscii(
  canvas: HTMLCanvasElement,
  result: ConversionResult,
  charset: CharBitmap[],
  palette: RGB[],
  bgColorIndex: number
): void {
  const width = result.cols * 8;
  const height = result.rows * 8;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const bgColor = palette[bgColorIndex];

  for (let row = 0; row < result.rows; row++) {
    for (let col = 0; col < result.cols; col++) {
      const cell = result.cells[row * result.cols + col];
      const bitmap = charset[cell.charIndex];
      const fgColor = palette[cell.fgColorIndex];

      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const bitmapVal = bitmap[py * 8 + px];
          const isFg = cell.inverted ? !bitmapVal : bitmapVal;
          const color = isFg ? fgColor : bgColor;

          const x = col * 8 + px;
          const y = row * 8 + py;
          const idx = (y * width + x) * 4;
          data[idx] = color.r;
          data[idx + 1] = color.g;
          data[idx + 2] = color.b;
          data[idx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Save the canvas content as a PNG file download.
 */
export function saveCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
