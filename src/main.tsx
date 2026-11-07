import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ToolWindow from "./tools/ToolWindow";
import MenuWindow from "./menus/MenuWindow";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import "./design/engineering.css";
import "./design/compact.css";
const root = ReactDOM.createRoot(document.getElementById("root")!);
async function boot() {
  if (
    isTauri() &&
    getCurrentWindow().label === "main" &&
    new URLSearchParams(location.search).has("window-ipc-check")
  ) {
    if (!(await invoke<boolean>("window_check_enabled")))
      throw new Error("Window IPC check is not enabled by host");
    const { default: WindowIpcCheck } = await import("./tools/WindowIpcCheck");
    root.render(<WindowIpcCheck />);
    return;
  }
  root.render(
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
}
void boot().catch((e) => {
  root.render(<p role="alert">{String(e)}</p>);
});
