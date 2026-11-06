import DigitStepper from "./DigitStepper";
import { useEffect, useRef, useState } from "react";
import type { ToolIntent } from "./tools/useToolHost";
import type { ToolSnapshot } from "./tools/state";
import { interactiveValue, type InteractiveTarget } from "./interactiveModel";
// Undo advances the shared scope and remounts the view. Keep only the selected
// control (never a project copy), so undo does not unexpectedly select another variable.
let lastSelection: {
  projectId: string;
  kind: InteractiveTarget["kind"];
  layerId: string;
  group: number;
  step: number;
} | null = null;
export default function InteractiveAnalysis({
  snapshot: s,
  send,
}: {
  snapshot: ToolSnapshot;
  send: (a: ToolIntent) => Promise<void>;
}) {
  const remembered =
    lastSelection?.projectId === s.project.id ? lastSelection : null;
  const [kind, setKind] = useState<InteractiveTarget["kind"]>(
    remembered?.kind || "qwot",
  );
  const [layerId, setLayer] = useState(
    remembered?.layerId ||
      (s.layerSide === "back" ? s.project.back_layers : s.project.layers)?.[
        s.selected
      ]?.id ||
      s.project.layers[0]?.id ||
      s.project.back_layers?.[0]?.id ||
      "",
  );
  const [group, setGroup] = useState(remembered?.group || 1);
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
  const [step, setStep] = useState(
    remembered?.step ?? (kind === "physical" || kind === "angle" ? 1 : 0.01),
  );
  useEffect(() => {
    lastSelection = { projectId: s.project.id, kind, layerId, group, step };
  }, [s.project.id, kind, layerId, group, step]);
  const [draft, setDraft] = useState("0");
  const focused = useRef(false);
  const [value, setValue] = useState(0);
  const [original, setOriginal] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const [records, setRecords] = useState<{ value: number; at: number }[]>([]);
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
      setRecords([{ value: v, at: Date.now() }]);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(reset, [kind, layerId, group, s.scope]);
  async function preview(next: number) {
    if (
      !Number.isFinite(next) ||
      next < 0 ||
      next > 1e9 ||
      (kind === "angle" && next > 89.9) ||
      ((kind === "group" || kind === "scale") && next <= 0) ||
      (kind === "group" && next > 1e6)
    ) {
      setError("新值超出当前变量的有效范围");
      return;
    }
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
        const recorded = candidate;
        setRecords((list) =>
          list.at(-1)?.value === recorded
            ? list
            : [...list.slice(-99), { value: recorded, at: Date.now() }],
        );
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
  const isLayer = kind === "physical" || kind === "qwot";
  const back = (s.project.back_layers || []).some((l) => l.id === layerId);
  const layers = back ? s.project.back_layers || [] : s.project.layers;
  const variable = isLayer ? `${back ? "back" : "front"}:${kind}` : kind;
  async function finish() {
    try {
      await send({
        kind: "interactive",
        session: session.current,
        phase: "finish",
        target,
        value,
      });
      reset();
      await send({ kind: "command", id: "view.interactive" });
    } catch (e) {
      setError(String(e));
    }
  }
  async function undoRound() {
    try {
      await send({
        kind: "interactive",
        session: session.current,
        phase: "undo",
        target,
        value,
      });
      session.current = crypto.randomUUID();
      confirmed.current = original;
      setValue(original);
      setDraft(String(original));
      setChanged(false);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="interactive-analysis tfc-analysis" data-target-kind={kind}>
      <div className="analysis-property-row analysis-variable">
        <span>变量</span>
        <select
          aria-label="分析变量"
          disabled={pending}
          value={variable}
          onChange={(e) => {
            const [side, unit] = e.target.value.split(":");
            if (unit) {
              setKind(unit as "physical" | "qwot");
              const choices =
                side === "back"
                  ? s.project.back_layers || []
                  : s.project.layers;
              const currentIndex = layers.findIndex((l) => l.id === layerId);
              setLayer(
                choices[Math.max(0, Math.min(currentIndex, choices.length - 1))]
                  ?.id || "",
              );
              setStep(unit === "physical" ? 1 : 0.01);
            } else {
              setKind(side as typeof kind);
              setStep(side === "angle" ? 1 : 0.01);
            }
          }}
        >
          <option value="front:qwot" disabled={!s.project.layers.length}>
            前表面1/4光学厚度
          </option>
          <option value="front:physical" disabled={!s.project.layers.length}>
            前表面物理厚度 (nm)
          </option>
          <option value="back:qwot" disabled={!s.project.back_layers?.length}>
            后表面1/4光学厚度
          </option>
          <option
            value="back:physical"
            disabled={!s.project.back_layers?.length}
          >
            后表面物理厚度 (nm)
          </option>
          <option value="group" disabled={!groups.length}>
            组系数
          </option>
          <option value="angle">入射角 (°)</option>
          <option value="scale">整体膜厚系数</option>
        </select>
        {isLayer ? (
          <select
            aria-label="分析膜层号"
            value={layerId}
            disabled={pending}
            onChange={(e) => setLayer(e.target.value)}
          >
            {layers.map((l, i) => (
              <option key={l.id} value={l.id}>
                {i + 1}
              </option>
            ))}
          </select>
        ) : kind === "group" ? (
          <select
            aria-label="分析组号"
            value={group}
            disabled={pending}
            onChange={(e) => setGroup(Number(e.target.value))}
          >
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
      </div>
      <div className="analysis-property-row">
        <span>原值</span>
        <output>{original.toFixed(7)}</output>
      </div>
      <div className="analysis-property-row analysis-new-value">
        <span>新值</span>
        <DigitStepper
          value={value}
          disabled={disabled}
          onChange={(v) => void preview(v)}
        />
      </div>
      <div className="analysis-primary-actions">
        <button disabled={disabled} onClick={() => void preview(original)}>
          恢复到原值
        </button>
        <button disabled={pending || s.busy} onClick={() => void finish()}>
          完成
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <details className="analysis-records">
        <summary>
          <span>显示记录控制</span>
          <small>
            {s.calculating ? "更新中" : s.stale ? "待更新" : "已同步"}
          </small>
        </summary>
        <label>
          直接输入
          <input
            aria-label="交互式调节新值"
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
              setDraft(e.target.value);
              if (
                e.target.value.trim() &&
                Number.isFinite(Number(e.target.value))
              )
                void preview(Number(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                void preview(original);
              }
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                void preview(value + (e.key === "ArrowUp" ? step : -step));
              }
            }}
          />
        </label>
        <label>
          步长
          <input
            aria-label="分析步长"
            type="number"
            min="0.0000001"
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
        </div>
        <input
          aria-label="连续调膜"
          type="range"
          min={Math.max(0, original - Math.max(original * 0.2, step * 20))}
          max={
            kind === "angle"
              ? Math.min(89.9, original + Math.max(original * 0.2, step * 20))
              : original + Math.max(original * 0.2, step * 20)
          }
          step={step > 0 ? step : 0.01}
          value={value}
          disabled={disabled}
          onChange={(e) => void preview(Number(e.target.value))}
        />
        <label>
          参数记录
          <select
            aria-label="本轮参数记录"
            value=""
            onChange={(e) => {
              if (e.target.value !== "")
                void preview(records[Number(e.target.value)].value);
            }}
          >
            <option value="">本轮 {records.length} 条 · 选择可恢复</option>
            {records.map((r, i) => (
              <option key={i} value={i}>
                {new Date(r.at).toLocaleTimeString()}　{r.value.toFixed(7)}
              </option>
            ))}
          </select>
        </label>
        <div className="interactive-actions">
          <button
            disabled={!s.canUndo || pending || !changed}
            onClick={() => void undoRound()}
          >
            撤销本轮
          </button>
          <button disabled={pending} onClick={reset}>
            载入当前值
          </button>
        </div>
        <p className="engineering-help">
          逐位按钮及方向键即时调整。每轮共用一次撤销；完成保留修改，项目需另行保存。记录为本轮参数，不代表已保存的光谱。
        </p>
      </details>
    </div>
  );
}
