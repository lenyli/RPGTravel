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
