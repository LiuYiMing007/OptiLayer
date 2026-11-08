import { useEffect, useId, useRef, useState } from "react";
import { resolveStackMaterial } from "./stackMaterialChoices";
import { readCatalogue } from "./api";
import type { Material, Project } from "./types";
import type { ToolIntent } from "./tools/useToolHost";
export default function StackMaterialInput({
  project,
  library,
  value,
  label,
  select,
  send,
  pending,
}: {
  project: Project;
  library: Material[];
  value: string;
  label: string;
  select: (name: string) => void;
  pending: (value: boolean) => void;
  send: (a: ToolIntent) => Promise<void>;
}) {
  const choices = [
    ...project.materials,
    ...library.filter((m) => !project.materials.some((p) => p.name === m.name)),
  ].filter(
    (m) =>
      (m.role === "film" || m.role === "all") && m.status !== "quarantined",
  );
  const display = choices.find((m) => m.name === value)?.display_name || value;
  const [draft, setDraft] = useState(display),
    [error, setError] = useState("");
  const id = useId();
  const committing = useRef(false);
  useEffect(() => setDraft(display), [value, display]);
  async function commit() {
    if (committing.current) return;
    if (draft.trim() === display || draft.trim() === value) {
      pending(false);
      return;
    }
    committing.current = true;
    pending(true);
    try {
      const name = draft.trim();
      const selected = resolveStackMaterial(name, choices);
      if (!project.materials.some((m) => m.name === selected.name)) {
        const material = selected.catalogue_summary
          ? (await readCatalogue(selected.name)).material
          : selected;
        await send({
          kind: "patch",
          patches: [
            {
              kind: "material",
              name: material.name,
              expected: null,
              value: material,
            },
          ],
        });
      }
      select(selected.name);
      setError("");
      pending(false);
    } catch (e) {
      setError(String(e));
    } finally {
      committing.current = false;
    }
  }
  return (
    <>
      <input
        aria-label={label}
        list={id}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          pending(true);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") {
            if (committing.current) return;
            pending(false);
            setDraft(display);
            setError("");
          }
        }}
      />
      <datalist id={id}>
        {choices.map((m) => (
          <option key={m.name} value={m.name}>
            {m.display_name || m.name}
          </option>
        ))}
      </datalist>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
