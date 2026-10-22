# 星遇 · 3D 抽奖平台

支持微信扫码签到、活动与奖项管理、多种 3D 抽奖主题、彩排模拟参与者和中奖记录导出的独立部署项目。

## 安装到服务器

从 [Releases](https://github.com/coency/web-3d-lottery/releases) 下载部署压缩包、SHA256 校验文件和 `INSTALLATION.md`，按[部署流程步骤](docs/部署流程步骤.md)操作。

当前部署版本为 **v1.0.0-rc.1（预发布）**，以 2026-10-22 的完整代码重新编号。升级成功且检查通过后，自动清理本次上传包、校验文件和新解压目录，保留运行目录、配置、数据、备份及内部版本副本。

服务器部署请使用命名为 `starlit-版本-source.tar.gz` 的附件。仓库源码用于开发、测试和重新打包，不能直接当作已整理好的安装目录执行。

## 功能

- 活动资料、品牌 Logo、签到字段、奖项及展示内容配置。
- 微信服务号配置、域名校验文件上传、手机授权签到。
- 彩排与正式活动隔离，按需生成最多 5000 名模拟参与者及不同模拟头像。
- 梦幻星球、星光矩阵、星光长廊、星轮光波、星河瀑布大屏主题。
- 服务端开奖、每轮最多 10 人、不在场补抽、名单导出和操作记录。
- 大屏头像本机缓存、实时状态同步、异常恢复和开场检查。

## 本地开发

需要 Node.js **24.14.1 或更新的 24.x**、npm 和 Git。开发数据库由启动脚本管理；无需先安装 Docker。

```sh
git clone https://github.com/coency/web-3d-lottery.git
```

```sh
cd web-3d-lottery
```

```sh
npm ci
```

```sh
npm run dev
```

打开 http://127.0.0.1:5173 。首次启动没有预置账号；按[开发与测试说明](docs/开发与测试.md)初始化。停止服务不会清空数据库。

## 代码结构

| 目录 | 用途 |
| --- | --- |
| `apps/web/src/` | Vue 后台和手机签到页面 |
| `apps/web/stage/` | 3D 大屏、主题和头像缓存 |
| `apps/web/public/` | 默认 Logo、模拟头像等内置资源 |
| `apps/api/src/` | NestJS API、账号、签到和服务端开奖 |
| `packages/contracts/` | 共享接口类型 |
| `db/migrations/` | PostgreSQL 数据库迁移 |
| `deploy/container/` | Docker、HTTPS、安装及维护脚本 |
| `scripts/` | 开发启动、验证和部署打包工具 |
| `tests/` | 正式系统的单元及部署测试 |
| `docs/` | 开发、部署和维护必需文档 |

旧静态原型及其专属测试已移除。测试使用模拟身份和隔离数据，不附带真实账号、参与者、数据库或微信密钥。

## 检查与构建

```sh
npm run check
```

```sh
npm test
```

```sh
npm run build
```

完整发布验收运行 `npm run release:check`，包含数据库、浏览器、抽奖、签到和部署检查。环境要求见[开发与测试说明](docs/开发与测试.md)。生产微信接入仍需在实际域名和手机微信中验证。

## 发布与维护

- [部署说明](docs/一键部署.md)
- [升级后的自动清理](docs/升级后清理.md)
- [2000 人模拟测试](docs/2000人服务器测试.md)
- [当前部署包更新内容](docs/部署包更新说明.md)

后续发布须使用新版本号，例如 `npm run package:deploy -- --version=1.0.0-rc.2`。部署包保存在本地 `artifacts/`，上传到 GitHub Releases，不提交进源码仓库。

请勿提交 `.env`、`.local/`、生产配置、数据库、上传文件、证书或备份。示例配置见 `.env.example`，运行数据和生成产物已加入 `.gitignore`。
