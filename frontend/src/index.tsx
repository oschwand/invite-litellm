import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { loadServerConfig } from "./providers/config";

const container = document.getElementById("root") as HTMLElement;
const root = createRoot(container);

// Adopt the backend's runtime config (LITELLM_URL + version) before the
// first render so every provider already sees the right server URL.
void loadServerConfig().then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
