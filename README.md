# 3deditor

一句话：这是一个 Vue 3 插件，给你的网页装上一块 **3D 画布**。你往里丢 glTF / GLB 模型，它能同时摆好几个、调相机和日照阴影、还能画户型图（墙 / 门窗 / 房间）。

你可以把它想成"嵌在网页里的迷你版 3D 建模软件"。区别是它不保存任何东西——场景数据你说了算，存在你自己的后端或 localStorage 里。

技术栈版本：Vue 3.5 / Vite 8 / TypeScript 5.9 / Pinia 4 / sass-embedded 1.104 / TresJS 5 / Three.js 0.186

---

## 安装

这段在装包。装完你就能 `import` 它了。

```bash
pnpm add github:chen870594504/3deditor three pinia @tresjs/core @tresjs/cientos
```

运行后会发生什么：pnpm 从 GitHub 把仓库拉下来，在你的机器上现场构建一遍，然后把产物放进 `node_modules/3deditor`。

### 这个包不在 npm 上

它**没有发到任何 npm 源**。你从上面那条 GitHub 地址直接装。仓库是公开的，所以匿名就能拉——不需要令牌，也不用配 `.npmrc` 的 registry。

### 你的 Node 必须是 20.19+ 或 22.12+

**这是硬要求，不是建议。**

为什么？因为装的时候要在你的机器上**现构建一次**，而构建用的是 Vite 8。Vite 8 就要求这个 Node 版本（它的 `engines` 字段写的是 `^20.19.0 || >=22.12.0`，`@vitejs/plugin-vue`、`sass-embedded` 同一个要求）。

**什么时候会踩到：** 你机器上是 Node 18，装完报了一堆错。这时候你去翻报错是白费功夫——**报错里一个字都不会提 Node**。Vite 只打一行黄色警告就继续跑，然后炸在某个 ESM 依赖上，画面是一段 `ELIFECYCLE` 加一串 `node:internal/modules/esm/…` 的调用栈。

所以：**先敲一句 `node -v`**。能省掉一整轮排查。

### 第一次装还会失败一次——别慌，这是正常的

pnpm 默认**不执行依赖的构建脚本**。而这个包必须构建一次（下面讲为什么），于是 pnpm 把你拦下来：

```
ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  The git-hosted package "3deditor@0.1.1"
needs to execute build scripts but is not in the "onlyBuiltDependencies" allowlist.
```

这是**好事**：报错信息本身就把该做的事印出来了。照它说的，在项目根的 `pnpm-workspace.yaml` 里放行，再装一次。

**但该填什么，随 pnpm 的版本变，而且没有一种写法两版通用。** 照它打印的那段抄，别照抄这里。四种组合逐一实测下来：

| `pnpm-workspace.yaml` 里写的 | pnpm 10.28 | pnpm 11.28 |
| --- | --- | --- |
| `onlyBuiltDependencies:` 列表，填**裸包名** | 通过 | **完全不认**，它只找 `allowBuilds` |
| `allowBuilds:` 映射，键填**裸包名** | 通过 | **不匹配**，报的还是同一个错 |
| `allowBuilds:` 映射，键填**完整说明符** | **硬报错** `ERR_PNPM_INVALID_VERSION_UNION` | 通过 |

所以两版各写各的：

```yaml
# pnpm 10.x —— 键是列表，填裸包名
onlyBuiltDependencies:
  - "3deditor"
```

```yaml
# pnpm 11.x —— 键是映射，键要带完整说明符，值填 true
allowBuilds:
  3deditor@https://codeload.github.com/chen870594504/3deditor/tar.gz/1a679eb57dd2e1a006282def542cccd03e989c9f: true
```

> **在 pnpm 11 上，请把版本钉死。** 它要的那个键**里面带着 commit**（上面那条里的 `1a679eb…`）。意思是上游每推一个新提交，这个键就失配一次，同一道闸再拦你一回。把地址钉成 `github:chen870594504/3deditor#<commit 或 tag>` 之后键就固定了——这也是下面「想锁死版本」那个做法的额外好处。

> **git 依赖为什么非得构建一次？** 包只发 `dist/`（`package.json` 的 `files` 字段），而 `dist/` 是 `vite build` 的产物、不进 git。所以只能在你安装的时候现构建一次——`package.json` 里的 `prepare` 钩子干的就是这件事。
>
> 代价是**首次安装会慢几分钟**（要先在一个临时克隆里把构建用的依赖装一遍）。之后就快了，走 pnpm 的 store 缓存，实测约 9 秒。
>
> 想锁死版本，把 tag 或 commit 钉在地址后面：`github:chen870594504/3deditor#v0.1.1`。

### 后面那 5 个依赖，你也必须自己装

`three` / `pinia` / `@tresjs/core` / `@tresjs/cientos` 这几个，还有 `vue`。

它们写在 `peerDependencies` 里。peer 的意思是"**你这边必须自己有一份**"——不是可选项。这个包本身**一行 `dependencies` 都没有**，`dist/index.js` 里对它们全是裸 `import`，所以这些代码一份都不跟着包发出来。

**这是刻意如此的，不是漏装。** 这几样都持有要跨边界共享的状态，出现两份的后果如下，而且**全是静默失败**——你不会看到任何报错，只会看到"东西不对劲"：

| 依赖 | 装了两份会怎样 |
| --- | --- |
| `vue` | 你那份的响应式追踪不到插件那份的状态 |
| `pinia` | 你读到的 `config` 不是组件正在写的那一份，数据永远不动 |
| `three` | 两套类标识，`instanceof` 判断全失效。而且库会把手里的**活的 three 对象**交给你（payload 里的 `object`、`measureModel` 的结果），跨两份根本用不了 |
| `@tresjs/core` | 它靠 Vue 的 `provide` / `inject` 传渲染器和 `useLoop` 上下文。两份就意味着 `<TresCanvas>` 和它的子组件解析到不同上下文 |

你本来就是 Vue 应用，`vue` 必然已经有了（而且必须和插件同一份）。所以实际要新增的是 `three` / `pinia` / `@tresjs/core` / `@tresjs/cientos` 四条。

`pinia` 的 peer 范围是 `^2.3.0 || ^3.0.0 || ^4.0.0`，你停在 3 也能直接用。

> `pnpm` 默认开着 `auto-install-peers`，会悄悄把 `three` / `@tresjs/*` 补进 `.pnpm`。于是你少装也看不出后果。
>
> 但那补的是**插件自己那份**。你之后自己再装一个别的版本，就是两份并存。
>
> **要求显式装，是为了让"只有一份"由你的顶层依赖决定，而不是碰巧。**

## 注册

把插件挂到你的 Vue app 上。这一步只做一次，之后整个应用都能用 `<TdmSceneViewer />`。

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createThreeDMaker } from '3deditor'
import '3deditor/style.css' // 必须引入，否则组件没有样式

const app = createApp(App)
app.use(createPinia()) // 可选：不装插件会自己建一个内部实例
app.use(createThreeDMaker())
app.mount('#app')
```

运行后会发生什么：应用启动时插件注册了 3 个全局组件，从这一刻起任何 `.vue` 文件里都能直接写 `<TdmSceneViewer />`。

⚠️ **`import '3deditor/style.css'` 这一行不能省。** 省了不会报错，但你的画布会是一堆没有外观的裸 DOM——颜色、边框、按钮全没有。

`createThreeDMaker` 一共收三个选项：

```ts
interface ThreeDMakerOptions {
  /** 宿主自己的 Pinia 实例。传入即复用（推荐），不传则插件建一个私有实例 */
  pinia?: Pinia
  /** 是否注册全局组件，默认 true；关掉就只能具名导入 */
  registerComponents?: boolean
  /** 全局组件名前缀，默认 'Tdm' */
  prefix?: string
}
```

全局组件名就是 `prefix + 组件名`。组件一共三个：`SceneViewer` / `SceneToolbar` / `SceneFloorplan`，也就是默认的 `<TdmSceneViewer />`。

**模板里的类型提示只覆盖 `Tdm` 这个默认前缀**（`GlobalComponents` 类型增强写死了这三个名字）。你用了自定义前缀、或者 `registerComponents: false`，请在模板里改用具名导入：

```vue
<script setup lang="ts">
import { SceneViewer, useSceneStore } from '3deditor'

const scene = useSceneStore()
</script>

<template>
  <TdmSceneViewer editable height="480px" />
  <SceneViewer :editable="false" height="480px" @loaded="scene.markLoaded()" />
</template>
```

这段在展示两种用法并存：第一行走全局组件（有类型提示），第二行走具名导入。两行都只有一个 `editable` 差着——中间那个 `:editable="false"` 是"只读画布"，去掉它就是"整个编辑器"。

## 预览还是编辑：`editable` 一个开关

**问题**：有时候你只想让人转着看看模型，有时候你要让人真的动手改。要是为此维护两套组件，迟早会各长各的。

**做法**：同一个 `SceneViewer`，用 `editable` 切换**形态**。

| `editable` | 你得到的 |
| --- | --- |
| **不传** | 一块画布：三维视口 + 内置工具栏（这条是旧版行为，留着是为了兼容） |
| `false` | 一块**只读**画布：没有内置工具栏，点不中模型，也没有包围框与手柄 |
| `true` | **整个编辑器**：左栏挑料 ｜ 中栏画布 ｜ 右栏改属性，外加事件绑定弹窗、户型图绘制工具、W/E/R 与 Esc 与 ⌘Z |

```vue
<!-- 只给人转着看：干干净净一块画布 -->
<SceneViewer :editable="false" height="480px" />

<!-- 可编辑：三栏工作台，给它一个有高度的容器它就铺满 -->
<div style="height: 720px">
  <SceneViewer editable height="100%" />
</div>
```

这两行只差一个 `editable`，页面上的表现差得很远：上面那行是一块干干净净的画布，下面那行是一个能直接用的场景编辑器。

**`editable` 里的一切都不用你配**：点选、包围框、变换手柄、工具栏的让位，全由它一处说了算。你要做的只有给它一个高度。

> `editable` 只管**形态**。12 个事件、5 个对外方法在两种形态下都在——`editable` 不会让它们增减。

### 顶栏是你的

编辑器**不包括顶栏**。场景名、保存、预览、"导出 JSON"这类按钮全是**策略**，库不知道你要把它们放哪、更不知道保存到哪去。所以：

```vue
<div class="我的页面">
  <header>你自己的顶栏：场景名 · 保存 · 预览……</header>
  <SceneViewer editable height="100%" />
</div>
```

顶栏要读的那几样（当前场景名、撤销栈、预览开关）都在公开面上，见「场景里有什么，走 store」一节。

### 想自己判断"此刻点选到底开没开"

**`resolveSceneSwitches` 仍然导出**——它是"分开关 ?? 总闸 ?? 旧默认"那条规则的唯一实现，库内部按它渲染。你自己画界面时想得到同一个答案就用它：

```ts
resolveSceneSwitches({ editable })
```

不用它，你就得在模板里抄一遍那条判断，两份规则迟早不一致——症状是"按钮亮着可点，画布上却点不中"。

> **其余四个开关（`toolbar` / `pickable` / `selection` / `gizmo`）已经不是组件的 prop 了。**
> 想要点选与手柄就是 `editable`（编辑形态），想要干净画布就是 `false`——中间那些组合不再开放。
> 理由与升级办法见下面「props」一节末尾那条警告。

## 最小示例

**这是最快的跑通路径**：一个能用的编辑器 + 一个从后端读场景、再存回去的完整流程。

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { SceneViewer } from '3deditor'
import type { ModelTransformPayload } from '3deditor'

// 组件交出五个方法（captureCamera / measureModel / groundPointAt /
// getSceneData / loadSceneData），拿实例的方式是普通的模板 ref
const viewer = ref<InstanceType<typeof SceneViewer>>()

onMounted(async () => {
  // 用后端存的场景初始化；载入后撤销栈会被清空
  viewer.value?.loadSceneData(await fetch('/api/scene/9f2').then((r) => r.json()))
})

async function save() {
  const data = viewer.value?.getSceneData()
  if (!data) return
  await fetch('/api/scene/9f2', { method: 'PUT', body: JSON.stringify(data) })
}

function onTransform(payload: ModelTransformPayload) {
  console.log('拖到了', payload.position)
}
</script>

<template>
  <!-- editable 一下就是整个编辑器：三栏、点选、包围框、手柄全在它里面 -->
  <SceneViewer ref="viewer" editable height="100%" @model-transform="onTransform" />
  <button @click="save">保存</button>
</template>
```

这段在做三件事：页面一打开就从 `/api/scene/9f2` 拉场景灌进画布；点「保存」把当前场景吐给你的后端；用户拖动手柄时在控制台打一行日志。

关于 `ref`：它就是 Vue 里"贴了标签的盒子"。你把标签（`ref="viewer"`）贴在组件上，之后用 `viewer.value` 就能把盒子打开、拿到这个组件实例，进而调它的方法。注意 `viewer.value?.` 里那个问号——组件还没挂上时盒子是空的。

跑起来之后你会看到：左边一栏模型库、中间画布、右边属性面板。空场景时左栏挑一个，或者直接把 `.glb` 拖进画布。

### 想要一块只有画布、没有编辑器的页面

不传 `editable` 就是它。这时**场景里的东西自己往 store 里放**：

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { SceneViewer, useSceneStore } from '3deditor'

const scene = useSceneStore()

onMounted(() => {
  scene.addModel('/chair.glb')                       // 摆一个模型
  scene.applyConfig({ camera: { fov: 35 } })         // 场景长什么样，也走 store
})
</script>

<template>
  <SceneViewer height="480px" />
</template>
```

**为什么"往场景里放东西"不走 prop**：prop 只到得了"那一个模型"，而一个场景里有几个模型、分别摆在哪，是一份会长大的数据。store 那个入口（`addModel` / `patchModel` / `removeModel`）本来就是为这件事准备的，编辑器自己走的也是同一条路——见下一节。

### 场景里有什么，走 store

**props 只管"组件长什么样"，场景内容本身在 store 里。** `useSceneStore()` 是一块公共白板——组件在写、你的代码在读，两边看到同一个东西（Pinia store，id `tdm-scene`，带前缀避免和你的 store 撞名）。它的核心是 `scene.config`：**一份普通对象，能 `JSON.stringify`，能存数据库**。

```ts
const scene = useSceneStore()

// 往场景里放东西
scene.addModel(url?)                     // 追加一个模型并选中它；url 留空 = 内置示例几何体
scene.patchModel(patch, label?, index?)  // 改一个模型；index 缺省 = 当前选中项
scene.removeModel(index)
scene.selectModel(index)                 // 切换"当前在编辑哪一个"
scene.models / scene.selectedModel       // 只读视图，渲染与遍历用

// 改场景本身（相机 / 地面 / 日照 / 阴影 / 户型图）
scene.applyConfig(patch, label?)         // 深合并写入；给了 label 就立刻记一条历史
scene.resetConfig()                      // 全部恢复默认值
scene.loadSceneData(data)                // 用一份（可能是旧格式的）场景数据初始化：先迁移、再深合并、最后清空撤销栈

// 取数据
scene.exportConfig()                     // 深拷贝，可直接交给后端

// 历史栈（自己画撤销 / 重做按钮时读它）
scene.undo() / scene.redo() / scene.clearHistory()
scene.canUndo / scene.canRedo / scene.history
```

**配置项长什么样**：`scene.config` 上就是那几个分组（`models` / `camera` / `ground` / `sun` / `shadow` / `floorplan`），字段名就是它自己的名字——`scene.config.camera.fov`、`scene.config.shadow.type`。整份默认值在 `DEFAULT_SCENE_CONFIG` 里，可以 import 出来对照。

几条**不照做会静默出错**的：

- ⚠️ **`applyConfig` 对数组是整体替换**，而 `models` 与 `floorplan.walls` 都是数组。只想改其中一个模型请用 `patchModel`（一个只写了 `{ url }` 的补丁会把那个模型其余字段连同 `id` 一起抹掉）；自己拼户型图数组时先过一遍 `cloneFloorplanPatch(patch)`——不过它就会让你和配置共用同一个数组，你在外面改一下画布跟着变，而这条路一次历史记录都不触发。
- **"当前选中哪一个"是界面状态，不进 `config`**——所以在列表里点一下不算一次场景改动，历史里也不会多出一串噪声。
- **`loading` / `progress` / `error` 是运行时状态**，同样不进 `config`、不进导出、不进历史。

## `SceneViewer` 的 props

**props 就是"你从外面告诉组件的事"**，像给一台机器的控制面板按按钮。

**这个组件的公开面只有七个 prop**，全部列在下面——是的，就这么少，而且这是刻意的：组件在"开箱即编辑器"这个身份下，真正需要宿主决定的就这七件事。其余的一切（场景长什么样、有几个模型、相机怎么摆）走 store，见「场景里有什么，走 store」一节。

| Prop            | 类型                       | 默认值    | 说明                                                         |
| --------------- | -------------------------- | --------- | ------------------------------------------------------------ |
| `editable`      | `boolean`                  | —         | **预览 / 编辑总闸**（见上一节）：`true` 渲染整个编辑器，`false` 渲染只读画布，不传则兼容旧行为 |
| `height`        | `string \| number`         | `'480px'` | 组件高度，数字按 px 处理                                     |
| `autoRotate`    | `boolean`                  | `false`   | 是否自动旋转视角                                             |
| `draco`         | `boolean`                  | `false`   | 模型是否为 Draco 压缩格式                                     |
| `initialScene`  | `DeepPartial<SceneConfig>` | —         | **挂载时装载一份场景数据，只装一次**（见下面那条）             |
| `sideTabs`      | `EditorPanelTab[]`         | `[]`      | 往**左栏**导轨末尾追加的页，内容走 `#side-tab-<key>` 插槽      |
| `inspectorTabs` | `EditorPanelTab[]`         | `[]`      | 往**右栏**导轨末尾追加的页，内容走 `#inspector-tab-<key>` 插槽 |

> ⚠️ **设高度请用 `height`，不要用内联 `style="height: …"`。**
>
> 你写在组件上的 `class` / `style` 会透传到组件根节点上，而透传的样式**是合并在后面的**。所以内联的 `height` 会把你通过 `height` prop 算出来的那个值覆盖掉。两者同时写时以你的内联样式为准——看起来就像 `height` prop 失效了，但不会报错。

> ⚠️ **`sideTabs` / `inspectorTabs` 只在 `editable` 为真时有落点。** 画布形态没有面板，这两个 prop 传了也不会渲染（同样不报错）。`height` / `autoRotate` / `draco` / `initialScene` 则在哪种形态下都照常生效。

`draco` 有一条**容易踩空**的语义：它写进的是**当前选中项**的 `draco` 标记，而读它的是加载那一步。所以**场景空着时它什么都不做**——没有选中项可写。要精确控制就分两步：`addModel(url)` 之后 `patchModel({ draco: true })`——那一条写在哪个模型上就是哪个模型上。

### 拿一份存好的场景把画布填上

你后端里存过一份 `getSceneData()` 的产物（或者任何同形状的 JSON），想直接渲染出来——用 `initialScene`：

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { SceneViewer } from '3deditor'

const saved = ref(null)

onMounted(async () => {
  saved.value = await fetch('/api/scene/9f2').then((r) => r.json())
})
</script>

<template>
  <SceneViewer editable :initial-scene="saved" />
</template>
```

**"只装一次"是要紧的那半句**，它决定了几件事：

- **数据可以晚到**。上面那样先 `null`、拉到再赋值是能用的——组件会在**第一次拿到非空值**时装载。之后你再改这个 ref 就不生效了，场景已经归 store 管。
- **它不会覆盖用户的编辑**。`editable` 下用户在画布上拖一个模型，改的是 store，**不影响你手里那个对象**（载入是深拷贝）。所以 `initialScene` 不是"受控绑定"——你要的如果是"父组件拿着真值、画布只是视图"，那与"库自己把改动写回 store"这件事是冲突的，那条路走不通。
- **它替代不了 `loadSceneData()`**。两者是**同一个实现**（内部都是先迁移旧格式、再深合并、最后清空撤销栈），区别只在你什么时候给数据：挂载时给用 prop，运行中随时给用方法。同一份数据**不要两边都给**。
- ⚠️ **和 `autoRotate` / `draco` 一起用时，以 `initialScene` 为准。** 那两个值（相机的自动旋转、每个模型的 draco）整份场景里本来就带着；那两个 prop 是给"从空场景起步"的宿主准备的。

> 顺带一条：**旧格式的配置可以原样喂进来**。早期版本写的是单个 `model` 对象，`initialScene` 与 `loadSceneData()` 都会先把它折成 `models` 列表再装载——不用你手动迁移。

### 扩展左右栏 tab

**往左边加一页自己的工具、往右边加一页自己的属性**——旧版里这两件事没有入口。现在各给了一个 prop，**声明与内容分开**：页的名字 / 图标 / 顺序是数据（库要拿去画导轨），页里画什么由具名插槽给。

```vue
<script setup lang="ts">
import { SceneViewer } from '3deditor'
import type { EditorPanelTab } from '3deditor'

const sideTabs: EditorPanelTab[] = [
  { key: 'device', label: '设备' },        // 有 key 就够，图标不写会退回占位字形
]
const inspectorTabs: EditorPanelTab[] = [
  { key: 'about', label: '说明' },
]
</script>

<template>
  <SceneViewer editable height="100%" :side-tabs="sideTabs" :inspector-tabs="inspectorTabs">
    <!-- 插槽名 = 前缀 + key：上面这页的 key 是 'device'，插槽就叫 #side-tab-device -->
    <template #side-tab-device>
      <div>这里画你自己那一页的内容</div>
    </template>

    <template #inspector-tab-about>
      <div>右栏同理，前缀换成 inspector-tab-</div>
    </template>
  </SceneViewer>
</template>
```

`EditorPanelTab` 就三个字段：

| 字段    | 类型         | 必需 | 说明                                                        |
| ------- | ------------ | ---- | ----------------------------------------------------------- |
| `key`   | `string`     | 是   | 唯一键。插槽名按它拼：`#side-tab-<key>` / `#inspector-tab-<key>` |
| `label` | `string`     | 是   | 导轨上的名字，同时是 `aria-label` 与悬停提示                 |
| `icon`  | `IconPath[]` | 否   | 导轨图标（24 格、只用描边、只吃 `currentColor`）。不写退回占位立方体 |

几条**不照做会踩坑**的：

- **`key` 别与内置分类撞名**（左栏 `floor` / `wall` / `door` / `window` / `skybox`，右栏 `history` / `model` / `floorplan` / `sun` 等七个）。撞上时以你的页为准，Vue 在开发模式会打一条重复 key 警告——生产里它只表现为"内置那页点不开了"。
- **左右两栏的 `key` 各是各的**，两边都叫 `device` 互不影响。
- **插槽名拼错不报错**：一个没被提供的插槽是合法的空插槽，表现是那一页点开之后一个字都没有。
- **右栏只有 306px 宽**，宿主页的正文要自己管好横向溢出（加个 `overflow-x: auto` 或者用定宽控件）。
- **库不替你保存任何东西**：宿主页里的状态归你自己管，`getSceneData()` 吐出的配置里没有它。

### 从旧版本升级：被删掉的那些 prop

**如果你之前用的是 `model` / `background` / `wireframe` / `showGrid` / `environment` / `cameraTransition` / `pickable` / `selection` / `gizmo` / `gizmoMode` / `toolbar`，或者 6 个分组 prop（`camera` / `ground` / `floorplan` / `sun` / `shadow` 与 `:model` 的对象写法），它们现在**都还在，但不再通过 props 给了**。

> ⚠️ **它们不会报错——这是最需要留意的一点。**
>
> Vue 对不认识的 prop **静默放行**：那个值会原样落到组件根的 DOM 属性上。所以 `<SceneViewer model="/chair.glb" />` 今天不报错、不警告，渲染出的 HTML 上多一个 `model="/chair.glb"` 属性，而椅子根本不会出现。`:model="{ url: …, name: … }"` 更迷惑一点——它的表现是根节点上出现一个字符串化的 `model="[object Object]"`。

| 你原来写的              | 现在怎么写                                                     |
| ----------------------- | -------------------------------------------------------------- |
| `model="…"`             | `useSceneStore().addModel(url)`（要多个就多调几次）             |
| 5 个 UI 开关            | 交给 `editable`：编辑形态自动全开，画布形态自动全关             |
| 6 个分组 prop / `background` / `wireframe` / `showGrid` / `environment` | `useSceneStore().applyConfig({ … })`                            |
| `cameraTransition`      | 不用管。编辑器自己取内部常量，纯画布为 0                        |

`applyConfig` 的用法与几条容易踩的（数组是整体替换）见「场景里有什么，走 store」一节。一句话：**能配的东西没少，只是入口从 prop 挪到了 store**——因为 prop 的表达力只到"那一个模型"，而一个场景里有几个模型本身就说不清。

> **想自己判断"此刻点选 / 手柄到底开没开"，用 `resolveSceneSwitches({ editable })`**（从包里具名导出）。它返回四个开关的生效值，宿主自己画工具栏时按的就是它——见上一节末尾。


## 事件

**事件是"组件从里面告诉你的事"**，跟 props 正好反过来。你在模板上写 `@事件名="处理函数"`，它在该发生时叫你。

| 事件                 | 载荷                 | 说明                                            |
| -------------------- | -------------------- | ----------------------------------------------- |
| `loaded`             | —                    | 模型加载完成                                    |
| `progress`           | `percentage`         | 加载进度 0 ~ 100                                |
| `error`              | `message`            | 加载失败，不会中断宿主应用                      |
| `cameraChange`       | `{ position, target }` | 用户拖动结束后回写的机位                      |
| `objectClick`        | `ObjectClickPayload` | 单击模型（需 `events.click.enabled`）           |
| `objectDblclick`     | `ObjectClickPayload` | 双击模型（需 `events.dblclick.enabled`）        |
| `objectPointerEnter` | `ObjectClickPayload` | 指针进入模型（需 `events.pointerenter.enabled`） |
| `objectPointerLeave` | `ObjectClickPayload` | 指针离开模型（需 `events.pointerleave.enabled`） |
| `objectContextMenu`  | `ObjectClickPayload` | 右键模型（需 `events.contextmenu.enabled`）     |
| `modelPick`          | `ModelPickPayload`   | 在画布上点中模型（需编辑形态，见「点选模型」一节；与 `events` 无关） |
| `modelTransform`     | `ModelTransformPayload` | 手柄拖拽过程中逐帧派发（需编辑形态）             |
| `modelTransformEnd`  | `ModelTransformPayload` | 手柄拖拽结束、且变换**确实变了**（需编辑形态）   |

> 五个 `object*` 事件的门控在**每个模型自己的** `events` 上：`model.events.click.enabled` 这样（5 个键 `click` / `dblclick` / `pointerenter` / `pointerleave` / `contextmenu`，各带一个 `enabled` 与一段 `code`）。可以用 `patchModel({ events: { click: { enabled: true } } })` 打开。
>
> ⚠️ **库只负责"发事件 + 读 `enabled`"，从不执行 `code`。** 这很重要，也是刻意的：你的场景数据可能来自后端或用户输入，库要是替你把它们执行了，那就是一个谁都担不起的安全口子。要让那段代码跑起来，**得你自己接这五个 emit**，再把 `code` 编译成函数执行（编辑器走的就是这条路）。

三个载荷长这样：

```ts
interface ObjectClickPayload {
  type: ModelEventType              // 触发它的是哪一类事件
  id: string                        // model.id，随机 uuid
  name: string                      // model.name，留空时回退成派生的短名，保证非空
  url: string                       // 带上它，blob 场景宿主也能自解释
  point: [number, number, number]   // 世界坐标下的命中点
  distance: number                  // 相机到命中点的距离
  object: Object3D                  // 命中的最深层 mesh
}

interface ModelPickPayload {
  id: string                        // 与配置里 models[n].id 一一对应
  point: [number, number, number]
  distance: number
  object: Object3D
}

interface ModelTransformPayload {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]   // 弧度，与配置同一套单位
  scale: [number, number, number]
}
```

**什么时候会用到 `id` 和 `name`**：`id` 是 uuid，换模型就换一个。它适合判断"是不是同一个物体"，**不适合当显示文本**。要显示给人看就用 `name`——配置里留空时会回退成从地址派生的短名（`builtin` / `local-file` / `damaged-helmet`），所以它**永远非空**。

> **单击的判据是「位移 < 4px 且间隔 < 500ms」**，所以拖动旋转视角不会误触发。
>
> 双击再叠加「两次单击间隔 < 500ms 且落在同一小片区域」。和浏览器一致，双击会**先发两次 `objectClick` 再发一次 `objectDblclick`**。

> ⚠️ **`object` 是 three 的 `Object3D`，带着 `parent` 环，不能 `JSON.stringify`。**
>
> 它挂进 payload 是为了让多部件模型能分辨"点中的是哪个部件"。要透传请只取你需要的字段。

### 点选模型：`modelPick`

**这两个看起来像一回事，其实回答的是两个问题。**

`objectClick` 回答的是"用户点了**这个模型的某个部件**"，需要模型自己开事件。
而"用户想让**这个模型**变成当前选中的那一个"是另一件事，所以单独给了一条画布级的通道：

|  | `objectClick` | `modelPick` |
| --- | --- | --- |
| 怎么开 | 该模型的 `events.click.enabled` | **`editable` 为真时自动开**（编辑形态的内置能力） |
| 开销 | 开了任意一类事件就**每帧** raycast 一次整棵子树 | 两个 DOM 监听器 + **每次点击**一次 raycast |
| 载荷 | 带 `type` / `name` / `url` | 只有 `id` |
| 点空白 | —（点的就是模型） | 什么都不发 |

> `raycast` 你可以理解成"从眼睛射出去一支激光笔，看它先打中谁"。每帧射一次和点一下射一次，开销差着数量级——这就是为什么两者分成两条路。

两者**互不影响**，都开时 `modelPick` 一定**先到**。

点空白处（地面、网格、背景）**不发** `modelPick`。所以"点一下画布就取消选中"这类行为需要你自己补一句。

`modelPick` 判定单击用的是与 `events` 同一个判据，而且**跳过 `visible` 为 false 的模型**——所以"点哪选哪"和你眼睛里看到的画面一致。

> ⚠️ **`pickable` 不再是 prop。** 点选能力现在**绑在编辑形态上**：`editable` 为真时自动可用，否则没有。也就是说"**裸画布 + 点选**"这个组合不再能表达——想让人在画布上点选，就得进编辑形态（会连三栏一起出来）。
>
> 想在纯画布页面里接住"用户点了哪个模型"，请走 `objectClick`（给模型开 `events.click.enabled`）那条路。

### 在画布上编辑模型：`modelTransform` 与 `modelTransformEnd`

**你要让人在画布上直接拖着改模型时，用编辑形态。**

```vue
<SceneViewer
  editable
  height="100%"
  @model-pick="onPick"
  @model-transform="onTransform"
  @model-transform-end="onTransformEnd"
/>
```

`editable` 一下，手柄就全打开了：能点选、选中后有框、有手柄，拖手柄时两个事件分别逐帧和松手时通知你。

- **包围框** —— 给选中的那个模型套一圈，颜色是内置示例几何体同款的青绿。
- **手柄** —— 给选中的那个模型挂一副 X/Y/Z 手柄。拖出来的是平移 / 旋转 / 缩放，由编辑器的按键（W / E / R）或右栏属性决定——**`gizmoMode` 不再是 prop**。

两个事件都是**输出**，不是输入——库里已经把值写回 store 了。

`modelTransform` 每帧派发，用来做"拖拽中"的联动。`modelTransformEnd` 只在**松手且值确实变了**时派发一次，用来补一条可读的历史标签。

你不用做任何事，也只会看到一条"模型属性"标签，不会刷屏。

> ⚠️ **`selection` / `gizmo` / `gizmoMode` 不再是 prop。** 它们与 `pickable` 一样，从三个独立开关收成 `editable` 一个总闸——宿主已经用 `editable` 说了"我要编辑"，再让它逐个开开关就是重复表达，漏关一个还不报错。

包围框与手柄都不给任何模型带来逐帧 raycast，关掉时整个组件都不渲染。

**隐藏的模型不给选中视觉**（否则你会在拖一个看不见的东西），但隐藏的模型仍然能量尺寸。

## `SceneViewer` 的对外方法

**props 和事件是"声明式"的——你说要什么、它告诉你发生了什么。方法不一样：方法是你主动去问它"此刻画布上是什么情况"。**

除了 props 与 emits，`SceneViewer` 还通过 `defineExpose` 暴露 5 个命令式方法：

| 方法 | 签名 | 拿不到时 |
| --- | --- | --- |
| `captureCamera` | `() => boolean` | 返回 `false`（相机没就绪） |
| `measureModel` | `(id: string) => ModelBounds \| null` | 返回 `null`（没挂上 / 模型还没加载完） |
| `groundPointAt` | `(clientX, clientY) => [number, number] \| null` | 返回 `null`（落不到地面） |
| `getSceneData` | `() => SceneConfig` | **不会失败** |
| `loadSceneData` | `(data: DeepPartial<SceneConfig>) => boolean` | 返回 `false`（传进来的不是对象） |

⚠️ **没有一个是抛异常的。** 前三条是隔着画布问的，而画布可能还没挂上。

所以模板里写了 `ref="viewer"` 之后，要用 `viewer.value?.` 这种方式访问。`getSceneData` 只读 store，是唯一一定给得出数据的。

> `InstanceType<typeof SceneViewer>` 上就带着这五个方法（产物的 `.d.ts` 里它们是 `DefineComponent` 的第二个类型参数）。你**不必自己声明一个接口**，写错了会编译失败。

**什么时候用哪一条：**

- **`captureCamera`** 抓当前机位写回配置。平时用不上——拖动结束会自动回写。只有自动旋转开着时相机一直在动、永远触发不了"拖动结束"，才需要你主动取一次。
- **`measureModel`** 量一个模型的世界包围盒（`ModelBounds`，就是 `{ min, max }` 两个最小 / 最大角）。**返回 `null` 时重试是有意义的**——它多半只是还在加载。
- **`groundPointAt`** 把屏幕坐标换算成地面平面上的 `[x, z]`（米）。
  ⚠️ **它不是一条事件通道**：库只回答"这一点对应地面的哪个位置"。至于这一点意味着"画一面墙"还是"什么都不做"，由你自己判断。
- **`getSceneData`** 取当前场景配置的深拷贝。可以直接 `JSON.stringify` 后交给你的接口。
  出去的是**裸的 `SceneConfig`**：版本号、场景名、导出时间这类外壳由你自己定。要存成文件的话，编辑器那边的形状是 `{ version, name, exportedAt, config }`，可以照抄。
- **`loadSceneData`** 用一份场景数据初始化场景。入参和 `applyConfig` 一样按 `DeepPartial` 收：只写要覆盖的分组，其余保持当前值，`undefined` 表示"本次不改这一项"。
  两处要注意的：它**先走一遍 `migrateConfig`**（早先的配置写的是单个 `model` 对象，现在是 `models` 列表）；载入后会**清空撤销栈**。想要"可撤销的载入"，自己调 `applyConfig(patch, '标签')`。
  **挂载前调也可以**——它的实现在 store 里，所以画布还没挂上时一样成立（这一点与 `getSceneData` 同）。挂载时就要给数据的场合，用 `initialScene` prop 更顺手，两者是**同一条实现**。

`migrateConfig` 单独导出，因为"你自己读盘、自己 `applyConfig`"那条路同样合法：

```ts
import { migrateConfig } from '3deditor'

scene.applyConfig(migrateConfig(await fetch('/api/scene/9f2').then((r) => r.json())))
```

这段在你**不走组件、直接操作 store** 时用：从后端拉到一份可能是旧格式的配置，先迁移成当前格式，再写进 store。漏掉 `migrateConfig` 的症状是静默的——旧格式里的 `model` 字段没人认识，于是场景是空的，而不是报错。

---

本文件只讲怎么用。为什么这么写、内部实现与验收清单都在仓库里那份 `DESIGN.md` 里
（<https://github.com/chen870594504/3deditor/blob/main/DESIGN.md>）——那是给改这个仓库的人
看的内部文档，不面向宿主，也不随这个包发出去。
