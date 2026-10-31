# TFC · v0.1.2

跨平台、离线优先的光学薄膜工作台。当前已验证 Apple Silicon macOS 构建；Windows 构建路径和检查流程已准备，尚未在 Windows 实机验收。

本地试用应用：`release/TFC.app`。尚未进行 Developer ID 签名和公证。之前的 `release/TFC for Mac.app` 保留。

## 技术路线

保留 Tauri 2 + React / TypeScript + Tailwind CSS + Plotly.js。现阶段 Python / NumPy / SciPy 是唯一生产计算实现，保留经过验证的 TMM、材料模型和光谱分析。长期优先考虑 Rust Core，通过同一接口分别编译原生库和 WASM；只有数值、复数分支、性能及优化需求通过对照验证后才切换，本版没有实现第二套算法。

评估依据、选择原因与迁移门槛见 [技术路线决策](docs/技术路线决策-跨平台离线优先.md)。

## 当前架构

```text
React UI → Tauri 桌面宿主 → JSON 应用服务
                            ├─ Optical Core：models / optics / analysis
                            ├─ TFCalc 参考子集解析器
                            └─ Repository → Workspace → SQLite / JSON / 光谱
```

Optical Core 不依赖数据库、文件系统、UI、TFCalc 解析器或 AI。Python 进程通过 JSON 收发结果，打包后不依赖用户安装 Python。浏览器开发桥接仍复用相同内核；独立浏览器产品尚未实现。

## Workspace

点击顶部工作区按钮，新建空目录或打开已有 `workspace.json` 的目录。首次升级将旧数据库复制到默认工作区，旧数据库保留。已记住的外置盘未挂载时提示重新选择，不创建替代空工作区。

```text
workspace.json       格式、版本、标识和相对目录
projects/            项目 JSON 恢复副本
materials/           共享材料 JSON 恢复副本
spectra/             带输入快照和单位的计算结果
database/           workspace.sqlite3（项目和共享材料权威存储）
imports/ exports/ config/    数据目录；部分用途预留
```

项目保存时写入 SQLite 和 JSON 副本；若有对应当前输入的有效光谱，同时归档结果。重新打开项目重新计算。Workspace 内不保存电脑绝对路径；最近选择的根目录仅在本机偏好中保存。关闭应用后复制整个工作区到 SSD，在另一台电脑重新选择目录。当前不支持多台电脑同时写入或同步冲突合并。格式、迁移和恢复规则见 [Workspace 数据规范](docs/Workspace数据规范.md)。

## 第一条业务链路

新建项目 → 从共享库选择材料或添加常数材料/基底 → 编辑膜层、d / n·d / QWOT、入射角与偏振 → 计算 → 查看 R/T、S/P 和分析 → 保存项目与有效光谱。

保留之前的厚度联动、基底选择、目标曲线叠加、图表缩放及指标分析。物理输入变化后标记旧结果并禁止误导出。每个项目保存材料快照，共享库更新不改变历史项目。

## 模型边界

当前仅支持各向同性、常数实数 n、k=0、单面相干膜层、半无限边界介质，不含基底背面反射。内置材料为合成验证常数，不等同于真实工艺或厂商数据。A 为 100−R−T 的数值残差。TFD 仅解析 ENVIRON / LAYERS / LAYER 参考子集。

本版没有实现 Rust/WASM Core、吸收和色散、膜系优化、AI Agent、云同步、PWA 或移动端应用。

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
npm run desktop:build
```

自动测试含 28 项 Python 和 4 项 TypeScript 测试；数值验收另有 25 项检查及原始 Golden 301 点比对。`tmm==0.2.0` 仅为独立验证依赖，生产计算不调用它。

各平台在对应系统打包 Python 目录环境；不能在 Mac 上声称生成已验证的 Windows 包。Windows 安装器配置离线 WebView2；便携目录仍要求目标电脑已有 WebView2。本机仅验证 macOS。CI 文件已准备但尚未在线运行。

## 目录

- `engine/optics.py`、`models.py`、`analysis.py`：保留的计算、校验和分析。
- `engine/application.py`：应用服务；`main.py`：进程入口。
- `engine/workspace.py`、`repository.py`：工作区与持久化。
- `engine/importers/tfd.py`：TFCalc 参考子集解析。
- `src/`：编辑器、材料库、光谱和工作区界面。
- `src-tauri/`：本机工作区选择、进程通信、文件导出与打包。
- `scripts/`：构建、数值验证和交付整理；`.github/workflows/`：跨平台检查。
- `docs/`：路线决策、数据规范、开发顺序与验收记录。

下一阶段见 [当前开发顺序](docs/当前开发顺序.md)。旧数值证据保留于 [光谱引擎验收](docs/V0.1.1-光谱引擎验收.md)，用户工程与升级前数据库副本均未替换。
