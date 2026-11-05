import MaterialEditor from "./MaterialEditor";
import { editableCopy } from "./materialEditing";
import { readCatalogue, checkMaterials } from "./api";
import { useEffect, useMemo, useRef, useState } from "react";
import { replaceMaterial, synchronizeBoundaries } from "./model";
import { materialAt, materialLabel, matchesMaterial } from "./materials";
import { chartTheme } from "./design/chartTheme";
import NumericInput from "./NumericInput";
import TextInput from "./TextInput";
import type { Material, MaterialRole, Project } from "./types";
const roles: Record<MaterialRole, string> = {
  film: "膜层",
  substrate: "基底",
  medium: "介质",
  all: "通用",
};
const format = (x: number) =>
  Number.isFinite(x) ? Number(x.toPrecision(7)).toString() : "超出有效范围";
function Preview({ m }: { m: Material }) {
  const points =
    m.preview ||
    m.samples ||
    (m.model === "tfcalc-formula" && m.range_nm
      ? Array.from({ length: 48 }, (_, i) => {
          const w =
            m.range_nm![0] + ((m.range_nm![1] - m.range_nm![0]) * i) / 47;
          return [w, ...materialAt(m, w)];
        }).filter((p) => p.every(Number.isFinite) && p[1] > 0 && p[2] >= 0)
      : []);
  if (points.length < 2)
    return (
      <p className="catalogue-hint">
        {m.model === "constant"
          ? "常数模型，不随波长变化。"
          : "没有可用的曲线预览。"}
      </p>
    );
  const lo = points[0][0],
    hi = points.at(-1)![0];
  return (
    <div className="nk-preview">
      {([1, 2] as const).map((col) => {
        const min = Math.min(...points.map((p) => p[col])),
          max = Math.max(...points.map((p) => p[col]));
        const coords = points
          .map(
            (p) =>
              `${32 + ((p[0] - lo) / (hi - lo || 1)) * 264},${72 - ((p[col] - min) / (max - min || 1)) * 48}`,
          )
          .join(" ");
        return (
          <svg
            key={col}
            viewBox="0 0 320 106"
            role="img"
            aria-label={`${col === 1 ? "n" : "k"} 色散预览`}
          >
            <path d="M32 18V73H296" stroke={chartTheme.axis} fill="none" />
            <polyline
              points={coords}
              fill="none"
              stroke={col === 1 ? chartTheme.channels.T : chartTheme.channels.R}
              strokeWidth="1.8"
            />
            <text x="4" y="14">
              {col === 1 ? "n" : "k"} · {format(max)}
            </text>
            <text x="4" y="70">
              {format(min)}
            </text>
            <text x="32" y="94">
              {format(lo)}
            </text>
            <text x="294" y="94" textAnchor="end">
              {format(hi)} nm
            </text>
          </svg>
        );
      })}
    </div>
  );
}
export default function MaterialLibrary({
  project,
  update,
  library,
  onSaveLibrary,
  onImport,
  onMaterialSave,
  openFolder,
  onEditing,
  substrate = false,
}: {
  project: Project;
  update: (f: (p: Project) => void) => void;
  library: Material[];
  onSaveLibrary: () => Promise<void>;
  onImport: (name: string, substrate?: boolean) => Promise<void>;
  onMaterialSave: (
    material: Material,
    replaces: string,
    expected: Material | null,
  ) => Promise<void>;
  openFolder: () => Promise<void>;
  onEditing: (active: boolean) => Promise<void>;
  substrate?: boolean;
}) {
  const [tab, setTab] = useState<"project" | "library">("library"),
    [search, setSearch] = useState("");
  const [collection, setCollection] = useState(""),
    [role, setRole] = useState(substrate ? "substrate" : ""),
    [status, setStatus] = useState("ready");
  const [page, setPage] = useState(0),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false),
    [newName, setNewName] = useState(""),
    [newN, setNewN] = useState(1.5),
    [newK, setNewK] = useState(0),
    [newRole, setNewRole] = useState<MaterialRole>(
      substrate ? "substrate" : "film",
    );
  const [editing, setEditing] = useState<{
    material: Material;
    replaces: string;
    expected: Material | null;
  } | null>(null);
  const editingActive = useRef(false),
    editingCallback = useRef(onEditing);
  editingCallback.current = onEditing;
  useEffect(
    () => () => {
      if (editingActive.current)
        void editingCallback.current(false).catch(() => {});
    },
    [],
  );
  async function edit(item: Material) {
    await perform(async () => {
      const full = item.catalogue_summary
        ? (await readCatalogue(item.name)).material
        : item;
      await onEditing(true);
      editingActive.current = true;
      setEditing({
        material: editableCopy(full),
        replaces: item.name,
        expected: structuredClone(
          project.materials.find((m) => m.name === item.name) || null,
        ),
      });
    });
  }
  const fileInput = useRef<HTMLInputElement>(null);
  const items = tab === "project" ? project.materials : library;
  const filtered = useMemo(
    () =>
      items.filter(
        (m) =>
          matchesMaterial(m, search) &&
          (!collection || m.collection === collection) &&
          (!role || m.role === role || m.role === "all") &&
          (status === "quarantined"
            ? m.status === "quarantined"
            : status !== "ready" || m.status !== "quarantined"),
      ),
    [items, search, collection, role, status],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50)),
    currentPage = Math.min(page, pages - 1),
    rows = filtered.slice(currentPage * 50, currentPage * 50 + 50);
  const m = filtered.find((x) => x.name === selected) || rows[0];
  const inProject = m && project.materials.find((x) => x.name === m.name);
  const current = project.materials.find(
    (x) => x.name === project.settings.substrate_material,
  );
  const selectedNk = m
    ? materialAt(m, project.settings.reference_nm)
    : [NaN, NaN];
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply(item: Material) {
    await perform(async () => {
      if (item.catalogue_summary) await onImport(item.name, substrate);
      else
        update((p) => {
          replaceMaterial(p, item);
          if (substrate) p.settings.substrate_material = item.name;
          synchronizeBoundaries(p);
        });
      setNotice(
        `${materialLabel(item)} 已${substrate ? "设为基底" : "加入项目"}，保存项目时包含完整 n/k 快照。`,
      );
    });
  }
  function reset() {
    setPage(0);
    setSelected("");
  }
  if (editing)
    return (
      <MaterialEditor
        material={editing.material}
        cancel={() => {
          void onEditing(false).then(() => {
            editingActive.current = false;
            setEditing(null);
          });
        }}
        save={async (m) => {
          await onMaterialSave(m, editing.replaces, editing.expected);
          await onEditing(false);
          editingActive.current = false;
          setEditing(null);
          setTab("project");
          setCollection("");
          setSearch("");
          setRole("");
          setSelected(m.name);
          setNotice("材料已保存；当前项目使用更新后的快照。");
        }}
      />
    );
  return (
    <section className="catalogue-window">
      {substrate && (
        <div className="catalogue-current">
          <span>当前基底</span>
          <select
            aria-label="基底材料"
            value={project.settings.substrate_material}
            onChange={(e) =>
              update((p) => {
                p.settings.substrate_material = e.target.value;
                synchronizeBoundaries(p);
              })
            }
          >
            {project.materials
              .filter(
                (x) =>
                  x.role === "substrate" ||
                  x.role === "all" ||
                  x.name === project.settings.substrate_material,
              )
              .map((x) => (
                <option key={x.name} value={x.name}>
                  {materialLabel(x)}
                  {x.collection ? ` · ${x.collection}` : ""}
                </option>
              ))}
          </select>
          <span>
            n(λ₀) {format(project.settings.substrate_n)} · k{" "}
            {format(
              current
                ? materialAt(current, project.settings.reference_nm)[1]
                : 0,
            )}
          </span>
        </div>
      )}
      <div className="catalogue-toolbar">
        <button onClick={() => void perform(openFolder)}>打开数据文件夹</button>
        <div className="catalogue-tabs" role="tablist" aria-label="材料来源">
          <button
            role="tab"
            aria-selected={tab === "library"}
            onClick={() => {
              setTab("library");
              reset();
            }}
          >
            材料目录 · {library.length}
          </button>
          <button
            role="tab"
            aria-selected={tab === "project"}
            onClick={() => {
              setTab("project");
              reset();
            }}
          >
            项目快照 · {project.materials.length}
          </button>
        </div>
        <button onClick={() => setAdding(!adding)}>新建常数材料</button>
        <button onClick={() => fileInput.current?.click()}>导入 JSON</button>
        {tab === "project" && (
          <button disabled={busy} onClick={() => void perform(onSaveLibrary)}>
            保存到共享库
          </button>
        )}
      </div>
      <div className="catalogue-filters">
        <input
          autoFocus
          aria-label="搜索材料"
          placeholder="搜索名称、编号、来源或备注…（可输入多个关键词）"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            reset();
          }}
        />
        <select
          aria-label="材料集合"
          value={collection}
          onChange={(e) => {
            setCollection(e.target.value);
            reset();
          }}
        >
          <option value="">全部来源</option>
          {[...new Set(items.map((x) => x.collection).filter(Boolean))].map(
            (c) => (
              <option key={c}>{c}</option>
            ),
          )}
        </select>
        <select
          aria-label="材料用途筛选"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            reset();
          }}
        >
          <option value="">全部用途</option>
          {Object.entries(roles).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <select
          aria-label="材料数据状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            reset();
          }}
        >
          <option value="ready">可用数据</option>
          <option value="all">包含待核查</option>
          <option value="quarantined">仅待核查</option>
        </select>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="catalogue-notice" role="status">
          {notice}
        </p>
      )}
      {adding && (
        <form
          className="catalogue-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (project.materials.some((x) => x.name === newName.trim())) {
              setError("名称已存在，请使用其他名称");
              return;
            }
            update((p) =>
              p.materials.push({
                name: newName.trim(),
                n: newN,
                k: newK,
                color: "#6488a6",
                role: newRole,
                model: "constant",
                source: "用户输入常数；未经实测校准",
              }),
            );
            setNewName("");
            setTab("project");
            setAdding(false);
          }}
        >
          <input
            required
            maxLength={100}
            aria-label="新材料名称"
            placeholder="材料名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <label>
            n{" "}
            <NumericInput
              label="新材料折射率"
              value={newN}
              min={0.001}
              max={20}
              onChange={setNewN}
            />
          </label>
          <label>
            k{" "}
            <NumericInput
              label="新材料消光系数"
              value={newK}
              min={0}
              max={1000000}
              onChange={setNewK}
            />
          </label>
          <select
            aria-label="新材料用途"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as MaterialRole)}
          >
            {Object.entries(roles).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <button type="submit">加入项目</button>
        </form>
      )}
      <div className="catalogue-body">
        <div className="catalogue-table-area">
          <div className="catalogue-table-scroll">
            <table className="catalogue-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>来源</th>
                  <th>用途</th>
                  <th>n¹</th>
                  <th>模型 / 状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item.name}
                    tabIndex={0}
                    aria-selected={m?.name === item.name}
                    className={m?.name === item.name ? "selected" : ""}
                    onClick={() => setSelected(item.name)}
                    onDoubleClick={() => {
                      if (item.status !== "quarantined") void apply(item);
                    }}
                    onKeyDown={(e) => {
                      const index = filtered.findIndex(
                        (x) => x.name === item.name,
                      );
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const next = Math.max(
                          0,
                          Math.min(
                            filtered.length - 1,
                            index + (e.key === "ArrowDown" ? 1 : -1),
                          ),
                        );
                        setSelected(filtered[next].name);
                        setPage(Math.floor(next / 50));
                        requestAnimationFrame(() =>
                          document
                            .querySelector<HTMLElement>(
                              ".catalogue-table tr.selected",
                            )
                            ?.focus(),
                        );
                      }
                      if (e.key === "Enter" && item.status !== "quarantined") {
                        e.preventDefault();
                        void apply(item);
                      }
                    }}
                  >
                    <td title={item.name}>
                      {materialLabel(item)}
                      {project.materials.some((x) => x.name === item.name) && (
                        <span className="catalogue-used"> · 已加入</span>
                      )}
                    </td>
                    <td>{item.collection || "自定义"}</td>
                    <td>{roles[item.role]}</td>
                    <td className="numeric">
                      {item.status === "quarantined" ? "—" : format(item.n)}
                    </td>
                    <td>
                      {item.status === "quarantined"
                        ? "待核查"
                        : item.model === "constant"
                          ? "常数"
                          : item.model === "tabulated"
                            ? "n/k 数据表"
                            : "色散公式"}
                      {!!item.issues?.length && item.status !== "quarantined"
                        ? " *"
                        : ""}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={5} className="catalogue-empty">
                      没有匹配项，请调整关键词或筛选条件。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="catalogue-pagination">
            <span>{filtered.length} 项 · 每页 50 项</span>
            <button
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </button>
          </footer>
        </div>
        <aside className="catalogue-detail">
          {m ? (
            <>
              <h2>{materialLabel(m)}</h2>
              <p className="catalogue-path">{m.provenance?.path || m.name}</p>
              <dl>
                <dt>用途</dt>
                <dd>{roles[m.role]}</dd>
                <dt>数据模型</dt>
                <dd>
                  {m.model === "constant"
                    ? "常数 n/k"
                    : m.model === "tabulated"
                      ? `逐波长 n/k · ${m.point_count || m.samples?.length || 0} 点`
                      : `色散公式 · λ 以 μm 代入`}
                </dd>
                <dt>
                  {m.catalogue_summary
                    ? `预览 ${format(m.preview_nm || 550)} nm`
                    : `参考 ${format(project.settings.reference_nm)} nm`}
                </dt>
                <dd>
                  n {format(selectedNk[0])} / k {format(selectedNk[1])}
                </dd>
                {m.range_nm && (
                  <>
                    <dt>原数据范围</dt>
                    <dd>{m.range_nm.map(format).join("–")} nm</dd>
                  </>
                )}
              </dl>
              {m.status !== "quarantined" && <Preview m={m} />}
              {!!m.issues?.length && (
                <div className="catalogue-issues">
                  <strong>
                    {m.status === "quarantined"
                      ? "待核查 · 禁止用于计算"
                      : "来源提示"}
                  </strong>
                  {m.issues.map((x, i) => (
                    <p key={i}>{x}</p>
                  ))}
                </div>
              )}
              {m.model === "tabulated" && (
                <p className="catalogue-hint">
                  线性插值；表范围外沿用 TFCalc
                  最近端点规则。单点表按常数处理。计算结果会提示超范围使用。
                </p>
              )}
              {!!m.provenance?.comments?.length && (
                <details>
                  <summary>原始数据备注</summary>
                  <pre>{m.provenance.comments.join("\n")}</pre>
                </details>
              )}
              {m.duplicate_of && (
                <p className="catalogue-hint">
                  与 {m.duplicate_of} 光学数据相同；原名称与用途分别保留。
                </p>
              )}
              <button
                className="catalogue-apply"
                disabled={
                  busy ||
                  m.status === "quarantined" ||
                  (!inProject && project.materials.length >= 300)
                }
                onClick={() => void apply(m)}
              >
                {busy
                  ? "正在载入…"
                  : substrate
                    ? "设为当前基底"
                    : inProject
                      ? "更新项目快照"
                      : "加入当前项目"}
              </button>
              <button
                className="catalogue-edit-button"
                disabled={busy || m.status === "quarantined"}
                onClick={() => void edit(m)}
              >
                {m.name.startsWith("TFC/") ? "编辑副本…" : "编辑材料 / 基底…"}
              </button>
              {tab === "project" && m.model === "constant" && (
                <div className="catalogue-edit">
                  <h3>编辑项目常数快照</h3>
                  <label>
                    n{" "}
                    <NumericInput
                      label={`${m.name} 折射率`}
                      min={0.001}
                      max={20}
                      value={m.n}
                      onChange={(v) =>
                        update((p) => {
                          p.materials.find((x) => x.name === m.name)!.n = v;
                          synchronizeBoundaries(p);
                        })
                      }
                    />
                  </label>
                  <label>
                    k{" "}
                    <NumericInput
                      label={`${m.name} 消光系数`}
                      min={0}
                      max={1000000}
                      value={m.k}
                      onChange={(v) =>
                        update((p) => {
                          p.materials.find((x) => x.name === m.name)!.k = v;
                        })
                      }
                    />
                  </label>
                  <label>
                    用途{" "}
                    <select
                      value={m.role}
                      onChange={(e) =>
                        update((p) => {
                          p.materials.find((x) => x.name === m.name)!.role = e
                            .target.value as MaterialRole;
                        })
                      }
                    >
                      {Object.entries(roles).map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    来源{" "}
                    <TextInput
                      value={m.source}
                      onChange={(v) =>
                        update((p) => {
                          p.materials.find((x) => x.name === m.name)!.source =
                            v;
                        })
                      }
                    />
                  </label>
                </div>
              )}
              {m.provenance && (
                <details>
                  <summary>来源校验 SHA-256</summary>
                  <code>{m.provenance.sha256}</code>
                </details>
              )}
            </>
          ) : (
            <p className="catalogue-hint">选择材料查看数据与来源。</p>
          )}
        </aside>
      </div>
      <p className="catalogue-hint">
        每种材料独立保存为 .material.json；基底位于
        materials/substrates。外部修改文件后，请用“导入
        JSON”校验并载入，再保存到共享库。原始目录保持只读，修改时创建自定义副本。
      </p>
      <footer className="catalogue-footer">
        ¹ 列表 n 为数据预览值。选入项目后，计算使用完整
        n/k，光学膜厚按参考波长求值。↑↓ 选择 · Enter / 双击应用
      </footer>
      <input
        ref={fileInput}
        hidden
        type="file"
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            if (f.size > 2000000) throw Error("材料 JSON 不能超过 2 MB");
            const data = JSON.parse(await f.text());
            const items = Array.isArray(data)
              ? data
              : data.materials || (data.name ? [data] : null);
            if (!Array.isArray(items) || !items.length || items.length > 300)
              throw Error("需要 1–300 个材料");
            for (const x of items)
              if (
                typeof x.name !== "string" ||
                !x.name.trim() ||
                !Number.isFinite(x.n) ||
                x.n <= 0 ||
                x.n > 20 ||
                !Number.isFinite(x.k) ||
                x.k < 0 ||
                !(x.role in roles) ||
                x.catalogue_summary ||
                x.status === "quarantined"
              )
                throw Error(
                  "材料需要完整有效的 n/k 与用途，不能导入目录摘要或待核查数据",
                );
            if (
              new Set([...project.materials, ...items].map((x) => x.name))
                .size > 300
            )
              throw Error("单个项目最多 300 种材料");
            const checked = await checkMaterials(items);
            update((p) => {
              for (const x of checked.materials)
                replaceMaterial(p, {
                  ...x,
                  color: x.color || "#6488a6",
                  model: x.model || "constant",
                  source: x.source || "用户 JSON 导入",
                });
            });
            setTab("project");
            setNotice("完整材料快照已加入项目，请保存项目。");
          } catch (err) {
            setError(String(err));
          }
        }}
      />
    </section>
  );
}
