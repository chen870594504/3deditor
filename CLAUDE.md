# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

`3dmaker` 是一个**同时具有两个身份**的仓库：

- **发布态**：npm 库包，其他项目 `app.use(createThreeDMaker())` + `import '3dmaker/style.css'` 获得 3D 场景能力
- **开发态**：`playground/` 是一个可独立运行的场景编辑器，同时是插件的**第一个消费者**

分层是刻意的，也是本仓库最重要的一条铁律：**能力进 `src/`，界面留 `playground/`**。
`src/` 里没有任何一处为编辑器开过后门——编辑器用到的相机、地面、日照、阴影全部走 `SceneViewer`
的公开 prop 与 store 的公开状态。往 `src/` 里加东西之前先问一句「宿主是不是也该有」，**答案是否，就该留在 `playground/`**。

## 常用命令

```bash
pnpm install
pnpm dev          # 启动 playground，http://localhost:5173
pnpm typecheck    # vue-tsc --noEmit
pnpm build        # 类型检查 + 构建库产物到 dist/
pnpm build:only   # 只构建，跳过类型检查
pnpm smoke        # 冒烟测试：加载 dist/index.js 在真实 Vue 应用里安装并渲染
pnpm verify       # build:only + smoke（提交前的完整验收）
pnpm preview      # 预览构建产物
```

几条容易踩的：

- **没有 lint / formatter 配置**（无 ESLint / Prettier / Biome / EditorConfig）。不要凭空引入，也不要假设某个风格工具会兜住格式问题。
- **没有测试框架**。`scripts/smoke.mjs` 是唯一的自动化测试，且**不支持筛选用例**——一次跑全部 91 条。想单点验证某个纯函数，写一个临时 node 脚本 `import('../dist/index.js')`（必须先 `pnpm build:only`），用完删掉。
- `pnpm smoke` 读的是 `dist/index.js`，改完 `src/` 不重新构建就测的是旧产物。
- **验证 playground 构建必须另给 outDir**。仓库没有 `build:playground` 脚本，裸跑 `vite build` 会用默认 `outDir: dist` **覆盖库产物**。正确做法：

  ```bash
  pnpm exec vite build --outDir dist-check --emptyOutDir && rm -rf dist-check
  ```

  这是没有浏览器时能替代 `pnpm dev` 的最强检查（走同一张模块图，改错导入路径会在这里炸）。
- 单个 SCSS 可以直接编译来看结果（`sass-embedded` 已装，Vite 原生支持 `.scss`，无需配置）：

  ```bash
  pnpm exec sass --no-source-map <file.scss> > /tmp/out.css
  ```
- `node scripts/measure-glb.mjs <本地文件|http(s) 地址>` 离线量一份 glb 的包围盒，输出模型清单要的格式。
  `playground/utils/modelList.ts` 里门窗那两类的 `width` / `height` 是「洞口要开多大」，量法口径与渲染端一致（片会被筛掉），写错了不报错、只有目视才发现。

## 架构

### `src/`（发布面）

`index.ts` 一个入口，做三件事：插件 `install`、具名导出、`GlobalComponents` 类型增强。
**公开面是刻意放大的**：凡「宿主自己也绕不过去」的算术都导出，理由通常是下面两条之一——

1. 宿主不导出就只能抄一遍，而抄漏一处**不报错**（例如 `placeOpenings` 的夹取漏掉 → 墙体切出负长度、变成一块法线翻转的黑面）
2. 放进公开面之后 `scripts/smoke.mjs` 才够得着它（浏览器依赖的部分测不到，纯函数能测）

所以：新增可测的算术时，把它写成**不依赖 three、不依赖 DOM 的纯函数**放进 `src/utils/` 并从 `index.ts` 导出。

`stores/scene.ts` 把状态切成三半，边界是刻意的：

| 半边 | 内容 | 进历史 | 进导出 |
|---|---|---|---|
| `config` | 唯一的可序列化事实来源 | 是 | 是 |
| `loading` / `progress` / `error` | 运行时状态 | 否 | 否 |
| `selectedIndex` | 界面状态 | 否 | 否 |

「选中哪个模型」放进配置的代价是：在列表里点一下就算一次场景改动，历史里多出一串噪声。

组件分层：`SceneViewer`（对外主组件）→ `SceneContent`（`TresCanvas` 内部，组装各 `Scene*` + 相机 + 控制器 + 物体级变换与拾取）→ 其余 `Scene*.vue`。

### `playground/`（开发面）

`App.vue` 是外壳（顶栏 + 三栏工作台）。`composables/` 放编辑器状态，`components/side/` 是左栏（图标导轨 + 模型库宫格），
`components/inspector/` 是右栏属性面板，`styles/editor.scss` 是编辑器唯一的样式面。

**属性面板是 schema 驱动的**：7 个 tab 的字段全部声明在 `composables/useInspectorSchema.ts` 里，
控件层不认识 store、schema 层不写 DOM。新增一个配置项 = 加一行声明。条件显隐分三层：
字段级 `when`（不渲染）、字段级 `dim`（渲染但灰显）、分区级 `when`（整节连标题一起不渲染）。

## 硬性约束（违反后多半不报错）

1. **`src/index.ts` 里的 `import './styles/index.scss'` 是副作用导入，必须留着。**
   漏掉它构建照样成功，但产物里没有任何组件样式，宿主渲染出的是一片裸 DOM。`pnpm smoke` 专门守这条回归。
2. **样式是手写 SCSS，不用任何原子 CSS 引擎**（UnoCSS 已卸载，只剩 `@unocss/reset` 给 playground 用）。
   库样式收敛在 `.tdm-root` 下、**不注入全局 reset**——重置是宿主的事，混进去就是污染宿主应用。
3. **运行时依赖全部声明为 `peerDependencies`**，`vite.config.ts` 的 `EXTERNAL` 必须与之一致。
   `vue` / `three` 出现两份实例会直接让响应式与 WebGL 上下文失效；`pinia` 同理（宿主已有时要复用其实例）。
4. **库构建只从 `src/index.ts` 一个入口出发**，playground 因此进不了产物。不要加第二个 entry。
5. `dist/style.css` 是单文件（`cssCodeSplit: false` + `assetFileNames: 'style.css'`），
   `package.json` 的 `sideEffects` 只列 `**/*.css`。
6. **`.env` 的键名是 `VITE_ASSE_IMAGE_URL`（`ASSE` 少一个 R，历史遗留）**，改它要同时改四处：
   `.env`、`env.d.ts`、`vite.config.ts`、`playground/composables/useModelLibrary.ts`。
   另外 `vite.config.ts` 里的 `ASSET_PROXY_PREFIX`（`/3d-assets`）必须与 `useModelLibrary.ts` 的
   `DEV_ASSET_PREFIX` 一致——只改一边的表现是列表里的地址代理不到，清一色加载失败。
   那台服务器不发 CORS 头而 `GLTFLoader` 走 `fetch`，所以必须靠这个同源代理。
7. `.gitignore` 只排除 `.env.local` / `.env.*.local`，**不排除 `.env` 本身**。
8. **`playground/styles/editor.scss` 里有一处靠源码顺序决胜负的地方**：`.ed-view-btn` 与 `.ed-draw-btn`
   先并入三选择器组（`min-width: 40px`），之后各自再单独收窄（34px / 30px）。特异性同为 (0,1,0)，
   所以是**后面的赢**。重排或拆分这几条会静默改变按钮宽度。
   要拆成 partial，先把这类顺序依赖改成靠特异性表达（`.ed-stage--preview` 那处就是范例：
   它写成两个类 `.ed-stage.ed-stage--preview`，README 里记着为什么）。
9. **不要嵌套 `@media`**。它们全部排在文件末尾、靠「排在后面」取胜，而 SCSS 会把嵌套的 `@media`
   提升到父规则的位置、也就是大幅前移；另外 `prefers-reduced-motion` 那条跨 10 个父选择器、
   `1100px` 那条跨 3 个，结构上根本嵌不进单一父规则。

## 验证到哪一步（不要补的测试）

`pnpm verify` 的 91 条断言**跑在 SSR 下**（`createSSRApp` + `renderToString`），
而 `TresCanvas` 的 children 在 SSR 下根本不渲染。所以下列内容**测不到**，
不要为它们补冒烟用例（只会得到一条永远为真的断言）：

- WebGL 实际出图、阴影是否真的落到地面上
- `attachPick` 的挂 / 摘、指针事件判别、双击阈值、事件弹窗
- 天空盒的**面到轴映射**（错了不报错，只是天整体转到别的方向）
- 模板 ref 指向 three 对象时的浅引用陷阱（dev 下只是一条警告，生产里静默失效）
- 那段 `new Function` 执行器（库自身从不执行配置里的任何 `code`）

这些的唯一防线是 README 末尾「验证覆盖到哪一步」里的**目视清单**，配合 `pnpm dev`。
推翻了某条断言时，要同时更新 README 里对应的说明。

## README 是权威文档

`README.md` 有两千三百余行，含 **44 条编号设计决定**。源码注释里大量以「见设计决定 N」**按编号**交叉引用，
所以：

- **不要重排或插入编号**，新条目只能追加在末尾
- 目视清单的条目号同样被引用，不要重排
- 改行为前先查有没有对应的设计决定；推翻它就要同时更新那一条

## 写作约定

- **一律中文**，包括 git 提交消息与代码注释。
- **注释解释「为什么」**，把踩过的坑与错法的后果写进去，而不是复述代码在做什么。
  这个仓库的注释密度和长度是刻意的，不要「顺手精简」。
- SCSS 里**只用 `/* */`，不用 `//`**（`//` 会被编译掉，而产物里保留的注释有时是刻意留的）。
- 表达式互斥的样式**不要写成两个同权选择器**（见设计决定 6）。
- 模型 id、几何算术这类「编辑器与宿主共用」的规则只能有一份实现，不要在两处各写一遍——
  两份规则悄悄不一致是不报错的那类 bug。

## 版本控制

仓库已 `git init`，但在 `main` 分支上**零提交**，所有文件都还是未跟踪状态。
也就是说**没有历史可以回滚**。改大文件之前先备份（此前的做法是留一份 `.bak`，人工确认后再删）。

`playground/styles/editor.css.bak` 就是这样一个备份（`editor.css` 已改成 `editor.scss`），目视确认后可删。
