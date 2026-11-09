# Windows 0.2.5 本地验收记录

日期：2026-11-09。源码基线：`12994e8`，加本记录同次提交中的 Windows 测试读取修正、包内 README 修正及文档修正。此文件记录实际执行结果，不是正式发布证明。

## 结论

- Windows x64 本地编译、自动检查和便携打包已完成；ZIP 与 SHA-256 已生成并校验。
- 真实窗口验收只完成一部分。全屏游戏反复抢占前台，导致后半段菜单/对话框点击无法可靠送达 TFC；未完成项不记为通过。
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
| 关闭项目（已修改） | 部分通过 | 修改 QWOT 后出现“保存项目更改？”；取消后留在当前项目。保存/不保存分支未在真实对话框中完成 |
| 最近项目子菜单 | 通过 | 键盘展开右侧最近项后可直接重开文件并先进入环境；重启持久化和源文件缺失提示未做 |
| 交互式分析联动 | 通过 | 前表面 QWOT 1→2，物理厚度 65.48→130.95 nm，曲线同步变化；撤销恢复 65.48/1.0000，重做恢复 130.95/2.0000 |
| 结果显示光谱曲线 | 未确认 | 关闭光谱成功；随后菜单点击未能可靠恢复，受全屏游戏抢占前台影响，不能记为通过；自动 IPC 检查此项为 true |
| 工具栏“项目”原生对话框 | 未做 | 受前台抢占影响 |
| 膜堆表达式 H→AL2O3 | 未做 | 自动 `window-ipc`/stack 检查通过，但真实手动换料未完成 |
| 材料/基底逐项编辑 | 未做 | 自动 `catalogue` 检查覆盖新增/编辑/删除/恢复和逐项文件；真实窗口点击未完成 |
| 纵轴范围、两位物理厚度、QWOT 四位 | 未做 | 自动 TypeScript 检查通过，真实窗口未逐项操作 |
| 命名保存、另存为、重新打开复算 | 未做 | 自动 `project-flow` 覆盖 TFD 写读和精确复算；真实保存/另存为对话框未完成 |
| 整包移动后重启 | 未做 | 自动 `portable-location` 覆盖目录移动和实际宿主入口；未做物理换盘符/整包 GUI 重启 |
| 包内 README 修正 | 通过 | 已重打包并检查 ZIP 内文本 |

截图随 SSD 回传目录交付，未提交进仓库。建议查看：`02-menu-only.png`、`05-environment-first.png`、`06-main-spectrum.png`、`07-layers-window.png`、`08e-config-all.png`、`16-stack-window.png`、`17-materials-window.png`、`29-interactive-before.png`、`31-interactive-after-keyup.png`、`32b-main-after-qwot2.png`、`33b-layers-after-qwot2.png`、`34-layers-after-undo.png`、`35-layers-after-redo.png`、`36-unsaved-dialog.png`。

## 发现的跨平台问题与修正

1. `engine/tests/test_tfd_export.py` 用 `Path.read_text()` 读取含中文的 UTF-8 JSON；中文 Windows 默认 GBK，导致 `UnicodeDecodeError`。已显式指定 `encoding='utf-8'`，修复后 75 项 Python 测试通过。这是测试代码可移植性问题，不改变产品计算。
2. `scripts/package_release.py` 的包内 README 仍写“保存的膜系 JSON”和“.tfc.json”。已改为默认 `.tfd`、内部完整快照、可选 JSON，并重新打包。
3. 全部工具窗口恢复约需 20 秒，慢于 Mac 记录；本次未判为功能失败，但建议 Mac/Windows 后续观察启动恢复耗时。

## 未完成原因

后半段操作时，桌面上运行的全屏游戏反复取得前台并覆盖 TFC；窗口能被枚举、移动、PrintWindow 抓取，但鼠标点击常落到游戏，无法可靠完成菜单/对话框点击。未通过项不是已证实的产品缺陷，也不能当作通过。恢复游戏后未再继续前台点击，以免干扰用户。

## Mac 整合建议

- 从同一源码提交重新构建 Mac 包：`scripts/package_release.py` 已改动包内 README，Mac 包也应使用新文本；测试读取修正不影响 Mac 产物。
- 不要把本记录当作 Windows 全验收通过。正式 `v0.2.5` 前，至少补做：工具栏项目对话框取消、保存/另存为真实对话框、结果显示光谱恢复、膜堆 H=AL2O3、材料逐项编辑、整包移动重启。
- 保留本次 ZIP、SHA-256、`release/checks/` 和回传截图供 Mac 对照；不要覆盖旧标签或发布未验证的平台包。
