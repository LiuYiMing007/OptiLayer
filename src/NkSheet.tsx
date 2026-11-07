import { useEffect, useState } from "react";
import type { Material } from "./types";
import { readCatalogue } from "./api";
export default function NkSheet({ material }: { material: Material }) {
  const [full, setFull] = useState<Material | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  const materialSignature = JSON.stringify(material);
  useEffect(() => {
    let live = true;
    setFull(null);
    setError("");
    setPage(0);
    if (material.catalogue_summary) {
      void readCatalogue(material.name)
        .then((r) => {
          if (live) setFull(r.material);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    } else setFull(material);
    return () => {
      live = false;
    };
  }, [materialSignature]);
  if (error) return <p role="alert">{error}</p>;
  if (!full) return <p role="status">读取完整 n/k 数据…</p>;
  if (full.model === "tfcalc-formula")
    return (
      <div className="sheet-scroll">
        <table className="engineering-sheet">
          <tbody>
            <tr>
              <th>n 公式类型</th>
              <td>{full.formula?.n_type}</td>
            </tr>
            <tr>
              <th>n 系数</th>
              {full.formula?.coefficients.map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
            <tr>
              <th>k 公式类型</th>
              <td>{full.formula?.k_type}</td>
            </tr>
            <tr>
              <th>k 系数</th>
              {full.formula?.k_coefficients.map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    );
  const samples =
      full.model === "constant"
        ? [[full.preview_nm || 550, full.n, full.k]]
        : full.samples || [],
    safePage = Math.min(page, Math.max(0, Math.ceil(samples.length / 32) - 1)),
    rows = samples.slice(safePage * 32, safePage * 32 + 32);
  return (
    <>
      <div className="sheet-scroll">
        <table className="engineering-sheet" aria-label="完整材料 n/k 数据">
          <thead>
            <tr>
              <th>数据</th>
              {rows.map((_, i) => (
                <th key={i}>{safePage * 32 + i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["波长 (nm)", "折射率 n", "消光系数 k"].map((label, r) => (
              <tr key={r}>
                <th>{label}</th>
                {rows.map((row, c) => (
                  <td key={c}>{row[r]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {samples.length > 32 && (
        <div className="sheet-toolbar">
          <button disabled={!safePage} onClick={() => setPage(safePage - 1)}>
            上一组数据
          </button>
          <span>
            {safePage + 1}/{Math.ceil(samples.length / 32)} · 共{" "}
            {samples.length} 点
          </span>
          <button
            disabled={(safePage + 1) * 32 >= samples.length}
            onClick={() => setPage(safePage + 1)}
          >
            下一组数据
          </button>
        </div>
      )}
    </>
  );
}
export function NkSheetEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [page, setPage] = useState(0);
  const rows = value
      .split(/\r?\n/)
      .filter((r) => r.trim())
      .map((r) =>
        r.includes("\t") ? r.split("\t") : r.trim().split(/[ ,;]+/),
      ),
    pages = Math.max(1, Math.ceil(rows.length / 24)),
    safePage = Math.min(page, pages - 1),
    visible = rows.slice(safePage * 24, safePage * 24 + 24);
  return (
    <div className="compact-tool">
      <div className="sheet-scroll">
        <table className="engineering-sheet">
          <thead>
            <tr>
              <th>数据</th>
              {visible.map((_, i) => (
                <th key={i}>{safePage * 24 + i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["波长 (nm)", "折射率 n", "消光系数 k"].map((label, r) => (
              <tr key={r}>
                <th>{label}</th>
                {visible.map((row, c) => (
                  <td key={c}>
                    <input
                      aria-label={`数据 ${safePage * 24 + c + 1} ${label}`}
                      value={row[r] ?? ""}
                      onChange={(e) => {
                        const next = rows.map((a) => [...a]);
                        next[safePage * 24 + c][r] = e.target.value;
                        onChange(next.map((a) => a.join("\t")).join("\n"));
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sheet-toolbar">
        <button disabled={!safePage} onClick={() => setPage(safePage - 1)}>
          上一页
        </button>
        <span>
          {safePage + 1}/{pages}
        </span>
        <button
          disabled={safePage + 1 >= pages}
          onClick={() => setPage(safePage + 1)}
        >
          下一页
        </button>
        <button
          onClick={() => {
            onChange(value + "\n0\t1.5\t0");
            setPage(Math.floor(rows.length / 24));
          }}
        >
          添加数据点
        </button>
      </div>
    </div>
  );
}
