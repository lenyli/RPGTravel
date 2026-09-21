# 旅章（RPGTravel）当前状态

项目状态：进行中

当前阶段：本机预览已恢复；GitHub Pages 白屏根因已确认，部署修复与专用包已在本机验证，尚未发布修复。

lastUpdated：2026-09-21 10:43（Asia/Shanghai）

## 当前实现

- 应用名称“旅章”，PWA 候选 2.0.0；决定版本 v2.0；故事协议 schemaVersion 1.1（RPG_TRIP_V1 外壳），进度版本 2。仓库、数据库与旧存档身份保持不变。
- 首屏旅行表单、完整生成 Prompt、复制兜底、草稿保存、整条回答/文件导入、中文校验与修复 Prompt、概要预览。
- 按地点独立任务，所有地点均可选择；编号不限制完成顺序，日期仅作参考。支持先做 3 再做 1、2，或保留当前勾选切换其他地点。叙事提示禁止前置任务和固定行程。
- 手动开始、3–5 项行动、主动完成、跳过补叙、已获线索、按实际解决时间排列的日志、全部地点解决后的结局。
- 本机多存档、独立 UUID、原子事务、并发保护、失败重试/导出、完整或故事备份、恢复、重开与删除确认。
- 任务未完成时也可添加照片；“日志 → 照片手记”按任务保存多张图片和说明，支持放大、编辑说明、确认删除。任务页可直接进入对应照片页。照片仅存在本机，无远端上传。
- 照片在浏览器内压缩为 JPEG，长边最多 1600 像素、单张最多 1 MiB；每任务 6 张、每冒险 30 张/12 MiB。完整备份 v2 包含照片，故事分享不含照片；旧 v1 备份与缺照片字段的本机记录仍可读取。写入失败可重试或导出待保存照片，重开保留照片。
- 地点/交通/安全信息、受控外部地图搜索、按需单次定位与可信坐标直线距离；无坐标/拒绝定位仍可游玩。
- 生产 SW 预缓存、更新提示及保存后更新、安装指引、根路径与子路径。无 AI API、账号、后端或云同步。

## 本地剧本预览

用户提供的 `峨眉山RPG_天绅凝霜录_四篇整合版.md` 已适配为《云外无终》。这是峨眉山剧本名，应用名为“旅章”。保留人物关系、主谜与完整结局文本，改为 10 项自由地点任务；一线天/生态猴区保留为可选附页，万佛顶仅作纸面档案，不增加必去地点。

- 导入包：[云外无终\_峨眉山.rpgtrip.json](artifacts/local-stories/云外无终_峨眉山.rpgtrip.json)。该目录为本机内容产物，已排除 Git 与静态应用构建，未公开或推送。
- 当前协议要求冒险日期字段，源稿未提供实际出行日期；2026-09-20 仅为明示的预览格式占位，各任务 recommendedDate 全为 null。没有编造坐标或来源核验结果。
- 实际内容校验：正式 parseImport 通过；10→1 逆序完成、全跳过补叙、完整备份往返通过。已在当前 Codex 内置浏览器通过粘贴入口导入并打开，展示《云外无终》与 10 项任务；用户存档保持未完成状态。
- 已在当前内置浏览器通过“保存并更新”从旧版升级到旅章，原《云外无终》存档与 0 / 10 进度保留，已打开伏虎寺“照片手记”入口，没有向用户存档写入测试照片。
- 故事内容检查记录见 [preview-validation.json](artifacts/local-stories/preview-validation.json)，本次应用更名和照片功能不改剧本文本。

## 部署与本机启动

- 2026-09-21 实际读取 `https://lenyli.github.io/RPGTravel/`：首页 HTTP 200，但仍含 `%BASE_URL%` 和 `/src/main.tsx`；该脚本 URL 返回 404。确认当前发布了源码入口，应用未启动。尚未变更远端或 GitHub Pages 账号设置，线上问题未声称解决。
- 新增手动 Pages 工作流，正确设置 `/RPGTravel/` 并仅上传编译后的 `dist`；新 `build:pages` / `package:pages` 输出专用 `dist-pages/` 与 ZIP，不混用根路径产物。
- 双击 `启动旅章.command` 可启动本机 HTTP 预览；HTML 源码入口加入失败说明，避免仅显示空白。启动器做过 shell 语法检查，未模拟 Finder 双击；当前预览通过同样的 npm preview 命令启动。
- 本机实际浏览器确认：4173“我的冒险”显示旅章和《云外无终》0 / 10 原存档；4179 的 `/RPGTravel/` 专用产物显示完整表单并报告资源已缓存。未执行实际断网检查；工具禁止访问 `file://`，直接文件入口仅作源码检查，没有绕过限制。
- 根路径与 Pages 构建、两份 ZIP 完整性/11 个文件字节一致、页面全部脚本/样式/图标/manifest 路径存在、manifest scope/start_url/id 正确，全部通过。证据：[pages-verification.json](artifacts/pages-verification.json)。
- 工作流 YAML、手动触发、最小权限、固定官方 Action SHA、上传范围与关闭站点自动启用均通过静态检查。实际云端执行待发布授权。

## 当前验证基线

业务回归基线日期：2026-09-20；对象为旅章 2.0.0 照片手记与自由地点版本。本次只改启动与部署，未重跑下列 206 / 66 业务测试；2026-09-21 的实际针对性检查见上节。

| 检查                     | 实际结果                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | 通过                                                                                                                                                                |
| npm run test             | 206 / 206 通过；6 个测试文件                                                                                                                                        |
| npm run test:e2e         | 66 / 66 通过；Chromium 33、WebKit 33；无失败、skip、flaky                                                                                                           |
| 照片手记                 | 多选、实际图像解码、任务隔离、刷新保留、说明编辑、删除确认、损坏拒绝、配额失败重试不重复、完整备份恢复/故事隐私隔离、离线重开、手机无横溢出均通过；新增专项 14 / 14 |
| 新玩法                   | 3→1→2 完成、多个 active 切换/重载/导出恢复、非前缀完成和线索/日志顺序均通过                                                                                         |
| 离线                     | 同 context、同 origin 保留存储后关闭页面重开；读取草稿/精确勾选、完成/跳过到结局、生成 Prompt、导出与恢复通过                                                       |
| 更新与路径               | 真实 A/B 生产构建更新保留进度、草稿和同域其他缓存；根路径与 /rpg-trip/ 资源、manifest、SW scope 通过                                                                |
| 手机布局                 | 360/390px、横屏、桌面、长中文、200% 文字、缩小视口模拟键盘通过                                                                                                      |
| build / schema / package | dist 构建通过；故事 Schema 未变，沿用同源导出；2.0.0 ZIP 的 11 个文件与 dist 字节一致、完整性检查通过                                                               |
| 静态记录检查             | README 7 个固定章节/资料字段、manifest 路径检查通过；ProjectRecord 目录已退役，无镜像待同步                                                                         |

证据：[单元结果](artifacts/unit-results.json)、[浏览器结果](artifacts/e2e-results.json)、[汇总与包哈希](artifacts/verification-summary.json)、[关键截图](artifacts/screenshots/manifest.json)、本地 [HTML 报告](artifacts/e2e-report/index.html)。

## 交付入口

- 源码根：`/Volumes/Leny/Projects/RPGTravel`；指定远端：[lenyli/RPGTravel](https://github.com/lenyli/RPGTravel)。
- 本机启动：双击 `启动旅章.command`，或 `npm run preview -- --port 4173 --strictPort`，访问 `http://127.0.0.1:4173/`；首次进入直接为表单，不自动导入测试故事。
- 静态产物：`dist/`、[RPGTravel-2.0.0-static.zip](artifacts/RPGTravel-2.0.0-static.zip)、[SHA-256](artifacts/RPGTravel-2.0.0-static.zip.sha256)；已替换旧静态包。
- Pages 专用产物：`dist-pages/`、[RPGTravel-2.0.0-github-pages.zip](artifacts/RPGTravel-2.0.0-github-pages.zip)、[SHA-256](artifacts/RPGTravel-2.0.0-github-pages.zip.sha256)；仅供 `/RPGTravel/` 路径。
- 唯一 Schema 的导出：[rpg-trip-v1.schema.json](artifacts/rpg-trip-v1.schema.json)。

## 有效决定与限制

有效决定为 [RPGTRAVEL-20260920-002](DECISION_EVENTS.md#rpgtravel-20260920-002) 的自由地点玩法，以及 [RPGTRAVEL-20260920-004](DECISION_EVENTS.md#rpgtravel-20260920-004) 的“旅章”品牌与本机照片手记，其余产品与权限边界保留。初版草案 1.0 不自动猜测转换，用户可复制修复 Prompt 请求新的独立地点包。

WebKit 的 `context.setOffline(true)` 在此自动化环境的页面重开报内部错误；已通过服务器实际断开生产资源连接且未缓存请求失败的对照验证完整离线闭环，证据见 [诊断记录](artifacts/webkit-offline-diagnostic.json)。这不等于该模拟接口通过，也不等于真实 iPhone 验收。

当前内置浏览器更新后底部仍显示“正在准备离线资源”，未在该浏览器执行实际断网验收；这不作为离线失败或通过的证据。上表离线结果适用于 Playwright 的 Chromium / WebKit 环境。

没有真实手机通道；Safari 添加到主屏幕、真实系统剪贴板/文件分享、真机离线杀进程重开、相机/相册选择、HEIC 解码和实际地图 App 唤起待验收。自动化的模拟权限、缩小视口与 WebKit 不能代替这些实机结果。HEIC/HEIF 取决于浏览器解码能力，不能读取时明确提示转换为 JPEG。旅行事实与任何真实目的地未由应用联网核实。现有 HTTPS 站点正在发布错误入口，尚不可用；需要发布修复后再做真机验收。

## 下一步

1. 获得针对现有 Pages 站点的发布授权后，提交/推送部署修复，切换 Pages Source 为 GitHub Actions 并手动执行工作流，再核验线上首页和资源。
2. 用户在本机“旅章”验收《云外无终》与任务照片；公开站点恢复后再验证真实手机安装、相册/拍照、离线重开和文件保存。
