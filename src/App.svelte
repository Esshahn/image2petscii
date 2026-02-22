<script lang="ts">
  import { loadCharset, type CharBitmap } from "./lib/charset";
  import { hexToRgb, loadPaletteData, type PaletteData, type RGB } from "./lib/colors";
  import { ditherImage, convertFromDithered, extractPaletteFromImage, DITHER_METHODS, type ConversionResult, type DitherMethod, type DitherSettings, type ConversionSettings } from "./lib/converter";
  import { renderPetscii, saveCanvasAsPng } from "./lib/renderer";

  let paletteData = $state<PaletteData | null>(null);
  let charset = $state<CharBitmap[] | null>(null);
  let sourceImage = $state<HTMLImageElement | null>(null);
  let sourcePreviewUrl = $state<string | null>(null);
  let result = $state<ConversionResult | null>(null);
  let converting = $state(false);

  let selectedPalette = $state("colodore");
  let extractedPalette = $state<RGB[] | null>(null);
  let bgColorIndex = $state(0);
  let contrastValue = $state(8);
  let ditherMethod = $state<DitherMethod>("threshold");
  let levelsBlack = $state(0);
  let levelsWhite = $state(255);
  let levelsGamma = $state(1.0);
  let excludedChars = $state<Set<number>>(new Set());
  let excludedColors = $state<Set<number>>(new Set());

  let cachedDither = $state<{
    bw: Uint8Array;
    imageData: ImageData;
    width: number;
    height: number;
  } | null>(null);

  let outputCanvas: HTMLCanvasElement;
  let ditheredCanvas: HTMLCanvasElement;
  let charsetCanvas: HTMLCanvasElement;
  let dragging = $state(false);

  // Derived settings objects — built once, used everywhere
  let ditherSettings: DitherSettings = $derived({
    method: ditherMethod,
    contrast: contrastValue,
    resolution: 1,
    blackPoint: levelsBlack,
    whitePoint: levelsWhite,
    gamma: levelsGamma,
  });

  let currentPaletteRgb: RGB[] = $derived.by(() => {
    if (selectedPalette === "auto" && extractedPalette) return extractedPalette;
    if (!paletteData) return [];
    const pal = paletteData.palettes[selectedPalette];
    return pal ? pal.values.map(hexToRgb) : [];
  });

  let colorNames: string[] = $derived(paletteData?.color_names ?? []);

  let conversionSettings: ConversionSettings = $derived({
    charset: charset ?? [],
    palette: currentPaletteRgb,
    bgColorIndex,
    excludedChars,
    excludedColors,
  });

  // Load charset and palette on mount
  $effect(() => {
    loadCharset("/c64-charset.png").then((c) => (charset = c));
    loadPaletteData("/palette.json").then((p) => (paletteData = p));
  });

  // Render charset grid when charset loads
  $effect(() => {
    if (charset && charsetCanvas) {
      renderCharsetGrid();
    }
  });

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      sourcePreviewUrl = url;
      result = null;
      updateExtractedPalette(img);
      updateDither();
    };
    img.src = url;
  }

  function updateExtractedPalette(img: HTMLImageElement) {
    if (!paletteData) return;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 320, 200);
    const imageData = ctx.getImageData(0, 0, 320, 200);
    const allPalettes = Object.values(paletteData.palettes).map((p) =>
      p.values.map(hexToRgb)
    );
    extractedPalette = extractPaletteFromImage(imageData, allPalettes);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function onDragLeave() {
    dragging = false;
  }

  function onFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFile(file);
  }

  function updateDither() {
    if (!sourceImage) return;
    cachedDither = ditherImage(sourceImage, ditherSettings);
    renderDitheredPreview();
  }

  function renderDitheredPreview() {
    if (!cachedDither || !ditheredCanvas) return;
    const { bw, width, height } = cachedDither;
    ditheredCanvas.width = width;
    ditheredCanvas.height = height;
    const ctx = ditheredCanvas.getContext("2d")!;
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < bw.length; i++) {
      const v = bw[i] ? 255 : 0;
      const idx = i * 4;
      imgData.data[idx] = v;
      imgData.data[idx + 1] = v;
      imgData.data[idx + 2] = v;
      imgData.data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function doConvert(redither = true) {
    if (!sourceImage || !charset || !currentPaletteRgb.length) return;
    converting = true;

    if (redither || !cachedDither) {
      cachedDither = ditherImage(sourceImage, ditherSettings);
      renderDitheredPreview();
    }

    requestAnimationFrame(() => {
      const { bw, imageData, width, height } = cachedDither!;
      result = convertFromDithered(imageData, bw, width, height, conversionSettings);
      renderPetscii(outputCanvas, result, charset!, currentPaletteRgb, bgColorIndex);
      converting = false;
    });
  }

  function savePng() {
    if (!outputCanvas) return;
    saveCanvasAsPng(outputCanvas, "petscii-output.png");
  }

  // === Charset grid ===
  function renderCharsetGrid() {
    if (!charset || !charsetCanvas) return;
    const cellSize = 10;
    const cols = 16;
    const rows = Math.ceil(charset.length / cols);
    charsetCanvas.width = cols * cellSize;
    charsetCanvas.height = rows * cellSize;
    const ctx = charsetCanvas.getContext("2d")!;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (let ci = 0; ci < charset.length; ci++) {
      const col = ci % cols;
      const row = Math.floor(ci / cols);
      const ox = col * cellSize + 1;
      const oy = row * cellSize + 1;
      const bitmap = charset[ci];
      const isExcluded = excludedChars.has(ci);

      ctx.fillStyle = isExcluded ? "#400" : "#222";
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);

      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          if (bitmap[py * 8 + px]) {
            ctx.fillStyle = isExcluded ? "#844" : "#ddd";
            ctx.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    }
  }

  function onCharsetClick(e: MouseEvent) {
    if (!charset || !charsetCanvas) return;
    const rect = charsetCanvas.getBoundingClientRect();
    const scaleX = charsetCanvas.width / rect.width;
    const scaleY = charsetCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const cellSize = 10;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    const ci = row * 16 + col;

    if (ci >= 0 && ci < charset.length) {
      const newExcluded = new Set(excludedChars);
      if (newExcluded.has(ci)) {
        newExcluded.delete(ci);
      } else {
        newExcluded.add(ci);
      }
      excludedChars = newExcluded;
      renderCharsetGrid();
    }
  }
</script>

<h1>PETSCII Converter</h1>

<!-- Section 1: Import Image -->
<div class="section">
  <h2 class="section-title">1. Import Image</h2>
  <div class="section-body">
    <div
      class="dropzone"
      class:dragging
      ondrop={onDrop}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      role="button"
      tabindex="0"
    >
      {#if sourcePreviewUrl}
        <img src={sourcePreviewUrl} alt="Source" class="preview-img" />
      {:else}
        <p>Drop image here or click to select</p>
      {/if}
      <input type="file" accept="image/*" onchange={onFileInput} class="file-input" />
    </div>
  </div>
</div>

<!-- Section 2: Dither Settings -->
<div class="section">
  <h2 class="section-title">2. Dither</h2>
  <div class="section-body">
    <div class="controls-row">
      <div class="control-group">
        <span class="label">Method</span>
        <select bind:value={ditherMethod} onchange={updateDither}>
          {#each DITHER_METHODS as m}
            <option value={m.value}>{m.label}</option>
          {/each}
        </select>
      </div>

      <div class="control-group">
        <span class="label">Contrast: {contrastValue}</span>
        <input
          type="range"
          min="0"
          max="20"
          step="1"
          bind:value={contrastValue}
          oninput={updateDither}
        />
      </div>

    </div>

    <div class="controls-row">
      <div class="control-group">
        <span class="label">Black Point: {levelsBlack}</span>
        <input
          type="range"
          min="0"
          max="254"
          step="1"
          bind:value={levelsBlack}
          oninput={updateDither}
        />
      </div>

      <div class="control-group">
        <span class="label">White Point: {levelsWhite}</span>
        <input
          type="range"
          min="1"
          max="255"
          step="1"
          bind:value={levelsWhite}
          oninput={updateDither}
        />
      </div>

      <div class="control-group">
        <span class="label">Gamma: {levelsGamma.toFixed(2)}</span>
        <input
          type="range"
          min="0.2"
          max="5.0"
          step="0.05"
          bind:value={levelsGamma}
          oninput={updateDither}
        />
      </div>
    </div>

    <div class="canvas-wrapper dither-preview">
      <canvas bind:this={ditheredCanvas}></canvas>
      {#if !cachedDither}
        <div class="placeholder">Load an image to see dither preview</div>
      {/if}
    </div>
  </div>
</div>

<!-- Section 3: Colors -->
<div class="section">
  <h2 class="section-title">3. Colors</h2>
  <div class="section-body">
    <div class="controls-row">
      <div class="control-group">
        <span class="label">Palette</span>
        <select bind:value={selectedPalette} onchange={() => doConvert()}>
          <option value="auto" disabled={!extractedPalette}>Auto (from image)</option>
          {#if paletteData}
            {#each Object.entries(paletteData.palettes) as [key, pal]}
              <option value={key}>{pal.name}</option>
            {/each}
          {/if}
        </select>
      </div>
    </div>

    <div class="subsection">
      <span class="label">Background Color</span>
      <div class="color-grid">
        {#each currentPaletteRgb as color, i}
          <button
            class="color-swatch"
            class:selected={bgColorIndex === i}
            style="background-color: rgb({color.r},{color.g},{color.b})"
            title={colorNames[i] ?? `Color ${i}`}
            onclick={() => { bgColorIndex = i; doConvert(false); }}
          ></button>
        {/each}
      </div>
    </div>

    <div class="subsection">
      <div class="subsection-header">
        <span class="label">Foreground Colors <span class="hint">(click to exclude/include)</span></span>
        <div class="small-buttons">
          <button onclick={() => { excludedColors = new Set(); }}>Select All</button>
          <button onclick={() => { excludedColors = new Set(Array.from({length: currentPaletteRgb.length}, (_, i) => i)); }}>Deselect All</button>
        </div>
      </div>
      <div class="color-exclude-grid">
        {#each currentPaletteRgb as color, i}
          <button
            class="color-exclude-swatch"
            class:excluded={excludedColors.has(i)}
            style="background-color: rgb({color.r},{color.g},{color.b})"
            title={colorNames[i] ?? `Color ${i}`}
            onclick={() => {
              const next = new Set(excludedColors);
              if (next.has(i)) { next.delete(i); } else { next.add(i); }
              excludedColors = next;
            }}
          >
            {#if excludedColors.has(i)}
              <span class="x-mark">✕</span>
            {/if}
          </button>
        {/each}
      </div>
      {#if excludedColors.size > 0}
        <div class="excluded-info">
          {excludedColors.size} color{excludedColors.size === 1 ? "" : "s"} excluded
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Section 4: PETSCII Characters -->
<div class="section">
  <h2 class="section-title">4. PETSCII Characters</h2>
  <div class="section-body">
    <div class="subsection-header">
      <span class="label">Character Set <span class="hint">(click to exclude/include)</span></span>
      <div class="small-buttons">
        <button onclick={() => { excludedChars = new Set(); renderCharsetGrid(); }}>Select All</button>
        <button onclick={() => { excludedChars = new Set(Array.from({length: charset?.length ?? 0}, (_, i) => i)); renderCharsetGrid(); }}>Deselect All</button>
      </div>
    </div>
    <canvas
      bind:this={charsetCanvas}
      onclick={onCharsetClick}
      class="charset-grid"
    ></canvas>
    {#if excludedChars.size > 0}
      <div class="excluded-info">
        {excludedChars.size} character{excludedChars.size === 1 ? "" : "s"} excluded
      </div>
    {/if}
  </div>
</div>

<!-- Section 5: Output -->
<div class="section">
  <h2 class="section-title">5. Output</h2>
  <div class="section-body">
    <div class="output-actions">
      <button class="btn-primary" onclick={() => doConvert()} disabled={!sourceImage || !charset || converting}>
        {converting ? "Converting..." : "Convert"}
      </button>
      <button onclick={savePng} disabled={!result}>Save PNG</button>
    </div>
    <div class="canvas-wrapper output-preview">
      <canvas bind:this={outputCanvas}></canvas>
      {#if !result}
        <div class="placeholder">Press Convert to generate PETSCII output</div>
      {/if}
    </div>
  </div>
</div>

<style>
  h1 {
    margin-bottom: 1rem;
  }

  /* Sections */
  .section {
    background: #222244;
    border: 1px solid #333;
    border-radius: 8px;
    margin-bottom: 1rem;
    overflow: hidden;
  }

  .section-title {
    font-size: 0.95rem;
    color: #7ec8e3;
    margin: 0;
    padding: 0.6rem 1rem;
    background: #1a1a3a;
    border-bottom: 1px solid #333;
  }

  .section-body {
    padding: 1rem;
  }

  /* Controls */
  .controls-row {
    display: flex;
    gap: 1.5rem;
    align-items: flex-start;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .control-group .label {
    font-size: 0.8rem;
    color: #9e9e9e;
  }

  .control-group input[type="range"] {
    width: 160px;
    accent-color: #7ec8e3;
  }

  .subsection {
    margin-top: 0.75rem;
  }

  .subsection > .label {
    display: block;
    font-size: 0.8rem;
    color: #9e9e9e;
    margin-bottom: 0.4rem;
  }

  .subsection-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }

  .subsection-header .label {
    font-size: 0.8rem;
    color: #9e9e9e;
  }

  .small-buttons {
    display: flex;
    gap: 0.4rem;
  }

  .small-buttons button {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
  }

  .hint {
    font-size: 0.7rem;
    color: #666;
    font-weight: normal;
  }

  /* Dropzone */
  .dropzone {
    position: relative;
    border: 2px dashed #555;
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
    cursor: pointer;
    max-width: 480px;
    min-height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s;
  }

  .dropzone.dragging {
    border-color: #7ec8e3;
    background: rgba(126, 200, 227, 0.05);
  }

  .dropzone p {
    color: #888;
    font-size: 0.85rem;
  }

  .file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .dropzone .preview-img {
    max-height: 150px;
    width: auto;
    max-width: 100%;
  }

  /* Canvas / preview wrappers */
  .canvas-wrapper {
    background: #000;
    border-radius: 4px;
    padding: 4px;
    position: relative;
    min-height: 60px;
  }

  .canvas-wrapper canvas {
    image-rendering: pixelated;
    width: 100%;
    height: auto;
    display: block;
  }

  .preview-img {
    image-rendering: pixelated;
    display: block;
  }

  .dither-preview {
    max-width: 480px;
  }

  .output-preview {
    max-width: 640px;
  }

  .placeholder {
    color: #555;
    font-size: 0.8rem;
    text-align: center;
    padding: 2rem 0;
  }

  /* Color swatches */
  .color-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
    max-width: 240px;
  }

  .color-swatch {
    width: 28px;
    height: 28px;
    border: 2px solid transparent;
    border-radius: 3px;
    padding: 0;
    min-width: 0;
  }

  .color-swatch.selected {
    border-color: #fff;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
  }

  .color-exclude-grid {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .color-exclude-swatch {
    width: 36px;
    height: 36px;
    border: 2px solid #555;
    border-radius: 4px;
    padding: 0;
    min-width: 0;
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .color-exclude-swatch.excluded {
    opacity: 0.35;
    border-color: #800;
  }

  .x-mark {
    color: #fff;
    font-size: 1.1rem;
    text-shadow: 0 0 3px #000, 0 0 3px #000;
    pointer-events: none;
  }

  .excluded-info {
    margin-top: 0.4rem;
    font-size: 0.8rem;
    color: #aaa;
  }

  /* Charset grid */
  .charset-grid {
    image-rendering: pixelated;
    cursor: pointer;
    border-radius: 4px;
    width: 320px;
    height: auto;
  }

  /* Output actions */
  .output-actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .btn-primary {
    background: #2a6a8a;
    font-weight: bold;
  }

  .btn-primary:hover:not(:disabled) {
    background: #3a8aaa;
  }
</style>
