export interface OfflineReport {
  cache: string;
  complete: boolean;
  cached: number;
  expected: number;
  materials: number;
}
export function offlineResourceUrls(
  base: string,
  modules: string[],
  styles: string[],
): string[] {
  const origin = new URL(base).origin;
  return [
    ...new Set(
      [
        "./mobile.html",
        "./icon.png",
        "./apple-touch-icon.png",
        "./manifest.webmanifest",
        ...modules,
        ...styles,
      ]
        .map((path) => new URL(path, base).href)
        .filter((url) => new URL(url).origin === origin),
    ),
  ];
}
/** Inspect CacheStorage in the foreground; a sleeping mobile worker need not answer. */
export async function checkOfflineCache(
  materials: number,
): Promise<OfflineReport> {
  if (!window.isSecureContext || !("serviceWorker" in navigator))
    throw new Error("需要通过 HTTPS 打开，局域网 HTTP 无法安装离线资源");
  let timer: number | undefined;
  const inspect = async (): Promise<OfflineReport> => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active)
      throw new Error("离线资源尚未安装，请保持联网等待后重试");
    const base = new URL("./", document.baseURI).href;
    const expected = offlineResourceUrls(
      base,
      [
        ...document.querySelectorAll<HTMLScriptElement>(
          'script[type="module"][src]',
        ),
      ].map((s) => s.src),
      [
        ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      ].map((s) => s.href),
    );
    const prefix = `tfc-mobile-${encodeURIComponent(new URL(registration.scope).pathname)}-`;
    const names = (await caches.keys())
      .filter((name) => name.startsWith(prefix))
      .reverse();
    let best: OfflineReport = {
      cache: "尚无本版本缓存",
      complete: false,
      cached: 0,
      expected: expected.length,
      materials,
    };
    for (const name of names) {
      const cache = await caches.open(name);
      const hits = await Promise.all(
        expected.map((url) => cache.match(url, { ignoreVary: true })),
      );
      const cached = hits.filter(Boolean).length;
      const report = {
        cache: name,
        complete: cached === expected.length,
        cached,
        expected: expected.length,
        materials,
      };
      if (report.complete) return report;
      if (cached > best.cached) best = report;
    }
    return best;
  };
  try {
    return await Promise.race([
      inspect(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () =>
            reject(
              new Error("检查超过 8 秒，请保持联网，关闭页面后重新打开再试"),
            ),
          8000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
