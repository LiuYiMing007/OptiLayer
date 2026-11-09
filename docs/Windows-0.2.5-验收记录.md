# Windows 0.2.5 本地验收记录

日期：2026-11-09。源码基线：`12994e8`，加同分支后续提交中的 Windows 测试读取修正、包内 README 修正、验收记录与截图说明修正。此文件记录实际执行结果，不是正式发布证明。

## 结论

- Windows x64 本地编译、自动检查和便携打包已完成；ZIP 与 SHA-256 已生成并校验。
- 真实窗口验收主要项已完成，包括膜堆 AL2O3、材料增删恢复、命名保存、TFD 重开复算、整包移动和最近项目失效提示。
- 仍有两个疑点未判通过：修改后关闭选“保存并继续”未观察到 TFD 时间更新；选“不保存”后 3 个工具窗口仍报告可见。需在普通前台再复验。
- 未创建 `v0.2.5` 正式标签，未发布 GitHub Release。Mac 不应仅凭本记录发布正式版。

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
| `cargo test --locked` | 13 项通过（交接文档写的 14 项与当前源码实际数量不符，以实际 13 项为准） |
| `npm run build` | 通过 |
| `npm run mobile:build` + `check_mobile_build.mjs` | 通过，1211 条材料/基底，离线资源完整 |
| `npm run engine:bundle` | PyInstaller Windows x64 冻结成功 |
| `npm run tauri -- build ... --no-bundle` | 通过，生成 `tfc-for-mac.exe` |
| `stage_release.py` | 生成 `release/Windows/TFC`，含 `TFC.exe` 与 `engine/_internal` |

发布校验九类报告全部为 `all_pass: true`：

- `native-menu.json`
- `window-ipc.json`（17 个工具入口/共享状态）
- `catalogue.json`（1211 条，1186 ready，25 quarantined）
- `project-flow.json`（TFD 记录保真，R/T 误差 0）
- `tfd-import.json`（GB18030、组系数、有限环境）
- `environment.json`（独立实现最大误差 `6.39e-13` 百分点）
- `packaged-workspace.json`（121 点光谱精确复算）
- `workspace-folders.json`（8 个实际目录窗口确认）
- `portable-location.json`（整体搬迁、相对路径、缺失工作区不重建）

`workspace-folders` 首次运行在 Explorer COM 枚举处超时；重启桌面后原命令复跑通过，报告已生成。该超时未复现为产品错误。

## 便携包

- 文件：`release/assets/TFC-0.2.5-Windows-x64-portable.zip`
- 大小：56,200,715 字节
- SHA-256：`7ed54a1aa9038a6f0269072de10cfbe0852a5e3e25962b27142568039c545537`
- 内容：158 个条目；含 `TFC/Windows/TFC.exe`、`TFC/Windows/engine/tfc-engine.exe`、`engine/_internal`；不含 `Workspace`、`.tfc`、数据库或用户材料。
- 包内 `README.txt` 已改为默认 `.tfd`、内部完整快照和可选 `.tfc.json` 的当前关系；旧“项目 JSON”描述已移除。

## 真实窗口验收

通过实际启动解压后的 `TFC/Windows/TFC.exe`、独立测试 Workspace 和真实菜单/窗口操作完成：

| 项目 | 结果 | 说明 |
|---|---|---|
| 启动只出现打开文件 | 通过 | 打开对话框默认定位 `Workspace/projects`；取消后仅剩菜单窗口，主窗未强制出现 |
| 菜单可用 | 通过 | 文件菜单可展开，新建/打开/最近/关闭/保存等项可见；主窗未因打开菜单被强制显示 |
| 打开有效 TFD | 通过 | 先出现环境窗口；完成后主光谱与前表面 4 层，材料为 `TA2O5_REF/SIO2_REF` |
| 工具窗口打开/移动/关闭/再开 | 通过，但有启动延迟 | 配置全部窗口后实际出现光谱 + 13 个工具窗；逐窗移动坐标已记录；13 个工具窗关闭后仅主窗+菜单保留；关闭项目再重开可恢复。窗口约 20 秒才全部出现 |
| 关闭项目（未修改） | 通过 | 不弹保存提示，工作窗口全部隐藏，仅菜单保留 |
| 关闭项目（已修改） | 部分通过，有疑点 | 出现“保存项目更改？”；“取消”留在当前项目通过；“不保存”后主光谱隐藏，但 `materialdata/distribution/rear` 三个工具窗仍报告可见；“保存并继续”后项目关闭，但 TFD 修改时间未更新。两项需复查，暂不判为通过 |
| 最近项目子菜单 | 通过 | 可直接重开文件并先进入环境；整包移动后最近项失效，界面明确报“系统找不到指定的文件 (os error 2)”，没有误开其它项目 |
| 交互式分析联动 | 通过 | 前表面 QWOT 1→2，物理厚度 65.48→130.95 nm，曲线同步变化；撤销恢复 65.48/1.0000，重做恢复 130.95/2.0000；组系数联动未单独操作 |
| 结果显示光谱曲线 | 通过 | 关闭光谱后主窗隐藏；调用“结果显示光谱曲线”命令后同一项目、同一光谱重新显示 |
| 工具栏“项目”原生对话框 | 通过 | 原生对话框默认定位 `Workspace/projects`；取消后当前项目名和光谱指标不变 |
| 膜堆表达式 H→AL2O3 | 通过 | 新项目 H=TA2O5、L=SIO2；H 手工输入 AL2O3 后先预览再生成，得到 AL2O3/SIO2 四层（84.36/94.50 nm，1.0000 QWOT），T@550=99.9683%；无效名被拒绝且“预览/替换”禁用 |
| 材料/基底逐项编辑 | 材料通过，基底部分 | 新增 `WIN验收材料`（n=2.05）并写入 `materials/films/WIN验收材料.material.json`；搜索、删除、恢复均成功，未出现“自定义”分类；基底窗口可列出 814 条并打开数据文件夹，但未做基底新增/编辑 |
| 纵轴范围、两位物理厚度、QWOT 四位 | 通过 | 自定义纵轴 90–100% 已应用；膜层表显示 `84.36`/`94.50` nm 和 `1.0000` QWOT |
| 命名保存、另存为、重新打开复算 | 通过，另存为只验证对话框 | 已命名保存 `.tfc.json` 和 `.tfd` 到 `Workspace/projects`；重新打开保存的 TFD 后仍为 4 层 AL2O3/SIO2，T@550=99.9683%、最小值 91.9146%；另存为原生窗口默认 `Workspace/projects`，取消未写文件 |
| 整包移动后重启 | 通过（目录移动） | 整个 `TFC 便携验收` 目录移到新路径后重启，环境先行、项目重开和光谱复算一致；Workspace 下 projects/materials/spectra/database/imports/exports/config 均存在。未做物理换盘符或断电 |
| 包内 README 修正 | 通过 | 已重打包并检查 ZIP 内文本 |

实际界面操作通过 WebView2 调试端口完成，以避免全屏游戏遮挡前台；读取的是真实渲染 DOM 并调用真实 Tauri 命令/原生对话框，截图由页面直接捕获。

截图随 SSD 回传目录交付，未提交进仓库。建议查看：`02-menu-only.png`、`05-environment-first.png`、`06-main-spectrum.png`、`07-layers-window.png`、`08e-config-all.png`、`16-stack-window.png`、`17-materials-window.png`、`29-interactive-before.png`、`31-interactive-after-keyup.png`、`32b-main-after-qwot2.png`、`33b-layers-after-qwot2.png`、`34-layers-after-undo.png`、`35-layers-after-redo.png`、`36-unsaved-dialog.png`，以及 `21-main-cdp.png` 至 `40-moved-reopened.png` 的新截图。

## 发现的跨平台问题与修正

1. `engine/tests/test_tfd_export.py` 用 `Path.read_text()` 读取含中文的 UTF-8 JSON；中文 Windows 默认 GBK，导致 `UnicodeDecodeError`。已显式指定 `encoding='utf-8'`，修复后 75 项 Python 测试通过。这是测试代码可移植性问题，不改变产品计算。
2. `scripts/package_release.py` 的包内 README 仍写“保存的膜系 JSON”和“.tfc.json”。已改为默认 `.tfd`、内部完整快照、可选 JSON，并重新打包。
3. 全部工具窗口恢复约需 20 秒，慢于 Mac 记录；本次未判为功能失败，但建议 Mac/Windows 后续观察启动恢复耗时。
4. 修改项目后关闭并选“保存并继续”，项目窗口关闭，但保存的 TFD 修改时间和层厚未变化；可能未真正保存，或本次修改未进入项目。需复验。
5. 选“不保存”关闭后，主光谱窗口隐藏，但 `materialdata`、`distribution`、`rear` 仍报告可见；与“关闭后所有工作窗口隐藏”的预期不一致，需复验。

## 验收方法说明

全屏游戏会抢占普通鼠标前台，因此大部分交互通过 WebView2 调试端口读取真实渲染 DOM 并触发真实 Tauri 命令/原生对话框；原生文件对话框用 Win32 子控件完成。该方式绕过了前台遮挡，但不能证明显示缩放、物理鼠标手感或 GPU 合成效果。关闭项目的两个疑点应在无游戏的全屏前台复验。

## 尚未覆盖

- 组系数实时联动未单独操作；交互式 QWOT 联动已通过。
- 基底只验证了目录列表和数据文件夹，未做基底新增/编辑/删除。
- 另存为只验证了原生窗口默认位置和取消，未写外部路径文件。
- 物理换盘符、真实断网、原版 TFCalc 实机读取未做。
- 显示缩放（125%/150%）和物理鼠标操作未验证。

## Mac 整合建议

- 从同一源码提交重新构建 Mac 包：`scripts/package_release.py` 已改动包内 README，Mac 包也应使用新文本；测试读取修正不影响 Mac 产物。
- 不要把本记录当作 Windows 全验收通过。正式 `v0.2.5` 前，重点复验关闭项目的“保存并继续/不保存”与工具窗隐藏；再补组联动、基底编辑和物理 SSD 搬迁。
- 保留本次 ZIP、SHA-256、`release/checks/` 和回传截图供 Mac 对照；不要覆盖旧标签或发布未验证的平台包。
