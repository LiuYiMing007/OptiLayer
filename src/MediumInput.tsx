import { useEffect, useId, useRef, useState } from "react";
import { readCatalogue } from "./api";
import { synchronizeBoundaries } from "./model";
import type { Project } from "./types";
/** Commit a known material, catalogue entry or explicit constant n; never invent optical data from a name. */
export default function MediumInput({
  project,
  field,
  label,
  update,
}: {
  project: Project;
  field: "incident_material" | "substrate_material" | "exit_material";
  label: string;
  update: (f: (p: Project) => void) => void;
}) {
  const current =
    project.settings[field] || project.settings.substrate_material;
  const selected = project.materials.find((m) => m.name === current);
  const display =
    selected?.display_name &&
    project.materials.filter(
      (m) =>
        m.display_name === selected.display_name ||
        m.name === selected.display_name,
    ).length === 1
      ? selected.display_name
      : current;
  const [draft, setDraft] = useState(display),
    [error, setError] = useState("");
  const focused = useRef(false),
    cancelled = useRef(false),
    requestId = useRef(0),
    id = useId();
  useEffect(() => {
    if (!focused.current) setDraft(display);
  }, [current, display]);
  async function commit() {
    focused.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const value = draft.trim();
    if (value === current || value === display) return;
    const token = ++requestId.current;
    try {
      if (!value) throw new Error("请输入材料名称或折射率 n");
      const matches = project.materials.filter(
        (m) => m.name === value || m.display_name === value,
      );
      if (matches.length > 1)
        throw new Error("同名材料不唯一，请输入完整材料名");
      let material = matches[0];
      if (!material) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0 && n <= 20)
          material = {
            name: `USER/n=${n}`,
            display_name: `n = ${n}`,
            n,
            k: 0,
            color: "#6b7280",
            role: "medium",
            model: "constant",
            source: "用户手动输入的常数折射率",
          };
        else material = (await readCatalogue(value)).material;
      }
      if (token !== requestId.current) return;
      if (material.status === "quarantined")
        throw new Error("该材料数据异常，请先修正材料定义");
      const resolved = material;
      update((p) => {
        if (!p.materials.some((m) => m.name === resolved.name))
          p.materials.push(resolved);
        p.settings[field] = resolved.name;
        if (
          field === "exit_material" &&
          (p.settings.substrate_model || "semi_infinite") === "semi_infinite"
        ) {
          p.settings.substrate_model = "incoherent";
          p.settings.substrate_thickness_mm ||= 1;
        }
        synchronizeBoundaries(p);
      });
      setDraft(resolved.name);
      setError("");
    } catch (e) {
      if (token === requestId.current) setError(String(e));
    }
  }
  return (
    <div className="medium-input">
      <input
        placeholder="材料名称 / 折射率 n"
        aria-label={label}
        aria-invalid={!!error}
        title="输入材料完整名称，或输入常数折射率 n（例如 1 或 1.52）"
        list={id}
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          ++requestId.current;
          setDraft(e.target.value);
          setError("");
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            cancelled.current = true;
            ++requestId.current;
            setDraft(display);
            setError("");
            focused.current = false;
            e.currentTarget.blur();
          }
        }}
      />
      <datalist id={id}>
        {project.materials.map((m) => (
          <option key={m.name} value={m.name}>
            {m.display_name || m.name}
          </option>
        ))}
      </datalist>
      {error && (
        <small role="alert" className="inline-error">
          {error}
        </small>
      )}
    </div>
  );
}
