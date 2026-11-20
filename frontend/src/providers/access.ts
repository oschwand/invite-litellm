import type { AccessControlProvider } from "@refinedev/core";
import { loadSession } from "./session";

// Menu-level gating matching the Alpine app's banner: /team/list and
// /user/list are admin-tier on LiteLLM (internal users get a 400), so the
// sider hides those entries for internal_user sessions. ThemedSider wraps
// every menu item in <CanAccess resource action="list">, which consults
// this provider.

// LiteLLM roles that can hit admin-tier endpoints themselves (/model/info
// shows them every deployment with pricing; /team/list and /user/list
// answer). Unknown roles are treated as non-admin — they get the
// team-filtered views.
const ADMIN_ROLES = ["admin", "proxy_admin", "proxy_admin_viewer", "org_admin"];

export const isAdminRole = (role: string | null | undefined): boolean =>
  role != null && ADMIN_ROLES.includes(role);

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource }) => {
    if (resource !== "teams" && resource !== "users") {
      return { can: true };
    }
    const role = loadSession()?.userRole ?? "";
    if (role === "internal_user") {
      return { can: false, reason: "Admins only" };
    }
    return { can: true };
  },
};
