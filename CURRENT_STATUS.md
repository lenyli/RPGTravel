# RPGTravel 当前状态

项目状态：进行中

当前阶段：本地候选已完成，未公开部署；等待用户验收。

lastUpdated：2026-09-20 14:46（Asia/Shanghai）

## 当前实现

- PWA 候选 1.1.0；决定版本 v1.1；故事协议 schemaVersion 1.1（RPG_TRIP_V1 外壳），进度版本 2。
- 首屏旅行表单、完整生成 Prompt、复制兜底、草稿保存、整条回答/文件导入、中文校验与修复 Prompt、概要预览。
- 按地点独立任务，所有地点均可选择；编号不限制完成顺序，日期仅作参考。支持先做 3 再做 1、2，或保留当前勾选切换其他地点。叙事提示禁止前置任务和固定行程。
- 手动开始、3–5 项行动、主动完成、跳过补叙、已获线索、按实际解决时间排列的日志、全部地点解决后的结局。
- 本机多存档、独立 UUID、原子事务、并发保护、失败重试/导出、完整或故事备份、恢复、重开与删除确认。
- 地点/交通/安全信息、受控外部地图搜索、按需单次定位与可信坐标直线距离；无坐标/拒绝定位仍可游玩。
- 生产 SW 预缓存、更新提示及保存后更新、安装指引、根路径与子路径。无 AI API、账号、后端或云同步。

## 当前验证基线

验证日期：2026-09-20；对象为上述自由地点版本，不沿用旧单链用例结果。

| 检查                     | 实际结果                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | 通过                                                                                                          |
| npm run test             | 149 / 149 通过；5 个测试文件                                                                                  |
| npm run test:e2e         | 52 / 52 通过；Chromium 26、WebKit 26；无 skip、无 flaky                                                       |
| 新玩法                   | 3→1→2 完成、多个 active 切换/重载/导出恢复、非前缀完成和线索/日志顺序均通过                                   |
| 离线                     | 同 context、同 origin 保留存储后关闭页面重开；读取草稿/精确勾选、完成/跳过到结局、生成 Prompt、导出与恢复通过 |
| 更新与路径               | 真实 A/B 生产构建更新保留进度、草稿和同域其他缓存；根路径与 /rpg-trip/ 资源、manifest、SW scope 通过          |
| 手机布局                 | 360/390px、横屏、桌面、长中文、200% 文字、缩小视口模拟键盘通过                                                |
| build / schema / package | dist 构建通过，同源 Schema 导出通过，ZIP 与 dist 全部文件字节一致、完整性检查通过                             |
| 静态记录检查             | README 7 个固定章节/资料字段、manifest 路径检查通过；ProjectRecord 目录已退役，无镜像待同步                   |

证据：[单元结果](artifacts/unit-results.json)、[浏览器结果](artifacts/e2e-results.json)、[汇总与包哈希](artifacts/verification-summary.json)、[关键截图](artifacts/screenshots/manifest.json)、本地 [HTML 报告](artifacts/e2e-report/index.html)。

## 交付入口

- 源码根：`/Volumes/Leny/Projects/RPGTravel`；指定远端：[lenyli/RPGTravel](https://github.com/lenyli/RPGTravel)。
- 本机启动：`npm run preview -- --port 4173`，访问 `http://127.0.0.1:4173/`；首次进入直接为表单，不自动导入测试故事。
- 静态产物：`dist/`、[RPGTravel-1.1.0-static.zip](artifacts/RPGTravel-1.1.0-static.zip)、[SHA-256](artifacts/RPGTravel-1.1.0-static.zip.sha256)。
- 唯一 Schema 的导出：[rpg-trip-v1.schema.json](artifacts/rpg-trip-v1.schema.json)。

## 有效决定与限制

有效决定为 [RPGTRAVEL-20260920-002](DECISION_EVENTS.md#rpgtravel-20260920-002)，替代启动决定中的固定链路/日程部分，其余产品与权限边界保留。初版草案 1.0 不自动猜测转换，用户可复制修复 Prompt 请求新的独立地点包。

WebKit 的 `context.setOffline(true)` 在此自动化环境的页面重开报内部错误；已通过服务器实际断开生产资源连接且未缓存请求失败的对照验证完整离线闭环，证据见 [诊断记录](artifacts/webkit-offline-diagnostic.json)。这不等于该模拟接口通过，也不等于真实 iPhone 验收。

没有真实手机通道；Safari 添加到主屏幕、真实系统剪贴板/文件分享、真机离线杀进程重开和实际地图 App 唤起待验收。自动化的模拟权限、缩小视口与 WebKit 不能代替这些实机结果。旅行事实与任何真实目的地未由应用联网核实。未公开部署，没有手机可访问的正式 HTTPS 地址。

## 下一步

1. 用户从首页用自己的旅行需求与 AI 完成一轮生成、自由选地点、导出恢复验收。
2. 在真实 iPhone/iPad 的 HTTPS 环境验证安装、切换 AI、离线杀进程重开和文件保存；公开部署须后续明确授权。
