# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

`3deditor` 是一个**同时具有两个身份**的仓库：

- **发布态**：npm 包 `@chen870594504/3deditor`（发在 **GitHub Packages** 上，宿主也可匿名从 git
  装，见「分发」），其他项目 `app.use(createThreeDMaker())` +
  `import '@chen870594504/3deditor/style.css'` 获得 3D 场景能力
- **开发态**：`playground/` 是一个可独立运行的场景编辑器，同时是插件的**第一个消费者**

分层依据是本仓库最重要的一条铁律，**它已经改写过一次**：

> **早先**：「能力进 `src/`，界面留 `playground/`」——编辑器是仓库的第一个消费者，不算能力。
> **现在**：**宿主通用的一切进 `src/`**。

改写发生在编辑器整个搬进 `src/editor/` 的那一轮。理由是那个前提站不住了：编辑器本身也是宿主可能
要的东西（谁都能装完库就拿到一个开箱即用的编辑器），那它就属于「宿主通用」。于是 `SceneViewer`
在 `editable` 为真时直接渲染三栏工作台，**顶栏仍然留给宿主**——顶栏里全是策略（场景名、保存、
预览），而那不通用。

现在**留在 `playground/` 的只有两样**：`App.vue` 那个宿主外壳（顶栏 + 一个 `SceneViewer`），
以及**库绝不碰的两件东西**——`composables/useConfigIO.ts`（保存到哪是策略）与
`composables/useEventRunner.ts`（那段 `new Function` 执行器，一旦进 `src/` 就会被打进 `dist/`，
而「库里绝不含 `new Function`」是硬性约束，有冒烟断言守着）。往 `src/` 里加东西之前先问一句
「宿主是不是也该有」，**答案是否，就该留在 `playground/`**。

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
- **没有测试框架**。`scripts/smoke.mjs` 是唯一的自动化测试，且**不支持筛选用例**——一次跑全部 105 条。想单点验证某个纯函数，写一个临时 node 脚本 `import('../dist/index.js')`（必须先 `pnpm build:only`），用完删掉。
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
  `src/editor/defaultAssets.ts` 里门窗那两类的 `width` / `height` 是「洞口要开多大」，量法口径与渲染端一致（片会被筛掉），写错了不报错、只有目视才发现。

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

组件分层（**三层都在 `src/` 内部，公开面仍然只有一份**）：

```
SceneCanvas.vue  由合并后的 SceneViewer.vue 改名而来，收窄成**内部签名**：8 个 prop /
                 12 个 emits / 5 个方法。编辑器与纯画布共用，宿主永远碰不到——公开面上
                 那几组「场景长什么样」的 prop 桥（`background` / `wireframe` / 分组配置…）
                 全删了，它们本来就住在 `store.config` 里；这里只留能决定画布本身的那些
                 与编辑器自己的手感偏好（`toolbar` / `gizmoMode` / `cameraTransition`）
     ↑
SceneEditor.vue  三栏工作台 = SidePanel | EditorStage | InspectorPanel + 事件绑定弹窗
     ↑
SceneViewer.vue  公开面：八个 prop（editable / height / autoRotate / draco / initialScene / sideTabs / inspectorTabs / assetBaseUrl）
```

`SceneCanvas` 里面才是 `SceneContent`（`TresCanvas` 内部，组装各 `Scene*` + 相机 + 控制器 +
物体级变换与拾取）与其余 `Scene*.vue`。

`SceneViewer` **只有一个公开组件，不拆壳**：「预览还是编辑」由它的 `editable` 一个 prop 决定，
`editable` 为真时渲染整个编辑器（三栏），**顶栏留给宿主**。三级规则
`生效值 = 分开关 ?? editable ?? 旧默认`（`src/utils/sceneSwitches.ts` 是这条规则的唯一实现，
并从 `index.ts` 导出）**没有变**，只是它的输入面从公开 prop 挪进了内部签名——编辑器给
`SceneCanvas` 喂的就是 `:toolbar="false"` 配一档 `editable`（自绘界面，所以内置工具栏让位）。

**五个布尔 prop（`editable` / `toolbar` / `pickable` / `selection` / `gizmo`）一律 `withDefaults`
成 `undefined`**——**缺失的布尔 prop 会被 Vue 转成 `false`**，不给 `undefined` 就等于把那一档钉死
在关闭上，且不报错。这五处现在全在 `src/components/SceneCanvas.vue` 的 props 里（公开面上只剩
`editable` 一个布尔）。见 DESIGN.md 设计决定 46 与 47，动这几处之前先读它们。
`gizmoMode` 同样收进了内部签名：手柄模式是编辑器的手感偏好，公开面上没有它的位置。

`SceneViewer` 的对外面有两层：**props / emits**（声明式，「场景长什么样」）与
**`defineExpose` 出来的 5 个方法**（命令式，「此刻画布上是什么情况」：`captureCamera` / `measureModel` /
`groundPointAt` / `getSceneData` / `loadSceneData`）。加新能力时先判这两层归哪一层——
「在画布上拖出一个物理量」走 props+emits（库自己写回，宿主一行不写也能用），
「取一份数据交给宿主」走 `defineExpose`（库只产出，不做策略）。
两层的名字都不带策略含义：叫 `getSceneData` 而不是 `saveScene`，因为**组件本身并不保存**。

**宿主还能往左右栏各加一页自己的东西**：两个 prop `sideTabs` / `inspectorTabs`（类型
`EditorPanelTab`）声明页的名字 / 图标 / 顺序，正文走具名插槽 `#side-tab-<key>` /
`#inspector-tab-<key>`。**声明与内容分开是刻意的**（名字是数据、正文是模板），插槽要透传两层，
前缀常量与 `panelSlotNames` 的唯一实现在 `src/editor/utils/panelSlots.ts`。见设计决定 48。

**组件自己不落盘**：编辑器的 `⌘S` 与顶栏「保存」走的就是 `getSceneData()` 这条公开面，
取完只打一条日志；页面初始化也不读任何草稿，场景从哪来由宿主决定。
那条「保存」留在 `playground/`（`useConfigIO.ts`），它读的就是公开的 `getSceneData()`。

### `src/editor/`（编辑器）

`components/side/` 是左栏（图标导轨 + 模型库宫格），`components/inspector/` 是右栏属性面板，
`components/EditorStage.vue` 是中栏（它渲染 `SceneCanvas` 并喂给它编辑器自己的值），
`composables/` 放编辑器状态，`styles/_editor.scss` 是编辑器唯一的样式面（在 `src/styles/index.scss`
里被 `@use`，产物流进 `dist/style.css`）。

**属性面板是 schema 驱动的**：7 个 tab 的字段全部声明在 `composables/useInspectorSchema.ts` 里，
控件层不认识 store、schema 层不写 DOM。新增一个配置项 = 加一行声明。条件显隐分三层：
字段级 `when`（不渲染）、字段级 `dim`（渲染但灰显）、分区级 `when`（整节连标题一起不渲染）。
宿主追加的页不走 schema（它们是整页正文），见上面「宿主还能往左右栏各加一页」那一段。

### `playground/`（宿主示例）

**现在只剩两件事**：`App.vue`（宿主外壳：`AppHeader` + 一个
`<SceneViewer editable height="100%" :asset-base-url="ASSET_BASE">`，没有插槽）与那两件
库碰不得的东西（`useConfigIO.ts` 保存、`useEventRunner.ts` 执行代码）。
`main.ts` 挂载应用并引样式，`styles/base.scss` 是**宿主页面**的底座（`html` / `body` / `#app`；
原先那一节 `.pg-panel` 是宿主面板页的样式，随样例页一起删掉了），`utils/` 是宿主自己的图标与那两件素材相关的东西
（`editorAssets.ts` 只给出 DEV 期的同源代理前缀，**清单引用库那份 `DEFAULT_EDITOR_ASSETS`，
不留第二份**）。

**它同时是库诚实的一份用法示例**：公开面在这里被完整地用了一遍（一个 `editable` 决定形态、
`assetBaseUrl` 换素材服务器、`getSceneData()` 取数据落盘），没有一处走后门
import 内部模块。
**左右栏的宿主页（`sideTabs` / `inspectorTabs`）它不摆样例**——那是宿主自己该写的东西，摆一页
假数据在库的导轨上读起来像是库内置了那些分类；那条路两个前缀在冒烟里各有断言守着。
**往 `src/` 里加东西之前，先想一遍 `App.vue` 会不会变复杂**——它变复杂通常说明那件东西该留在
host 这一层。

## 硬性约束（违反后多半不报错）

1. **`src/index.ts` 里的 `import './styles/index.scss'` 是副作用导入，必须留着。**
   漏掉它构建照样成功，但产物里没有任何组件样式，宿主渲染出的是一片裸 DOM。`pnpm smoke` 专门守这条回归。
2. **样式是手写 SCSS，不用任何原子 CSS 引擎**（UnoCSS 已卸载，只剩 `@unocss/reset` 给 playground 用）。
   库样式收敛在 `.tdm-root` 下、**不注入全局 reset**——重置是宿主的事，混进去就是污染宿主应用。
   反过来也有一条：**容器根（两栏、属性面板的每一节、事件弹窗的表头与脚注）是 `div`，不是
   `aside` / `header` / `section` / `footer`**。作用域只赢「两边都声明了的属性」，宿主按**标签**写的
   `aside { padding / margin / line-height / background }`（后台模板里很典型）会整片压上两栏，
   而 `.tdm-col` 只声明了四条属性、挡不住。同一个道理还有一条**属性**级的：`.tdm-field-label`
   显式写着 `font-weight: 400`，因为宿主几乎必有一条 `label { font-weight: 700 }`。
   两种都**不报错，只有目视才发现**，所以有两条自动防线：`scripts/smoke.mjs` 里一条「模板里的
   容器根不用语义元素」的源码扫描（`nav` 是刻意的例外），以及编辑态渲染断言里两栏连标签名一起断
   （见设计决定 2 与目视清单第 153 条）。
3. **运行时依赖全部声明为 `peerDependencies`**，`vite.config.ts` 的 `EXTERNAL` 必须与之一致。
   `vue` / `three` 出现两份实例会直接让响应式与 WebGL 上下文失效；`pinia` 同理（宿主已有时要复用其实例）。
4. **库构建只从 `src/index.ts` 一个入口出发**，playground 因此进不了产物。不要加第二个 entry。
5. `dist/style.css` 是单文件（`cssCodeSplit: false` + `assetFileNames: 'style.css'`），
   `package.json` 的 `sideEffects` 只列 `**/*.css`。
6. **素材地址有两处，改一处要看看另一处**：
   - **库内默认**：`src/editor/defaultAssets.ts` 的 `DEFAULT_ASSET_BASE_URL`（字面量，**那个文件里不许
     出现 `import.meta.env`**——库构建会把它内联进产物，等于把本仓库的 `.env` 发给每一家宿主）。
     它是 `DEFAULT_EDITOR_ASSETS` 的根地址，宿主一行不写时左栏读的就是它。**`dist/index.js` 与
     sourcemap 里带着那台服务器的域名是刻意的**（见设计决定 50），别在「产物里搜不到域名」这类
     检查里把它当 bug 删掉。
   - **dev 代理的目标**：`.env` 的 `VITE_ASSE_IMAGE_URL`（**`ASSE` 少一个 `R`，是照那台服务器
     原样读的历史遗留**），由 `vite.config.ts` 的 `loadEnv()` 读走当代理目标；`vite.config.ts`
     从 `defaultAssets.ts` 导入那个常量当兜底，所以**两份不同源时 `.env` 赢**。
   另外 `vite.config.ts` 里的 `ASSET_PROXY_PREFIX`（`/3d-assets`）必须与
   `playground/utils/editorAssets.ts` 的 `DEV_ASSET_PREFIX` 一致（**不再是
   `useModelLibrary.ts`**）——只改一边的表现是列表里的地址代理不到，清一色加载失败。
   那台服务器不发 CORS 头而 `GLTFLoader` 走 `fetch`，所以必须靠这个同源代理。
   缩略图是 `<img>`、**不受 CORS 约束**——于是「缩略图全都好好的、拖进场景加载失败」正是这个坑，
   很容易误判成地址写错。
7. `.gitignore` 只排除 `.env.local` / `.env.*.local`，**不排除 `.env` 本身**。
8. **`src/styles/_editor.scss` 里有一处靠源码顺序决胜负的地方**：`.tdm-view-btn` 与 `.tdm-draw-btn`
   先并入三选择器组（`min-width: 40px`），之后各自再单独收窄（34px / 30px）。特异性同为 (0,1,0)，
   所以是**后面的赢**。重排或拆分这几条会静默改变按钮宽度。
   要拆成 partial，先把这类顺序依赖改成靠特异性表达（`.tdm-stage--preview` 那处就是范例：
   它写成两个类 `.tdm-stage.tdm-stage--preview`，DESIGN.md 里记着为什么）。
   （这份样式原先叫 `playground/styles/editor.scss`，编辑器搬进 `src/` 时整个搬了过来；
   搬的时候组内相对次序一个字没动。）
9. **不要嵌套 `@media`**。它们全部排在文件末尾、靠「排在后面」取胜，而 SCSS 会把嵌套的 `@media`
   提升到父规则的位置、也就是大幅前移；另外 `prefers-reduced-motion` 那条跨 10 个父选择器、
   `1100px` 那条跨 3 个，结构上根本嵌不进单一父规则。
   **`@use` 的先后就是产物里规则的先后**（`src/styles/index.scss`），所以 `_editor.scss` 必须排在
   `_canvas.scss` 之后——插到前面会让那一堆靠顺序取胜的规则整片失效。

## 验证到哪一步（不要补的测试）

`pnpm verify` 的 105 条断言**跑在 SSR 下**（`createSSRApp` + `renderToString`），
而 `TresCanvas` 的 children 在 SSR 下根本不渲染。所以下列内容**测不到**，
不要为它们补冒烟用例（只会得到一条永远为真的断言）：

- WebGL 实际出图、阴影是否真的落到地面上
- `attachPick` 的挂 / 摘、指针事件判别、双击阈值、事件弹窗
- 天空盒的**面到轴映射**（错了不报错，只是天整体转到别的方向）
- 模板 ref 指向 three 对象时的浅引用陷阱（dev 下只是一条警告，生产里静默失效）
- 那段 `new Function` 执行器（库自身从不执行配置里的任何 `code`）
- **`SceneViewer` 那 5 个 `defineExpose` 方法**——它的失效原因与上面几条不同，值得单独记着：
  `renderToString` 只产出 HTML 字符串，**拿不到组件实例**，`ref` 上没有 `.value`，
  所以返回值语义（什么时候给 `null`、`loadSceneData` 会不会清空撤销栈）**一行断言都写不出来**。
  往里加方法时必须同时补一条目视清单条目。
- **宿主面板页的正文**：那一页点开才渲染，而 SSR 里点不了。能断言的只有「那一格进了导轨」
  （`aria-label` 在不在、分隔线在不在）；正文到不到得了、点回内置页会不会留下空白，
  全归目视清单 147-151。

这些的唯一防线是 DESIGN.md 末尾「验证覆盖到哪一步」里的**目视清单**，配合 `pnpm dev`。
推翻了某条断言时，要同时更新 DESIGN.md 里对应的说明。

## 文档分两份

| 文件 | 读者 | 内容 |
|---|---|---|
| `README.md` | 用这个库的宿主 | **一份精简卡片（≤80 行）**：一句话简介、安装、快速开始、三条核心概念、props / 事件 / 对外方法三张表 |
| `DESIGN.md` | 改这个仓库的人 | 编辑器的设计、**50 条编号设计决定**、154 条**目视清单**、目录结构、发布流程、待办 |

`README.md` 是一份**面向宿主的用法卡片**，结构是固定的（**总长 ≤80 行**）：一句话简介 →
安装（一条命令）→ 快速开始（一个最小示例）→ 核心概念（最多 3 条）→ props / 事件 / 对外方法
三张表。**不写「特性列表」「为什么选我们」「架构图」「贡献指南」这类章节**，也
**不解释「为什么这么设计」**——那类推理一律进 `DESIGN.md`，哪怕它读起来很有用。
卡片放不下的宿主向内容（升级对照表、`npmrc` 令牌、git 安装那两道闸、CORS 与同源代理）
**现在只住在 `DESIGN.md` 里**，别以为它们还在 README。

`README.md` 是**唯一随包发出去的那份**（`files` 只收 `dist`，但 npm 强制带上 README），
`DESIGN.md` 不会——所以 README 里不写任何宿主读不到的东西，也不留指不回本仓库的引用。

分界线就是仓库那条铁律的文档版本：**「宿主用得上吗」**，答案是否就该进 `DESIGN.md`。
`DESIGN.md` 里没有任何宿主需要知道的东西，`README.md` 里不解释任何内部推理。

**编号是稳定契约。** 源码注释大量以「见 `DESIGN.md` 设计决定 N」**按编号**交叉引用（`src/` 与
`playground/` 里 30 余处，其中十余处以编号引用；目视清单的条目号同样被引用），所以：

- **不要重排或插入编号**，新条目只能追加在末尾
- 目视清单的条目号同样不要重排
- 改行为前先查有没有对应的设计决定；推翻它就要同时更新那一条
- 上面那张表决定了新内容写进哪个文件，**不要两边各写一份**

## 写作约定

- **一律中文**，包括 git 提交消息与代码注释。
- **注释解释「为什么」**，把踩过的坑与错法的后果写进去，而不是复述代码在做什么。
  这个仓库的注释密度和长度是刻意的，不要「顺手精简」。
- SCSS 里**只用 `/* */`，不用 `//`**（`//` 会被编译掉，而产物里保留的注释有时是刻意留的）。
- 表达式互斥的样式**不要写成两个同权选择器**（见设计决定 6）。
- 模型 id、几何算术这类「编辑器与宿主共用」的规则只能有一份实现，不要在两处各写一遍——
  两份规则悄悄不一致是不报错的那类 bug。

## 版本控制

`main` 分支已有历史，首个提交 `51a182d` 是**一次性全量入库**（91 个文件），此后按变更切分。

所以「改大文件之前先留一份 `.bak`」这条旧规矩**已经不适用**：它成立的前提是零提交、无处回滚，
而现在 `git checkout` 就能退回任一已提交版本。同理，`playground/styles/editor.css.bak`
那份备份（`editor.css` 早已改成 `editor.scss`）已确认删除，不必再找。

两点仍然要留意：

- **首个提交之前没有可退的版本。** 它是全量入库，「这个文件当时长什么样」在它之前无处可查。
  真正动大手术前，确认工作区干净（`git status` 为空）比留 `.bak` 更有效——脏工作区上一个提交
  也救不回来。
- **`.env` 是被跟踪的**（`.gitignore` 只排除 `.env.local` / `.env.*.local`，见硬性约束 7）。
  这意味着 `VITE_ASSE_IMAGE_URL` 的任何改动都会直接进下一次提交。它现在只是 dev 代理的目标
  （库内默认住在 `src/editor/defaultAssets.ts`，是**提交里本来就带着的另一个字面量**），
  按第 6 条那两处一起看——只改一边时，dev 期代理指向一台服务器、而宿主不写任何配置时读的是另一台，
  表现是「自己开发时好好的、宿主那边清一色加载失败」，两者都不报错。

### 分发

包名 **`@chen870594504/3deditor`**，发在 **GitHub Packages**（`npm.pkg.github.com`）上。scope 必须
等于仓库 owner，所以名字从 `3deditor` 改成了这个形式——**改名波及所有导入语句**，宿主与做演示的
文档都要跟着走。

发布用 `pnpm publish`（`prepublishOnly` 会先跑一遍 `build + smoke`）。**推送到哪个 registry 由
`package.json` 的 `publishConfig.registry` 声明**，不靠 `.npmrc`。

宿主有两条装法，代价落在不同处，完整说法在 DESIGN.md「分发」里（**原先在 README 的「安装」一节，
README 精简成卡片之后搬了过去**）：

- **GitHub Packages**（主路径）：拿到的是构建好的产物、不挑 Node，但该源**即使包是公开的也强制
  带令牌拉取**——每个项目、每台 CI 都要各配一次勾了 `read:packages` 的 classic PAT。失败信号是
  一句 `401`，看起来很像「包名写错了」。
- **从 git 装**（备选，一直留着）：匿名可拉、不需要令牌，代价是宿主机器上**现构建一次**，
  于是连带挑 Node 版本、还要过 pnpm 那道构建脚本放行。

**`3deditor:` 日志前缀与 `.3deditor.json` 扩展名不是包名，改名时不要动。** 设计决定 21 与目视清单
按它们写死了断言，跟着改会让文档与实现对不上。真正在写导入语句的地方只有 README、`src/index.ts`
的 JSDoc 示例。

走到今天是被堵了两次才换的这条路：npmjs 匿名可拉但**发布强制 2FA**（本环境的验证器绑定做不了，
没有 USB 密钥、扫码也失败），GitHub Packages 发布能过、卡在拉取门槛。三段的实测与代价都在
DESIGN.md「分发」里——**那是「为什么是这条」的唯一落点**，不要再往 README 里写一遍。

**两个钩子都别删，它们守的是同一件事的两半**：

- **`prepare`（`npm run build:only`）** —— 从 git 装时 pnpm / npm 会在 fetch 阶段跑它，
  在宿主的临时克隆里把 `dist/` 构建出来。删了它，宿主装到的是空包，表现是「装上了，
  import 全是 undefined」，而两家都不报错。它同时意味着**本仓库自己 `pnpm install` 时也会
  构建一次**（`prepare` 不区分「装自己」和「被别人从 git 装」），这是可接受的副作用，
  但别往它前面加 `typecheck` 之类会变慢又可能让安装失败的东西。
  它写 `npm run build:only` 而不是 `pnpm build:only`，是因为 pnpm 处理 git 依赖时是借 npm
  执行的，宿主那边不一定装了 pnpm。
- **`prepublishOnly`（`pnpm build && pnpm smoke`）** —— 守的是「发出去的产物必须是刚构建的」：
  `dist/` 被 `.gitignore` 排除、`files` 又只收 `dist`，没有这道钩子时 `pnpm publish` 会把陈旧
  产物甚至空目录发出去，而 npm 不会因此报错。**发 GitHub Packages 就走它。**

**本仓库不放 `.npmrc`，也不要加回来。** registry 由 `publishConfig.registry` 声明，令牌只住在
**发布者自己的用户级 `~/.npmrc`** 里。往仓库里塞一份带 `_authToken` 的 `.npmrc` 会被直接提交上去
（`.gitignore` 不排除它，与硬性约束 7 里 `.env` 的情形是同一类），**令牌就是这么泄出去的**。

git 安装那条路上，宿主侧还有两道闸：

- pnpm 默认不跑依赖的构建脚本，git 依赖会被 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 拦下，
  要在项目的 `pnpm-workspace.yaml` 里放行。**这道放行的键名与形态随 pnpm 版本变，四种组合
  没有一种两版通用**（矩阵与实测见 DESIGN.md）：pnpm 10 写列表 `onlyBuiltDependencies` +
  裸包名，pnpm 11 写映射 `allowBuilds` + **完整说明符**（键里带 commit）。好在报错信息会把
  该抄的那一段原样打印出来，照抄即可——**别照抄这里，也别照抄别人机器上的**。
  pnpm 11 的键带 commit，所以宿主**推荐把地址钉死**，否则上游每推一次提交它就失配一次。
- **宿主的 Node 必须 ≥20.19（或 ≥22.12）**：安装时会现构建，而构建走 Vite 8。低于它时
  Vite 只打一行黄色警告就继续跑，真正的失败在更深处，输出里一个字都不提 Node。`package.json`
  的 `engines` 照 Vite 的范围声明了同一条（**范围要与 `vite` 的 `engines` 保持一致**），
  宿主的包管理器会据此打一条警告——但默认只是警告不是拒绝（`engine-strict` 才是拒绝），
  所以这条主要还得靠文档说。

完整说明见 DESIGN.md「分发」。
