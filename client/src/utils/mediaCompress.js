// ─── Telegram-style image compression before upload (1.7.0-dev.4) ────────────
//
// Chat images (photos, screenshots) used to be uploaded as the RAW original
// bytes — a 12 MP phone photo at ~4 MB went to storage untouched, bloating
// both the message payloads and the server disk. This module re-encodes
// images in the browser BEFORE upload, the same way mainstream messengers
// handle photo uploads:
//
//   • Downscale to a 2560px box (never upscales) — 4K/48MP originals become
//     plenty for a chat while cutting pixels dramatically.
//   • Re-encode to WebP (quality 0.82) when the browser can truly encode
//     WebP; fall back to JPEG (quality 0.82) for opaque images.
//   • Transparency is never destroyed: if the browser cannot encode WebP
//     (Safari silently produces PNG), a PNG/WebP source with alpha keeps
//     its ORIGINAL bytes instead of being flattened to JPEG.
//   • Never re-encode animated formats (GIF) or vectors (SVG) — recompressing
//     them destroys animation / crispness.
//   • Only keep the compressed result when it actually saves bytes (≥5%
//     smaller). Re-encoding an already tiny, well-compressed image would
//     spend CPU and quality for nothing.
//
// Videos are NOT touched here — they are transcoded server-side by the
// media worker (H.264 CRF 23 + 1920px box). Documents the user explicitly
// sends as files are also never touched.

export const IMAGE_COMPRESSION_DEFAULTS = Object.freeze({
  // Largest allowed edge (width or height) after compression.
  maxDimension: 2560,
  // WebP/JPEG quality — visually indistinguishable for photos at chat size.
  quality: 0.82,
  // Keep the compressed result only when it is at most this fraction of the
  // original size (0.95 = at least 5% smaller).
  minSavingRatio: 0.95,
});

// Formats that must never be re-encoded (animation / vector / alpha-critical).
const SKIP_MIME_PREFIXES = ["image/gif", "image/svg"];

export function shouldCompressImageFile(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (!mime.startsWith("image/")) return false;
  return !SKIP_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

async function decodeImageSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path (exotic formats, Safari quirks).
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const isWebpBlob = async (blob) => {
  if (!blob || blob.size < 12) return false;
  try {
    const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    // RIFF<4-byte size>WEBP — compare only the fixed magic positions.
    return (
      bytes[0] === 0x52 && // R
      bytes[1] === 0x49 && // I
      bytes[2] === 0x46 && // F
      bytes[3] === 0x46 && // F
      bytes[8] === 0x57 && // W
      bytes[9] === 0x45 && // E
      bytes[10] === 0x42 && // B
      bytes[11] === 0x50 //    P
    );
  } catch {
    return false;
  }
};

// A real WebP encoder check: some browsers (Safari) silently fall back to
// PNG when asked for image/webp, so the produced bytes must be sniffed.
export async function canEncodeWebp(canvas) {
  try {
    const blob = await new Promise((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/webp", 0.5),
    );
    return await isWebpBlob(blob);
  } catch {
    return false;
  }
}

function drawCompressedCanvas(source, maxDimension) {
  const width = Number(source.width || source.naturalWidth || 0);
  const height = Number(source.height || source.naturalHeight || 0);
  if (!width || !height) return null;
  const scale =
    Math.max(width, height) > maxDimension
      ? maxDimension / Math.max(width, height)
      : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return canvas;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      mime,
      quality,
    );
  });
}

// Compresses one image file for upload. Returns:
//   { blob, compressed, width, height, mimeType, originalSize, compressedSize }
// `blob` is the ORIGINAL file whenever compression is not applicable, not
// beneficial, or not safely possible (transparent image without WebP).
export async function compressImageForUpload(file, options = {}) {
  const originalSize = Number(file?.size || 0);
  const base = {
    blob: file,
    compressed: false,
    width: null,
    height: null,
    mimeType: String(file?.type || ""),
    originalSize,
    compressedSize: originalSize,
  };
  if (!shouldCompressImageFile(file) || typeof document === "undefined") {
    return base;
  }

  const {
    maxDimension = IMAGE_COMPRESSION_DEFAULTS.maxDimension,
    quality = IMAGE_COMPRESSION_DEFAULTS.quality,
    minSavingRatio = IMAGE_COMPRESSION_DEFAULTS.minSavingRatio,
  } = options;

  try {
    const source = await decodeImageSource(file);
    const canvas = drawCompressedCanvas(source, maxDimension);
    if (source.close) source.close();
    if (!canvas) return base;

    const isPossiblyTransparent =
      String(file?.type || "").toLowerCase() === "image/png" ||
      String(file?.type || "").toLowerCase() === "image/webp";

    let blob = null;
    let mimeType = null;
    try {
      const webp = await canvasToBlob(canvas, "image/webp", quality);
      if (await isWebpBlob(webp)) {
        blob = webp;
        mimeType = "image/webp";
      }
    } catch {
      // WebP unsupported — fall through.
    }

    if (!blob) {
      // No true WebP support: flattening a PNG/WebP to JPEG would destroy
      // transparency, so the original bytes win.
      if (isPossiblyTransparent) return base;
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
      mimeType = "image/jpeg";
    }

    // Never spend quality on a re-encode that saves nothing meaningful.
    if (blob.size >= originalSize * minSavingRatio) return base;

    return {
      blob,
      compressed: true,
      width: canvas.width,
      height: canvas.height,
      mimeType,
      originalSize,
      compressedSize: blob.size,
    };
  } catch {
    // Any decode/encode failure keeps the upload working with original bytes.
    return base;
  }
}
