import type { Layer, Project } from "./types.ts";
import { materialAt } from "./materials.ts";
export interface StackSymbol {
  symbol: string;
  material: string;
  thickness: number;
  unit: "qw" | "nm";
  group: number;
}
// Bounded recursive descent: no evaluation of executable input.
export function generateStack(
  p: Project,
  expression: string,
  symbols: StackSymbol[],
  newId: () => string,
): Layer[] {
  if (!expression.trim() || expression.length > 32000)
    throw Error("请输入膜堆表达式（最多 32000 字符）");
  const tokens =
    expression.match(
      /G\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Z]|[()^]|\S/g,
    ) || [];
  const aliases = new Map(symbols.map((s) => [s.symbol, s]));
  if (
    aliases.size !== symbols.length ||
    symbols.some((s) => !/^[A-Z]$/.test(s.symbol))
  )
    throw Error("符号必须为不重复的单个大写字母");
  let pos = 0;
  function read(depth: number, initialGroup?: number): Omit<Layer, "id">[] {
    if (depth > 16) throw Error("括号嵌套过深");
    const result: Omit<Layer, "id">[] = [];
    let group = initialGroup;
    while (pos < tokens.length && tokens[pos] !== ")") {
      if (/^G\d+$/.test(tokens[pos])) {
        group = Number(tokens[pos++].slice(1));
        if (
          group < 1 ||
          group > 999 ||
          p.group_factors?.[String(group)] === undefined
        )
          throw Error("请先在组窗口定义该组");
        continue;
      }
      let multiplier = 1;
      if (/^(?:\d|\.)/.test(tokens[pos])) {
        multiplier = Number(tokens[pos++]);
        if (!Number.isFinite(multiplier) || multiplier < 0)
          throw Error("膜厚倍数无效");
      }
      const token = tokens[pos++];
      let part: Omit<Layer, "id">[];
      if (token === "(") {
        part = read(depth + 1, group);
        if (!part.length || tokens[pos++] !== ")" || tokens[pos++] !== "^")
          throw Error("括号后需要 ^ 和重复次数");
        const count = Number(tokens[pos++]);
        if (
          !Number.isInteger(count) ||
          count < 1 ||
          count > 500 ||
          part.length * count > 500
        )
          throw Error("重复次数或总膜层超过 500 层");
        part = Array.from({ length: count }, () => part).flat();
      } else {
        const s = aliases.get(token),
          m = p.materials.find((m) => m.name === s?.material);
        if (!s || !m)
          throw Error(`未定义的符号或项目材料：${token || "表达式末尾"}`);
        const g = group ?? s.group,
          factor = g ? (p.group_factors?.[String(g)] ?? 1) : 1;
        if (
          !Number.isInteger(g) ||
          g < 0 ||
          g > 999 ||
          !Number.isFinite(s.thickness) ||
          s.thickness < 0
        )
          throw Error("符号厚度或组号无效");
        const n = materialAt(m, p.settings.reference_nm)[0];
        const d =
          s.unit === "nm"
            ? s.thickness
            : (s.thickness * p.settings.reference_nm) / (4 * n);
        part = [{ material: m.name, thickness_nm: d * factor, group: g }];
      }
      result.push(
        ...part.map((l) => ({
          ...l,
          thickness_nm: l.thickness_nm * multiplier,
        })),
      );
      if (
        result.length > 500 ||
        result.some(
          (l) =>
            !Number.isFinite(l.thickness_nm) ||
            l.thickness_nm < 0 ||
            l.thickness_nm > 1e6,
        )
      )
        throw Error("膜层数或膜厚超过有效范围");
    }
    return result;
  }
  const layers = read(0);
  if (pos !== tokens.length || !layers.length)
    throw Error("括号不匹配或没有生成膜层");
  return layers.map((l) => ({ ...l, id: newId() }));
}
export function replaceStack(
  p: Project,
  side: "front" | "back",
  expected: Layer[],
  layers: Layer[],
): Project {
  const actual = side === "front" ? p.layers : p.back_layers || [];
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error("膜层已更新，请重新预览后生成");
  if (
    side === "back" &&
    (p.settings.substrate_model || "semi_infinite") === "semi_infinite"
  )
    throw Error("请先在环境中启用有限厚基底");
  if (
    !layers.length ||
    layers.length > 500 ||
    new Set(layers.map((l) => l.id)).size !== layers.length ||
    layers.some(
      (l) =>
        !l.id ||
        [...p.layers, ...(p.back_layers || [])].some(
          (old) => old.id === l.id,
        ) ||
        !p.materials.some((m) => m.name === l.material) ||
        !Number.isFinite(l.thickness_nm) ||
        l.thickness_nm < 0 ||
        l.thickness_nm > 1e6 ||
        !Number.isInteger(l.group ?? 0) ||
        (l.group ?? 0) < 0 ||
        (l.group ?? 0) > 999,
    )
  )
    throw Error("生成膜堆无效");
  return {
    ...structuredClone(p),
    ...(side === "front" ? { layers } : { back_layers: layers }),
  };
}
