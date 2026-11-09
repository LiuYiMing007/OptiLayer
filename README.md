# TFC · 0.3.0

0.3.0 仅新增两个雏形，均位于“分析”菜单：**膜系自动优化**和 **AI Agent**。优化器按目标 R/T 曲线在给定范围内调整所选膜层厚度，提供误差/候选光谱预览；Agent 支持配置 Responses API 服务、真实光谱工具调用和膜厚候选。两者均先预览再应用，支持撤销和停止，不改动已验证的 Optical Core。

[0.3.0 更新报告与使用边界](docs/更新报告/0.3.0更新报告.md)。AI 需要用户填写模型与 API Key；密钥不保存到项目。真实模型服务连通及 Windows 0.3.0 仍需单独验收，不能沿用旧版结果。本次发布本机已验收的 Mac 包；下方 0.2.5 双平台下载保留。GitHub 云构建因账号付款/消费额度限制未启动，Windows 0.3.0 包尚待构建。

[下载 0.3.0 Mac 便携包](https://github.com/LiuYiMing007/tfc-workbench/releases/download/v0.3.0/TFC-0.3.0-macOS-arm64.zip) · [0.3.0 发布页与校验文件](https://github.com/LiuYiMing007/tfc-workbench/releases/tag/v0.3.0)

## 上一版本 0.2.5

0.2.5 汇总工程桌面菜单、环境先行、真实 TFD 保存、H/L 原库换料、材料/基底管理和关闭流程修复。Mac 与 Windows 已分别完成本地构建及验收；Windows 保存卡住、工具窗残留的缺陷已复验通过。两端程序源码为 `7967206`，后续提交只更新验收和发布文档。

[下载双系统便携包](https://github.com/LiuYiMing007/tfc-workbench/releases/download/v0.2.5/TFC-0.2.5-macOS-Windows-portable.zip) · [全部下载及校验文件](https://github.com/LiuYiMing007/tfc-workbench/releases/tag/v0.2.5) · [更新报告](docs/更新报告/0.2.5更新报告.md) · [Windows 实机记录](docs/Windows-0.2.5-验收记录.md)

GitHub 云端构建仍受账号额度限制，本版使用两台本地电脑已验证的原生程序包发布，未将失败云任务标为通过。合并包已核对逐文件内容、Mac 签名、实际入口定位及目录搬迁精确复算。物理断网/换盘符、显示缩放和原版 TFCalc 实机复算的未覆盖范围见验收记录。

此前的 [启动打开文件流程](docs/启动打开文件流程预览.md)、[TFD 保存与窗口流程](docs/TFD保存与窗口流程预览.md)及 dev.1/dev.2 修复已纳入本版。旧版本标签和下载保留。

0.2.4 补齐紧凑材料和基底窗口的新增、删除、恢复与独立文件保存，移除“自定义”分类及四条未修改演示常数的共享记录。旧项目快照保留。

0.2.3 加入完整有限基底环境、独立出射介质、正背膜层、实时交互式分析、组及膜堆表达式；工具窗口采用紧凑表格和窄材料列表，项目命名保存、材料逐项文件与便携工作区继续保留。

跨平台、离线优先、可迁移 Workspace 的光学薄膜工作台。macOS 使用系统菜单，Windows 使用独立菜单小窗口；光谱主窗与工具窗口共享同一个项目和计算状态。

0.2.0 从用户提供的 TFCalc 数据中完整登记 1,211 份材料／基底记录：1,186 项可用，25 项原数据损坏、为空或含负 k 的记录单独列为待核查并禁止用于计算。保留全部逐波长 n/k、色散系数、原名称、备注与来源校验，不将真实数据简化成固定 n。

材料与基底使用窄搜索目录，支持来源筛选、50 行分页，点击打开独立完整 n/k 数据表；内置记录编辑时建立用户副本。新增原创光学图标。旧项目、便携工作区、单一 Project State 和 0.1.5 的多窗口能力继续保留。

[下载双系统合并包](https://github.com/LiuYiMing007/tfc-workbench/releases/download/v0.2.5/TFC-0.2.5-macOS-Windows-portable.zip) · [全部下载](https://github.com/LiuYiMing007/tfc-workbench/releases/tag/v0.2.5) · [0.2.4 更新报告](docs/更新报告/0.2.4更新报告.md) · [材料验收及异常清单](docs/0.2.0-材料与基底导入验收.md)

Mac 为 Apple Silicon / macOS 14+，Windows 为 x64 / WebView2。两个客户端使用同一套 Workspace 数据。升级只替换 `macOS` 和 `Windows` 程序子目录，保留 `Workspace`、`Workspaces`、`.tfc`，不要用空目录覆盖数据。材料目录已打入两端程序，无需原 TFCalc 文件夹或联网。

0.2.4 已通过 [双平台正式构建与验收](https://github.com/LiuYiMing007/tfc-workbench/actions/runs/42417104330)：包括新增/删除/恢复按钮 IPC、冻结运行时材料与基底管理、独立文件、目录可见性和搬迁复算。正式包及校验文件已发布。数据库升级为版本4，请退出旧版并同步升级 Mac/Windows 两端。

0.2.3 正式标签已通过两端原生菜单、15个实际工具窗口、材料编辑、冻结环境计算、保存、搬迁复算、目录可见性及便携定位验证。三个程序包分别附 SHA-256 文件；合并包不包含个人工作区。原版 TFCalc 逐点数值一致性、物理 SSD 换盘符、物理断网及所有显示缩放不由这些自动检查替代。

0.2.1 修复 Mac 隔离启动时的工作区定位与目录不可见问题，提供显式选择便携项目入口。材料和基底支持常数、完整 n/k 表及色散系数编辑，原始记录保留；“打开数据文件夹”可查看原始目录及逐项材料文件。只在丢弃实际修改前提示保存，支持保存并继续。

## 技术路线

保留 Tauri 2 + React / TypeScript + Tailwind CSS + Plotly.js。现阶段 Python / NumPy / SciPy 是唯一生产计算实现，保留经过验证的 TMM、材料模型和光谱分析。长期优先考虑 Rust Core，通过同一接口分别编译原生库和 WASM；只有数值、复数分支、性能及优化需求通过对照验证后才切换，本版没有实现 Rust/WASM 计算核心。

评估依据、选择原因与迁移门槛见 [技术路线决策](docs/技术路线决策-跨平台离线优先.md)。

## 当前架构

```text
React UI → Tauri 桌面宿主 → JSON 应用服务
                            ├─ Optical Core：materials / models / optics / analysis
                            ├─ MAT 导入器 / 只读材料目录 / TFD 参考子集解析器
                            └─ Repository → Workspace → SQLite / JSON / 光谱
```

主光谱窗口持有唯一 Project / Workspace 状态；原生工具窗口通过受校验命令编辑，接收只读投影，自动计算队列只发布最新结果。详见 [多窗口工作台设计](docs/0.1.5-多窗口工作台设计.md)。

Optical Core 不依赖数据库、文件系统、UI、TFCalc 解析器或 AI。Python 进程通过 JSON 收发结果，打包后不依赖用户安装 Python。浏览器开发桥接仍复用相同内核；独立浏览器光谱计算尚未实现。新增独立的 [iPhone 随行查阅框架](docs/iPhone随行框架.md)，内置完整材料库，支持只读项目导入与本机保存，不连接桌面计算桥。

## Workspace

默认在项目文件夹内使用 Workspace。可以新建或打开项目内其它工作区，或用“迁入旧工作区（复制）”把外部旧数据复制进项目；原件保留。选中的目录缺失时明确报错，不改用本机默认磁盘。

```text
workspace.json       格式、版本、标识和相对目录
projects/            项目文件：默认 *.tfd，可选 *.tfc.json 完整快照
materials/           材料/基底逐项文件与恢复副本
spectra/             带输入快照和单位的计算结果
database/           workspace.sqlite3（项目和共享材料权威存储）
imports/ exports/ config/    数据目录；部分用途预留
```

项目保存时以 SQLite 为权威，并按界面所选格式写出 TFD 或 JSON 恢复副本；若有对应当前输入的有效光谱，同时归档结果。重新打开项目重新计算。Workspace 内不保存电脑绝对路径；最近选择以相对路径保存在项目 `.tfc/workspace-selection.json` 中。关闭应用后复制整个便携项目到 SSD，另一台电脑按相对位置继续打开。当前不支持多台电脑同时写入或同步冲突合并。格式、迁移和恢复规则见 [Workspace 数据规范](docs/Workspace数据规范.md)。

## 第一条业务链路

新建项目 → 检索材料目录或添加常数材料/基底 → 编辑膜层、d / n·d / QWOT、入射角与偏振 → 计算 → 查看 R/T/A、S/P 和分析 → 保存项目与有效光谱。

保留之前的厚度联动、基底选择、目标曲线叠加、图表缩放及指标分析。物理输入变化后标记旧结果并禁止误导出。每个项目保存材料快照，共享库更新不改变历史项目。

## 模型边界

支持各向同性、常数 n/k、逐波长 n/k 表，以及当前目录使用的 TFCalc Sellmeier / Cauchy / Hartmann 色散公式。已验证的旧单面/半无限基底路径保留；新增有限厚非相干基底（含吸收、背面膜系和多次反射）及相干基底干涉模型。正背面均可编辑，Front/Back 指定照射方向。光源 WHITE、探测器 IDEAL 为平坦参考，可自定义响应表，并单独显示加权曲线；本征 T/R/A 与能量检查保持独立。

新环境项目使用项目格式 v2，防止旧客户端静默忽略背面和出射环境；普通旧项目继续读取 v1，Workspace 清单及共享目录仍为 v1。两系统使用同一份 Workspace 时，应同时升级至支持新环境的客户端。半无限模型的 T 表示进入基底，有限模型的 T 表示穿过元件进入出射介质。光源相干性和采样条件由用户选择；不把某个固定厚度自动当成相干性判据。

771 个原始 TFD 在隔离副本中重新验证：767 个导入、计算、保存和精确复算；4 个因材料定义缺失或损坏拦截，全部 812 个原文件哈希未变。这是内部链路与独立算法验证，不能冒称逐条与原 TFCalc 软件输出等价。各向异性、增益、吸收入射介质，以及缺少完整定义的可变/混合材料仍不支持。详见 [有限基底设计](docs/0.2.3-光学环境与有限基底设计.md) 和 [0.2.4 更新报告](docs/更新报告/0.2.4更新报告.md)。

内置 REF 条目依然是合成验证常数；导入目录来自用户提供的旧 TFCalc 数据，不等同于实际沉积工艺的实测值。范围和异常规则见 [材料与计算设计](docs/0.2.0-材料目录与计算设计.md)。桌面版未实现 Rust/WASM Core 或云同步；0.3.0 已加入局部膜厚优化和 AI Agent 雏形，完整边界见本版报告；独立的 iPhone 查看框架不承担桌面 Optical Core 计算。

## 开发

需要 Node.js 24、Python 3.13、Rust / Cargo 及当前平台编译工具。macOS 使用 Xcode Command Line Tools；Windows 使用 C++ Build Tools 和 WebView2。

```sh
npm ci
python3 -m venv .venv
# Windows：py -3.13 -m venv .venv
# macOS
.venv/bin/python -m pip install -r engine/requirements-dev.txt
# Windows PowerShell
# .venv\Scripts\python.exe -m pip install -r engine/requirements-dev.txt
npm run desktop
```

`npm run dev` 提供本地浏览器调试，地址 http://127.0.0.1:1420 ，默认使用 `.dev-workspace`；可用环境变量 `TFC_WORKSPACE_ROOT` 指向已有工作区。本地开发桥接不等于可独立分发的浏览器版。

```sh
npm test
npm run validate:optics
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run desktop:build
node scripts/run_python.mjs scripts/package_release.py
node scripts/run_python.mjs scripts/validate_portable_release.py
```

0.3.0 本机自动测试含 85 项引擎 Python、70 项 TypeScript、9 项打包/迁移 Python 与 Mac 14 项 Rust 测试；Windows 0.3.0 尚待原生验收；数值验收另有 25 项检查及原始 Golden 301 点比对。`tmm==0.2.0` 仅为独立验证依赖，生产计算不调用它。

各平台在对应系统打包 Python 目录环境；不能在 Mac 上声称生成已验证的 Windows 包。Windows 默认只构建便携目录，要求目标电脑已有 WebView2；离线安装器配置另行保留，尚未验收。Windows 实测与未完成项见本版验收记录。GitHub Actions 已接入，在线构建结果以 Actions 页面为准。

## 目录

- `engine/optics.py`、`models.py`、`analysis.py`：保留的计算、校验和分析。
- `engine/application.py`：应用服务；`main.py`：进程入口。
- `engine/workspace.py`、`repository.py`：工作区与持久化。
- `engine/importers/`：MAT 只读提取与 TFD 参考子集解析。
- `engine/materials.py`：纯光学常数求值；`engine/catalogue.py`、`engine/data/`：只读材料目录。
- `src/`：编辑器、材料库、光谱和工作区界面。
- `src-tauri/`：本机工作区选择、进程通信、文件导出与打包。
- `scripts/`：构建、数值验证和交付整理；`.github/workflows/`：跨平台检查。
- `docs/`：路线决策、数据规范、开发顺序与验收记录。

下一阶段见 [当前开发顺序](docs/当前开发顺序.md)。旧数值证据保留于 [光谱引擎验收](docs/V0.1.1-光谱引擎验收.md)，用户工程与升级前数据库副本均未替换。

## iPhone 随行框架（预览）

`npm run mobile:dev` 启动手机界面开发服务，`npm run mobile:build` 构建独立静态包，`npm run mobile:preview` 预览 `/mobile.html`。含完整 1,211 条材料/基底记录、n/k 查询、只读项目 JSON 导入、IndexedDB 本机保存及主屏幕光学图标。离线安装需 HTTPS；未发布 iOS 原生安装包，也未进行 iPhone 真机验收。详见 [使用与开发说明](docs/iPhone随行框架.md)。

### 0.2.3 开发验证

`0.2.3-dev.2` 阶段，已加入命名保存、材料/基底逐项文件、交互式调膜和完整出射环境计算。Mac 本机验收已通过；Windows 同一源码的冻结程序、8 个真实工具窗口、材料/TFD、环境计算、文件夹入口和便携搬迁检查已通过；两端 24 个参考 R/T/S/P 数值最大差异为 7.105427357601002e-14 个百分点。尚未发布 0.2.3 正式版。范围与文件位置见 [0.2.3 开发更新报告](docs/更新报告/0.2.3更新报告.md)；正式下载继续使用上方 0.2.2 Release。

### 0.2.3-dev.3

新增可手填介质名称/常数折射率、420×300 TFC 式交互式分析、膜层组号和组系数，以及复用 Python 的实时计算服务。原模型及验证数据保持；[使用与验收范围](docs/0.2.3-dev.3-实时调膜与分组.md)。Mac 本机与 Windows 原生自动运行检查已通过，菜单及按钮统一为“交互式分析”和“单纯分析”。本次仍为开发验证版，未发布正式标签。

### 0.2.3-dev.4（窗口预览）

新增紧凑横向膜层表、独立环境/响应/组/膜堆窗口；材料与基底改为窄列表加独立 n/k 数据窗。新增 TFD 厚度/材料一致性提示，未改计算公式。尚未发布正式版，窗口视觉方向仍待确认。[开发与验证记录](docs/0.2.3-dev.4-紧凑数据窗口.md)。
