export interface SaveChoice {
  name: string;
  format: "tfd" | "json";
}
import { useEffect, useRef, useState } from "react";
export default function SaveProjectDialog({
  initial,
  copy,
  folder,
  finish,
  defaultFormat = "tfd",
}: {
  initial: string;
  copy: boolean;
  folder: string;
  finish: (choice: SaveChoice | null) => void;
  defaultFormat?: "tfd" | "json";
}) {
  const [name, setName] = useState(initial);
  const [format, setFormat] = useState<"tfd" | "json">(defaultFormat);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.select();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="save-project-dialog"
      onCancel={(e) => {
        e.preventDefault();
        finish(null);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) finish({ name: name.trim(), format });
        }}
      >
        <h2>{copy ? "另存项目" : "保存项目"}</h2>
        <label>
          项目名称
          <input
            ref={input}
            autoFocus
            aria-label="保存项目名称"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p>保存位置：{folder}/projects</p>
        <label>
          文件格式
          <select
            aria-label="保存项目格式"
            value={format}
            onChange={(e) => setFormat(e.target.value as "tfd" | "json")}
          >
            <option value="tfd">TFCalc 膜系（.tfd）</option>
            <option value="json">TFC 完整项目（.tfc.json）</option>
          </select>
        </label>
        <p>
          {format === "tfd"
            ? "TFD 使用原版外部材料库，保存前校验材料对应关系；未匹配时不会替换材料或丢弃数据。"
            : "JSON 包含完整材料快照与本软件分析配置。"}{" "}
          同名文件自动增加序号。
        </p>
        <footer>
          <button type="button" onClick={() => finish(null)}>
            取消
          </button>
          <button className="primary" disabled={!name.trim()} type="submit">
            {copy ? "另存为" : "保存"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
