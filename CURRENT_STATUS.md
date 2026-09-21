# 旅章（RPGTravel）当前状态

项目状态：进行中

当前阶段：旅章已在现有 GitHub Pages 成功发布，游戏风格选填且无预设的改动已同步；线上启动与静态资源已核验，真实手机验收待进行。

lastUpdated：2026-09-21 12:26（Asia/Shanghai）

## 当前实现

- 应用名称“旅章”，PWA 候选 2.0.0；决定版本 v2.1（新增现有站点发布授权）；故事协议 schemaVersion 1.1（RPG_TRIP_V1 外壳），进度版本 2。仓库、数据库与旧存档身份保持不变。
- 首屏旅行表单、完整生成 Prompt、复制兜底、草稿保存、整条回答/文件导入、中文校验与修复 Prompt、概要预览。游戏风格为选填、默认空白，生成及修复 Prompt 不设默认游戏参考；未填写时生成故事的 gameStyle=[]，修复既有故事则保留其风格。旧草稿中的固定预设只清除一次，其他输入和粘贴内容保留，后续主动填写相同文字也能保存。
- 来源网址任意字符串按原文导入、保存、展示和导出；普通及 Markdown HTTP(S) 网址可点击，其余保留文本，不再产生 INVALID_SOURCE_URL。完整 JSON 允许外围说明、混合或缺失标记；相同包去重，不同故事通过选择框预览，不再要求 AI 改写。章节副标题合入简介、缺区域沿用标题、缺简介留空；完整平铺或 meta/trip/metadata 冒险概要归位；缺核心剧情或类型错误仍明确提示。
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

- 线上入口：[旅章](https://lenyli.github.io/RPGTravel/)。现有 Pages 发布源为 `workflow`，继续启用 HTTPS。仅手动运行 GitHub Actions，以 `/RPGTravel/` 构建并上传 `dist`，不再将 main 根目录源码当作网站。
- [最新部署工作流](https://github.com/lenyli/RPGTravel/actions/runs/35557505717) 的 build / deploy 全部成功，发布应用源码提交 `756d1acd1652b08a5fd6c101a33c2349ddaeddc7`，包含游戏风格选填、默认空白与草稿兼容。应用为 2.0.0，部署授权决定为 v2.1。
- 线上首页、脚本、CSS、图标、manifest、SW / Workbox 共 11 个文件均 HTTP 200，与本地 `dist-pages` 逐字节一致。HTML 引用 `/RPGTravel/assets/`，不存在未替换的 `%BASE_URL%` 或 `/src/main.tsx`；manifest id/scope/start_url 均正确。
- 实际内置浏览器显示完整旅行表单、旅章导航和“喜欢的游戏风格 选填”；字段值为空、没有 placeholder、不设 required，控制台无 error；没有停留在启动提示页。证据：[pages-deployment-verification.json](artifacts/pages-deployment-verification.json)。缓存就绪提示不等于已进行真机断网测试。
- 本机仍使用 `http://127.0.0.1:4173/`；已有《云外无终》0 / 10 存档保留。双击 `启动旅章.command` 启动 HTTP 预览；直接文件入口仅显示说明，不执行应用。启动器通过 shell 语法检查，未模拟 Finder 双击；工具禁止访问 `file://`，没有绕过。
- 两份本地静态包保持根路径与 `/RPGTravel/` 用途区分，包完整性、11 个文件字节一致与资源路径检查通过；本机验证见 [pages-verification.json](artifacts/pages-verification.json)。线上和本机属于不同 origin，需导出完整存档后手动恢复，不自动同步。

## 当前验证基线

2026-09-21 导入兼容修复：

| 检查 | 实际结果 |
| --- | --- |
| 类型与格式 | `npm run typecheck`、变更源码/测试/Schema 的 Prettier 检查通过 |
| 单元回归 | 281 / 281 通过，8 个文件；覆盖提取、网址原文、章节/概要兼容、进度、照片、存储及备份 |
| 浏览器专项 | 4 / 4 通过，Chromium 2、WebKit 2；网址原文展示、Markdown 链接、安全文本、不主动外联、重复包、章节兼容与不同故事选择 |
| 当前失败原文复验 | 原文完整保留，更新后直接通过预览，3 章 / 6 项任务；控制台无错误，未替用户保存新冒险 |
| 构建及静态包 | 根路径与 Pages 构建通过，Schema 同源导出；两份 ZIP 完整性及各 11 个文件与构建逐字节一致 |
| 项目记录 | 静态布局检查通过；ProjectRecord 已退役，无镜像待同步 |

证据：[单元结果](artifacts/unit-results.json)、[浏览器专项](artifacts/import-compat-e2e-results.json)、[汇总与包哈希](artifacts/verification-summary.json)。本次代码待部署到线上。

2026-09-20 的完整浏览器回归基线为 66 / 66（Chromium 33、WebKit 33），本次未重跑全量：覆盖照片手记、3→1→2 自由地点、备份恢复、离线重开、SW 更新保留数据、根/子路径及窄屏布局。证据：[完整浏览器基线](artifacts/e2e-results.json)、[当时截图](artifacts/screenshots/manifest.json)。本次无新增截图。

用户手机截图中另有 116 项字段错误，但对应原文已丢失；已知的章节字段形态与完整概要放错层级已用合成用例验证，不能声称已对丢失原文逐项复验。

## 交付入口

- 线上访问：[旅章](https://lenyli.github.io/RPGTravel/)。
- 源码根：`/Volumes/Leny/Projects/RPGTravel`；指定远端：[lenyli/RPGTravel](https://github.com/lenyli/RPGTravel)。
- 本机启动：双击 `启动旅章.command`，或 `npm run preview -- --port 4173 --strictPort`，访问 `http://127.0.0.1:4173/`；首次进入直接为表单，不自动导入测试故事。
- 静态产物：`dist/`、[RPGTravel-2.0.0-static.zip](artifacts/RPGTravel-2.0.0-static.zip)、[SHA-256](artifacts/RPGTravel-2.0.0-static.zip.sha256)；已替换旧静态包。
- Pages 专用产物：`dist-pages/`、[RPGTravel-2.0.0-github-pages.zip](artifacts/RPGTravel-2.0.0-github-pages.zip)、[SHA-256](artifacts/RPGTravel-2.0.0-github-pages.zip.sha256)；仅供 `/RPGTravel/` 路径。
- 唯一 Schema 的导出：[rpg-trip-v1.schema.json](artifacts/rpg-trip-v1.schema.json)。

## 有效决定与限制

有效决定为 [RPGTRAVEL-20260920-002](DECISION_EVENTS.md#rpgtravel-20260920-002) 的自由地点玩法，以及 [RPGTRAVEL-20260920-004](DECISION_EVENTS.md#rpgtravel-20260920-004) 的“旅章”品牌与本机照片手记，以及 [RPGTRAVEL-20260921-001](DECISION_EVENTS.md#rpgtravel-20260921-001) 的现有 Pages 发布授权；无 AI API、后端、账号或云同步的边界保留。初版草案 1.0 不自动猜测转换，用户可复制修复 Prompt 请求新的独立地点包。

WebKit 的 `context.setOffline(true)` 在此自动化环境的页面重开报内部错误；已通过服务器实际断开生产资源连接且未缓存请求失败的对照验证完整离线闭环，证据见 [诊断记录](artifacts/webkit-offline-diagnostic.json)。这不等于该模拟接口通过，也不等于真实 iPhone 验收。

本次未在内置浏览器执行实际断网验收；缓存状态文案不作为实际离线失败或通过的证据。历史离线回归结果适用于 Playwright 的 Chromium / WebKit 环境。

没有真实手机通道；Safari 添加到主屏幕、真实系统剪贴板/文件分享、真机离线杀进程重开、相机/相册选择、HEIC 解码和实际地图 App 唤起待验收。自动化的模拟权限、缩小视口与 WebKit 不能代替这些实机结果。HEIC/HEIF 取决于浏览器解码能力，不能读取时明确提示转换为 JPEG。旅行事实与任何真实目的地未由应用联网核实。现有 HTTPS 站点已可访问，可用于后续真机验收；本次未上传个人剧本或照片到静态站点。

## 下一步

1. 用户在线验收旅章；需要继续本机《云外无终》时，先从本机导出完整存档，再在线导入。
2. 在真实 iPhone/iPad 验证安装、相册/拍照、离线杀进程重开和文件保存。
