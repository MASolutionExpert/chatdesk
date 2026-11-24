import { AdminPanel, AdminClaimCard } from "../components/admin/index.js";

export default function AdminPage({ user, setUser, isDark, onToggleTheme, onBack }) {
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  if (!isAdmin) {
    // Strictly gated emergency claim: the token form renders only when the
    // server says a real lockout exists; impersonation sessions and healthy
    // installs get "access denied" (see AdminClaimCard).
    return (
      <AdminClaimCard
        user={user}
        setUser={setUser}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        onBack={onBack}
      />
    );
  }

  return <AdminPanel user={user} onBack={onBack} />;
}
