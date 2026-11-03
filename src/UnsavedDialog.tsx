import { useEffect, useRef, useState } from "react";
export default function UnsavedDialog({
  name,
  save,
  cancel,
  discard,
}: {
  name: string;
  save: () => Promise<boolean>;
  cancel: () => void;
  discard: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="unsaved-backdrop">
      <section
        ref={ref}
        className="unsaved-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-description"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !saving) {
            e.preventDefault();
            cancel();
          }
          if (e.key === "Tab") {
            const buttons = [
              ...ref.current!.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            ];
            const first = buttons[0],
              last = buttons.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id="unsaved-title">保存项目更改？</h2>
        <p id="unsaved-description">“{name}”有未保存的修改。</p>
        <p className="unsaved-help">
          保存后继续，或选择不保存。取消将留在当前项目。
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button data-cancel disabled={saving} onClick={cancel}>
            取消
          </button>
          <button
            className="discard-button"
            disabled={saving}
            onClick={discard}
          >
            不保存
          </button>
          <button
            className="save-button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                if (!(await save()))
                  setError("保存未完成，项目仍保留。请检查工作区后重试。");
              } catch (e) {
                setError(String(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "正在保存…" : "保存并继续"}
          </button>
        </footer>
      </section>
    </div>
  );
}
