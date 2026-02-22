# PETSCII Converter

A web-based tool that converts images into PETSCII art using the Commodore 64 character set and color palette.

## Features

- **Image import** via drag & drop or file picker
- **Multiple dithering algorithms**: Floyd-Steinberg, Atkinson, Jarvis-Judice-Ninke, Stucki, Threshold
- **Levels adjustment**: black point, white point, gamma controls
- **Contrast and resolution** controls for fine-tuning the dither
- **3 built-in C64 palettes**: Colodore, PALette, Pepto
- **Auto palette extraction**: detects colors directly from the input image and maps them to C64 color indices
- **Per-color and per-character exclusion**: click to include/exclude individual colors or PETSCII characters
- **Selectable background color**
- **PNG export** of the converted output

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Build

```bash
npm run build
npm run preview
```

## How It Works

1. **Dithering**: The source image is scaled to C64 resolution (320x200), converted to luminance, and dithered to a black/white bitmap using the selected algorithm.
2. **Character matching**: Each 8x8 block of the bitmap is matched against the C64 charset (256 characters) using Hamming distance. Both normal and inverted polarities are evaluated.
3. **Color matching**: For each matched character, foreground color is determined by per-pixel majority voting against the selected palette.
4. **Rendering**: The result is rendered to a canvas using the matched characters and colors.

## Project Structure

```
src/
  App.svelte          — Main UI (Svelte 5 with runes)
  main.ts             — App entry point
  app.css             — Global styles
  lib/
    converter.ts      — Dithering, character matching, color matching, palette extraction
    charset.ts        — C64 charset PNG parser (8x8 bitmaps)
    colors.ts         — Color utilities (hex conversion, palette loading)
    renderer.ts       — Canvas rendering and PNG export
public/
  c64-charset.png     — 128x128 C64 character set (16x16 grid of 8x8 chars)
  palette.json        — C64 color palettes (Colodore, PALette, Pepto)
```

## Tech Stack

- [Svelte 5](https://svelte.dev/) with runes (`$state`, `$derived`, `$effect`)
- [Vite](https://vite.dev/)
- TypeScript
