import type { AccessControlProvider } from "@refinedev/core";
import { loadSession } from "./session";

// Menu-level gating matching the Alpine app's banner: /team/list and
// /user/list are admin-tier on LiteLLM (internal users get a 400), so the
// sider hides those entries for internal_user sessions. ThemedSider wraps
// every menu item in <CanAccess resource action="list">, which consults
// this provider.
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
