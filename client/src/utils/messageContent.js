export const FILE_SUMMARY_PATTERN =
  /^Sent (a media file|a file|a photo|a video|a document|a voice message|\d+ (files|photos|videos|documents|media files|voice messages))$/i;

const CALL_LOG_BODY_PATTERN =
  /^\[\[call:(voice|video):(outgoing|cancelled|failed|connected|missed|declined)(?::(\d+))?\]\]$/i;

export const extractMessageBodyText = (value) => {
  if (typeof value === "string") {
    return value === "[object Object]" ? "" : value;
  }
  if (value && typeof value === "object") {
    return String(value.text || value.body || "");
  }
  return String(value ?? "");
};

export const parseCallLogBody = (body) => {
  const raw = extractMessageBodyText(body).trim();
  const match = raw.match(CALL_LOG_BODY_PATTERN);
  if (!match) return null;
  return {
    type: match[1].toLowerCase(),
    status: match[2].toLowerCase(),
    duration: match[3] == null ? null : Math.max(0, parseInt(match[3], 10)),
  };
};

export const isCallLogBody = (body) => parseCallLogBody(body) !== null;

/**
 * Human label for a call-log entry. `t` (the i18n translator) is optional;
 * when omitted, English fallbacks keep the util usable outside React.
 */
export const getCallLogLabel = (callLog, isOwnMessage, t) => {
  if (!callLog) return "";
  const key =
    callLog.status === "cancelled"
      ? "chat.callLog.cancelled"
      : callLog.status === "failed"
        ? "chat.callLog.failed"
        : callLog.status === "missed"
          ? "chat.callLog.missed"
          : callLog.status === "declined"
            ? "chat.callLog.declined"
            : callLog.status === "outgoing"
              ? "chat.callLog.outgoing"
              : isOwnMessage
                ? "chat.callLog.outgoing"
                : "chat.callLog.incoming";
  if (typeof t === "function") {
    const translated = t(key);
    if (translated) return translated;
  }
  return (
    {
      "chat.callLog.cancelled": "Cancelled call",
      "chat.callLog.failed": "Failed call",
      "chat.callLog.missed": "Missed call",
      "chat.callLog.declined": "Declined call",
      "chat.callLog.outgoing": "Outgoing call",
      "chat.callLog.incoming": "Incoming call",
    }[key] || ""
  );
};

export const getMessageFiles = (message) =>
  Array.isArray(message?.files) ? message.files : [];

export const hasMessageText = (message) => {
  const bodyText = extractMessageBodyText(message?.body).trim();
  if (!bodyText) return false;
  if (bodyText.startsWith("sb-enc-v1:")) return false;
  if (isCallLogBody(bodyText)) return false;
  const files = getMessageFiles(message);
  if (!files.length) return true;
  return !FILE_SUMMARY_PATTERN.test(bodyText);
};
