import { describe, it, expect } from "vitest";
import {
  shouldCompressImageFile,
  compressImageForUpload,
  IMAGE_COMPRESSION_DEFAULTS,
} from "../../src/utils/mediaCompress.js";

// Node environment: `document` is undefined, so compression always degrades
// gracefully to the original bytes — which is exactly the contract.
describe("mediaCompress (node)", () => {
  it("exports the Telegram-like defaults", () => {
    expect(IMAGE_COMPRESSION_DEFAULTS.maxDimension).toBe(2560);
    expect(IMAGE_COMPRESSION_DEFAULTS.quality).toBe(0.82);
    expect(IMAGE_COMPRESSION_DEFAULTS.minSavingRatio).toBe(0.95);
  });

  it("selects only compressible raster images", () => {
    expect(shouldCompressImageFile({ type: "image/jpeg" })).toBe(true);
    expect(shouldCompressImageFile({ type: "image/png" })).toBe(true);
    expect(shouldCompressImageFile({ type: "image/webp" })).toBe(true);
    // Animation and vectors must never be re-encoded.
    expect(shouldCompressImageFile({ type: "image/gif" })).toBe(false);
    expect(shouldCompressImageFile({ type: "image/svg+xml" })).toBe(false);
    // Non-images pass through untouched.
    expect(shouldCompressImageFile({ type: "video/mp4" })).toBe(false);
    expect(shouldCompressImageFile({ type: "application/pdf" })).toBe(false);
    expect(shouldCompressImageFile(null)).toBe(false);
    expect(shouldCompressImageFile({})).toBe(false);
  });

  it("returns the original bytes when no DOM/canvas is available", async () => {
    const file = { type: "image/png", size: 1234 };
    const result = await compressImageForUpload(file);
    expect(result.compressed).toBe(false);
    expect(result.blob).toBe(file);
    expect(result.originalSize).toBe(1234);
    expect(result.compressedSize).toBe(1234);
    expect(result.mimeType).toBe("image/png");
  });

  it("degrades gracefully for skipped formats even with a DOM", async () => {
    const gif = { type: "image/gif", size: 500 };
    const result = await compressImageForUpload(gif);
    expect(result.compressed).toBe(false);
    expect(result.blob).toBe(gif);
  });
});
