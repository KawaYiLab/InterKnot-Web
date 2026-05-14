# 绳网 (InterKnot)

<p align="center">
  <img src="icon.webp" alt="Inter-Knot Logo" width="120" />
</p>

<p align="center">
  <strong>模仿制作的「绝区零」世界观中的"绳网"——新艾利都最大的匿名委托中枢。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Nuxt-4.x-00DC82?logo=nuxtdotjs&logoColor=white" alt="Nuxt 4">
  <img src="https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node-%E2%89%A520.18-339933?logo=nodedotjs&logoColor=white" alt="Node">
</p>

本项目是 [KawaYiLab/InterKnot-App](https://github.com/KawaYiLab/InterKnot-App) 独立开发的**网页前端**，使用 Nuxt 4 从零构建，模仿绝区零UI风格，后端对接自建 Strapi v5。

> 📱 移动端请前往 [KawaYiLab/InterKnot-App](https://github.com/KawaYiLab/InterKnot-App)（Android / iOS）。

---

## ✨ 功能亮点

- **帖子详情** — 还原弹窗式浏览，支持评论与回复
- **发帖** — 富文本编辑器，图片上传
- **用户体系** — 登录注册、个人主页、经验等级
- **图片画廊** — 集成 lightGallery，支持缩放与幻灯片
- **绝区零UI风格** — 使用 [zenless-ui](https://github.com/ChrisChan13/zenless-ui) 组件库，搭配自定义主题光标
- **响应式** — 桌面端 + 移动端自适应，移动端底部导航栏
- **SPA + 静态生成** — 纯客户端渲染，可部署至任意静态托管

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | [Nuxt 4](https://nuxt.com/)（Vue 3，SPA 模式） |
| **语言** | [TypeScript 5](https://www.typescriptlang.org/) |
| **状态管理** | [Pinia](https://pinia.vuejs.org/) |
| **数据请求** | [TanStack Vue Query](https://tanstack.com/query/latest/docs/vue/overview) + [ofetch](https://github.com/unjs/ofetch) |
| **工具库** | [VueUse](https://vueuse.org/) |
| **组件库** | [zenless-ui](https://github.com/ChrisChan13/zenless-ui)|
| **图标** | [Heroicons](https://heroicons.com/) |
| **图片画廊** | [lightGallery](https://www.lightgalleryjs.com/) |
| **样式** | SCSS + CSS 变量主题系统 |
| **后端** | [Strapi v5](https://strapi.io/)（RESTful API） |

---

## 🚀 快速开始

### 1. 环境准备

- **Node.js** ≥ 20.18.0
- **npm**（项目使用 npm 管理依赖）

### 2. 拉取代码

```bash
git clone https://github.com/yinengbei/InterKnot-Web.git
cd InterKnot-Web
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置环境变量

复制示例文件并填写后端地址：

```bash
cp .env.example .env
```

```env
NUXT_PUBLIC_API_BASE_URL=https://your-strapi-server.com
NUXT_PUBLIC_SITE_DOMAIN=your-domain.com
```

### 5. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000` 即可预览。

### 6. 构建生产版本

```bash
npm run generate     # 静态生成
npm run preview      # 预览生产构建
```

---

## 📂 目录结构

```
InterKnot-web/
├── app/                    # Nuxt 应用源码（srcDir）
│   ├── assets/styles/      # 全局样式 & 主题变量
│   ├── components/         # 可复用 UI 组件
│   ├── composables/        # 组合式函数（API、弹窗、画廊等）
│   ├── pages/              # 路由页面
│   │   ├── index.vue       #   首页（帖子广场）
│   │   ├── create.vue      #   发帖页
│   │   ├── login.vue       #   登录页
│   │   ├── discussion/     #   帖子详情页
│   │   └── profile/        #   个人主页
│   ├── plugins/            # Nuxt 插件（API、Vue Query、zenless-ui 等）
│   ├── stores/             # Pinia 状态（认证）
│   ├── types/              # TypeScript 类型定义
│   ├── utils/              # 工具函数
│   └── app.vue             # 根组件
├── public/                 # 静态资源（字体、图片、光标等）
├── zzzui/                  # zenless-ui 组件库（子模块）
├── nuxt.config.ts          # Nuxt 配置
└── package.json
```

---

## ✅ 路线图

- [x] 帖子推荐（瀑布流 + 虚拟滚动 + 骨架屏）
- [x] 帖子弹窗式详情浏览（路由级弹窗 + 双栏布局）
- [x] 评论 & 回复系统（乐观更新 + 分页加载）
- [x] 用户登录 & 注册（验证码 + JWT 自动续期）
- [x] 个人主页（帖子 / 评论 / 经验等级 / 名片）
- [x] 发帖 & 草稿自动保存
- [x] 图片上传（S3 直传 + 内容去重）
- [x] 点赞系统（文章 & 评论）
- [x] 已读状态同步
- [x] 搜索功能（全站搜索 + 防抖）
- [x] 自定义光标（16 套绝区零风格）
- [x] 响应式布局（桌面 + 平板 + 移动端）
- [x] 图片画廊（lightGallery 惰性加载）
- [ ] 消息通知（敲敲）
- [ ] 收藏功能

---

## 🤝 贡献指南

欢迎提交 Issue 或 Pull Request，一起完善绳网。

> ⚠️ **注意**：本项目使用Claude Opus 4.6辅助开发，使用前请自行评估。

---

## 📄 许可证

本项目基于 MIT License 开源。

```
Copyright (c) 2024 share121
Copyright (c) 2026 KawaYi
```

[zenless-ui](https://github.com/ChrisChan13/zenless-ui) 组件库由 ChrisChan13 开发，基于 MIT License。
