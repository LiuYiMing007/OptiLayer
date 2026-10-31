# GitHub 版本管理

建立日期：2026-11-01。仓库默认私有，账号以实际授权为准。

## 保存方式

- 每次完成可用更新：测试、更新说明、commit、push；GitHub Commits 可查看每次变化。
- 正式版本：增加不可变的 `v版本号` 标签，并创建 Release；报告与安装包对应同一标签。
- 0.1.2 的源码标签由合并前备份恢复，明确记录为后补归档；没有伪造过去的逐次提交历史。
- 0.1.3 保存 Windows 回传、Mac 合并验证后的源码和更新报告。更早版本只有部分证据或程序，暂不创建缺少完整源码的标签。

## 更新后的固定操作

```sh
npm run sync -- "fix: 修复具体问题并补充说明"
```

该入口检查本地远程配置，运行自动测试、数值检查和前端构建，再提交并推送。若离线或上传失败，本地提交仍保留，恢复网络后重新推送；不能把仅本地提交说成已同步。

正式版本同时更新产品版本号，写好 `docs/更新报告/<版本>更新报告.md`，然后：

```sh
npm run publish:version
```

入口检查版本一致性和报告，运行检查，提交、建立新标签并原子推送。已有标签会拒绝覆盖。GitHub Actions 在 Mac/Windows 分别检查和构建，标签构建成功后创建 Release，附报告、程序压缩包及 SHA-256。已有 Release 的已验收产物不会自动覆盖。脚本和工作流存在不代表远程构建已经通过，应查看 Actions 的实际状态。

## 在哪里找历史版本

- 仓库首页：当前源码、README 和开发文档。
- Commits：日常更新和逐文件变化。
- Tags：固定的版本源码快照。
- Releases：对应更新报告和可下载程序；初始 0.1.3 使用已在两台机器验收的本地产物。
- Actions：在线检查结果与构建日志。

## 数据范围

源码、配置、验证 fixtures、更新报告和必要验收证据进入 Git。用户 Workspace、SQLite、实验原件、密钥、本机备份、依赖及构建缓存保持本地。发布程序通过 Releases 分发，不将大型安装包放入 Git 历史。匿名/参考算例是测试资产，仍需跟随源码以复现验证。

换电脑开发时从 GitHub 克隆源码，在对应系统重新准备依赖；业务 Workspace 单独迁移。开始修改前确认双方源码同步，避免在两台电脑各自修改后互相覆盖。

本项目 AGENTS.md 已记录用户“每次完成更新提交并上传”的约定。此约定依赖当前 GitHub 授权和网络；不会在用户没有完成开发更新时后台上传任意编辑，也未创建定时任务。

参考：[GitHub 导入现有项目](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)、[GitHub CLI Release](https://cli.github.com/manual/gh_release_create)。
