# RPG 旅行

记录类型：项目

## 项目资料

| 字段     | 内容                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 项目名称 | RPGTravel                                                                                                                      |
| 项目简介 | 将旅行需求转换为可复制给外部 AI 的故事生成提示，再把完整故事包导入本机，沿真实地点进行调查、揭露线索与收束故事的离线旅行 PWA。 |
| 项目类型 | 独立应用项目                                                                                                                   |
| 领域     | 旅行叙事与现场探索                                                                                                             |
| 平台     | 浏览器 / 手机优先 PWA；实际设备支持以验收结果为准                                                                              |
| 技术     | Vite、React、TypeScript、普通 CSS、Zod 4、idb、vite-plugin-pwa；Vitest、Playwright                                             |
| 架构     | 纯静态应用；地点故事与进度分离；IndexedDB 本机存储；hash 路由                                                                  |
| Agent    | 当前无持久项目 Agent 配置；本次采用临时协议、存储、验收分工，不安装 Agent 框架                                                 |
| Skill    | 已读取全局 implement、pwa-app；与本次明确技术栈、测试和临时分工要求冲突的技能默认值不采用                                      |
| 源码     | 本目录为唯一源码与记录根；远端 https://github.com/lenyli/RPGTravel                                                             |
| 关联     | 无其他个人产品集成；共享规则 `/Volumes/Leny/Projects/CLAUDE.md`                                                                |

## 定位与范围

首页始终是旅行表单：填目的地与日期 → 复制生成 Prompt → 自行交给常用 AI → 粘贴完整回答 → 预览 → 保存并开始。生成、校验和游玩全部在设备内执行。

**无 AI API、无账号、无应用后端、无云同步。** 不读取系统剪贴板，不后台定位，不上传照片，不记录轨迹。复制给 AI、打开地图/来源和分享备份由用户主动触发。

AI 按地点生成独立调查，不安排必须照走的固定行程。各地点围绕同一谜团提供不同线索，没有地点前置条件；旅行日期用于季节与开放信息背景，任务日期与时段只是可选参考，编号只作查找顺序。

每项调查有 3–5 个行动；你可以直接选第 3 个地点开始，也可做了一半切到另一地点，回来时勾选仍保留。手动到达、逐项勾选、主动完成后取得线索。现场受阻可确认跳过，以明确补叙取得该地点线索；全部地点完成或跳过后才展示完整结局，并准确区分完成和跳过。地点、地址与安全信息始终公开，未获得线索与 NPC 内部动机不提前展示。

格式通过只表示结构与一致性通过，不代表地点、来源、历史、开放、预约和路线已核验。测试故事标题含“协议测试”，地点完全虚构，不能作为旅行建议，且不会自动进入用户库或生产 Prompt。

## 架构与技术

### 模块与协议

- `src/protocol/schema.ts`：唯一正式 strict Zod 结构；通过 `z.infer` 导出 TypeScript 类型，通过 `z.toJSONSchema` 生成完整自包含 JSON Schema。
- `src/protocol/validate.ts`：真实日历日期、全局 ID、地点分组与展示顺序、引用、来源和可信 WGS84 坐标校验。
- `src/protocol/extract.ts`：有限容错的标记/裸 JSON/单围栏提取、安全键检查和 UTF-8 限额。原包最多 2 MiB，备份最多 4 MiB，内含紧凑故事仍最多 2 MiB。
- `src/protocol/prompt.ts`：完整生成/修复模板，与导入器共享 Schema；用户数据经过 JSON 序列化，未关联的新表单不冒充原始请求。
- `src/domain/progress.ts`：唯一任务进度事实，日志/线索派生；纯函数验证动作，自由选择地点、保留各地点独立进度，不重复存剧情状态。
- `src/domain/navigation.ts`：受控地图关键词 URL、按需定位、Haversine 直线距离，不向地图传入 PWA 获取的精确起点。
- `src/storage/db.ts`：DB v1 的 adventures / progress / settings；UUID 实例主键、完整事务和版本冲突检查。
- `src/storage/backup.ts`：`RPG_TRIP_SAVE` v1 双模式存档；恢复创建新实例，损坏进度须明确选择仅导入故事。
- `src/state.tsx`：草稿读取与 400ms 自动保存、事务后 UI 更新、未保存进度保留与重试；应用更新前等待全部写入。
- `src/pages/`：首页、调查、地点、日志、冒险库。`src/components/` 只容纳复用交互。

每个地点独立转换 `available → active → completed / skipped`，available 也可经确认直接 skipped。初始所有地点均可选择；同时允许多个已开始但未解决的调查，`currentQuestId` 仅记录当前选择。完成后默认选中一个尚未解决的地点作为继续入口，随时可改选，不等于路线要求。日期、定位、地点编号和外部地图都不是推进门槛。

当前生成协议为 `schemaVersion: "1.1"`，外壳仍为 `RPG_TRIP_V1`；进度版本为 2，备份 envelope 版本仍为 1。章节仅按地点区域组织，去除了 day 和任务 initialStatus/unlockQuestIds；recommendedDate 可以为 null。尚未发布的旧 1.0 草案不自动猜测转换，导入时明确报不支持，并可复制同源修复 Prompt 重新生成。

### 本机隐私与存储

内容仅保存在当前 origin 的当前浏览器。其他设备、浏览器、域名、端口或协议不能自动读取旧存档。清理站点数据可能删除全部本机内容；“请求保留本机数据”以浏览器实际批准结果为准，不替代文件备份。

软件更新更新本应用资源缓存，保留 IndexedDB；发现新版本会提示“保存并更新 / 稍后”，不会打断当前编辑或清理其他应用缓存。数据库不可用、空间不足、其他页面升级或并发修改均给出中文说明，不以删除数据库修复。

AI 文本使用普通 React 文本节点和 `white-space: pre-wrap` 展示，不执行 HTML/Markdown。来源仅允许 http/https；外部链接使用 `noopener noreferrer`。导航地址与安全提醒不受剧情锁影响。

## 运行与验证

### 安装和启动

项目使用 Node 22.12 及以上兼容版本；本次环境为 Node 22.19.0 / npm 10.9.3。依赖固定在 `package.json` 与 `package-lock.json`，不需要全局安装工具。

```sh
npm ci
npm run dev
```

开发地址以命令输出为准（默认 `http://127.0.0.1:5173/`），开发模式不注册 SW。

```sh
npm run typecheck
npm run test
npm run build
npx playwright install chromium webkit
npm run test:e2e
npm run format:check
npm run schema
npm run package
npm run preview -- --port 4173
```

- `test` 为非 watch 单元测试，输出 `artifacts/unit-results.json`。
- `test:e2e` 基于真实生产产物，需要先 `build`；自动启动根目录 preview 和仅本地的升级/子路径验收服务器。测试构建位于 `artifacts/deployment/`，不进入静态部署包。
- 浏览器结果：`artifacts/e2e-results.json`、本地 HTML 报告 `artifacts/e2e-report/index.html`、截图 `artifacts/screenshots/`。
- `schema` 实际从 `schema.ts` 导出 `artifacts/rpg-trip-v1.schema.json`。
- `package` 将当前 `dist/` 内容打包为 `artifacts/RPGTravel-1.1.0-static.zip`，生成同名 `.sha256`。打包前必须先构建。
- `format` 用于显式格式化；提交前使用 `format:check` 检查。JSON fixtures 来源于执行指导附录 A，无效用例有明确分类清单。

### 安装、部署与离线边界

最终 `dist/` 为纯静态文件，无需常驻 Node 或服务器数据库。**当前未公开部署，也没有真实手机访问地址。** 本机验收用 `npm run preview -- --port 4173`，打开 `http://127.0.0.1:4173/`。双击 ZIP 或 `file://` 不属于可安装/离线的交付方式。

用户后续授权部署时，将 ZIP 解压后的内容上传到指定 HTTPS 静态托管目录。hash 路由无需服务端重写。根路径默认 `/`；子路径构建：

```sh
DEPLOY_BASE=/rpg-trip/ npm run build
```

`vite.config.ts` 统一控制 base、manifest id/start_url/scope 与缓存标识；图标引用匹配该路径。更换路径/origin 之前先导出备份，迁移后手动恢复。恢复默认根目录产物使用 `npm run build`。

首次联网打开并完成资源缓存后可离线重开首页和任务，读取草稿、生成 Prompt、导入、推进、导出和恢复。外部 AI、地图、来源网站及定位提供者不属于离线保证。普通手机局域网 HTTP 地址不是该手机的 localhost，不能据此宣称定位/安装成立。

支持浏览器安装提示时出现安装按钮；iPhone/iPad 在 Safari 分享菜单选择“添加到主屏幕”。安装状态与缓存状态分别显示。桌面 WebKit 自动化不等于真实 iPhone Safari 或主屏幕 PWA 验收。

### 文件备份

在“我的冒险”选择“导出完整存档”保留故事、勾选与进度；“导出故事”仅含故事。标准 envelope 不包含 rawReply、旅行表单草稿和定位数据。

文件默认名为 `冒险标题_存档_YYYY-MM-DD.rpgtrip.json`，使用通用下载、系统分享（可用时）或复制完整文件内容兜底。浏览器/系统决定保存位置，应用只确认文件已生成。首页“从文件恢复”可选 JSON / rpgtrip，也可粘贴文件文本；每次恢复是新存档，相同故事由用户选择打开已有或另存一份。

### 验收标准

先从空白首页实际填写并复制，使用自己的 AI 返回完整包，再走预览→保存→任选地点→手动到达→行动→线索→自由切换地点→跳过/结局→导出恢复。出门前确认离线资源就绪，断网关闭再打开测试已保存进度。

自动化覆盖协议正反例、全部状态和损坏存档、事务失败、Chromium/WebKit 上的完整故事、复制兜底、草稿恢复、无第三方请求、定位四态、自由地点切换/线索防剧透、离线冷开、更新保留数据、根/子路径、窄屏和放大布局。精确的本次结果及未覆盖项只以 [CURRENT_STATUS.md](CURRENT_STATUS.md) 为准。

## Agent 与 Skill

能力清单为 [.ai/manifest.yaml](.ai/manifest.yaml)。未新增持久 Agent 或平台模型配置；临时实现协作不作为已议定的长期 Agent 阵容登记。

采用 [implement](/Volumes/Leny/Projects/skills/implement/SKILL.md) 的范围和验证纪律，参考 [pwa-app](/Volumes/Leny/Projects/skills/pwa-app/SKILL.md) 的本机 PWA 存储与安装边界。本次用户指定 React/Vite 构建、测试和连续分工，因此不采用技能中的原生单文件结构、默认不测试等冲突项。读取 ego-browser 入口后，本次自动化按用户文档明确要求使用 Playwright 双浏览器测试。

## 项目约束

仅修改本项目与获持续授权的本项目共享索引记录，不写其他应用源码、系统 Node、域名或部署账号。独立生命周期，不归父仓；`.gitignore` 排除 exFAT `._*`、`.DS_Store`、依赖和临时测试缓存。

无 Next.js 服务端、Electron/Tauri 原生壳、地图 SDK、远程字体/CDN、AI 服务、账户和云同步。无 GPS 自动完成、实时路线规划、后台监听、多人或复杂分支。普通实现细节按已确认指导执行，真实权限、账号、费用和不可解决环境限制才阻塞相应分支。

应用名称统一在 `src/config.ts` 修改，页面标题、界面和 manifest 随构建使用同一配置；产品正式更名时同步项目文档标题。协议结构不可单独手工维护第二份 JSON Schema；改动协议必须同步结构、Prompt、校验与正反例。

## 记录与链接

- [当前状态与实际证据](CURRENT_STATUS.md)
- [只追加的正式决定](DECISION_EVENTS.md)
- [完整测试故事](tests/fixtures/valid-trip.json)（完全虚构）
- [导出的 V1 Schema](artifacts/rpg-trip-v1.schema.json)
- [现有远端仓库](https://github.com/lenyli/RPGTravel)

实施输入：用户提供的 `Codex_RPG_Travel_PWA_From_Zero.md` 执行指导 v1.0（2026-09-20）及同日“按地点任务，不绑定固定行程”的明确修订，作为一次性输入，不作实时状态源。框架接口以安装包和 [Zod JSON Schema 文档](https://zod.dev/json-schema)、[Vite PWA 更新提示文档](https://vite-pwa-org.netlify.app/guide/prompt-for-update) 复核。
