import { useEffect, useRef, useState } from "react";
import { menus, type CommandState } from "./commands";

export default function BrowserMenu({
  states,
  recent = [],
  dispatch,
}: {
  states: Record<string, CommandState>;
  recent?: { id: string; name: string }[];
  dispatch: (id: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <nav
      className="browser-menu"
      aria-label="应用菜单"
      ref={container}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(null);
          container.current
            ?.querySelectorAll<HTMLButtonElement>("[data-menu-trigger]")
            [open ?? 0]?.focus();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          const buttons = [
            ...(container.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ) || []),
          ];
          if (!buttons.length) return;
          e.preventDefault();
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (index + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                  buttons.length
          ]?.focus();
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const index =
            ((open ?? 0) + (e.key === "ArrowLeft" ? -1 : 1) + menus.length) %
            menus.length;
          setOpen(index);
          container.current
            ?.querySelectorAll<HTMLButtonElement>("[data-menu-trigger]")
            [index]?.focus();
        }
      }}
    >
      {menus.map((group, index) => (
        <div className="browser-menu-group" key={group.title}>
          <button
            data-menu-trigger
            aria-haspopup="menu"
            aria-expanded={open === index}
            onClick={() => setOpen(open === index ? null : index)}
          >
            {group.title}
          </button>
          {open === index && (
            <div
              className="browser-menu-popup"
              role="menu"
              aria-label={group.title}
            >
              {group.items
                .filter((item) => !item.platform && item.id !== "file.quit")
                .map((item, i) =>
                  item.separator ? (
                    <hr key={i} />
                  ) : item.dynamic === "recent" ? (
                    <div
                      key={item.id}
                      className="recent-menu-parent"
                      onMouseEnter={() => setRecentOpen(true)}
                      onMouseLeave={() => setRecentOpen(false)}
                    >
                      <button
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={recentOpen}
                        disabled={!states[item.id!]?.enabled}
                        onFocus={() => setRecentOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowRight") {
                            e.preventDefault();
                            e.stopPropagation();
                            setRecentOpen(true);
                          }
                        }}
                      >
                        {item.label}
                        <small>▸</small>
                      </button>
                      {recentOpen && recent.length > 0 && (
                        <div
                          className="recent-menu-popup"
                          role="menu"
                          aria-label="最近项目"
                        >
                          {recent.map((r) => (
                            <button
                              role="menuitem"
                              key={r.id}
                              disabled={!states[`file.recent.${r.id}`]?.enabled}
                              onClick={() => {
                                setRecentOpen(false);
                                setOpen(null);
                                dispatch(`file.recent.${r.id}`);
                              }}
                            >
                              {r.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      role="menuitem"
                      key={item.id}
                      disabled={!states[item.id!]?.enabled}
                      onClick={() => {
                        setOpen(null);
                        dispatch(item.id!);
                      }}
                    >
                      <span>
                        {states[item.id!]?.checked ? "✓ " : ""}
                        {item.label}
                      </span>
                      <small>
                        {(navigator.platform.includes("Mac")
                          ? item.macShortcut || item.shortcut
                          : item.shortcut
                        )
                          ?.replace(
                            "CmdOrCtrl",
                            navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
                          )
                          .replaceAll("+", " ")}
                      </small>
                    </button>
                  ),
                )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
