import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ToolWindow from "./tools/ToolWindow";
import MenuWindow from "./menus/MenuWindow";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isTauri() && getCurrentWindow().label === "menu" ? (
      <MenuWindow />
    ) : isTauri() && getCurrentWindow().label.startsWith("tool-") ? (
      <ToolWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
