import { useEffect, useRef, useState } from "react";
import type { ToolIntent } from "./tools/useToolHost";
import type { ToolSnapshot } from "./tools/state";
import { interactiveValue, type InteractiveTarget } from "./interactiveModel";
export default function InteractiveAnalysis({
  snapshot: s,
  send,
}: {
  snapshot: ToolSnapshot;
  send: (a: ToolIntent) => Promise<void>;
}) {
  const [kind, setKind] = useState<InteractiveTarget["kind"]>("physical");
  const [layerId, setLayer] = useState(
    (s.layerSide === "back" ? s.project.back_layers : s.project.layers)?.[
      s.selected
    ]?.id ||
      s.project.layers[0]?.id ||
      s.project.back_layers?.[0]?.id ||
      "",
  );
  const [group, setGroup] = useState(1);
  const groups = [
    ...new Set(
      [...s.project.layers, ...(s.project.back_layers || [])]
        .map((l) => l.group || 0)
        .filter((g) => g > 0),
    ),
  ].sort((a, b) => a - b);
  useEffect(() => {
    if (groups.length && !groups.includes(group)) setGroup(groups[0]);
  }, [groups.join(","), group]);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState("0");
  const focused = useRef(false);
  const [value, setValue] = useState(0);
  const [original, setOriginal] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const session = useRef(crypto.randomUUID());
  const locked = useRef(false);
  const queued = useRef<number | null>(null);
  const confirmed = useRef(0);
  const target =
    kind === "group"
      ? { kind, group }
      : kind === "physical" || kind === "qwot"
        ? { kind, layerId }
        : { kind };
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  function reset() {
    session.current = crypto.randomUUID();
    setChanged(false);
    queued.current = null;
    try {
      const v = interactiveValue(s.project, target);
      confirmed.current = v;
      setValue(v);
      setDraft(String(v));
      setOriginal(v);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(reset, [kind, layerId, group, s.scope]);
  async function preview(next: number) {
    setValue(next);
    if (locked.current) {
      queued.current = next;
      return;
    }
    const token = session.current;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      let candidate: number | null = next;
      while (candidate !== null && session.current === token) {
        queued.current = null;
        await send({
          kind: "interactive",
          session: token,
          phase: "preview",
          target,
          value: candidate,
        });
        if (session.current !== token) return;
        confirmed.current = candidate;
        setChanged(true);
        candidate = queued.current;
      }
    } catch (e) {
      if (session.current === token) {
        setError(String(e));
        setValue(confirmed.current);
      }
      queued.current = null;
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  const disabled =
    s.busy ||
    ((kind === "physical" || kind === "qwot") &&
      ![...s.project.layers, ...(s.project.back_layers || [])].some(
        (l) => l.id === layerId,
      ));
  return (
    <div className="interactive-analysis" data-target-kind={kind}>
      <label>
        调节变量
        <select
          disabled={pending}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setStep(
              e.target.value === "physical" || e.target.value === "angle"
                ? 1
                : 0.01,
            );
          }}
        >
          <option value="physical">膜层物理厚度（nm）</option>
          <option value="qwot">膜层 ¼ 波光学厚度（QWOT）</option>
          <option
            disabled={
              ![...s.project.layers, ...(s.project.back_layers || [])].some(
                (l) => l.group,
              )
            }
            value="group"
          >
            组系数
          </option>
          <option value="scale">正背面整体厚度系数</option>
          <option value="angle">入射角（°）</option>
        </select>
      </label>
      {(kind === "physical" || kind === "qwot") && (
        <label>
          膜层
          <select
            disabled={pending}
            value={layerId}
            onChange={(e) => setLayer(e.target.value)}
          >
            {[...s.project.layers, ...(s.project.back_layers || [])].map(
              (l, i) => (
                <option key={l.id} value={l.id}>
                  {i < s.project.layers.length ? "正面" : "背面"}第{" "}
                  {i < s.project.layers.length
                    ? i + 1
                    : i - s.project.layers.length + 1}{" "}
                  层 · {l.material} · {l.thickness_nm.toPrecision(7)} nm
                </option>
              ),
            )}
          </select>
        </label>
      )}
      {kind === "group" && (
        <label>
          组号
          <select
            aria-label="调膜组号"
            value={group}
            onChange={(e) => setGroup(Number(e.target.value))}
          >
            {[
              ...new Set(
                [...s.project.layers, ...(s.project.back_layers || [])]
                  .map((l) => l.group || 0)
                  .filter((g) => g > 0),
              ),
            ]
              .sort((a, b) => a - b)
              .map((g) => (
                <option key={g} value={g}>
                  组 {g}
                </option>
              ))}
          </select>
        </label>
      )}
      <dl>
        <dt>本轮原值</dt>
        <dd>{original.toPrecision(9)}</dd>
      </dl>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem(
            "value",
          ) as HTMLInputElement;
          void preview(Number(input.value));
        }}
      >
        <label>
          新值
          <input
            name="value"
            aria-label="交互式调节新值"
            type="text"
            inputMode="decimal"
            value={draft}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              setDraft(String(confirmed.current));
            }}
            onChange={(e) => {
              const text = e.target.value;
              setDraft(text);
              if (text.trim() && Number.isFinite(Number(text)))
                void preview(Number(text));
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                void preview(value + (e.key === "ArrowUp" ? step : -step));
              }
              if (e.key === "Escape") {
                e.preventDefault();
                void preview(original);
              }
            }}
            required
          />
        </label>
      </form>
      <label>
        增减步长
        <input
          type="number"
          min="0.000001"
          step="any"
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        />
      </label>
      <div className="interactive-actions">
        <button
          disabled={disabled || !(step > 0)}
          onClick={() => void preview(value - step)}
        >
          − 减小
        </button>
        <button
          disabled={disabled || !(step > 0)}
          onClick={() => void preview(value + step)}
        >
          ＋ 增大
        </button>
        <button disabled={disabled} onClick={() => void preview(original)}>
          恢复原值
        </button>
      </div>
      <input
        aria-label="连续调膜"
        type="range"
        min={Math.max(0, original - Math.max(original * 0.2, step * 20))}
        max={
          kind === "angle"
            ? Math.min(89.89, original + Math.max(original * 0.2, step * 20))
            : original + Math.max(original * 0.2, step * 20)
        }
        step={step > 0 ? step : 0.01}
        value={value}
        disabled={
          s.busy ||
          ((kind === "physical" || kind === "qwot") &&
            ![...s.project.layers, ...(s.project.back_layers || [])].some(
              (l) => l.id === layerId,
            ))
        }
        onChange={(e) => void preview(Number(e.target.value))}
      />
      <div className="interactive-actions">
        <button
          disabled={pending}
          onClick={async () => {
            try {
              await send({
                kind: "interactive",
                session: session.current,
                phase: "finish",
                target,
                value,
              });
              reset();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          完成本轮
        </button>
        <button
          disabled={!s.canUndo || pending || !changed}
          onClick={() =>
            void send({
              kind: "interactive",
              session: session.current,
              phase: "undo",
              target,
              value,
            }).catch((e) => setError(String(e)))
          }
        >
          撤销本轮
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <details className="interactive-help">
        <summary>
          说明 · {s.calculating ? "更新中" : s.stale ? "待更新" : "已同步"}
        </summary>
        <p>
          数值、方向键及滑块直接更新光谱。一轮操作共用一次撤销；组系数仅调整同组膜层，0
          为未分组。其他窗口修改后请载入当前值。关闭保留修改，项目需另行保存。
        </p>
      </details>
      <button disabled={pending} onClick={reset} style={{ display: "block" }}>
        载入当前值
      </button>
    </div>
  );
}
