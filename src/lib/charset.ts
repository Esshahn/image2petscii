/**
 * Parses the c64-charset.png into 256 binary bitmaps (8x8 each).
 * Each bitmap is a boolean[] of length 64 where true = foreground pixel.
 */

export type CharBitmap = boolean[];

export async function loadCharset(url: string): Promise<CharBitmap[]> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);

  const charsPerRow = img.width / 8; // 16
  const charsPerCol = img.height / 8; // 16
  const charsets: CharBitmap[] = [];

  for (let row = 0; row < charsPerCol; row++) {
    for (let col = 0; col < charsPerRow; col++) {
      const bitmap: boolean[] = [];
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const x = col * 8 + px;
          const y = row * 8 + py;
          const idx = (y * img.width + x) * 4;
          // White pixel = foreground (true), black = background (false)
          const brightness = imageData.data[idx]; // R channel is enough
          bitmap.push(brightness > 128);
        }
      }
      charsets.push(bitmap);
    }
  }

  return charsets;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
