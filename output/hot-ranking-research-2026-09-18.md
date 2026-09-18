# 首页热门榜调研与改造建议

调研日期：2026-09-18。范围：官方文档、公开源码、本项目实现和公开接口；未修改业务代码或线上配置。

## 结论

当前榜单的主要问题是：把历史累计互动压缩成一个分数，再用最后一次评论时间对整个分数做很强的衰减。它容易把“刚有人回复”放大成“整帖很热门”。只提高浏览权重不能消除这个机制。

建议首页“热门”采用最近 48 小时的有效阅读与独立用户互动，保留最新流作为新帖获得初始曝光的入口。近期窗口、独立参与者、最小样本和完整的计数链路，应先于微调权重。

低浏览量本身不证明排名错误：少量阅读但得到多名真实用户认可的帖子可以上榜；低阅读、低参与，仅靠一条新回复进入前列，才是应当解决的问题。

## 一手资料对照

### Discourse：Hot 与 Top 是不同产品

- 官方将 Hot 定义为整体受欢迎程度与近期趋势的组合；Top 侧重选定周期内的热门内容，用于补看社区内容。
- 当前 Hot 源码统计最近窗口内的独立点赞用户数、独立发帖参与人数。默认近期窗口 7 天、gravity 1.2。
- 评分包含两项：一项按主题创建时间衰减；另一项按近期窗口内首条有效帖子的时间衰减。第二项使用近期点赞人数与参与人数。不是每条新评论都把整个主题的时间年龄归零。
- Hot 评分本身不使用浏览量；因此“Discourse 热门就是高浏览优先”不成立。
- Top 源码使用浏览、首帖点赞、每帖点赞比例、帖子数等信号，浏览和帖子数有对数项。有限周期还会对周期之前创建的主题置零；不能概括成“所有旧帖最近几天的访问榜”。
- Top 对点赞的周期统计也有细节：当前源码汇总窗口内创建的帖子的点赞数，而非统一对每个点赞事件做时间过滤。不要把两类产品和计数口径混为一谈。

来源：

1. [官方 Hot 发布说明与 Hot/Top 区别](https://meta.discourse.org/t/discover-popular-conversations-in-your-community-with-hot-topic-sorting/296747)
2. [当前 Hot 源码（固定提交）](https://github.com/discourse/discourse/blob/789d012d7fb6aaa15e1b707c34be22a03239c4c9/app/models/topic_hot_score.rb)
3. [Top 源码（固定提交）](https://github.com/discourse/discourse/blob/789d012d7fb6aaa15e1b707c34be22a03239c4c9/app/models/top_topic.rb)
4. [默认配置（固定提交）](https://github.com/discourse/discourse/blob/789d012d7fb6aaa15e1b707c34be22a03239c4c9/config/site_settings.yml)

### WordPress：没有统一热门算法，常用插件偏向近期访问统计

- WordPress 本体不记录文章浏览量；实际热门功能通常来自主题或插件。
- WP Popular Posts 默认按过去 24 小时浏览量排序，可选 7 天、30 天、全部或自定义窗口，也可按评论数等排序。
- WPP 限时查询实际聚合时间窗内的 pageviews；按帖子发布时间筛选是独立的 freshness 选项，默认关闭。老文章能凭最近的新访问上榜。
- Jetpack Top Posts 官方描述为过去 48 小时流量最高的文章和页面；当前源码默认查询 2 天统计。
- 这些是 PV 统计，不能说成默认严格按 UV 去重。WPP 默认记录每次页面访问；WordPress.com 文档明确区分刷新/加载产生的 views 与识别浏览器后的 visitors。

来源：

5. [WPP 官方 FAQ](https://github.com/cabrerahector/wordpress-popular-posts/wiki/5.-FAQ)
6. [WPP 参数与默认值](https://github.com/cabrerahector/wordpress-popular-posts/wiki/2.-Template-tags#parameters)
7. [WPP 查询源码](https://github.com/cabrerahector/wordpress-popular-posts/blob/master/src/Query.php)
8. [Jetpack Top Posts 官方说明](https://jetpack.com/support/extra-sidebar-widgets/top-posts-pages-widget/)
9. [Jetpack Top Posts 源码](https://github.com/Automattic/jetpack/blob/trunk/projects/plugins/jetpack/modules/widgets/top-posts.php)
10. [WordPress.com 浏览量、访客与机器人口径](https://wordpress.com/support/stats/understand-your-sites-traffic/)

### Hacker News / Reddit：认可、时效与防操纵

- HN 官方 FAQ 说基础排名是票数除以提交以来时间的某次幂，另有举报、防刷、过热讨论降权等因素。时间基准是提交时间。
- Reddit 现行官方文档将 Hot 描述为最近获得赞的近期帖子；未公布现行精确公式。Home 还涉及个性化与多样性。
- Reddit 的经典 log10(净赞) + 发布时间/45000 算法来自已经归档的旧源码，只能作为历史参考。
- 没有证据表明这些平台统一采用某个最低浏览量。本站阈值必须视流量试验。

来源：

11. [Hacker News 官方 FAQ](https://news.ycombinator.com/newsfaq.html)
12. [Reddit 现行内容推荐说明](https://support.reddithelp.com/hc/en-us/articles/23511859482388-Reddit-s-Approach-to-Content-Recommendations)
13. [Reddit 历史排序源码](https://github.com/reddit-archive/reddit/blob/master/r2/r2/lib/db/_sorts.pyx)

## 本站为何出现低浏览帖靠前

当前默认公式：

```text
E = 0.2 × 浏览 + 4 × 点赞 + 4 × 评论 + 6 × 丁尼 + 10 × 三连计数
score = ln(1 + E)
        / (距最后活跃小时数 + 2)^1.5
        / (发布天数 + 1)^0.25
```

源码：`server/src/api/article/services/hot.ts`；评论更新活跃时间：`server/src/api/comment/content-types/comment/lifecycles.ts`。

- 互动采用累计计数，不是最近 24/48 小时新增计数。
- 每次新评论会更新 bumpedAt；同一人连续回复和作者自评在这一更新时间步骤没有区别。
- 分子经对数强压缩，分母按小时快速衰减。距最后评论从 12 小时变成 0 小时，仅这一项就能让原分数提高约 18.5 倍。
- 榜单没有最低有效互动门槛。前 200 条是数量上限，不代表 200 条都通过了“热门资格”检验。

可复算示例（相同发布时间，丁尼和三连均为 0；共同的发布年龄项略去）：

| 帖子 | 浏览 | 点赞 | 评论 | 距最后活跃 | 得分 |
|---|---:|---:|---:|---:|---:|
| A | 10 | 0 | 1 | 0 小时 | 0.688 |
| B | 1000 | 50 | 20 | 12 小时 | 0.118 |

A 会排在 B 前面，分数约为 B 的 5.8 倍。这是按当前默认参数计算的示例，不是线上两篇帖子的实际分数。

2026-09-18 08:10（UTC+8）读取正式站 `/api/articles/list?sort=hot&start=0&limit=20`：榜单共 200 条，前 10 条中有 6 条显示浏览量不超过 10。单次快照只证明用户描述的现象存在，不能独立证明每篇帖子应该排第几。

## 推荐的产品与算法方向

1. 首页“热门”先定义为最近 48 小时得到实际阅读和多人认可的帖子。以后如需要稳定回顾，可增设本周热门；最新流继续提供初始曝光。
2. 统计窗口内新增的有效阅读、独立点赞者、独立评论者、收藏者和投币者。老帖允许靠最近真正发生的互动回来，不携带旧的累计互动重新起跑。
3. 评论按参与用户去重，作者自身和明确的系统/AI 账号不贡献热门分；隐藏、删除内容不贡献分。同一用户跨动作的贡献应设上限，避免一次三连被重复包装成多个人的认可。
4. 增加最低有效样本。可以从“至少 3 名非作者的独立互动者”开始做影子计算，并根据本站分布调整；这不是行业通用标准。暂不硬设“必须 100 浏览”，以免小站榜单变空或小众好帖失去机会。
5. 排名综合近期有效阅读和独立认可，阅读成为明确的主要信号之一。避免仅按点赞/阅读比排序，因为极小样本很容易出现虚高比率。具体权重用本站候选分布和回放对照选择，不把某组拍脑袋常数当已验证答案。
6. 去掉最后一条评论对整帖的年龄重置。以 48 小时滚动窗口自然淘汰旧行为；若仍需更平滑的衰减，按每个事件的年龄衰减，而非按最后一次事件重置所有历史分数。
7. 热门数量不足就展示实际合格数量，不以零互动帖凑满 200 条。继续按约 5 分钟刷新，分页使用同一榜单版本避免跨次重排造成跳项。

## 数据与实施顺序

- 点赞、收藏、投币、评论已有时间戳与用户关联，可聚合窗口内的独立用户；应按文章 documentId 统一草稿/发布版本。
- 点赞/收藏取消会删除记录，现表适合统计“窗口内创建且当前仍有效”的互动；不等价于可完整回放的事件日志。需要明确取消、重做动作是否允许刷新事件时间。
- 当前浏览仅有总计数和 5 分钟 Redis 冷却键，没有可回溯的小时级访问记录。不能从总浏览量真实还原过去 48 小时阅读，也不能把文章 updatedAt 作为阅读发生时间。
- 用户已读表是首次已读标记，不能代替窗口内的重复访问/独立阅读统计。
- 先补小时级有效阅读统计和窗口内去重数据，启动后需积累观察窗口。可先只做影子计算，不应把缺失历史计数假装成真实的 48 小时数据。
- 用同批候选对比旧榜和新榜：低样本占比、独立参与人数、同作者占比、榜单轮换速度与有效内容覆盖。确认单人连评不能显著抬分，作者自评/AI 回复不能抬分，旧帖一次回复不能重新激活全部历史分数。

以上是针对当前论坛的建议，不是对 Discourse 或 WordPress 某一套实现的逐行复制。尚未读取生产环境的权重覆盖配置，公式示例以仓库默认值为准。
