// ─── Client-side logo preprocessing (1.7.0-dev.2) ─────────────────────────────
//
// The owner can upload the organization logo in ANY image format the browser
// can decode (png, jpeg, webp, gif, svg, bmp, avif, …). This module converts
// it into the fixed set of square PNG icons the server stores and serves as
// favicon / apple-touch-icon / PWA app icons:
//
//   icon-512  → PWA manifest (any + maskable) and the login-page logo
//   icon-192  → PWA manifest (any + maskable)
//   icon-180  → apple-touch-icon (iOS adds its own rounded mask)
//   icon-32   → favicon + the /favicon.ico dynamic route
//   icon-16   → small favicon
//
// The conversion happens on a canvas (centered cover-crop onto a square), so
// the server needs no native image dependency. iOS-style rounded corners on
// the login page are applied with CSS at display time — the stored files stay
// full-bleed squares, which is also what maskable icons want.

export const LOGO_ICON_SIZES = [16, 32, 180, 192, 512];

const MIME_BY_SIZE = Object.fromEntries(
  LOGO_ICON_SIZES.map((size) => [`icon-${size}`, "image/png"]),
);

async function decodeImage(file) {
  // createImageBitmap handles most raster formats; SVG needs an <img> so the
  // intrinsic size resolves and the vector rasterizes crisply at each target.
  if (file.type !== "image/svg+xml" && typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path (e.g. exotic formats).
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The file could not be read as an image."));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawSquare(source, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const width = source.width || source.naturalWidth || size;
  const height = source.height || source.naturalHeight || size;
  // Centered cover-crop: the shorter edge fills the square, the rest crops.
  const scale = Math.max(size / width, size / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG conversion failed."))),
      "image/png",
    );
  });
}

// Returns { formData, sizes, primarySize } ready for
// POST /api/admin/branding/logo, or throws when the file is not usable.
export async function buildLogoIconFormData(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  const source = await decodeImage(file);
  const formData = new FormData();
  for (const size of LOGO_ICON_SIZES) {
    const blob = await canvasToBlob(drawSquare(source, size));
    formData.append(`icon-${size}`, blob, `icon-${size}.png`);
  }
  return { formData, sizes: [...LOGO_ICON_SIZES], primarySize: 512, mimeBySize: MIME_BY_SIZE };
}
