import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  FolderOpen,
  Search,
  ChevronRight,
  ArrowLeft,
  Download,
  Info,
} from "lucide-react";
import catalogue from "../../engine/data/tfcalc-catalogue.json";
import type { Material, Project } from "../types";
import { materialAt, materialLabel, matchesMaterial } from "../materials";
import { parsePocketProject, projects, type PocketProject } from "./data";
import "./mobile.css";
const materials = catalogue.materials as Material[];
const fmt = (n: number, digits = 5) =>
  Number.isFinite(n)
    ? n.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
function Curve({ material }: { material: Material }) {
  const points = material.preview || material.samples || [];
  const valid = points.filter((p) => p.length >= 3 && p.every(Number.isFinite));
  if (valid.length < 2 || material.status === "quarantined") return null;
  const x0 = valid[0][0],
    x1 = valid.at(-1)![0];
  const maxN = Math.max(...valid.map((p) => p[1])),
    minN = Math.min(...valid.map((p) => p[1]));
  const path = valid
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${36 + ((p[0] - x0) / (x1 - x0)) * 292},${135 - ((p[1] - minN) / (maxN - minN || 1)) * 106}`,
    )
    .join(" ");
  return (
    <figure>
      <figcaption>折射率 n · 数据预览</figcaption>
      <svg viewBox="0 0 360 172" role="img" aria-label="折射率随波长变化预览">
        <path d="M36 20V140H330" fill="none" stroke="#b5c0cc" />
        <path d={path} fill="none" stroke="var(--curve-n)" strokeWidth="2" />
        <text x="36" y="160">
          {fmt(x0, 0)} nm
        </text>
        <text x="265" y="160">
          {fmt(x1, 0)} nm
        </text>
        <text x="2" y="29">
          {fmt(maxN, 2)}
        </text>
        <text x="2" y="139">
          {fmt(minN, 2)}
        </text>
      </svg>
      <small>预览采样；精确值见下方波长查询。</small>
    </figure>
  );
}
function MaterialDetail({ m, back }: { m: Material; back: () => void }) {
  const range =
    m.range_nm ||
    (m.samples?.length ? [m.samples[0][0], m.samples.at(-1)![0]] : undefined);
  const [nm, setNm] = useState(
    String(range ? Math.max(range[0], Math.min(550, range[1])) : 550),
  );
  const wavelength = Number(nm),
    inRange =
      nm.trim() !== "" &&
      Number.isFinite(wavelength) &&
      wavelength > 0 &&
      (!range || (wavelength >= range[0] && wavelength <= range[1]));
  const usable = m.status !== "quarantined" && inRange;
  const [n, k] = usable ? materialAt(m, wavelength) : [NaN, NaN];
  const [page, setPage] = useState(0),
    rows = m.samples || [];
  return (
    <>
      <button className="back" onClick={back}>
        <ArrowLeft size={18} />
        材料库
      </button>
      <h1>{materialLabel(m)}</h1>
      <p className="muted">
        {m.collection} · {m.role === "film" ? "膜层材料" : "基底 / 介质"}
      </p>
      {m.status === "quarantined" && (
        <p role="alert" className="notice">
          此数据有异常，保留用于查阅，不作为可用光学数据。{m.issues?.join("；")}
        </p>
      )}
      <Curve material={m} />
      <section>
        <h2>光学常数查询</h2>
        <label className="property">
          波长 / nm
          <input
            type="number"
            inputMode="decimal"
            value={nm}
            onChange={(e) => setNm(e.target.value)}
          />
        </label>
        <div className="readings">
          <span>
            折射率 n<strong>{fmt(n, 7)}</strong>
          </span>
          <span>
            消光系数 k<strong>{fmt(k, 8)}</strong>
          </span>
        </div>
        {!inRange && (
          <p role="alert">请输入有效波长范围内的数值，不进行范围外推算。</p>
        )}
        <p className="muted">
          {range ? `${fmt(range[0])}–${fmt(range[1])} nm` : "常数模型"} ·{" "}
          {m.model === "tabulated"
            ? "原始数据线性插值"
            : m.model === "tfcalc-formula"
              ? "原始色散公式"
              : "常数"}
        </p>
      </section>
      <section>
        <h2>数据来源</h2>
        <p className="break">{m.source}</p>
        <p className="muted break">{m.name}</p>
        {m.provenance?.comments.filter(Boolean).map((c, i) => (
          <p key={i}>{c}</p>
        ))}
        <details>
          <summary>来源校验与公式</summary>
          <p className="break">SHA256 {m.provenance?.sha256 || "未提供"}</p>
          {m.formula && <pre>{JSON.stringify(m.formula, null, 2)}</pre>}
        </details>
      </section>
      {rows.length > 0 && (
        <section>
          <h2>原始数据 · {rows.length} 点</h2>
          <table>
            <thead>
              <tr>
                <th>λ / nm</th>
                <th>n</th>
                <th>k</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(page * 30, page * 30 + 30).map((r, i) => (
                <tr key={i}>
                  <td>{fmt(r[0])}</td>
                  <td>{fmt(r[1], 7)}</td>
                  <td>{fmt(r[2], 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span>
              {page + 1} / {Math.ceil(rows.length / 30)}
            </span>
            <button
              disabled={(page + 1) * 30 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </section>
      )}
    </>
  );
}
function ProjectDetail({ p, back }: { p: Project; back: () => void }) {
  const lookup = new Map(p.materials.map((m) => [m.name, m]));
  function download() {
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = `${p.name.replace(/[\\/:*?"<>|]/g, "_")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <>
      <button className="back" onClick={back}>
        <ArrowLeft size={18} />
        项目
      </button>
      <h1>{p.name}</h1>
      <p className="muted">手机中的只读副本 · {p.layers.length} 层</p>
      <button onClick={download}>
        <Download size={16} />
        导出项目副本
      </button>
      <section>
        <h2>计算参数</h2>
        <dl>
          <dt>波长范围</dt>
          <dd>
            {p.settings.start_nm}–{p.settings.end_nm} nm
          </dd>
          <dt>参考波长</dt>
          <dd>{p.settings.reference_nm} nm</dd>
          <dt>入射角</dt>
          <dd>{p.settings.angle_deg}°</dd>
          <dt>偏振</dt>
          <dd>
            {
              { unpolarized: "非偏振", s: "S 偏振", p: "P 偏振" }[
                p.settings.polarization
              ]
            }
          </dd>
          <dt>基底</dt>
          <dd>
            {lookup.has(p.settings.substrate_material)
              ? materialLabel(lookup.get(p.settings.substrate_material)!)
              : p.settings.substrate_material}
          </dd>
        </dl>
      </section>
      <section>
        <h2>膜层结构</h2>
        <p className="muted">按原项目顺序：基底 → 空气</p>
        <table>
          <thead>
            <tr>
              <th>层</th>
              <th>材料</th>
              <th>厚度 / nm</th>
            </tr>
          </thead>
          <tbody>
            {p.layers.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="break">
                  {materialLabel(lookup.get(l.material)!)}
                </td>
                <td>{fmt(l.thickness_nm, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="notice">
        此框架只查看已保存的膜系与参数，尚未接入手机端光谱计算。桌面项目 JSON
        不包含已计算光谱，因此这里不生成或模拟 R/T 曲线。
      </p>
    </>
  );
}
function App() {
  const [tab, setTab] = useState("materials"),
    [query, setQuery] = useState(""),
    [collection, setCollection] = useState("all"),
    [status, setStatus] = useState("ready"),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Material | null>(null),
    [saved, setSaved] = useState<PocketProject[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [message, setMessage] = useState(""),
    [offline, setOffline] = useState("尚未准备离线资源");
  useEffect(() => {
    projects()
      .then(setSaved)
      .catch(() =>
        setMessage("手机存储不可用，无法保存项目。请检查浏览器设置。"),
      );
    if (!import.meta.env.PROD) {
      setOffline("开发预览 · 离线功能请使用正式构建和 HTTPS");
      return;
    }
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      setOffline("需要 HTTPS 才能准备离线资源");
      return;
    }
    let active = true;
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (active) setOffline("材料库与界面已准备离线使用");
      })
      .catch(() => {
        if (active) setOffline("离线准备失败，请联网刷新后重试");
      });
    return () => {
      active = false;
    };
  }, []);
  const filtered = materials.filter(
    (m) =>
      (collection === "all" || m.collection === collection) &&
      (status === "all" || m.status === status) &&
      matchesMaterial(m, query),
  );
  async function load(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error("项目文件不能超过 10 MB");
      const p = parsePocketProject(await file.text());
      if (saved.some((s) => s.project.id === p.id)) {
        setMessage("该项目已存在；请先导出备份并移除手机副本，再导入新版本。");
        return;
      }
      setSaved(
        await projects({
          save: { project: p, importedAt: new Date().toISOString() },
        }),
      );
      setProject(p);
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "导入失败");
    }
  }
  function switchTab(t: string) {
    setTab(t);
    setSelected(null);
    setProject(null);
    setMessage("");
    window.scrollTo(0, 0);
  }
  return (
    <div className="pocket">
      <header>
        <span className="brand">
          TFC <b>随行</b>
        </span>
        <span className="edition">iPhone 预览框架</span>
      </header>
      <main>
        {message && (
          <p role="alert" className="notice">
            {message}
            <button onClick={() => setMessage("")}>关闭</button>
          </p>
        )}
        {tab === "materials" &&
          (selected ? (
            <MaterialDetail
              key={selected.name}
              m={selected}
              back={() => setSelected(null)}
            />
          ) : (
            <>
              <h1>材料与基底</h1>
              <p className="muted">
                {materials.length} 条原始记录 · {catalogue.status_counts.ready}{" "}
                条可用
              </p>
              <div className="search">
                <Search size={18} />
                <input
                  aria-label="搜索材料"
                  placeholder="名称、玻璃牌号、来源…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
              <div className="filters">
                <select
                  aria-label="材料分类"
                  value={collection}
                  onChange={(e) => {
                    setCollection(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">全部分类</option>
                  {Object.entries(catalogue.counts).map(([name, count]) => (
                    <option key={name} value={name}>
                      {name} · {count}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="数据状态"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="ready">可用数据</option>
                  <option value="quarantined">异常记录</option>
                  <option value="all">全部记录</option>
                </select>
              </div>
              <div className="list-caption">
                {filtered.length} 条匹配 <span>每页 40 条</span>
              </div>
              <div className="list">
                {filtered.slice(page * 40, page * 40 + 40).map((m) => (
                  <button
                    className="row"
                    key={m.name}
                    onClick={() => {
                      setSelected(m);
                      window.scrollTo(0, 0);
                    }}
                  >
                    <span>
                      <strong>{materialLabel(m)}</strong>
                      <small>
                        {m.collection} ·{" "}
                        {m.status === "quarantined"
                          ? "异常数据"
                          : m.model === "tabulated"
                            ? `${m.samples?.length || 0} 个数据点`
                            : "色散 / 常数"}
                      </small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                ))}
                {!filtered.length && (
                  <p className="empty">没有找到匹配材料，请换个关键词。</p>
                )}
              </div>
              <div className="pager">
                <button
                  disabled={page === 0}
                  onClick={() => {
                    setPage(page - 1);
                    window.scrollTo(0, 0);
                  }}
                >
                  上一页
                </button>
                <span>
                  {filtered.length ? page + 1 : 0} /{" "}
                  {Math.ceil(filtered.length / 40)}
                </span>
                <button
                  disabled={(page + 1) * 40 >= filtered.length}
                  onClick={() => {
                    setPage(page + 1);
                    window.scrollTo(0, 0);
                  }}
                >
                  下一页
                </button>
              </div>
            </>
          ))}
        {tab === "projects" &&
          (project ? (
            <ProjectDetail p={project} back={() => setProject(null)} />
          ) : (
            <>
              <h1>我的项目</h1>
              <p className="muted">只读项目副本，保存在当前设备中</p>
              <label className="import-button">
                <FolderOpen size={18} />
                从“文件”导入项目 JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    void load(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {!saved.length && (
                <div className="empty">
                  <FolderOpen size={32} />
                  <h2>把膜系带在身边</h2>
                  <p>
                    在桌面版导出项目 JSON，通过 AirDrop、iCloud Drive
                    或其他文件传输方式送到手机，然后导入。
                  </p>
                </div>
              )}
              <div className="list">
                {saved.map((s) => (
                  <div className="project-row" key={s.project.id}>
                    <button
                      className="row"
                      onClick={() => setProject(s.project)}
                    >
                      <span>
                        <strong>{s.project.name}</strong>
                        <small>
                          {s.project.layers.length} 层 ·{" "}
                          {s.project.settings.reference_nm} nm
                        </small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                    <details>
                      <summary>副本管理</summary>
                      <p>
                        移除仅影响此手机，电脑原项目不会删除。需要保留时，请先打开项目并导出。
                      </p>
                      <button
                        onClick={() => {
                          void projects({ remove: s.project.id })
                            .then(setSaved)
                            .catch(() => setMessage("移除失败，请重试"));
                        }}
                      >
                        移除此手机副本
                      </button>
                    </details>
                  </div>
                ))}
              </div>
            </>
          ))}
        {tab === "about" && (
          <>
            <h1>随时查阅，随处研究</h1>
            <section>
              <h2>离线状态</h2>
              <p role="status">{offline}</p>
              <p className="muted">
                首次使用需完整下载。iPhone Safari 中选择“分享 →
                添加到主屏幕”，可像应用一样打开。
              </p>
            </section>
            <section>
              <h2>内置资料</h2>
              <p>
                完整接入桌面版 TFCalc
                材料与基底库：MATERIAL、SUBSTRAT、SCHOTT、SOPRA。保留原始表格、色散公式、有效波长范围及来源。
              </p>
              <p>
                25
                条异常记录单独标记，不把缺失数据伪装成有效数值。材料查询复用桌面显示函数，不运行薄膜计算。
              </p>
            </section>
            <section>
              <h2>项目与隐私</h2>
              <p>
                项目仅保存在本机浏览器存储中，不上传到服务器，不自动同步。浏览器清理数据或系统回收存储可能移除副本，请保留电脑原件。
              </p>
              <p>
                当前支持项目 JSON 查阅及原样导出；暂不支持 TFD 直接导入、SQLite
                工作区、项目编辑和光谱计算。
              </p>
            </section>
            <p className="muted">
              TFC 随行 · 框架预览 0.1 · 材料库 {catalogue.catalogue_version}
            </p>
          </>
        )}
      </main>
      <nav aria-label="主要导航">
        {[
          ["materials", "材料", BookOpen],
          ["projects", "项目", FolderOpen],
          ["about", "说明", Info],
        ].map(([id, label, Icon]) => {
          const I = Icon as typeof Info;
          return (
            <button
              key={String(id)}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => switchTab(String(id))}
            >
              <I size={21} />
              {String(label)}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
