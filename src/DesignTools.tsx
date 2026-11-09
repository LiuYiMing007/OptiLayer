import { useEffect, useRef, useState } from "react";
import { designRequest } from "./api";
import { projectKey } from "./projectStatus";
import type { Project, Spectrum } from "./types";
import type { ToolSnapshot } from "./tools/state";
import type { ToolIntent } from "./tools/useToolHost";
import SpectrumChart from "./SpectrumChart";

type Variable = {
  side: "front" | "back";
  id: string;
  min_nm: number;
  max_nm: number;
};
type Candidate = {
  before: Project;
  project: Project;
  scope: string;
  spectrum?: Spectrum;
};
const rows = (p: Project) =>
  (["front", "back"] as const).flatMap((side) =>
    (side === "front" ? p.layers : p.back_layers || []).map((layer, index) => ({
      ...layer,
      side,
      index,
    })),
  );
const rowKey = (r: { side: string; id: string }) => `${r.side}:${r.id}`;

function useAnalysis(scope: string) {
  const controller = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [scope],
  );
  async function run<T>(
    body: Record<string, unknown>,
    done: (result: T) => void,
  ) {
    if (controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setRunning(true);
    setError("");
    try {
      const result = await designRequest<T>(body, active.signal);
      if (!active.signal.aborted) done(result);
    } catch (e) {
      if (!active.signal.aborted) setError(String(e));
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setRunning(false);
      }
    }
  }
  const stop = () => {
    controller.current?.abort();
    setError("已停止，项目未修改");
  };
  return { running, error, setError, run, stop };
}

function Proposal({
  candidate,
  snapshot,
  send,
  applied,
}: {
  candidate: Candidate;
  snapshot: ToolSnapshot;
  send: (a: ToolIntent) => Promise<void>;
  applied: () => void;
}) {
  const [error, setError] = useState(""),
    [applying, setApplying] = useState(false);
  const before = rows(candidate.before),
    changes = rows(candidate.project).filter(
      (r) =>
        r.thickness_nm !==
        before.find((b) => rowKey(b) === rowKey(r))?.thickness_nm,
    );
  const stale =
    candidate.scope !== snapshot.scope ||
    projectKey(candidate.before) !== projectKey(snapshot.project);
  return (
    <section className="design-proposal">
      <h3>候选膜系 · 尚未应用</h3>
      {stale && <p role="alert">项目已变化，此候选已过期，请重新运行。</p>}
      <table className="engineering-sheet">
        <thead>
          <tr>
            <th>膜层</th>
            <th>材料</th>
            <th>原厚度 nm</th>
            <th>候选厚度 nm</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((r) => (
            <tr key={rowKey(r)}>
              <td>
                {r.side === "front" ? "正面" : "背面"} {r.index + 1}
              </td>
              <td>{r.material}</td>
              <td>
                {before
                  .find((b) => rowKey(b) === rowKey(r))
                  ?.thickness_nm.toFixed(4)}
              </td>
              <td>{r.thickness_nm.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!changes.length && <p>候选未改变膜厚。</p>}
      {candidate.spectrum && (
        <div className="design-preview">
          <SpectrumChart
            spectrum={candidate.spectrum}
            referenceNm={candidate.project.settings.reference_nm}
            options={{ T: true, R: true, A: false, sp: false, yMode: "full" }}
            targets={candidate.project.target_points}
          />
        </div>
      )}
      <button
        disabled={stale || !changes.length || applying}
        onClick={async () => {
          setApplying(true);
          setError("");
          try {
            await send({
              kind: "design-apply",
              expected: candidate.before,
              proposal: candidate.project,
            });
            applied();
          } catch (e) {
            setError(String(e));
          } finally {
            setApplying(false);
          }
        }}
      >
        应用候选（可撤销）
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function OptimizationTool({
  snapshot: s,
  send,
}: {
  snapshot: ToolSnapshot;
  send: (a: ToolIntent) => Promise<void>;
}) {
  const all = rows(s.project);
  const [variables, setVariables] = useState<Record<string, Variable>>({});
  const [budget, setBudget] = useState(120);
  const [result, setResult] = useState<
    | (Candidate & {
        initial_rmse: number;
        final_rmse: number;
        evaluations: number;
        status: string;
        note: string;
      })
    | null
  >(null);
  const task = useAnalysis(s.scope);
  const variable = (r: (typeof all)[number]): Variable => ({
    side: r.side,
    id: r.id,
    min_nm: r.thickness_nm * 0.8,
    max_nm: Math.max(r.thickness_nm * 1.2, r.thickness_nm + 10),
  });
  return (
    <section className="design-tool">
      <h2>膜系自动优化 · 雏形</h2>
      <p>
        固定材料和层序，调整所选层的实际物理厚度；以目标曲线 R/T
        的等权均方根误差寻优。未勾选的层保持不变，组系数不作为联动约束。
      </p>
      <div className="design-toolbar">
        <button
          disabled={task.running}
          onClick={() =>
            setVariables(
              Object.fromEntries(
                all.slice(0, 30).map((r) => [rowKey(r), variable(r)]),
              ),
            )
          }
        >
          选择全部（最多30层）
        </button>
        <button disabled={task.running} onClick={() => setVariables({})}>
          清空选择
        </button>
        <button
          onClick={() => void send({ kind: "command", id: "view.targets" })}
        >
          目标曲线…
        </button>
        <span>{s.project.target_points?.length || 0} 个目标点</span>
      </div>
      <fieldset disabled={task.running}>
        <div className="design-layer-list">
          <table className="engineering-sheet">
            <thead>
              <tr>
                <th>优化</th>
                <th>膜层</th>
                <th>材料</th>
                <th>当前 nm</th>
                <th>下限 nm</th>
                <th>上限 nm</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => {
                const key = rowKey(r),
                  v = variables[key];
                return (
                  <tr key={key}>
                    <td>
                      <input
                        aria-label={`优化${r.side}第${r.index + 1}层`}
                        type="checkbox"
                        checked={!!v}
                        onChange={(e) =>
                          setVariables((old) => {
                            const next = { ...old };
                            if (e.target.checked) next[key] = variable(r);
                            else delete next[key];
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      {r.side === "front" ? "正面" : "背面"} {r.index + 1}
                    </td>
                    <td>{r.material}</td>
                    <td>{r.thickness_nm.toFixed(2)}</td>
                    {(["min_nm", "max_nm"] as const).map((field) => (
                      <td key={field}>
                        <input
                          type="number"
                          aria-label={`${key}-${field}`}
                          min={0}
                          max={1000000}
                          step="any"
                          disabled={!v}
                          value={v?.[field] ?? ""}
                          onChange={(e) =>
                            setVariables((old) => ({
                              ...old,
                              [key]: {
                                ...old[key],
                                [field]: Number(e.target.value),
                              },
                            }))
                          }
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <label>
          最大光谱评估次数{" "}
          <input
            type="number"
            min={10}
            max={500}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
        </label>
      </fieldset>
      <div className="design-toolbar">
        <button
          disabled={
            task.running ||
            !Object.keys(variables).length ||
            !s.project.target_points?.length
          }
          onClick={() => {
            const before = structuredClone(s.project);
            setResult(null);
            void task.run<Omit<NonNullable<typeof result>, "before" | "scope">>(
              {
                action: "optimize",
                project: before,
                variables: Object.values(variables),
                max_evaluations: budget,
              },
              (r) => setResult({ ...r, before, scope: s.scope }),
            );
          }}
        >
          {task.running ? "正在优化…" : "开始优化"}
        </button>
        {task.running && <button onClick={task.stop}>停止</button>}
      </div>
      <p>
        每次最多运行约 15
        秒，或达到评估次数后返回目前最优候选；局部优化不保证全局最优。
      </p>
      {task.error && <p role="alert">{task.error}</p>}
      {result && (
        <>
          <p>
            目标 RMSE：{result.initial_rmse.toFixed(6)} →{" "}
            {result.final_rmse.toFixed(6)} 个百分点 · {result.evaluations}{" "}
            次评估 · {result.status === "converged" ? "局部收敛" : "达到预算"}
          </p>
          <Proposal
            candidate={result}
            snapshot={s}
            send={send}
            applied={() => setResult(null)}
          />
        </>
      )}
    </section>
  );
}

type Chat = { role: "user" | "assistant"; content: string };
type Trace = { tool: string; arguments?: unknown; result: unknown };
export function AgentTool({
  snapshot: s,
  send,
}: {
  snapshot: ToolSnapshot;
  send: (a: ToolIntent) => Promise<void>;
}) {
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1"),
    [model, setModel] = useState(""),
    [key, setKey] = useState("");
  const [prompt, setPrompt] = useState(
      "分析当前膜系的光谱特征，并说明可调整哪些膜层。",
    ),
    [chat, setChat] = useState<Chat[]>([]);
  const [trace, setTrace] = useState<Trace[]>([]),
    [candidate, setCandidate] = useState<Candidate | null>(null);
  const task = useAnalysis(s.scope);
  return (
    <section className="design-tool agent-tool">
      <h2>AI Agent · 雏形</h2>
      <details open={!key || !model}>
        <summary>模型连接（Responses API）</summary>
        <fieldset disabled={task.running}>
          <label>
            服务根地址{" "}
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            模型 ID{" "}
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="输入服务支持工具调用的模型 ID"
            />
          </label>
          <label>
            API Key{" "}
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
        </fieldset>
        <p>
          连接信息仅保留在当前窗口内存，不写入项目。服务需支持 Responses API
          和函数工具调用。
        </p>
      </details>
      <p>
        发送会将当前膜层、环境、目标点、材料名称与来源，以及本窗口最近对话发送到上述服务。工具可读取项目、调用真实光谱计算，并提出膜厚候选；点击“应用候选”后才修改项目。
      </p>
      <div className="agent-chat" aria-live="polite">
        {chat.map((m, i) => (
          <article key={i} className={m.role}>
            <strong>{m.role === "user" ? "你" : "AI Agent"}</strong>
            <p>{m.content}</p>
          </article>
        ))}
      </div>
      <label>
        给 Agent 的任务
        <textarea
          disabled={task.running}
          maxLength={6000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
      </label>
      <div className="design-toolbar">
        <button
          disabled={
            task.running || !key.trim() || !model.trim() || !prompt.trim()
          }
          onClick={() => {
            const before = structuredClone(s.project),
              message = prompt.trim();
            setCandidate(null);
            setTrace([]);
            void task.run<{ answer: string; project: Project; trace: Trace[] }>(
              {
                action: "agent",
                project: before,
                prompt: message,
                config: { endpoint, model, api_key: key },
                history: chat.slice(-12),
              },
              (r) => {
                setChat((old) => [
                  ...old,
                  { role: "user", content: message },
                  { role: "assistant", content: r.answer },
                ]);
                setTrace(r.trace);
                if (projectKey(before) !== projectKey(r.project))
                  setCandidate({ before, project: r.project, scope: s.scope });
              },
            );
          }}
        >
          {task.running ? "Agent 正在分析…" : "发送给模型服务"}
        </button>
        {task.running && <button onClick={task.stop}>停止</button>}
        <button
          disabled={task.running}
          onClick={() => {
            setChat([]);
            setTrace([]);
            setCandidate(null);
            task.setError("");
          }}
        >
          清空对话
        </button>
        <button disabled={task.running} onClick={() => setKey("")}>
          清除密钥
        </button>
      </div>
      {task.error && <p role="alert">{task.error}</p>}
      {!!trace.length && (
        <details>
          <summary>本轮工具调用 · {trace.length} 次</summary>
          {trace.map((t, i) => (
            <div key={i}>
              <strong>{t.tool}</strong>
              <pre>
                {JSON.stringify(
                  { arguments: t.arguments, result: t.result },
                  null,
                  2,
                )}
              </pre>
            </div>
          ))}
        </details>
      )}
      {candidate && (
        <Proposal
          candidate={candidate}
          snapshot={s}
          send={send}
          applied={() => {
            setCandidate(null);
            setChat((old) => [
              ...old,
              {
                role: "assistant",
                content: "候选已由你应用到当前项目，可通过编辑菜单撤销。",
              },
            ]);
          }}
        />
      )}
      <p>
        雏形仅支持现有层膜厚候选，不执行文件操作、自动保存或结构设计。每轮最多 5
        次模型请求，可随时停止。
      </p>
    </section>
  );
}
