# Windows 0.1.3 与 SSD 使用教程

## 启动

使用 `release/Windows/TFC` 完整目录，双击 `TFC.exe`。不要单独复制 EXE；旁边 `engine` 及其 `_internal` 必须一起保留。运行计算无需安装 Python、Node 或 Rust，无需联网。目标电脑需要 Microsoft Edge WebView2 Runtime；本机已安装。此便携包不包含 WebView2 离线安装器，未验证缺少 WebView2 的电脑。

## 打开从 Mac 带来的项目

1. 先关闭 Mac 和 Windows 上的 TFC。
2. 保留交接包根目录的 `Workspace` 原件；复制整个文件夹到 SSD 的工作目录，例如 `TFC数据/Workspace`。不要只复制数据库或单个 JSON。
3. 在 Windows TFC 顶部点击工作区按钮，选择“打开工作区”，选择包含 `workspace.json` 的文件夹。不要选择“新建”。
4. 打开已有项目，核对材料、基底、层序、厚度、波长范围、角度和偏振。
5. 点击计算，查看 R/T，然后保存项目。有效光谱随保存归档。修改物理输入后先重新计算再保存。
6. 关闭并重新启动应用，确认项目仍可打开并复算。

## 搬迁与 Mac 往返

1. 关闭 TFC，等待退出，再复制整个 Workspace 到新位置。
2. Windows 应用目录也可整目录移动。程序目录与工作区独立，通过工作区按钮重新选择数据目录。
3. SSD 盘符变化后，打开工作区并重新选择；旧路径不可用时不要创建同名空工作区替代数据。
4. 在 Mac 使用 Mac 版应用打开同一 Workspace；Windows EXE 不能在 Mac 运行。两台电脑顺序使用，不同时写入。
5. Mac 如需写入 SSD，确认磁盘格式双方均可读写。当前 E: 为 NTFS；macOS 默认通常不能写入 NTFS，需要另行确认可写方案。格式化会删除数据，不在本次操作范围。
6. 应用退出后安全弹出磁盘。不要在打开项目时拔盘。

## 当前验收副本

`acceptance/Windows-0.1.3/搬迁 SSD 模拟/Workspace` 是 3 个 Mac 项目的验收副本。原件文件哈希已验证不变。副本已打开、计算、保存光谱，搬迁后精确复算。F: exFAT 固态 U 盘和原生界面也已验收。可直接启动 `F:/TFC-Windows-0.1.3-验收-20261031/Windows/TFC.exe`，通过工作区按钮打开 `F:/TFC-Windows-0.1.3-验收-20261031/数据验收/搬迁 SSD 模拟/Workspace`。真实换盘符、Mac 往返及物理断网仍待验证。

## 源码重新构建

开发环境使用 Node 24、Python 3.13、Rust MSVC、Visual Studio 2022 C++ Build Tools 和 Windows SDK。重新打开 PowerShell，使安装后的工具路径生效。

```powershell
py -3.13 -m venv .venv
.venv/Scripts/python.exe -m pip install -r engine/requirements-dev.txt
npm ci
npm test
npm run validate:optics
./scripts/build_windows.ps1
node scripts/run_python.mjs scripts/validate_workspace_release.py
```

Windows 默认构建便携目录，不生成安装器。需要离线 WebView2 安装器时，另行使用 `tauri.windows.conf.json` 合并构建并实测，不能把配置文件存在视为已验证。
