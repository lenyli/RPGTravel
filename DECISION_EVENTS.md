# RPGTravel Decision Events

## RPGTRAVEL-20260920-001

- date: 2026-09-20
- type: decision
- project: RPGTravel
- relates_to: none
- supersedes: none

### Summary
启动独立项目 RPG 旅行，按用户提供的执行指导 v1.0 连续实施阶段 A→D。

### Decision
采用 Vite、React、TypeScript、Zod 4、idb、vite-plugin-pwa。首屏旅行表单离线生成 Prompt，用户自行交给外部 AI，再导入 RPG_TRIP_V1。单链剧情调查、线索与结局、本机多个独立存档、跳过补叙、文件备份与恢复、辅助定位和外部地图。执行单元、Chromium / WebKit、生产离线和子路径测试，交付静态候选包。用户本次明确指定 https://github.com/lenyli/RPGTravel 并授权实施后推送，覆盖附件中未提供远端时的禁止初始化/推送前提。

### Reason
用户要可以完整游玩的手机优先离线 PWA，使用自己的 AI，不引入服务端成本和账号依赖。

### Rejected
AI API、后端、账号、云同步、地图 SDK、自动 GPS 完成、复杂分支、公开部署和创建远端仓库。

### Implementation
pending

## RPGTRAVEL-20260920-002

- date: 2026-09-20
- type: revision
- project: RPGTravel
- relates_to: RPGTRAVEL-20260920-001
- supersedes: RPGTRAVEL-20260920-001

### Summary
按用户新增要求改为按地点组织、任意顺序完成的调查任务，不绑定固定行程。

### Decision
AI 为各地点生成可独立开始和完成的调查，共同围绕一个谜团；各条线索补充不同侧面，不要求先完成某一地点或已经获得另一条线索。日期、时段和路线仅供参考，通常不指定任务日期。玩家可自由选择地点、暂停当前调查并切换，回来保留勾选；结局仍在全部地点完成或明确跳过后收束。

这一修订替代 001 中固定单链解锁与按日章节的部分，其余离线、本机存储、导出、安全、排除项和远端授权保持有效。尚未发布的候选协议使用 schemaVersion 1.1，RPG_TRIP_V1 外壳不变；去除章节 day、任务 initialStatus/unlockQuestIds，recommendedDate 允许 null，进度版本为 2。旧协议不猜测转换，提示通过完整修复 Prompt 重新生成，无历史用户迁移层。

### Reason
用户明确要求：“要求ai只按照地点分不同任务，不一定要有固定行程，这样即使行程有变也不妨碍任务的完成”。固定前后置任务会把现实路线变更变成故事门槛，需要让各地点任务独立可达。

### Rejected
仅改提示措辞却保留顺序锁；日期/定位门禁；把不同访问顺序扩展为复杂剧情分支引擎。

### Implementation
pending

## RPGTRAVEL-20260920-003

- date: 2026-09-20
- type: implementation
- project: RPGTravel
- relates_to: RPGTRAVEL-20260920-001, RPGTRAVEL-20260920-002
- supersedes: none

### Summary
完成自由地点 PWA 候选 1.1.0 的实现、自动化验收和静态部署包。

### Decision
落实表单→用户自己的 AI→严格故事协议→独立地点调查→本机保存/备份的完整闭环。所有地点均可任意选择，部分调查切换后保留行动，线索日志按真实解决时间派生，全部地点完成或明确跳过后收束。落实原启动决定中保留的离线、定位辅助、外部地图、存档与排除项。

### Reason
用户需要可验收的成品，并明确要求现实行程变化不妨碍任务完成。

### Rejected
none。

### Implementation
src/ 全模块、public/icons、固定 package/lockfile、测试 fixtures、149 项单元测试、52 项 Chromium / WebKit 验收通过。生产构建、同源 Schema、根/子路径、SW 更新数据保留、移动布局及自由顺序存档往返均通过。dist 与 artifacts/RPGTravel-1.1.0-static.zip 已核验一致。WebKit 离线采用实际资源连接切断对照，setOffline 内部错误保留证据；未公开部署、未作真实手机验收。实际报告与截图在 artifacts/，当前事实见 CURRENT_STATUS.md。

## RPGTRAVEL-20260920-004

- date: 2026-09-20
- type: decision
- project: RPGTravel
- relates_to: RPGTRAVEL-20260920-002
- supersedes: none

### Summary
应用正式命名为“旅章”，任务日志支持本机照片手记与完整备份。

### Decision
按用户要求修改显示名称、页面标题与安装名称，保留 RPGTravel 仓库标识、数据库与存档身份。每项任务可在未完成时添加照片、说明、放大回看与确认删除；图像在设备内缩放重编码，移除源图元信息。完整存档含照片，故事分享不含个人照片；备份增加严格 v2 并兼容旧 v1，照片不进入 AI 故事协议。重开保留照片，删除冒险连带删除，写入失败可重试或导出。仍为无后端、无云同步的纯本机 PWA。

### Reason
用户明确要求“app名字改为 旅章。任务日志里可以上传照片，不是只用文字记录”，需要让真实观察可随任务归档并可靠携带。

### Rejected
向远端上传照片、把照片交给 AI、仅显示临时图片却不持久化、导出完整存档时静默遗漏照片。

### Implementation
src/config.ts、index.html、src/domain/photos.ts、src/components/PhotoJournal.tsx、日志/任务页、state、IndexedDB 存储与备份导入导出。应用候选 2.0.0；决定版本 v2.0。实际验证与交付入口见 CURRENT_STATUS.md。

## RPGTRAVEL-20260921-001

- date: 2026-09-21
- type: revision
- project: RPGTravel
- relates_to: RPGTRAVEL-20260920-001, RPGTRAVEL-20260920-004
- supersedes: RPGTRAVEL-20260920-001

### Summary
按用户“修复并部署”的明确授权，修复并发布现有 GitHub Pages 站点。

### Decision
仅替代启动决定中禁止公开部署的部分：允许更新 `lenyli/RPGTravel` 的现有站点 `https://lenyli.github.io/RPGTravel/`。发布源从 main 根目录源码改为 GitHub Actions；按 `/RPGTravel/` 编译，只发布 `dist`，后续仍手动触发。无 AI API、后端、账号、云同步的产品边界保留；不创建新仓库，不把个人剧本与照片加入静态部署。

### Reason
用户报告线上与本地白屏，随后提供启动提示截图并明确要求“修复并部署”。原线上发布的源码引用 `/src/main.tsx`，该入口返回 404，必须改为发布编译产物。

### Rejected
继续直接发布源码根目录；把根路径静态包直接放到 `/RPGTravel/`；为解决部署问题增加后端或公开个人存档。

### Implementation
现有 Pages 已设为 workflow，`.github/workflows/pages.yml` 对源码提交 `627c41bf6de3d4c6596e8039656b619b9c3e68b6` 的运行 `35555906496` 构建/发布成功；线上 11 个资源与本地专用构建逐字节一致，实际浏览器表单启动、缓存就绪、无控制台 error。应用版本保持 2.0.0，决定版本变为 v2.1。证据见 `artifacts/pages-deployment-verification.json`，真机范围以 CURRENT_STATUS 为准。
