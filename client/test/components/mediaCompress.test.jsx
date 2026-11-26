import { describe, it, expect } from "vitest";
import { compressImageForUpload } from "../../src/utils/mediaCompress.js";

// Real-browser test (Playwright Chromium): exercises the actual canvas
// encode path — a genuine oversized PNG must come back smaller and capped
// at the 2560px box, while GIFs and no-gain re-encodes keep the original.
describe("mediaCompress (browser canvas)", () => {
  const makePngFile = async (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // Photo-like input: a smooth gradient plus per-pixel noise. High-frequency
    // detail is exactly what real photos look like — PNG stores it verbatim
    // (huge) while lossy WebP/JPEG discard it invisibly (small).
    const imageData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const noise = Math.random() * 48 - 24;
        imageData.data[i] = Math.max(0, Math.min(255, (x * 255) / width + noise));
        imageData.data[i + 1] = Math.max(0, Math.min(255, (y * 255) / height + noise));
        imageData.data[i + 2] = Math.max(
          0,
          Math.min(255, ((x + y) * 255) / (width + height) + noise),
        );
        imageData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/png"),
    );
    return new File([blob], "photo.png", { type: "image/png" });
  };

  it("compresses an oversized photo: smaller bytes, within the 2560px box", async () => {
    const original = await makePngFile(3200, 2400);
    expect(original.size).toBeGreaterThan(100 * 1024);

    const result = await compressImageForUpload(original);
    expect(result.compressed).toBe(true);
    expect(result.width).toBeLessThanOrEqual(2560);
    expect(result.height).toBeLessThanOrEqual(2560);
    expect(result.width).toBe(2560); // longest edge exactly at the cap
    expect(result.height).toBe(1920); // aspect preserved
    expect(["image/webp", "image/jpeg"]).toContain(result.mimeType);
    expect(result.compressedSize).toBeLessThan(original.size);
    expect(result.blob.size).toBe(result.compressedSize);
    expect(result.originalSize).toBe(original.size);
  });

  it("keeps the original when the re-encode would not save bytes", async () => {
    // Deterministic no-gain case: the canvas encoder is stubbed to return a
    // blob BIGGER than the source — the guard must keep the original bytes
    // instead of wasting quality on a pointless re-encode.
    const original = await makePngFile(64, 64);
    const bigBlob = new Uint8Array(original.size * 4);
    // Valid WebP magic (RIFF....WEBP) so the encoder check passes and the
    // size guard is what keeps the original.
    const magic = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    magic.forEach((byte, index) => {
      bigBlob[index] = byte;
    });
    const restore = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, mime) {
      callback(new Blob([bigBlob], { type: mime || "image/webp" }));
    };
    try {
      const result = await compressImageForUpload(original);
      expect(result.compressed).toBe(false);
      expect(result.blob).toBe(original);
    } finally {
      HTMLCanvasElement.prototype.toBlob = restore;
    }
  });

  it("never touches animated or vector formats", async () => {
    const gif = new File([new Uint8Array([71, 73, 70, 56])], "a.gif", {
      type: "image/gif",
    });
    const gifResult = await compressImageForUpload(gif);
    expect(gifResult.compressed).toBe(false);
    expect(gifResult.blob).toBe(gif);

    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    const svgResult = await compressImageForUpload(svg);
    expect(svgResult.compressed).toBe(false);
    expect(svgResult.blob).toBe(svg);
  });
});
