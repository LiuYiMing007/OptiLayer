import type { Material, Project } from "./types";
export const initialMaterials: Material[] = [
  {
    name: "TA2O5_REF",
    n: 2.1,
    k: 0,
    color: "#16a18f",
    role: "film",
    model: "constant",
    source: "合成验证常数；非真实镀膜材料色散",
  },
  {
    name: "SIO2_REF",
    n: 1.46,
    k: 0,
    color: "#829cdd",
    role: "film",
    model: "constant",
    source: "合成验证常数；非真实镀膜材料色散",
  },
  {
    name: "AIR",
    n: 1,
    k: 0,
    color: "#b7c9d7",
    role: "medium",
    model: "constant",
    source: "理想空气参考介质",
  },
  {
    name: "GLASS_REF",
    n: 1.52,
    k: 0,
    color: "#b29b77",
    role: "substrate",
    model: "constant",
    source: "玻璃参考常数 n=1.52；非 K9/BK7 厂商数据",
  },
];
export function referenceProject(): Project {
  return {
    schema_version: 1,
    id: crypto.randomUUID(),
    name: "550 nm · 四层参考膜系",
    layer_order: "substrate_to_air",
    settings: {
      start_nm: 400,
      end_nm: 700,
      step_nm: 1,
      reference_nm: 550,
      angle_deg: 0,
      polarization: "unpolarized",
      incident_n: 1,
      substrate_n: 1.52,
      incident_material: "AIR",
      substrate_material: "GLASS_REF",
    },
    materials: structuredClone(initialMaterials),
    layers: [
      ["TA2O5_REF", 65.47619],
      ["SIO2_REF", 94.178082],
      ["TA2O5_REF", 65.47619],
      ["SIO2_REF", 94.178082],
    ].map(([material, thickness_nm]) => ({
      id: crypto.randomUUID(),
      material: String(material),
      thickness_nm: Number(thickness_nm),
    })),
  };
}
export const clone = <T>(value: T): T => structuredClone(value);
