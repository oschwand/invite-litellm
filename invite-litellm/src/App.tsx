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

import { ApiOutlined } from "@ant-design/icons";

import { App as AntdApp } from "antd";
import {
  DashboardOutlined,
  KeyOutlined,
  TeamOutlined,
  UserOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router";
import routerProvider, {
  NavigateToResource,
  CatchAllNavigate,
  UnsavedChangesNotifier,
  DocumentTitleHandler,
} from "@refinedev/react-router";
import { dataProvider } from "./providers/data";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { Header } from "./components/header";
import { Login } from "./pages/login";
import { Profile } from "./pages/profile";
import { Dashboard } from "./pages/dashboard";
import { KeyList } from "./pages/keys/list";
import { TeamList } from "./pages/teams/list";
import { UserList } from "./pages/users/list";
import { ModelList } from "./pages/models/list";
import { authProvider } from "./providers/auth";

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
                resources={[
                  {
                    name: "dashboard",
                    list: "/dashboard",
                    meta: { label: "Dashboard", icon: <DashboardOutlined /> },
                  },
                  {
                    name: "keys",
                    list: "/keys",
                    meta: { icon: <KeyOutlined /> },
                  },
                  {
                    name: "teams",
                    list: "/teams",
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
                    meta: { icon: <RobotOutlined /> },
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
                          Title={({ collapsed }) => (
                            <ThemedTitle
                              collapsed={collapsed}
                              text="Invite-LiteLLM"
                              icon={<ApiOutlined />}
                            />
                          )}
                        >
                          <Outlet />
                        </ThemedLayout>
                      </Authenticated>
                    }
                  >
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/keys" element={<KeyList />} />
                    <Route path="/teams" element={<TeamList />} />
                    <Route path="/users" element={<UserList />} />
                    <Route path="/models" element={<ModelList />} />
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
