/** Strict legacy TFD decoding. JSON remains UTF-8; never replace invalid bytes. */
export async function readImportFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8-sig",
    };
  } catch {
    if (!file.name.toLowerCase().endsWith(".tfd"))
      throw Error("JSON 文件必须使用 UTF-8 编码");
    try {
      return {
        content: new TextDecoder("gb18030", { fatal: true }).decode(bytes),
        encoding: "gb18030",
      };
    } catch {
      throw Error("TFD 无法按 UTF-8 或 GB18030 无损解码");
    }
  }
}
