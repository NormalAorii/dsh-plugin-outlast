# dsh-plugin-outlast · 逃生：试炼 QQ 查询助手

给 DeepSeek Harness 用的原生 Cordis 插件（纯 ESM，无构建、无运行时依赖），
把《逃生：试炼》(The Outlast Trials) 的攻略资料库和 Steam 实时公告接入成 9 个模型可调用工具，
配合已接入的 QQ 官方机器人（`@tencent-connect/dsh-qqbot`）即可在 QQ 群聊/私聊里直接问答。

> 状态：已在本人的 DSH desktop profile 中安装并实跑验收（`node scripts/verify.js` 46/46 通过）。

## 工具

| 工具 | 作用 | 典型问法 |
| --- | --- | --- |
| `outlast_help` | 功能菜单与指令说明 | 帮助 / 菜单 / 你能干什么 |
| `outlast_search` | 全库中英文模糊搜索 | 「监狱」「鹅妈妈」「注射器」 |
| `outlast_trials` | 关卡列表 / 进度结构 | 有哪些关卡 / MK 挑战 / 关卡顺序 |
| `outlast_guide` | 单关攻略（目标/步骤/技巧） | 警局怎么打 / 孤儿院攻略 |
| `outlast_enemies` | 敌人图鉴与应对 | 有哪些敌人 / 鹅妈妈怎么躲 |
| `outlast_items` | 消耗品 / Rig / 处方 / 货币 | 有什么道具 / Rig 怎么选 |
| `outlast_mechanics` | 核心机制与生存技巧 | 怎么躲 / 噪音机制 / 新手怎么上手 |
| `outlast_news` | Steam 官方公告实时抓取 | 最近有什么更新 |
| `outlast_card` | 生成 1080 宽图文攻略卡 PNG | 来张图 / 图文攻略 |

`outlast_card` 只负责渲染 PNG 并返回本地路径，**发图**由 `qqbot_send_file` 完成（模型会紧接着调用）。

## 资料库规模

41 个关卡（11 主线 Trial + 30 MK 挑战）· 14 个 Program · 21 个敌人 · 65 条道具/升级/货币/机制 · 31 条核心机制 · 10 条资讯快照。

## 安装

```bash
# 1) 把仓库放进 DSH 工作区（或任意本地目录）
git clone https://github.com/NormalAorii/dsh-plugin-outlast.git

# 2) 让 DSH 把该目录安装成 profile bundle（需要审批）
#    plugin_manager install_bundle → target = 该目录的绝对路径
#    例如：C:\Users\<you>\Documents\deepseek-harness\default-workspace\dsh-plugin-outlast
```

安装后 DSH 会把它挂进 profile 的 bundle（`cordis.patch.yml` 的 `insert` 条目），
不需要手改 profile 的 `package.json` / `cordis.patch.yml`，也不需要 `pnpm install`。
装完重启（或重载）DSH 后，模型侧会多出 9 个 `outlast_*` 工具。

自检（不需要 DSH 宿主，直接跑）：

```bash
node scripts/verify.js      # 46 项断言：数据完整性、9 个工具、实时新闻、PNG 卡片
node scripts/smoke.mjs      # 只跑卡片 + 新闻两段，出图更快
```

## 目录结构

```
index.js           插件入口：注册 9 个工具 + 4 行 system prompt 指引（order 900）
lib/tools.js       工具定义（参数 schema、中文描述、错误处理）
lib/store.js       数据加载与归一化、中英文模糊搜索、同义词扩展
lib/render.js      QQ markdown 文本渲染（3400 字上限内自动收尾）
lib/news.js        Steam ISteamNews 抓取 → RSS → 本地快照 三级降级
lib/cards.js       1080 宽图文卡：Node 侧排版 + PowerShell/System.Drawing 绘制
lib/core.js        defineTool 适配层（宿主 SDK 缺失时的兜底实现）+ HTTP 小工具
data/*.json        资料库（trials / enemies / items / mechanics / news）
scripts/verify.js  无宿主自检（46 项）
```

## 数据与来源

- `data/trials.json`：关卡（主线 Trials + MK 挑战）与 Program 结构
- `data/enemies.json`：敌人图鉴
- `data/items.json`：消耗品、Rig、处方/升级、货币、操作机制
- `data/news.json`：Steam 新闻源实测结果 + 离线快照
- 全部条目带 `sources` 与 `confidence`；`confidence` 非 high 的条目在回复里会明确标注「社区整理」。

攻略内容为社区资料整理，非官方wiki原文转帖；版本更新后可能有出入。
资讯优先实时抓取 `ISteamNews`（`appid=1304930`），失败退 RSS，再失败回退本地快照并在回复里说明原因。
卡片顶部横幅在运行时从 Steam CDN 拉取官方页头图（`cdn.cloudflare.steamstatic.com`，仅本地缓存，不随插件分发）。

## 限制

- 图文卡片依赖 Windows PowerShell + `System.Drawing`（字体自动回退：Microsoft YaHei UI → Microsoft YaHei → SimHei → Arial）；非 Windows 环境会明确报错，改走文字回复。
- 资讯与网络接口可能被墙/限流，失败时如实说明，不编造公告。
- 单条回复控制在 3400 字以内以适配 QQ markdown 消息长度上限。

## 许可

插件代码 MIT。游戏名称、相关设定与商标归 Red Barrels 所有；本插件仅为粉丝向查询工具。
