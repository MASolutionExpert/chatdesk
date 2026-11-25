import Tooltip from "./Tooltip.jsx";

/**
 * UserRoleBadge — inline filled icon badge for server-level roles.
 *
 * Mirrors the visual style of VerifiedBadge: a solid filled shape with
 * white interior details, so all three badges look like a consistent set.
 *
 * Props:
 *   role      – "owner" | "operator" | "user" | falsy
 *               (role model, migration 047: the retired "admin" role
 *               renders nothing)
 *   size      – icon size in px (default 15)
 *   className – extra classes on the wrapper span
 */
export default function UserRoleBadge({ role, size = 15, className = "" }) {
  const normalizedRole = String(role || "").toLowerCase();

  if (normalizedRole === "owner") {
    return (
      <Tooltip label="Server Owner" className={`shrink-0 ${className}`}>
        <span className="inline-flex shrink-0 items-center" role="img" aria-label="Server Owner">
          {/*
            Same shape as VerifiedBadge (BadgeCheck outer path) but filled
            gold instead of sky-blue, with a white mini-crown inside instead
            of the white checkmark.
            Crown path is the lucide Crown shape scaled to ~55% and centered
            inside the badge body.
          */}
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            fill="none"
          >
            {/* Gold badge body — same shape as VerifiedBadge */}
            <path
              d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
              fill="#f59e0b"
              className="dark:fill-amber-400"
            />
            {/* White crown — lucide Crown paths scaled ~55% centered in badge */}
            <g transform="translate(12,12) scale(0.52) translate(-12,-12)">
              <path
                d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"
                fill="white"
              />
            </g>
          </svg>
        </span>
      </Tooltip>
    );
  }


  if (normalizedRole === "operator") {
    return (
      <Tooltip label="Support Operator" className={`shrink-0 ${className}`}>
        <span className="inline-flex shrink-0 items-center" role="img" aria-label="Support Operator">
          {/*
            Headset — lucide path filled with sky blue, white mouthpiece detail.
          */}
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            fill="none"
          >
            <path
              d="M3 12a9 9 0 0 1 18 0v5a3 3 0 0 1-3 3h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3v-2a7 7 0 0 0-14 0v2h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6a3 3 0 0 1-3-3z"
              fill="#0ea5e9"
              className="dark:fill-sky-400"
            />
          </svg>
        </span>
      </Tooltip>
    );
  }

  return null;
}
