import { describe, test, expect } from "vitest";
import { stopScreenShareTracks } from "../../src/hooks/chat/useWebRTCCall.js";

function makeTrack(kind = "video") {
  return {
    kind,
    stopped: false,
    onended: () => {},
    stop() {
      this.stopped = true;
    },
  };
}

// releaseScreenShare / stopScreenShare must tear down BOTH screen tracks:
// the video track and the display-audio track from getDisplayMedia. Leaving
// the audio track running means it keeps capturing after hang-up, and leaving
// screenAudioSenderRef set makes the next call's share replaceTrack on a
// sender from a closed peer connection (which throws).

describe("stopScreenShareTracks", () => {
  test("stops the video track and the display-audio track", () => {
    const video = makeTrack("video");
    const audio = makeTrack("audio");

    stopScreenShareTracks(video, audio);

    expect(video.stopped).toBe(true);
    expect(audio.stopped).toBe(true);
  });

  test("clears the video track's onended handler (browser 'Stop sharing')", () => {
    const video = makeTrack("video");
    stopScreenShareTracks(video, null);
    expect(video.onended).toBeNull();
  });

  test("swallows stop() failures (track already stopped by the browser)", () => {
    const video = makeTrack("video");
    const audio = makeTrack("audio");
    video.stop = () => {
      throw new Error("InvalidStateError");
    };
    audio.stop = () => {
      throw new Error("InvalidStateError");
    };

    expect(() => stopScreenShareTracks(video, audio)).not.toThrow();
  });

  test("tolerates missing tracks (share without display audio / no share)", () => {
    expect(() => stopScreenShareTracks(null, null)).not.toThrow();
    expect(() => stopScreenShareTracks(null, makeTrack("audio"))).not.toThrow();
    expect(() => stopScreenShareTracks(makeTrack("video"), null)).not.toThrow();
  });
});
