import { useState } from "react";
import type { Project } from "./types";
import { parseDistribution } from "./distribution";
export default function DistributionWindow({
  project,
  update,
}: {
  project: Project;
  update: (f: (p: Project) => void) => void;
}) {
  const data = project.response_data?.distributions || [];
  const [selected, setSelected] = useState("EQUAL"),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const current =
    selected === "EQUAL"
      ? { name: "EQUAL", samples: [[0, 100]] }
      : data.find((d) => d.name === selected);
  return (
    <section className="compact-tool distribution-window">
      <div className="sheet-toolbar">
        <select
          aria-label="分布名称"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option>EQUAL</option>
          {data.map((d) => (
            <option key={d.name}>{d.name}</option>
          ))}
        </select>
        <button
          onClick={() => {
            setEditing(true);
            setName(selected === "EQUAL" ? "" : selected);
            setText(
              current?.samples.map((r) => r.join("\t")).join("\n") || "0\t100",
            );
            setError("");
          }}
        >
          编辑 / 新增…
        </button>
        <button
          disabled={selected === "EQUAL"}
          onClick={() => {
            update((p) => {
              p.response_data ||= {};
              p.response_data.distributions = data.filter(
                (d) => d.name !== selected,
              );
            });
            setSelected("EQUAL");
          }}
        >
          删除
        </button>
      </div>
      <div className="sheet-scroll">
        <table className="engineering-sheet">
          <tbody>
            <tr>
              <th>数据</th>
              {current?.samples.map((_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
            </tr>
            {["角度 (°)", "相对强度 (%)"].map((label, r) => (
              <tr key={label}>
                <th>{label}</th>
                {current?.samples.map((s, i) => (
                  <td key={i}>{s[r]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="distribution-editor">
          <label>
            名称（最多8位）
            <input
              aria-label="分布记录名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <textarea
            aria-label="角度与相对强度数据"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button onClick={() => setEditing(false)}>取消</button>
          <button
            onClick={() => {
              try {
                const record = parseDistribution(name, text);
                update((p) => {
                  p.response_data ||= {};
                  p.response_data.distributions = [
                    ...data.filter((d) => d.name !== record.name),
                    record,
                  ];
                });
                setSelected(record.name);
                setEditing(false);
                setError("");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            保存分布
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="sheet-help">
        EQUAL
        为均匀相对强度参考。分布描述锥角内的角度权重，不等于光源光谱；此窗口管理数据，当前单角
        R/T 不使用角度积分。新增分布需用完整项目 JSON 保存。
      </p>
    </section>
  );
}
