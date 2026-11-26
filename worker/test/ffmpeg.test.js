import { describe, it, expect } from "vitest";
import {
  probeVideoDetails,
  probeVideoMetadata,
  transcodeVideo,
  buildTranscodeArgs,
  faststartVideo,
  generateThumbnail,
} from "../ffmpeg.js";

describe("worker ffmpeg & ffprobe utilities", () => {
  it("exports all required video processing functions", () => {
    expect(typeof probeVideoDetails).toBe("function");
    expect(typeof probeVideoMetadata).toBe("function");
    expect(typeof transcodeVideo).toBe("function");
    expect(typeof buildTranscodeArgs).toBe("function");
    expect(typeof faststartVideo).toBe("function");
    expect(typeof generateThumbnail).toBe("function");
  });

  it("builds a Telegram-like compression transcode command", () => {
    const args = buildTranscodeArgs({
      inputPath: "/tmp/in.mov",
      outputPath: "/tmp/out.mp4",
    });
    expect(args).toContain("/tmp/in.mov");
    expect(args).toContain("/tmp/out.mp4");
    expect(args.indexOf("-i")).toBe(args.indexOf("/tmp/in.mov") - 1);
    expect(args).toContain("libx264");
    // veryfast compresses far better than ultrafast at the same CRF.
    expect(args[args.indexOf("-preset") + 1]).toBe("veryfast");
    expect(args[args.indexOf("-crf") + 1]).toBe("23");
    expect(args[args.indexOf("-b:a") + 1]).toBe("128k");
    // Downscale box: fits within 1920x1920, never upscales, even dimensions.
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("min(iw,1920)");
    expect(vf).toContain("min(ih,1920)");
    expect(vf).toContain("force_original_aspect_ratio=decrease");
    expect(vf).toContain("force_divisible_by=2");
    expect(args).toContain("+faststart");
  });

  it("handles probe errors gracefully when file does not exist", async () => {
    const details = await probeVideoDetails("/tmp/non-existent-video-file.mp4");
    expect(details).toEqual({
      needsTranscode: true,
      videoCodec: null,
      audioCodec: null,
      pixFmt: null,
      formatName: null,
      widthPx: null,
      heightPx: null,
      durationSeconds: null,
    });
  });

  it("handles metadata probe errors gracefully when file does not exist", async () => {
    const meta = await probeVideoMetadata("/tmp/non-existent-video-file.mp4");
    expect(meta).toEqual({
      widthPx: null,
      heightPx: null,
      durationSeconds: null,
    });
  });
});
