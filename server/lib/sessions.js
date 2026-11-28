export function createSessionHelpers({
  getSession,
  touchSession,
  isProduction,
}) {
  const decodeCookieValue = (value) => {
    // A single malformed percent-escape (e.g. `foo=%E0%A4%A`) must not make
    // decodeURIComponent throw and turn every authenticated endpoint into a
    // 500 — the browser keeps sending that cookie, so the user would stay
    // locked out. Fall back to the raw value instead.
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const parseCookies = (req) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return {};

    return cookieHeader.split(";").reduce((acc, cookie) => {
      const [name, ...rest] = cookie.trim().split("=");
      if (!name) return acc;

      acc[name] = decodeCookieValue(rest.join("="));

      return acc;
    }, {});
  };

  const isHttpsRequest = (req) => {
    if (!req) return false;
    if (req.secure) return true;

    const proto = String(req.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();

    return proto === "https";
  };

  const shouldUseSecureCookie = (req) => {
    // Only mark cookies Secure on actual HTTPS requests.
    // This keeps local HTTP development working even if APP_ENV is production.
    return isProduction && isHttpsRequest(req);
  };

  const setSessionCookie = (req, res, token) => {
    const parts = [
      `sid=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=1209600",
    ];

    if (shouldUseSecureCookie(req)) {
      parts.push("Secure");
    }

    res.setHeader("Set-Cookie", parts.join("; "));
  };

  // Issue (or clear) a side cookie next to `sid` — e.g. the parked admin
  // session (`admin_sid`) while an owner impersonates another user. Same
  // hardening rules as the session cookie itself. Appends to any Set-Cookie
  // header already on the response instead of overwriting it.
  const setSideCookie = (
    req,
    res,
    name,
    value,
    { httpOnly = true, maxAge = 1209600, clear = false } = {},
  ) => {
    const parts = [
      `${name}=${encodeURIComponent(String(value ?? ""))}`,
      "Path=/",
      "SameSite=Lax",
      `Max-Age=${clear ? 0 : maxAge}`,
    ];

    if (httpOnly) {
      parts.splice(2, 0, "HttpOnly");
    }

    if (shouldUseSecureCookie(req)) {
      parts.push("Secure");
    }

    const cookie = parts.join("; ");
    const existing = res.getHeader("Set-Cookie");
    if (!existing) {
      res.setHeader("Set-Cookie", cookie);
      return;
    }
    res.setHeader(
      "Set-Cookie",
      Array.isArray(existing) ? [...existing, cookie] : [existing, cookie],
    );
  };

  const clearSessionCookie = (req, res) => {
    const parts = ["sid=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];

    if (shouldUseSecureCookie(req)) {
      parts.push("Secure");
    }

    res.setHeader("Set-Cookie", parts.join("; "));
  };

  const getSessionFromRequest = (req) => {
    const cookies = parseCookies(req);
    if (!cookies.sid) return null;

    const rawSession = getSession(cookies.sid);
    if (rawSession && typeof rawSession.then === "function") {
      return rawSession.then((session) => {
        if (session) {
          touchSession(cookies.sid);
        }
        return session;
      });
    }

    if (rawSession) {
      touchSession(cookies.sid);
    }

    return rawSession;
  };

  const requireSession = (req, res) => {
    const rawSession = getSessionFromRequest(req);
    if (rawSession && typeof rawSession.then === "function") {
      return rawSession.then((session) => {
        if (!session) {
          res.status(401).json({ error: "Not authenticated." });
          return null;
        }
        return session;
      });
    }

    if (!rawSession) {
      res.status(401).json({ error: "Not authenticated." });
      return null;
    }

    return rawSession;
  };

  const requireSessionUsernameMatch = (res, session, suppliedUsername) => {
    const supplied = String(suppliedUsername || "")
      .trim()
      .toLowerCase();

    if (supplied && supplied !== String(session.username || "").toLowerCase()) {
      res
        .status(403)
        .json({ error: "Username does not match authenticated user." });
      return false;
    }

    return true;
  };

  return {
    parseCookies,
    isHttpsRequest,
    shouldUseSecureCookie,
    setSessionCookie,
    setSideCookie,
    clearSessionCookie,
    getSessionFromRequest,
    requireSession,
    requireSessionUsernameMatch,
  };
}
