import { useState } from "react";
import { checkOfflineCache, type OfflineReport } from "./offline";
export default function DeviceCheck({
  materialCount,
}: {
  materialCount: number;
}) {
  const [report, setReport] = useState<OfflineReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setReport(await checkOfflineCache(materialCount));
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "检查失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>设备与离线验收</h2>
      <dl>
        <dt>连接方式</dt>
        <dd>{window.isSecureContext ? "安全连接" : "普通 HTTP"}</dd>
        <dt>打开方式</dt>
        <dd>{standalone ? "主屏幕应用" : "浏览器页面"}</dd>
      </dl>
      <p>
        <button
          onClick={() => {
            void check();
          }}
          disabled={busy}
        >
          {busy ? "正在检查…" : "检查本机离线资源"}
        </button>
      </p>
      {error && <p role="alert">{error}</p>}
      {report && (
        <div role="status">
          <p>
            {report.complete
              ? "离线资源完整"
              : "离线资源不完整，请联网重新下载"}
            ：{report.cached} / {report.expected} 个文件；{report.materials}{" "}
            条材料记录。
          </p>
          <small className="break">缓存版本 {report.cache}</small>
        </div>
      )}
      <p className="muted">
        检查缓存完整不等于通过真机断网验收。请添加到主屏幕，关闭 Wi-Fi
        和蜂窝网络后，从主屏幕重新打开，搜索材料并读取已导入项目，再点击本机检查。
      </p>
    </section>
  );
}
