# Windows 0.2.5 本地验收记录

日期：2026-11-09。源码：`7967206`（含保存/关闭流程修复）。此文件记录实际执行结果，不是正式发布证明。

## 结论

- Windows x64 本地编译、自动检查、九类发布校验和便携打包已完成；ZIP 与 SHA-256 已生成并校验。
- 关闭流程修复已在 Windows 实机复验：保存确认先结束，只保留命名窗口；保存后全部工作窗口隐藏，不再转圈或叠加。
- 已保存项目修改后直接保存关闭、取消命名、取消关闭、保存失败均保持正确状态；同时打开 materialdata/distribution/rear 后选“不保存”也能一次隐藏全部工作窗。
- 基底新增/删除/恢复、组系数联动、外部位置另存为已补验；基底“编辑”入口在本次自动化中未成功打开编辑器，未判通过。
- 未创建 `v0.2.5` 正式标签，未发布 GitHub Release。

## 环境

| 项目 | 实际值 |
|---|---|
| 系统 | Windows 10 22H2，10.0.19045.0，x64 |
| 屏幕 | 1920×1080，96 DPI |
| Node / npm | 24.20.0 / 11.19.0 |
| Python | 3.13.16（项目 `.venv`） |
| Rust / Cargo | 1.99.1 |
| C++ | Visual Studio 2022 Build Tools 17.14，MSVC x64 |
| WebView2 | 157.0.4341.42 |

## 自动检查

全部在本机实际执行，退出码为 0：

| 检查 | 结果 |
|---|---|
| `npm test` | 75 Python + 67 TypeScript + 9 打包/迁移通过 |
| `npm run validate:optics` | 25 项通过；Golden 最大误差 `7.838345368327282e-07` 百分点 |
| `cargo test --locked` | 13 项通过 |
| `npm run build` | 通过 |
| `npm run mobile:build` + `check_mobile_build.mjs` | 通过，1211 条材料/基底，离线资源完整 |
| `npm run engine:bundle` | PyInstaller Windows x64 冻结成功 |
| `npm run tauri -- build ... --no-bundle` | 通过 |
| `stage_release.py` | 生成 `release/Windows/TFC`，含 `TFC.exe` 与 `engine/_internal` |

九类发布校验全部 `all_pass: true`。新窗口 IPC 检查同时确认：

- `all_work_windows_hidden: true`
- `reopen_after_hide_all: true`
- 17 个工具入口及共享状态通过

`workspace-folders` 的 Explorer COM 枚举在上一轮曾超时，本轮直接通过。

## 便携包

- 文件：`release/assets/TFC-0.2.5-Windows-x64-portable.zip`
- 大小：56,212,824 字节
- SHA-256：`f86b9913baa8eaa6be59691512a6f2cc2a4a1a8829eede9e68b9b09f1a771483`
- 含 `TFC/Windows/TFC.exe`、`TFC/Windows/engine/tfc-engine.exe`、`engine/_internal`
- 不含 `Workspace`、`.tfc`、SQLite 或用户材料
- 包内 README 为默认 `.tfd`、内部完整快照和可选 `.tfc.json` 的当前关系

## 真实窗口验收

通过实际启动从新 ZIP 解压的 `TFC/Windows/TFC.exe`、独立测试 Workspace 和真实渲染界面完成：

| 项目 | 结果 | 说明 |
|---|---|---|
| 启动只出现打开文件 | 通过 | 取消后仅剩菜单，主窗未强制出现 |
| 打开有效 TFD | 通过 | 先环境、完成后主光谱与前表面 4 层 |
| 保存并继续（未保存到 Workspace） | 通过 | 保存确认立即结束，只出现一个命名窗，无叠加；命名保存后 TFD 实际写出（QWOT 2、层厚 168.71），全部工作窗隐藏，仅菜单保留 |
| 已保存项目修改后保存关闭 | 通过 | 项目首次保存后再次修改 QWOT 1.8，关闭选保存，直接写回 `持久化保存验收.tfd`，无命名窗，全部工作窗隐藏 |
| 取消命名 | 通过 | 命名窗关闭，项目保持打开且未保存修改仍在 |
| 取消关闭 | 通过 | 保存确认关闭，项目保持打开且未保存修改仍在 |
| 保存失败 | 通过 | 含自定义分布的 TFD 保存被拒绝，提示改用完整 JSON；项目保留、工作窗未隐藏 |
| 不保存时隐藏全部工作窗 | 通过 | 同时打开 materialdata/distribution/rear 后选不保存；可见窗口只剩菜单，`tool_visibility` 全部 false |
| 隐藏后重新打开 | 通过 | 再次打开项目，环境先行和主光谱恢复正常 |
| 组系数联动 | 通过 | 组 1 系数 2；实际厚度显示 337.42/189.00 nm、QWOT 4.0000/2.0000 |
| 基底新增/删除/恢复 | 通过 | 新增 `WIN基底验收`（n=1.52），写入 `materials/substrates/WIN基底验收.material.json`；删除后文件移除，撤销删除后文件恢复。基底“编辑”入口未成功打开编辑器，未判通过 |
| 外部位置另存为 | 通过 | 原生另存为写到 `E:\localsend\0.2.5-Windows验收回传\外部另存验收-7967206.tfd`；TFD 为 4 层，层 1 为 AL2O3/QWOT 2/168.71 |
| 工具窗口 IPC | 通过 | 新增 `all_work_windows_hidden`、`reopen_after_hide_all` 均为 true |
| 整包移动后重启 | 通过（目录移动） | 上一轮在独立目录移动和重开后复算一致；本轮未重复物理换盘 |

实际界面操作通过 WebView2 调试端口完成，读取真实渲染 DOM 并调用真实 Tauri 命令及原生对话框；截图由页面或原生窗口捕获。不能证明显示缩放、物理鼠标手感或 GPU 合成效果。

## 仍未覆盖

- 基底“编辑”入口：本次自动点击未打开编辑器，只确认新增、删除、恢复。
- 物理换盘符、真实断网、原版 TFCalc 实机读取未做。
- 显示缩放 125%/150% 与纯物理鼠标操作未验证。
- 组系数只验证了系数 2 的厚度联动，未逐项操作组筛选/重排。

## 保留问题与观察

1. 全部工具窗口恢复仍比 Mac 记录慢；上一轮约 20 秒，本轮未精确计时，未判为失败。
2. `engine/tests/test_tfd_export.py` 的 UTF-8 读取修正和包内 README 修正已包含在源码/包中。
3. 关闭流程旧缺陷（命名叠加、停在“正在保存…”、三个工具窗残留）在 `7967206` 上未复现，保留旧记录作为历史证据。

## Mac 整合建议

- 从 `7967206` 重新构建 Mac 包并保留本次 ZIP/SHA-256、`release/checks/`、截图和记录。
- 正式发布前仍需物理 SSD 换盘/断电、显示缩放和基底编辑入口复核。
- 不覆盖旧标签，不把本记录当作物理 SSD 或原版 TFCalc 兼容证明。
