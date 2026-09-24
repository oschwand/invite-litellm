import { Refine, Authenticated } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import {
  ErrorComponent,
  useNotificationProvider,
  ThemedLayout,
  ThemedSider,
} from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import { App as AntdApp } from "antd";
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
                  { name: "keys", list: "/keys" },
                  { name: "teams", list: "/teams" },
                  { name: "users", list: "/users" },
                  { name: "models", list: "/models" },
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
                        <ThemedLayout Header={Header} Sider={ThemedSider}>
                          <Outlet />
                        </ThemedLayout>
                      </Authenticated>
                    }
                  >
                    <Route path="/keys" element={<KeyList />} />
                    <Route path="/teams" element={<TeamList />} />
                    <Route path="/users" element={<UserList />} />
                    <Route path="/models" element={<ModelList />} />
                    <Route path="/profile" element={<Profile />} />
                  </Route>
                  <Route index element={<Navigate to="/keys" replace />} />
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
                <DocumentTitleHandler />
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
