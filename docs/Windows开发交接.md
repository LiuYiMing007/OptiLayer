# Windows 开发交接：从 0.1.2 继续 0.1.3

> 历史交接记录：0.1.3 已完成双平台构建与回传验证，当前状态请看 [0.1.3 更新报告](更新报告/0.1.3更新报告.md)。

整理日期：2026-10-31。本文件记录 Mac 端实际状态，供 Windows 新对话接续；不是已经完成的 Windows 验收报告。

## 用户目标与授权范围

用户要把软件及数据放到移动 SSD，在 macOS / Windows 离线使用。0.1.2 还没有 Windows EXE，用户要求不能直接使用就继续开发 0.1.3。当前同意转到 Windows 编译和测试。先检查当前源码和环境，保留正确计算与验证，不为技术路线无意义重写。不要启动 AI Agent、膜系优化或 Rust/WASM 重写。

首条完整链路：新建项目 → 材料/基底 → 膜系编辑 → Optical Core → R/T 光谱 → 保存项目。

## 已完成的实际状态

- 当前版本仍为 0.1.2。0.1.3 仅完成环境/缺口检查，尚未修改产品版本或业务代码。
- Tauri 2 + React / TypeScript + Tailwind + Plotly；Python / NumPy / SciPy 是唯一生产计算实现；SQLite + JSON 放在 Workspace 中。
- Optical Core 保留 `engine/optics.py`、`models.py`、`analysis.py`。存储分离为 `repository.py`、`workspace.py`；应用编排为 `application.py`；`main.py` 为进程入口；TFCalc 子集解析独立在 `importers/tfd.py`。
- Workspace v1：manifest + projects/materials/spectra/database/imports/exports/config，相对引用；SQLite schema v3 为权威数据；JSON 为恢复副本。根目录只属于宿主运行上下文。
- 新建/打开/切换工作区、旧数据库只读复制迁移、有效光谱随项目归档已实现。
- Mac 已验证 28 项 Python + 4 项 TypeScript 测试、25 项数值检查、Golden 301 点（最大误差约 7.838e-7 个百分点）、打包引擎目录搬迁与精确复现、原生 UI 保存及重启。
- 修复过原生 JSON 对象字段顺序引起错误过期判断；`src/model.ts` 使用规范化签名，须保留该回归测试。
- Mac 用户原数据库有 3 个项目，已经复制到默认 Workspace；原数据库保留。交接包若包含 Workspace，则是额外副本；不要覆盖唯一原件。
- 当前无 git 仓库，无可用 GitHub CLI/远程构建。CI 文件只在磁盘准备，尚未执行。

## Windows 已准备、尚未证明可用的部分

- Rust 启动使用 `.venv/Scripts/python.exe` 或 `engine/tfc-engine.exe`，隐藏计算进程控制台窗口。
- `scripts/run_python.mjs` 选择当前 OS 的 Python 虚拟环境入口。
- `scripts/bundle_engine.py` 使用 PyInstaller onedir；`tauri.release.conf.json` 将整个引擎目录加入 resources。
- `scripts/stage_release.py` Windows 分支将程序和完整 engine 复制到 `release/Windows/TFC/`。
- `tauri.windows.conf.json` 配置 WebView2 offlineInstaller；便携目录本身仍要求目标机有 WebView2。
- `.github/workflows/cross-platform.yml` 包含 Mac/Windows 流程，但未在线运行、未上传交付产物。
- 目前不存在 Windows EXE 或已验证的 Windows 便携包；Mac `.app` 不能替代它。

## 0.1.3 必做工作

1. 确认真实 Windows 版本、CPU 架构（x64/ARM64）、Node 24、Python 3.13、Rust MSVC、Visual Studio C++ Build Tools / Windows SDK 与 WebView2。缺什么先报告，再按用户授权准备，不要把 Mac `.venv`、node_modules 或 target 当作 Windows 依赖。
2. 在 Windows 重新创建虚拟环境和安装依赖。检查锁定版本有没有对应架构 wheel、Windows 编码与带空格/中文路径；不要盲目升级破坏现有验证。
3. 运行自动测试、数值检查与前端/Rust 构建，修复实际 Windows 问题。
4. 真正生成 Windows 程序、完整 Python 引擎资源和便携目录；验证 EXE 资源路径、WebView2 缺失提示、离线计算与保存。
5. 使用交接包的 Workspace 副本，打开原项目、计算、保存光谱；把整个 Workspace 移至另一目录/SSD后重开，模拟盘符变化。不要覆盖用户唯一原始工作区。
6. 如需要便携启动器，启动器以自身位置定位 Workspace，不能写死 Mac 根目录或 Windows 盘符；先实施必要功能，避免过度设计。
7. 完成后更新到 0.1.3，更新版本号、文档和验收记录，提供真实 EXE/ZIP路径及逐步 SSD 使用教程。未实测的项目明确标注，不能把脚本准备等同于验收成功。
8. 导出修改后的源码供 Mac 同步。Mac 与 Windows 开发副本不会自动同步；回传前记录修改文件，保留双方备份。

## 建议验证命令（PowerShell，按实际环境调整）

```powershell
$env:PYTHONUTF8 = '1'
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r engine/requirements-dev.txt
npm ci
npm test
npm run validate:optics
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run desktop:build
node scripts/run_python.mjs scripts/validate_workspace_release.py
```

构建依赖安装需要网络；运行打包产品应验证断网使用。Python 脚本内有未显式指定 UTF-8 的历史读写，环境变量只帮助初次排错，仍需评估代码修复。`validate_workspace_release.py` 当前报告名仍带 v0.1.2，升级时改为按版本/平台记录，避免覆盖旧证据。

## 数学边界

各向同性、常数实数 n、k=0、单面相干膜层、半无限边界、不含基底背面反射；材料 REF 是合成验证常数。TFD 仅 ENVIRON / LAYERS / LAYER 子集。不要宣称已支持吸收、色散、完整 TFCalc 或优化。

## 阅读顺序

1. 本文件。
2. README.md。
3. docs/技术路线决策-跨平台离线优先.md。
4. docs/Workspace数据规范.md。
5. docs/V0.1.2-基础架构验收.md。
6. 实际源码、配置和测试。

Mac 原路径只是历史信息，不能用于 Windows 运行路径。交接包中没有 Mac 虚拟环境、node_modules、target、Mac 应用和历史 SQLite 备份；这些应在各 OS 构建或留在原机。交接包根目录 Workspace 是业务数据副本，TFC 是源码，两者概念不同。
