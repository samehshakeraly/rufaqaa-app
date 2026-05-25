import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/auth";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? "bg-trust text-white" : "text-slate-700 hover:bg-tranquil"
  }`;

export function AppLayout() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-snow">
      <header className="border-b border-sky bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="text-xl font-bold text-trust">
            رفقاء
          </Link>
          <nav className="flex gap-2">
            <NavLink to="/dashboard" className={navItemClass}>
              الرئيسية
            </NavLink>
            <NavLink to="/orphans" className={navItemClass}>
              الأيتام
            </NavLink>
          </nav>
          <div className="flex items-center gap-4">
            {me && (
              <span className="text-sm text-slate-600">
                {me.first_name} {me.last_name}
              </span>
            )}
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
            >
              خروج
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
