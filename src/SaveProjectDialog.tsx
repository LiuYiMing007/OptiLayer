import { useEffect, useRef, useState } from "react";
export default function SaveProjectDialog({
  initial,
  copy,
  folder,
  finish,
}: {
  initial: string;
  copy: boolean;
  folder: string;
  finish: (name: string | null) => void;
}) {
  const [name, setName] = useState(initial);
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
          if (name.trim()) finish(name.trim());
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
        <p>
          以项目名称生成 .tfc.json
          文件；同名项目自动增加序号。内部编号用于保持项目关联。
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
