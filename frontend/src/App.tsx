import { Refine, Authenticated } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import {
  ErrorComponent,
  useNotificationProvider,
  ThemedLayout,
  ThemedSider,
  ThemedTitle,
} from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import { ApiOutlined, MessageOutlined, QuestionCircleOutlined } from "@ant-design/icons";

import { App as AntdApp } from "antd";
import {
  DashboardOutlined,
  KeyOutlined,
  TeamOutlined,
  UserOutlined,
  RobotOutlined,
} from "@ant-design/icons";import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router";
import routerProvider, {
  NavigateToResource,
  CatchAllNavigate,
  UnsavedChangesNotifier,
  DocumentTitleHandler,
} from "@refinedev/react-router";
import { dataProvider } from "./providers/data";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { Header } from "./components/header";
import { AppFooter } from "./components/footer";
import { ServerStatusBanner } from "./components/server-status";
import { Login } from "./pages/login";
import { InviteRedeem } from "./pages/invite";
import { Playground } from "./pages/playground";
import { Help } from "./pages/help";
import { Profile } from "./pages/profile";
import { Dashboard } from "./pages/dashboard";
import { KeyList } from "./pages/keys/list";
import { KeyEdit } from "./pages/keys/edit";
import { TeamList } from "./pages/teams/list";
import { TeamEdit } from "./pages/teams/edit";
import { TeamShow } from "./pages/teams/show";
import { UserList } from "./pages/users/list";
import { ModelList } from "./pages/models/list";
import { authProvider } from "./providers/auth";
import { accessControlProvider } from "./providers/access";

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <AntdApp>
            <DevtoolsProvider>
              <Refine
                dataProvider={dataProvider}
                notificationProvider={useNotificationProvider}
                routerProvider={routerProvider}
                authProvider={authProvider}
                accessControlProvider={accessControlProvider}
                resources={[
                  {
                    name: "dashboard",
                    list: "/dashboard",
                    meta: { label: "Dashboard", icon: <DashboardOutlined /> },
                  },
                  {
                    name: "keys",
                    list: "/keys",
                    edit: "/keys/edit/:id",
                    meta: { icon: <KeyOutlined /> },
                  },
                  {
                    name: "teams",
                    list: "/teams",
                    edit: "/teams/edit/:id",
                    meta: { icon: <TeamOutlined /> },
                  },
                  {
                    name: "users",
                    list: "/users",
                    meta: { icon: <UserOutlined /> },
                  },
                  {
                    name: "models",
                    list: "/models",
                    // Reachable via team links, not the sider.
                    meta: { icon: <RobotOutlined />, hide: true },
                  },
                  {
                    name: "playground",
                    list: "/playground",
                    meta: { label: "Playground", icon: <MessageOutlined /> },
                  },
                  {
                    name: "help",
                    list: "/help",
                    meta: { label: "Help", icon: <QuestionCircleOutlined /> },
                  },
                ]}
                options={{
                  syncWithLocation: true,
                  warnWhenUnsavedChanges: true,
                  projectId: "11BTWd-s7WeyS-LOfTLO",
                }}
              >
                <Routes>
                  <Route
                    element={
                      <Authenticated
                        key="authenticated-routes"
                        fallback={<CatchAllNavigate to="/login" />}
                      >
                        <ThemedLayout
                          Header={Header}
                          Sider={ThemedSider}
                          Footer={AppFooter}
                          Title={({ collapsed }) => (
                            <ThemedTitle
                              collapsed={collapsed}
                              text="Invite-LiteLLM"
                              icon={<ApiOutlined />}
                            />
                          )}
                        >
                          <ServerStatusBanner />
                          <Outlet />
                        </ThemedLayout>
                      </Authenticated>
                    }
                  >
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/keys" element={<KeyList />} />
                    <Route path="/keys/edit/:id" element={<KeyEdit />} />
                    <Route path="/teams" element={<TeamList />} />
                    <Route path="/teams/edit/:id" element={<TeamEdit />} />
                    <Route path="/team/:team_id" element={<TeamShow />} />
                    <Route path="/users" element={<UserList />} />
                    <Route path="/models" element={<ModelList />} />
                    <Route path="/playground" element={<Playground />} />
                    <Route path="/help" element={<Help />} />
                    <Route path="/profile" element={<Profile />} />
                  </Route>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route
                    path="/login"
                    element={
                      <Authenticated key="auth-page" fallback={<Login />}>
                        <NavigateToResource resource="keys" />
                      </Authenticated>
                    }
                  />
                  <Route
                    path="/invite/:team_id/:invite_code"
                    element={<InviteRedeem />}
                  />
                  <Route
                    path="*"
                    element={
                      <Authenticated
                        key="catch-all"
                        fallback={<CatchAllNavigate to="/login" />}
                      >
                        <ErrorComponent />
                      </Authenticated>
                    }
                  />
                </Routes>
                <RefineKbar />
                <UnsavedChangesNotifier />
                <DocumentTitleHandler
                  handler={({ autoGeneratedTitle }) =>
                    autoGeneratedTitle === "Refine"
                      ? "Invite-LiteLLM"
                      : autoGeneratedTitle.replace(
                          " | Refine",
                          " | Invite-LiteLLM",
                        )
                  }
                />
              </Refine>
              <DevtoolsPanel />
            </DevtoolsProvider>
          </AntdApp>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
