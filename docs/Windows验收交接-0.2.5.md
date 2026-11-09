> 更新：关闭流程共享修复已在 Mac/浏览器验证；Windows 已在 `7967206` 重新编译并复验关闭、取消命名/关闭、保存失败和全窗口隐藏。剩余项见 [Windows 验收记录](Windows-0.2.5-验收记录.md)。旧 ZIP 不能作为新候选。

# Windows Codex 交接：0.2.5 验收与便携打包

整理日期：2026-11-09。此文件是交接任务，不是 Windows 已通过的验收证明。

> 执行状态（2026-11-09）：Windows 本地编译、自动检查与便携打包已完成；真实窗口主要项已完成，但“保存并继续”关闭流程有已确认缺陷，详见 [Windows 0.2.5 验收记录](Windows-0.2.5-验收记录.md)。未创建正式标签，不能据此发布。

## 仓库与接续入口

- 私有仓库：https://github.com/LiuYiMing007/tfc-workbench
- 分支：main。开始时先 git status、git remote -v、git log，保留本地修改。
- 本轮功能提交：b228091；Mac 最终验收及阻碍记录：653aec3。交接文件的后续提交只更新文档。克隆最新 main，不要退回旧预览。
- 产品版本已为 0.2.5，属于候选；尚未创建 v0.2.5 正式标签，尚未发布正式包。现场再次核实 tags/releases，避免并发发布。
- 先读根目录 AGENTS.md、README.md、docs/更新报告/0.2.5更新报告.md。本文件取代历史 docs/Windows开发交接.md 对当前版本的描述。

用户需要 Windows 原生编译、真实窗口操作验收与打包，然后将结果回传 Mac，由 Mac 整合双平台正式发布。无需本聊天历史。不要购买 GitHub 服务、改账单、公开仓库或改为收费云构建。

## 当前状态及故障背景

Tauri 2 + React/TypeScript + Plotly；Python/NumPy/SciPy 冻结引擎；可迁移 Workspace。不要重写核心，不开发 AI Agent/优化。

本轮已完成：

- H/L 可输入或候选选择完整材料目录，读取完整光学数据，避免旧材料误生成。
- 新项目默认原库 TA2O5/SIO2/AIR/GLASS；REF 仅留历史快照及数值验证。
- 文件：关闭项目、右侧最近项目子菜单、配置；去掉窗口菜单；分析末尾保留目标曲线。
- 结果只有“显示光谱曲线”，复用同一状态；工具栏“项目”打开原生文件选择，默认 Workspace/projects。
- 关闭项目隐藏所有工作窗口，保留菜单；未修改文件不多余提示保存。
- 修复膜堆工具窗口没收到材料目录导致打开失败、浏览器菜单被遮挡、最近子菜单方向键冒泡等问题。
- 先前预览的真实 TFD 写出、原生另存为、统一环境、环境先行与窗口配置也在本候选内。

Mac 已通过：75 Python + 67 TypeScript + 9 打包/迁移测试，14 Rust 测试，25 数值检查，17 工具窗口 IPC，冻结材料/有限基底/项目流程/中文 TFD/工作区/便携搬迁检查。TFD 保存重新导入 R/T 差异为零。原版 TFCalc 实机复算不是上述检查的替代项。

最新功能源码的云端任务 https://github.com/LiuYiMing007/tfc-workbench/actions/runs/42532431092 在 Windows 开始前被账单/限额拦住，0 个步骤。它不是编译失败，也不是 Windows 验收通过。不能拿先前 a32b4fe 的成功代替本版。

## Windows 首次环境

优先 Windows x64；ARM64 需单独评估，不冒充 x64 已测。

1. 用有此私有仓库权限的账号登录 GitHub，克隆 main 到 Windows 本地可写源码目录。不要将访问令牌写入文档/命令日志。
2. 读取/检查已有 Node 24、Python 3.13、Rust stable MSVC、Visual Studio C++ Build Tools（Desktop development with C++、Windows SDK）、Git、Edge WebView2。缺少时说明并按用户已有授权安装官方工具；遇安装许可/系统权限按现场规则处理。
3. Mac 的 .venv、node_modules、target 和 .app 不能当作 Windows 构建依赖，必须在 Windows 重建。不必搬迁用户全部项目数据。
4. 不写死 Mac 路径或某个盘符；不覆盖用户 Workspace。

获取源码示例（目录由用户选择）：

```powershell
git clone https://github.com/LiuYiMing007/tfc-workbench.git
cd tfc-workbench
git status --short
git remote -v
git log -3 --oneline
```

## 自动验收与打包顺序

以 .github/workflows/cross-platform.yml 当前 verify 流程为准，以下为对应 Windows 本地命令。每一步检查退出码；失败即停并查明原因，不允许失败后仍记录全通过。首次安装需要网络。

```powershell
$env:PYTHONUTF8 = '1'
py -3.13 -m venv .venv
node scripts/run_python.mjs -m pip install -r engine/requirements-dev.txt
npm ci
npm test
npm run validate:optics
npm run build
npm run mobile:build
node scripts/check_mobile_build.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run engine:bundle
npm run tauri -- build --config src-tauri/tauri.release.conf.json --no-bundle
node scripts/run_python.mjs scripts/stage_release.py
node scripts/run_python.mjs scripts/validate_menu_release.py
node scripts/run_python.mjs scripts/validate_window_ipc_release.py
node scripts/run_python.mjs scripts/validate_catalogue_release.py
node scripts/run_python.mjs scripts/validate_project_flow_release.py
node scripts/run_python.mjs scripts/validate_tfd_release.py
node scripts/run_python.mjs scripts/validate_environment_release.py
node scripts/run_python.mjs scripts/validate_workspace_release.py
node scripts/run_python.mjs scripts/validate_workspace_folders_release.py
node scripts/run_python.mjs scripts/package_release.py
node scripts/run_python.mjs scripts/validate_portable_release.py
```

如果没有 py 启动器，用已验证的 Python 3.13 路径建 .venv，不盲目升级锁定依赖。逐项保存真实输出、退出码、源码 commit、Windows/工具版本。尽量在源码外的本地验收目录存日志，避免日志/私人路径被直接提交。

## 必须人工操作的 Windows 验收

将本次 Windows ZIP 解压到新的可写验收目录，启动 TFC/Windows/TFC.exe，使用独立测试 Workspace。自动 IPC 检查不能取代这些步骤：

1. 启动仅出现打开文件；取消后只保留独立菜单小窗口。菜单不能失效、主窗不能强制出现。
2. 打开有效 TFD：先环境，完成后默认光谱与前膜层；所有工具窗口能打开、移动、关闭、再开。
3. 参数→膜堆表达式：新项目 H=TA2O5、L=SIO2；H 手动输入 AL2O3，预览/生成后检查材料与曲线同步；无效名不得用旧值生成。旧 REF 项目保持原快照。
4. 结果→显示光谱曲线恢复同一项目。关闭光谱不退出应用。
5. 工具栏“项目”打开 Windows 原生文件选择，默认 Workspace/projects；取消不改变当前膜系。
6. 文件→关闭项目：未修改不多余提示；修改后有正常保存/丢弃/取消；关闭后所有工作窗口隐藏，仅菜单保留；可再次新建/打开。
7. 文件→重新打开上次项目：鼠标移入显示右侧文件名，点击直接重开并先环境；重启后记录可用；删除/移动源文件后明确提示，不误开其他项目。
8. 材料与基底窄目录、完整逐波数据、新增/编辑/删除/恢复、草稿关闭再开不死锁；没有重新引入“自定义”分类。核对数据位置中的逐项文件可找到。
9. 交互式分析调整膜厚/组实时联动，撤销重做无错乱；纵轴自定义范围、物理厚度两位、QWOT四位。
10. 保存项目命名并写入 Workspace/projects；另存为原生窗口可选位置及 .tfd。打开保存文件并复算。
11. 退出后移动整个 TFC 便携文件夹到另一路径（有SSD可换盘符），重新启动、打开并复算；检查 Workspace 下 projects/materials/spectra/database/imports/exports/config 均可找到。物理断网等只有实际做过才标通过。
12. 包内 README.txt 仍有历史“项目 JSON”描述，核对并修正为当前默认 TFD 与内部快照关系；若改 scripts/package_release.py，重新打包验收并提交，Mac 也需重新打包。

至少保存菜单、膜堆手动换料、材料逐波表、保存对话框及可见 Workspace 目录的截图。不要截图私人项目或账号凭据。记录未测项目/缺陷，不承诺“所有系统无bug”。

## 产物与回传 Mac

预期产物（以脚本实际输出为准）：

- release/assets/TFC-0.2.5-Windows-x64.zip
- 同名 .sha256
- release/checks/ 下本轮 9 类报告（native-menu、window-ipc、catalogue、project-flow、tfd-import、environment、packaged-workspace、workspace-folders、portable）及生成的 docs/v0.2.5-windows-* 文件。
- Windows 人工验收记录：实际源码 commit、OS/架构、逐项结果、截图、缺陷和限制；建议 docs/Windows-0.2.5-验收记录.md。

检查 ZIP 包含完整 Windows/TFC.exe 与 Windows/engine（含 _internal），不是只有 EXE；不得包含个人 Workspace、数据库、密钥或原始实验。不能直接运行 ZIP 内程序，须解压完整目录。

代码/说明/可分享的合成验证报告按 AGENTS.md 提交 main 并推送，先核对没有私人文件；不提交二进制和依赖。ZIP、sha256、详细日志及截图通过 SSD 文件夹“0.2.5-Windows验收回传”交给 Mac，也可使用用户另行明确授权的私有传输。对话末尾给出 commit、产物绝对路径、通过/未测项与需 Mac 重验的改动。

不要直接创建标签或发布正式版：云端标签流程仍受限，本次是本地验收与回传。Mac 收到结果后须核对两端代码版本；若 Windows 修改了业务代码，Mac 需重新构建/验证，不能混用不同源码的同版本包。由 Mac 统一确定本地发布步骤、合并 ZIP、校验与正式标签，不能假定 push tag 会自动完成。
