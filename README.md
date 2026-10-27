# 星遇 · Starlit

可独立部署的 3D 抽奖平台，支持微信扫码签到、活动与奖项管理、多主题大屏和服务端开奖。

[下载部署包](https://github.com/coency/web-3d-lottery/releases) · [部署说明](docs/部署说明.md) · [开发与测试](docs/开发与测试.md) · [2000 人模拟测试](docs/开发与测试.md#2000-人服务器测试)

## 主要功能

- **活动配置**：活动名称、品牌 Logo、背景、签到字段和展示信息。
- **微信签到**：服务号配置、域名校验文件上传、手机授权及签到名单管理。
- **五种大屏主题**：梦幻星球、星光矩阵、星轨光波、星光长廊、星河瀑布。
- **抽奖与补抽**：服务端保存开奖结果，每轮最多 10 人，支持指定获奖人员、不在场补抽、中奖名单和操作记录。
- **彩排测试**：彩排与正式活动数据隔离，可生成 1–5000 名模拟参与者；头像按需生成并复用。
- **头像准备**：大屏分批下载头像并缓存到本机浏览器，减少重复下载；抽奖操作仍需连接服务器。
- **部署维护**：自动安装 Docker、升级前备份、数据恢复和升级后的文件清理。

## 安装到服务器

前往 [Releases](https://github.com/coency/web-3d-lottery/releases)，选择一种部署包：

| 部署方式 | 下载文件 | 服务器上的处理方式 |
| --- | --- | --- |
| 源码部署包 | `starlit-版本-source.tar.gz` | 下载基础镜像及 npm 依赖，在服务器构建应用 |
| Docker 镜像部署包 | `starlit-版本-images.tar.gz` | 导入包内镜像，无需现场编译 |

同时下载压缩包的同名 `.sha256` 文件，以及对应的 `SOURCE_INSTALLATION.md` 或 `IMAGES_INSTALLATION.md`。按说明逐步安装，**两种部署包任选一种**。

支持 Ubuntu 22.04 / 24.04、Debian 12 / 13，Linux x86_64 架构。两种包都会自动安装缺少的 Docker Engine 和 Compose。需准备可访问的域名并放行 TCP 80、443；安装 Docker、申请 HTTPS 证书和微信接入仍需联网。

GitHub 自动生成的 `Source code (zip/tar.gz)` 是仓库源码快照，不是整理好的部署包。首次安装、升级、备份、清理和故障处理统一见[部署说明](docs/部署说明.md)。

**版本状态**：目前已发布 `v1.0.0-rc.2` 预发布部署包。`main` 中新增的模拟头像按需生成和文档合并尚未重新打包；下载 rc.2 不会包含这些后续修改。各版本内容见 [Release 更新说明](https://github.com/coency/web-3d-lottery/releases)。

## 本地开发

准备 Node.js **24.14.1 或更新的 24.x**、npm 和 Git。本地数据库由开发脚本管理，无需安装 Docker Desktop 或 WSL。

1. 下载源码：

```sh
git clone https://github.com/coency/web-3d-lottery.git
```

2. 进入项目目录：

```sh
cd web-3d-lottery
```

3. 安装依赖：

```sh
npm ci
```

4. 启动开发环境：

```sh
npm run dev
```

打开 [本地后台](http://127.0.0.1:5173)。首次启动没有预置账号和活动，账号初始化方法见[开发与测试](docs/开发与测试.md)。停止服务后，本地数据库会保留。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 管理后台与手机签到 | Vue 3、TypeScript、Element Plus、Vite |
| 3D 大屏 | Three.js、WebGL |
| 后端接口 | Node.js、NestJS |
| 数据库 | PostgreSQL |
| 部署与 HTTPS | Docker Compose、Caddy |

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `apps/web/src/` | 管理后台和手机签到页面 |
| `apps/web/stage/` | 大屏主题、动画和头像缓存 |
| `apps/web/public/` | 默认 Logo、占位图和兼容资源 |
| `apps/api/src/` | 账号、活动、微信签到、头像生成与服务端开奖 |
| `packages/contracts/` | 前后端共享接口类型 |
| `db/migrations/` | 数据库初始化和升级脚本 |
| `deploy/container/` | 镜像构建、安装、升级及维护脚本 |
| `scripts/` | 开发启动、集成验证和打包工具 |
| `tests/` | 单元测试和部署测试 |
| `docs/` | 部署说明、开发与测试两份文档 |
| `.github/workflows/` | GitHub Actions 镜像构建和发布流程 |

## 测试与发布

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 类型检查 |
| `npm test` | 单元测试 |
| `npm run build` | 生产构建 |
| `npm run test:deployment` | 安装、升级、备份和清理测试 |
| `npm run verify:rehearsal-seed` | 2000 人模拟参与者流程验证 |
| `npm run release:check` | 完整发布验收 |

测试环境要求、模拟测试步骤和制作部署包的方法见[开发与测试](docs/开发与测试.md)。镜像包也可通过仓库的 GitHub Actions 工作流构建。版本更新内容维护在 Release 页面，部署包和 SHA256 文件作为 Release 附件发布。

## 数据与配置

源码仓库不包含开发电脑的账号、活动、数据库、上传文件或微信密钥；模拟头像在运行时生成，不提交预生成的 5000 张图片。

环境配置参考 [.env.example](.env.example)。`.local/`、构建输出、测试产物及部署包均由忽略规则排除。生产环境的配置、数据、证书和备份应在服务器上妥善保存。
