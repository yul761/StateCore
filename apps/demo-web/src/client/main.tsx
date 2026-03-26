import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./styles.css";

async function loadDemoConfig() {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/config.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed_to_load_demo_config"));
    document.head.append(script);
  });
}

async function bootstrap() {
  await loadDemoConfig();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
