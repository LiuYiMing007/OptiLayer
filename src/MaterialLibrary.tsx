import { useRef, useState } from "react";
import { Check, Download, Plus, Save } from "lucide-react";
import NumericInput from "./NumericInput";
import { replaceMaterial, synchronizeBoundaries } from "./model";
import type { Material, MaterialRole, Project } from "./types";
const roles: Record<MaterialRole, string> = {
  film: "膜层材料",
  substrate: "基底",
  medium: "入射介质",
  all: "通用（均可选）",
};
export default function MaterialLibrary({
  project,
  update,
  library,
  onSaveLibrary,
}: {
  library: Material[];
  onSaveLibrary: () => Promise<void>;
  project: Project;
  update: (f: (p: Project) => void) => void;
}) {
  const [tab, setTab] = useState<"project" | "library">("project");
  const [search, setSearch] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [name, setName] = useState(""),
    [role, setRole] = useState<MaterialRole>("film"),
    [n, setN] = useState(1.5),
    [source, setSource] = useState("用户输入的常数折射率");
  async function saveLibrary() {
    setBusy(true);
    setError("");
    try {
      await onSaveLibrary();
      setNotice("当前材料快照已保存到共享库；其他项目的快照不会被自动修改。");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="material-library">
      <div className="material-search">
        <input
          aria-label="搜索材料"
          placeholder="搜索材料名称、用途或来源"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          hidden
          type="file"
          ref={importInput}
          accept=".json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (f.size > 2_000_000) throw new Error("材料文件不能超过 2 MB");
              const data = JSON.parse(await f.text());
              const items = Array.isArray(data) ? data : data.materials;
              if (!Array.isArray(items) || !items.length || items.length > 1000)
                throw new Error(
                  "需要 1–1000 个材料的 JSON 数组或 materials 字段",
                );
              for (const m of items)
                if (
                  typeof m.name !== "string" ||
                  !m.name.trim() ||
                  !Number.isFinite(m.n) ||
                  m.n <= 0 ||
                  m.n > 20 ||
                  m.k !== 0 ||
                  !["film", "substrate", "medium", "all"].includes(m.role)
                )
                  throw new Error("材料需具名、有效 n、k=0 和用途");
              update((p) => {
                for (const m of items)
                  replaceMaterial(p, {
                    ...m,
                    model: "constant",
                    source: m.source || "用户导入常数材料",
                    color: m.color || "#859bd0",
                  });
              });
              setNotice("材料已提交到当前项目；共享库需单独保存。");
            } catch (error) {
              setError(String(error));
            }
          }}
        />
        <button
          className="button secondary"
          onClick={() => importInput.current?.click()}
        >
          导入材料 JSON
        </button>
      </div>
      <p className="modal-description">
        膜层、基底和入射介质共用光学材料模型。共享库可跨项目复用；项目保存自己的材料快照，避免旧结果随库更新而改变。当前支持常数
        n、k=0。
      </p>
      <div className="library-tabs">
        <button
          className={tab === "project" ? "active" : ""}
          onClick={() => setTab("project")}
        >
          项目快照 · {project.materials.length}
        </button>
        <button
          className={tab === "library" ? "active" : ""}
          onClick={() => setTab("library")}
        >
          共享材料库 · {library.length}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-success" role="status">
          {notice}
        </p>
      )}
      {tab === "project" ? (
        <>
          <div className="material-cards">
            {project.materials
              .map((m, index) => ({ m, index }))
              .filter(({ m }) =>
                `${m.name} ${m.source} ${roles[m.role]}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map(({ m, index }) => (
                <article className="material-card" key={m.name}>
                  <div className="material-card-title">
                    <span
                      className="material-dot"
                      style={{ background: m.color }}
                    />
                    <strong>{m.name}</strong>
                    <span className="small-label">常数模型 · k=0</span>
                  </div>
                  <div className="material-card-fields">
                    <label>
                      用途
                      <select
                        aria-label={`${m.name} 用途`}
                        value={m.role}
                        onChange={(e) =>
                          update((p) => {
                            p.materials[index].role = e.target
                              .value as MaterialRole;
                          })
                        }
                      >
                        {Object.entries(roles).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      折射率 n
                      <NumericInput
                        label={`${m.name} 折射率`}
                        value={m.n}
                        min={0.001}
                        max={20}
                        onChange={(value) =>
                          update((p) => {
                            p.materials[index].n = value;
                            synchronizeBoundaries(p);
                          })
                        }
                      />
                    </label>
                    <label className="source-field">
                      数据来源
                      <input
                        aria-label={`${m.name} 数据来源`}
                        value={m.source}
                        onChange={(e) =>
                          update((p) => {
                            p.materials[index].source = e.target.value;
                          })
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void saveLibrary()}
          >
            <Save size={14} />
            {busy ? "正在保存…" : "将项目材料保存到共享库"}
          </button>
          <div className="new-material-form">
            <h3>添加材料或基底</h3>
            <div className="material-card-fields">
              <label>
                名称
                <input
                  aria-label="新材料名称"
                  placeholder="例如：我的基底"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                用途
                <select
                  aria-label="新材料用途"
                  value={role}
                  onChange={(e) => setRole(e.target.value as MaterialRole)}
                >
                  {Object.entries(roles).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                折射率 n
                <NumericInput
                  label="新材料折射率"
                  value={n}
                  min={0.001}
                  max={20}
                  onChange={setN}
                />
              </label>
            </div>
            <label className="new-source">
              数据来源
              <input
                aria-label="新材料数据来源"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={
                !name.trim() || !Number.isFinite(n) || n <= 0 || n > 20 || busy
              }
              onClick={() => {
                if (project.materials.some((m) => m.name === name.trim())) {
                  setError("该名称已存在，请修改现有快照或使用其他名称");
                  return;
                }
                update((p) =>
                  p.materials.push({
                    name: name.trim(),
                    n,
                    k: 0,
                    color: role === "substrate" ? "#b29b77" : "#859bd0",
                    role,
                    model: "constant",
                    source,
                  }),
                );
                setName("");
                setError("");
                setNotice(
                  "已加入项目；基底用途的材料可在计算设置中选择。保存到共享库后可跨项目复用。",
                );
              }}
            >
              <Plus size={15} />
              加入当前项目
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="material-cards">
            {library
              .filter((m) =>
                `${m.name} ${m.source} ${roles[m.role]}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((m) => {
                const current = project.materials.find(
                  (p) => p.name === m.name,
                );
                const same =
                  current && JSON.stringify(current) === JSON.stringify(m);
                return (
                  <article className="material-card catalog-card" key={m.name}>
                    <div>
                      <div className="material-card-title">
                        <span
                          className="material-dot"
                          style={{ background: m.color }}
                        />
                        <strong>{m.name}</strong>
                        <span className="pill">{roles[m.role]}</span>
                      </div>
                      <p>
                        n = {m.n} · k = {m.k}
                      </p>
                      <small>{m.source}</small>
                    </div>
                    <button
                      className="button secondary"
                      disabled={same}
                      onClick={() => {
                        update((p) => replaceMaterial(p, m));
                        setNotice(
                          `${m.name} 已${current ? "替换项目快照" : "加入项目"}，请重新计算。`,
                        );
                      }}
                    >
                      {same ? <Check size={14} /> : <Download size={14} />}{" "}
                      {same
                        ? "已在项目"
                        : current
                          ? "替换项目快照"
                          : "加入项目"}
                    </button>
                  </article>
                );
              })}
          </div>
          <p className="small-label">
            内置 REF
            条目仅用于数值验证。添加真实材料时请记录来源；当前没有声称具备真实材料的色散数据。
          </p>
        </>
      )}
    </div>
  );
}
