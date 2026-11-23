/**
 * Checks whether WebRTC calling is supported in the current environment.
 * Requires a secure context (HTTPS or localhost) and mediaDevices support.
 */
export function isCallSupported() {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext === false) return false;
  if (
    window.location.protocol === "http:" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    window.location.hostname !== "::1" &&
    !window.location.hostname.endsWith(".localhost")
  ) {
    return false;
  }
  return Boolean(
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function",
  );
}

/**
 * Checks whether the current browser can share its screen during a call.
 * Desktop browsers expose getDisplayMedia; most mobile browsers (Android
 * Chrome, iOS Safari) do not, so the share control stays hidden there.
 */
export function isScreenShareSupported() {
  if (!isCallSupported()) return false;
  return typeof navigator.mediaDevices.getDisplayMedia === "function";
}

/**
 * Decide the local MediaStream that carries an incoming track. Screen-share
 * audio arrives on its own (display) stream id; folding it into the existing
 * remote stream keeps the peer's mic playing. Screen-share video on its own
 * stream still replaces the current stream so the shared screen is shown.
 */
export function foldIncomingRemoteStream(event, remoteStream) {
  let stream = event.streams?.[0];
  if (!stream) {
    stream = remoteStream || new MediaStream();
    if (event.track && !stream.getTracks().includes(event.track)) {
      stream.addTrack(event.track);
    }
    return stream;
  }
  if (
    event.track?.kind === "audio" &&
    remoteStream &&
    stream !== remoteStream
  ) {
    if (!remoteStream.getTracks().includes(event.track)) {
      remoteStream.addTrack(event.track);
    }
    return remoteStream;
  }
  return stream;
}

/**
 * Turn a getUserMedia failure into a precise, user-facing failure kind so
 * the call screen can say WHAT went wrong (permission, missing device,
 * device busy, insecure context) instead of a generic "Call failed".
 *
 * Kinds:
 * - media-secure     the page is not a secure context: no getUserMedia at all
 * - media-permission the user (or the browser settings) denied mic/camera
 * - media-device     no microphone/camera exists on this device
 * - media-busy       the device is locked by another app (NotReadable)
 * - media-unknown    anything else
 */
export function classifyMediaError(err) {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    return "media-secure";
  }
  const name = String(err?.name || "");
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "media-permission";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "media-device";
    case "NotReadableError":
    case "TrackStartError":
      return "media-busy";
    case "OverconstrainedError":
      return "media-device";
    default:
      // Chrome throws TypeError with no devices selected only when the
      // request is malformed; treat an insecure context as the likely cause.
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        return "media-secure";
      }
      return "media-unknown";
  }
}
