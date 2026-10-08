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
  <TdmSceneViewer model="/chair.glb" height="480px" />
  <SceneViewer model="/chair.glb" :toolbar="false" @loaded="scene.markLoaded()" />
</template>
```

这段在展示两种用法并存：第一行走全局组件（有类型提示），第二行走具名导入（自己传 props）。

## 预览还是编辑：`editable` 一个开关

**问题**：有时候你只想让人转着看看模型，有时候你要让人真的动手改。要是为此维护两套组件，迟早会各长各的。

**做法**：同一个 `SceneViewer`，用 `editable` 切换。

```vue
<!-- 只给人转着看：没有内置工具栏、点不中模型、也没有包围框与手柄 -->
<SceneViewer :editable="false" model="/chair.glb" height="480px" />

<!-- 可编辑：内置工具栏 + 点选 + 包围框 + 变换手柄 -->
<SceneViewer :editable="true" model="/chair.glb" height="480px" />
```

这两行只差一个 `editable`，页面上的表现差得很远：上面那行是一块干干净净的画布，下面那行冒出一条工具栏，点模型能选中，选中后出现一圈框和一副手柄。

**它不新增任何能力**，只是改下面四个开关的默认值（`toolbar` / `pickable` / `selection` / `gizmo`）：

| `editable` | 效果 |
| --- | --- |
| 不传（默认） | 完全按四个开关各自的值来——与没有这个 prop 之前一致 |
| `false` | 四个一律关掉 |
| `true` | 四个一律打开 |

**谁显式传了谁说话。** `:editable="true"` 配上 `:toolbar="false"`，就是"要编辑，但不要内置工具栏"——你想自己画一条工具栏时就这么写。

`editable` 只管这四个开关。其余 prop、下面 12 个事件、5 个对外方法，都不会因为它而增减。

**什么时候会用到 `resolveSceneSwitches`**：你在模板里想自己判断"此刻点选到底开没开"（比如自己画个按钮的禁用态）。它导出了，和组件内部走的是同一条规则：

```ts
resolveSceneSwitches({ editable, pickable, /* … */ })
```

不用它，你就得在模板里抄一遍"三级优先级"的判断，两份规则迟早不一致——症状是"按钮亮着可点，画布上却点不中"。

## 最小示例

**这是最快的跑通路径**：一块画布 + 一个从后端读场景、再存回去的完整流程。

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
  <!-- editable 一下就把点选 / 包围框 / 手柄都打开，不必再写三个 prop -->
  <SceneViewer
    ref="viewer"
    editable
    height="100%"
    model="/chair.glb"
    :camera-transition="450"
    :shadow="{ enabled: true, type: 'contact', contactOpacity: 0.6 }"
    @model-transform="onTransform"
  />
  <button @click="save">保存</button>
</template>
```

这段在做三件事：页面一打开就从 `/api/scene/9f2` 拉场景灌进画布；点「保存」把当前场景吐给你的后端；用户拖动手柄时在控制台打一行日志。

关于 `ref`：它就是 Vue 里"贴了标签的盒子"。你把标签（`ref="viewer"`）贴在组件上，之后用 `viewer.value` 就能把盒子打开、拿到这个组件实例，进而调它的方法。注意 `viewer.value?.` 里那个问号——组件还没挂上时盒子是空的。

跑起来之后你会看到：椅子出现在画布上，右下角一条工具栏，点中椅子会出现一圈青绿色的框和一副 X/Y/Z 手柄。

---

## `SceneViewer` 的 props

**props 就是"你从外面告诉组件的事"**，像给一台机器的控制面板按按钮。这个组件有 9 个扁平 prop 保持原有契约不变，另有 `pickable`、三个选中视觉相关的 prop，以及 `cameraTransition`：

| Prop          | 类型                              | 默认值      | 说明                                                |
| ------------- | --------------------------------- | ----------- | --------------------------------------------------- |
| `model`       | `string \| DeepPartial<ModelConfig>` | `''`     | 模型地址，或整个模型分组（见下）；写入**当前选中的那个模型**          |
| `background`  | `string`                          | `'#0b1020'` | 画布背景色，传 `'transparent'` 可透出页面背景       |
| `environment` | `EnvironmentPreset`               | —           | 环境贴图预设，**不设置则不发起任何网络请求**        |
| `height`      | `string \| number`                | `'480px'`   | 画布高度，数字按 px 处理                            |
| `editable`    | `boolean`                         | —           | **预览 / 编辑总闸**（见上一节）：`false` 关掉下面四个开关，`true` 全开，不传则按四个开关各自的值 |
| `toolbar`     | `boolean`                         | `true`      | 是否显示内置工具栏                                  |
| `autoRotate`  | `boolean`                         | `false`     | 是否自动旋转视角                                    |
| `wireframe`   | `boolean`                         | `false`     | 是否线框渲染（会遍历改写模型所有材质的 wireframe）  |
| `showGrid`    | `boolean`                         | `true`      | 是否显示地面网格                                    |
| `draco`       | `boolean`                         | `false`     | 模型是否为 Draco 压缩格式                           |
| `pickable`    | `boolean`                         | `false`     | 是否允许在画布上点选模型（见「点选模型」一节）      |
| `selection`   | `boolean`                         | `false`     | 是否给选中的模型画一圈包围框（见「在画布上编辑模型」） |
| `gizmo`       | `boolean`                         | `false`     | 是否给选中的模型挂 X/Y/Z 变换手柄（同上）           |
| `gizmoMode`   | `TransformMode`                   | `'translate'` | 手柄模式：`'translate'` / `'rotate'` / `'scale'`  |
| `cameraTransition` | `number`                     | `0`         | 机位改动滑过去的时长（毫秒），0 = 瞬移              |

> ⚠️ **设高度请用 `height`，不要用内联 `style="height: …"`。**
>
> 你写在组件上的 `class` / `style` 会透传到画布根节点上，而透传的样式**是合并在后面的**。所以内联的 `height` 会把你通过 `height` prop 算出来的那个值覆盖掉。两者同时写时以你的内联样式为准——看起来就像 `height` prop 失效了，但不会报错。

> ⚠️ **`toolbar` / `pickable` / `selection` / `gizmo` 这四行的"默认值"列，是 `editable` 也没传时的值。** 传了 `editable` 就以它为准（分开关优先）。

`selection` / `gizmo` / `gizmoMode` 读的是 store 里那个选中项（由 `selectModel` 或用户在编辑器里点出来）。它们不改变选中逻辑，也**不经过 `events`**。

`cameraTransition` 是唯一的动效开关。你写 `450` 之类之后，`camera.position` / `camera.target` 的**任何**改动都会滑过去：2D / 3D 切换、聚焦模型、点「重置机位」、撤销、面板里手改数值。

**它只影响画面。** 配置在写入那一刻就已经是终点值了——所以右栏读数、按钮高亮、历史记录立刻都是终点的样子，不必等画面追上。两端缓入缓出，中途被打断时直接落到终点。

### `model` 的两种写法

**你在只需要一个网址时用第一种，要顺带配名字/位置时用第二种。**

```vue
<!-- 简写：只给地址 -->
<SceneViewer model="/chair.glb" />

<!-- 完整：一次给出模型分组的多个字段，未提到的字段保持默认 -->
<SceneViewer
  :model="{
    url: '/chair.glb',
    name: '办公椅',
    position: [0, 0.2, 0],
    rotation: [0, Math.PI / 4, 0],
    scale: [1.2, 1.2, 1.2],
    events: { click: { enabled: true, code: 'console.log(event.name)' } },
  }"
  @object-click="onPick"
/>
```

第一行是"只给地址"的简写，椅子会出现在默认位置。第二行一次给出整组字段：地址、显示名、位置、转了 45°、放大 1.2 倍，并给"单击"挂了一段代码。你没写到的字段保持默认。

> ⚠️ **对象写法请传稳定引用**（`setup` 里的常量，或者 `computed`）。
>
> `model` 是深监听的。你传一个内联字面量，它每次渲染都会重新同步一遍——把用户在编辑器里改好的变换冲掉。这个 bug 的样子是"我明明拖好了，一动别的地方它就弹回去了"。

> 类型用 `DeepPartial<ModelConfig>`（也就是这个 prop 的类型）。你手写一个**完整**的 `ModelConfig` 字面量，会在升级后编译失败。直接读 `exportConfig()` 的结果不受影响。

> **这个 prop 的语义是"当前选中的那一个模型"。** 选中项不存在（空场景）时，它**追加一个新的**。
>
> 要同时摆多个模型，用下面「多个模型」一节里的 `addModel` / `patchModel` / `selectModel`。

### 6 个分组 prop

**想把一整块能力一次配好时用它**，比如"我这页面的相机固定 35° 视野、俯角不超过 90°"。

另有 6 个分组 prop（`model` / `camera` / `ground` / `floorplan` / `sun` / `shadow`），类型是各配置分组的 `DeepPartial`。

注意这里**没有 `models`**：prop 的表达力只到"那一个模型"。多模型请直接用 store。

```vue
<SceneViewer
  :camera="{ fov: 35, maxPolarAngle: Math.PI / 2 }"
  :ground="{ visible: true, cellSize: 0.5, infiniteGrid: true }"
  :sun="{ showSky: true, elevation: 12, azimuth: 150 }"
  :shadow="{ enabled: true, type: 'contact', contactOpacity: 0.6 }"
/>
```

这段在一次性调好几块：相机视野收窄到 35°、地面网格改成 0.5 米一格且无限延伸、太阳压到 12° 仰角、阴影换成接触阴影。没写到的字段一律保持默认。

其中 `floorplan` 比其他五个多一条**必须注意**的事：它的 `walls` / `openings` / `rooms` 是数组，而深合并对数组是**整体替换**、且**按引用**装进配置。你自己拼数组时请先过一遍 `cloneFloorplanPatch(patch)`（理由见下面「`floorplan` — 户型图」）。

> 扁平 prop 与分组 prop 都是**初始值**：传进去之后同步进 store，用户在编辑器里的改动不会再被覆盖。
>
> 两层同时给同一个字段时**以分组 prop 为准**——`wireframe` / `draco` / `environment` 这几个兼容用的扁平 prop 会先看分组里有没有写该字段，写了就自己让位。
>
> 物体级的 `castShadow` / `receiveShadow` 只走 `model` 分组这一条路。

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
| `modelPick`          | `ModelPickPayload`   | 在画布上点中模型（需 `pickable`，与 `events` 无关） |
| `modelTransform`     | `ModelTransformPayload` | 手柄拖拽过程中逐帧派发（需 `gizmo`）             |
| `modelTransformEnd`  | `ModelTransformPayload` | 手柄拖拽结束、且变换**确实变了**（需 `gizmo`）   |

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

### 点选模型：`pickable` 与 `modelPick`

**这两个看起来像一回事，其实回答的是两个问题。**

`objectClick` 回答的是"用户点了**这个模型的某个部件**"，需要模型自己开事件。
而"用户想让**这个模型**变成当前选中的那一个"是另一件事，所以单独给了一条画布级的通道：

|  | `objectClick` | `modelPick` |
| --- | --- | --- |
| 开启方式 | 该模型的 `events.click.enabled` | 画布级 prop `pickable` |
| 开销 | 开了任意一类事件就**每帧** raycast 一次整棵子树 | 两个 DOM 监听器 + **每次点击**一次 raycast |
| 载荷 | 带 `type` / `name` / `url` | 只有 `id` |
| 点空白 | —（点的就是模型） | 什么都不发 |

> `raycast` 你可以理解成"从眼睛射出去一支激光笔，看它先打中谁"。每帧射一次和点一下射一次，开销差着数量级——这就是为什么两者分成两条路。

两者**互不影响**，都开时 `modelPick` 一定**先到**。

点空白处（地面、网格、背景）**不发** `modelPick`。所以"点一下画布就取消选中"这类行为需要你自己补一句。

`pickable` 判定单击用的是与 `events` 同一个判据，而且**跳过 `visible` 为 false 的模型**——所以"点哪选哪"和你眼睛里看到的画面一致。

### 在画布上编辑模型：`selection` 与 `gizmo`

**你要让人在画布上直接拖着改模型时，打开这两个。**

```vue
<SceneViewer
  model="/chair.glb"
  pickable
  selection
  gizmo
  gizmo-mode="translate"
  @model-pick="onPick"
  @model-transform="onTransform"
  @model-transform-end="onTransformEnd"
/>
```

这段在把编辑器手柄全打开：能点选、选中后有框、有手柄，拖手柄时两个事件分别逐帧和松手时通知你。

- **`selection`** —— 给选中的那个模型套一圈包围框，颜色是内置示例几何体同款的青绿。
- **`gizmo`** —— 给选中的那个模型挂一副 X/Y/Z 手柄。`gizmoMode` 决定拖出来的是平移、旋转还是缩放。

两个事件都是**输出**，不是输入——库里已经把值写回 store 了。

`modelTransform` 每帧派发，用来做"拖拽中"的联动。`modelTransformEnd` 只在**松手且值确实变了**时派发一次，用来补一条可读的历史标签。

你不用做任何事，也只会看到一条"模型属性"标签，不会刷屏。

`selection` / `gizmo` 都不依赖 `pickable`，也不给任何模型带来逐帧 raycast。关掉开关时整个组件都不渲染。

**隐藏的模型不给选中视觉**（否则你会在拖一个看不见的东西），但隐藏的模型仍然能量尺寸。

## 模型事件：`events` 与 `code`

**你在属性面板里给某个模型写了一段 JS，想让它在被点击时跑起来——这一节讲的就是这条链。**

每个模型的 `events` 里存着 5 类指针事件各自的启用位与一段 JS 代码：

```ts
interface ModelEventHandler {
  enabled: boolean   // 唯一门控：决定挂不挂指针监听器、发不发事件
  code: string       // 要执行的 JS 语句体；库**完全不解释**它
}

// 5 个键：click / dblclick / pointerenter / pointerleave / contextmenu
```

⚠️ **库只负责"发事件 + 读 `enabled`"，从不执行 `code`。**

这很重要，而且是刻意的：**库不碰 `new Function`，也不碰 `eval`**。你的场景数据可能来自后端、来自用户输入，库要是替你把它们执行了，那就是一个谁都担不起的安全口子。

所以要真正跑起来，**你自己接这 5 个 emit**。下面这段接上去就能跑：

```ts
import { useSceneStore } from '3deditor'
import type { ModelEventPayload, ModelEventType } from '3deditor'

const scene = useSceneStore()
const compiled = new Map<string, (event: unknown, model: unknown) => void>()

function run(type: ModelEventType, payload: ModelEventPayload) {
  // 按载荷里的 id 找回**发出事件的**那个模型，而不是「此刻选中的那个」：
  // 点一下 A 之后、代码跑起来之前去列表里切到 B 是完全可能发生的
  const model = scene.exportConfig().models.find((item) => item.id === payload.id)
  const handler = model?.events?.[type]
  if (!handler?.enabled || !handler.code.trim()) return

  let fn = compiled.get(handler.code)
  if (!fn) {
    try {
      // 最后一个参数是**语句体**，不是函数表达式
      fn = new Function('event', 'model', handler.code) as typeof fn
      compiled.set(handler.code, fn!)
    } catch (error) {
      console.error('事件代码编译失败', error)
      return
    }
  }

  try {
    // model 传深拷快照：传 config.models[n] 本身的话，用户代码一句
    // `model.events.click.enabled = true` 就会真的写进 store、进历史栈
    fn(payload, model)
  } catch (error) {
    console.error('事件执行出错', error)
  }
}
```

这段做四件事：从载荷里找回是哪个模型；读它这段代码的启用位；把代码编译成函数（并缓存，不会每次都编译）；执行，同时兜住可能的报错。

接上这五个事件：

```vue
<SceneViewer
  @object-click="run('click', $event)"
  @object-dblclick="run('dblclick', $event)"
  @object-pointer-enter="run('pointerenter', $event)"
  @object-pointer-leave="run('pointerleave', $event)"
  @object-context-menu="run('contextmenu', $event)"
/>
```

接上之后：用户单击模型，属性面板里写的那段 `console.log(...)` 就会真的打到控制台。

编辑器里默认填的模板是 `console.log('单击', event, model)`。另外三个导出：

- `MODEL_EVENT_TYPES` —— 固定顺序的 5 个键
- `MODEL_EVENT_LABELS` —— 中文名
- `defaultEventCode(type)` —— 默认模板
- `activeEventTypes(model)` —— 唯一那套门控判断。你想自己画界面时用它，结果一定与库一致

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

`migrateConfig` 单独导出，因为"你自己读盘、自己 `applyConfig`"那条路同样合法：

```ts
import { migrateConfig } from '3deditor'

scene.applyConfig(migrateConfig(await fetch('/api/scene/9f2').then((r) => r.json())))
```

这段在你**不走组件、直接操作 store** 时用：从后端拉到一份可能是旧格式的配置，先迁移成当前格式，再写进 store。漏掉 `migrateConfig` 的症状是静默的——旧格式里的 `model` 字段没人认识，于是场景是空的，而不是报错。

## 配置：`SceneConfig`

`scene.config` 就是它。默认值见 `DEFAULT_SCENE_CONFIG`。

**这是你的场景的全部内容**——它只是一份普通对象，能 `JSON.stringify`，能存数据库。想"保存场景"，就是把它存下来；想"打开场景"，就是把它写回去。

### `models` — 模型列表

场景里可以同时摆多个模型，所以这一组是**数组**。

⚠️ 默认是**空数组**：打开就是空场景。想要那个占位物体（地址为空、渲染成内置示例几何体），调一次 `addModel()`。

| 字段                                  | 默认值            | 说明                                          |
| ------------------------------------- | ----------------- | --------------------------------------------- |
| `id`                                  | 随机 uuid         | 模型标识，由 store 生成；地址变化时重新生成   |
| `url`                                 | `''`              | 模型地址，留空则渲染内置示例几何体            |
| `draco` / `wireframe`                 | `false` / `false` | 加载与渲染方式                                |
| `name`                                | `''`              | 显示名；留空时回退成从地址派生的短名          |
| `position` / `rotation` / `scale`     | `[0,0,0]` / `[0,0,0]` / `[1,1,1]` | 相对父级的变换三元组       |
| `repeat`                              | **不存在**        | 贴图在两个方向重复几次 `(u, v)`，见下          |
| `visible`                             | `true`            | 是否渲染                                      |
| `castShadow` / `receiveShadow`        | `true` / `true`   | 物体级阴影，与全局总闸 **AND**                 |
| `events`                              | 5 类全关           | 5 类指针事件各自的启用位与 JS 代码，见「模型事件」 |

> `rotation` 的**单位是弧度**，与 `camera.minPolarAngle` / `maxPolarAngle` 一致。

> ⚠️ **`repeat` 默认不存在，不是 `[1, 1]`。**
>
> 它补偿的是"把一个模型拉伸到一块区域大小"那类用法。你 `scale` 放大几倍，贴图也跟着拉伸，图案的**实物尺寸**就随区域大小变了。给一个非 1 的 `repeat` 把这个倍数还回去，图案尺寸就恒定了。
>
> 它**只改贴图、不改几何**。要求资产的 **UV 恰好铺满 0..1**，两个分量都必须是正数。

> `id` 是 uuid，由 store 生成并维护，也存在配置里，所以导出导入会原样带上——你想"换模型也保持同一个 id"，显式传一个固定值即可。

> ⚠️ **`models` 与配置里其他分组有一个不对称：`applyConfig` 对数组是整体替换。**
>
> 所以 `applyConfig({ models: [...] })` 等于把整张列表换掉，而不是按下标合并。
>
> 只想改其中一个模型请用 `patchModel(patch, label?, index?)`——否则一个只写了 `{ url }` 的补丁会把那个模型其余字段连同 `id` 一起抹掉。

> 物体级 `castShadow` / `receiveShadow` 只有 `shadow.type` 是 `map` 或 `accumulative` 时才有实际效果（接触阴影走的是另一条烘焙路径）。

### `floorplan` — 户型图

默认是**空户型**（`foundation: null` + 三个空数组）。

| 字段         | 类型                              | 默认值 | 说明                                        |
| ------------ | --------------------------------- | ------ | ------------------------------------------- |
| `foundation` | `{ x, z, width, depth }` 或 null  | `null` | 一块矩形地基板；`x` / `z` 是**中心点**，不是最小角 |
| `walls`      | `FloorplanWall[]`                 | `[]`   | 墙，存**中心线**（两个端点）+ 墙高 + 墙厚 + 可选的外观地址 `url` |
| `openings`   | `FloorplanOpening[]`              | `[]`   | 门窗。**没有自己的坐标**，只有 `hostWallId` + 沿墙米数 |
| `rooms`      | `FloorplanRoom[]`                 | `[]`   | 房间：由墙体泛洪自动围出来的多边形 + 名称 + 颜色 |

> 单位一律**米**、角度一律**弧度**。`SceneConfig` 只放**可 JSON 往返**的数据——"画到一半的那条墙链"不进配置。

> ⚠️ **`applyConfig({ floorplan: { walls: [...] } })` 里的 `walls` 会整体替换整张表**（与 `models` 同样是数组语义）。
>
> 你自己拼数组时请调一次 `cloneFloorplanPatch(patch)`。原因是 `applyPatch` 对数组做的是**别名**而不是拷贝，逐层拷过再写，才能切断你和配置之间的那条暗通道（墙的 `start` / `end`、房间的 `polygon` 都是嵌套数组，只拷顶层不够）。
>
> 漏掉它的症状：你在外面改了一下自己那个数组，画布里的墙跟着变——而这条路上谁都没触发历史记录。

### 其余分组

**`camera`** — 相机

| 字段                                          | 默认值        | 说明                              |
| --------------------------------------------- | ------------- | --------------------------------- |
| `position` / `target`                         | `[4,3,6]` / `[0,0,0]` | 机位与注视点，三元组       |
| `fov` / `near` / `far`                        | `45` / `0.1` / `200` | 透视相机参数               |
| `autoRotate` / `autoRotateSpeed`              | `false` / `1.2` | 自动旋转及其速度                |
| `damping` / `dampingFactor`                   | `true` / `0.06` | 阻尼惯性及其系数                |
| `minDistance` / `maxDistance`                 | `1.5` / `150` | 推拉距离上下限                    |
| `minPolarAngle` / `maxPolarAngle`             | `0` / `π/2`   | 俯仰上下限，**单位是弧度**        |
| `enableRotate`                                | `true`        | 是否允许旋转视角                  |
| `enablePan` / `enableZoom`                    | `true` / `true` | 平移与缩放开关                  |

**`ground`** — 地面网格：`visible` `size` `cellSize` `cellThickness` `cellColor` `sectionSize` `sectionThickness` `sectionColor` `infiniteGrid` `fadeDistance` `fadeStrength` `followCamera`

**`sun`** — 日照与环境：`showSky` `elevation` `azimuth` `turbidity` `rayleigh` `mieCoefficient` `mieDirectionalG` `ambientIntensity` `keyIntensity` `fillIntensity` `environment` `skybox`

> 主光方向由 `elevation` / `azimuth` 用与天空盒相同的球坐标公式推导，所以**影子方向和天上的太阳始终一致**。
>
> `skybox` 是**六个面地址的定长元组**（顺序 `[+X, -X, +Y, -Y, +Z, -Z]`，即 `[右, 左, 上, 下, 前, 后]`——后三个字是社区惯例对这三对轴的叫法，本项目的资产**不按它排队**，见 `SkyboxFaces` 与 `SKYBOX_FACE_FILES`）。`null` 表示不用天空盒。
>
> 它与 `environment` 是**同一个位置的两种填法**：两者写的都是 `scene.environment`，这一组字段里最多只有一个不是空的。

**`shadow`** — 阴影：`enabled` `type`（`'map'` / `'contact'` / `'accumulative'`）`castShadow` `receiveShadow` `mapSize` `bias` `normalBias` `contactOpacity` `contactBlur` `contactScale` `contactResolution` `accFrames` `accOpacity` `accScale` `accBlend`

## 状态管理：`useSceneStore`

**store 你可以想成一块公共白板**：组件在写，你的代码也在读，两边看到的是同一个东西。它是 Pinia 的 store，id 为 `tdm-scene`（带前缀，避免和你的 store 撞名）。

```ts
const scene = useSceneStore()

// 配置（唯一事实来源）
scene.config                      // SceneConfig，reactive
scene.applyConfig(patch, label?)  // 深合并写入；给了 label 就立刻记一条历史
scene.exportConfig()              // 深拷贝，可直接 JSON 序列化
scene.resetConfig()               // 全部恢复默认值

// 历史栈
scene.history                     // { id, label, at, config }[]，上限 50
scene.historyIndex
scene.canUndo / scene.canRedo
scene.undo() / scene.redo() / scene.jumpTo(i) / scene.clearHistory()

// 运行时状态（刻意不进 config，导入导出时不会被带走）
scene.loading / scene.progress / scene.error / scene.hasError

// 兼容访问器，读写都会落到 config 对应字段
scene.modelUrl / scene.background / scene.autoRotate / scene.wireframe / scene.showGrid

// 行为
scene.setModel(url) / scene.clearModel() / scene.resetView() / scene.toggle('wireframe')
```

**为什么"运行时状态"要单独拎出来**：`loading` / `progress` / `error` 是"此刻加载到哪了"，不是"场景长什么样"。它们不进 `config`，所以不会被导出、不会进历史、也不会被你存进数据库。

`resetView()` 恢复的是**显示类开关**：`background` / `camera.autoRotate` / `model.wireframe` / `model.visible` / `ground.visible`。

**它不碰机位，也不碰模型的位置旋转缩放**——那是 `resetConfig()` 的范畴。想"把镜头转回原样"用前者，想"整个场景推倒重来"用后者。

改动 `config` 会被自动记录：400 毫秒内的连续改动合并成一条，标签按变化的顶层分组自动生成（`模型属性` / `相机` / `地面` / `日照环境` / `阴影` / `背景`）。

### 多个模型

**什么时候会用到**：你的场景里不止一个物体，比如一个房间里摆了椅子、桌子、灯。这时"当前在编辑哪一个"就变成一个必须回答的问题。

| 成员                            | 说明                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `models`                        | `config.models` 的只读视图，渲染与遍历用                                 |
| `addModel(url?)`                | 追加一个模型并选中它，返回它的下标。`url` 留空 = 追加一个内置示例几何体   |
| `removeModel(index)`            | 移除指定条目；越界是空操作                                              |
| `selectModel(index)`            | 切换「当前在编辑哪一个」；越界是空操作                                   |
| `selectedIndex` / `selectedModel` | 当前选中项的下标与对象。空场景时 `selectedModel` 是 `undefined`          |
| `patchModel(patch, label?, index?)` | 深合并一份补丁到某一个模型上；`index` 缺省时落到 `selectedIndex`       |
| `setModel(url, index?)`         | 载入模型并复位加载态；`index` 缺省时落到 `selectedIndex`                  |
| `clearModel(index?)`            | 卸载资源、回到内置几何体                                                |

```ts
const scene = useSceneStore()

scene.addModel('/chair.glb')
scene.addModel('/table.glb')        // 两个模型并存，第一个原封不动
scene.patchModel({ position: [1, 0, 0] }, '挪一下', 1)
scene.selectModel(0)                // 属性面板从此描述第一个模型
scene.removeModel(1)
```

这段在摆两个模型：椅子放原处，桌子加进来再往右挪 1 米，然后把"当前选中"切回椅子，最后删掉桌子。

> ⚠️ **选中项是界面状态，不是配置。** 它是独立的 `selectedIndex`，不进 `config`、不进历史、不进导出物。
>
> 这是刻意的：要是把"选中哪个"塞进配置，那你在列表里点一下就算一次场景改动，历史里会多出一串纯噪声，撤销一次只是换了个选中项。
>
> 它只可能因为"列表变短"而越界，store 里 watch 一下列表长度就足以收回界内。

> 单模型时代的那些入口（`model` prop、`setModel` / `clearModel` / `modelUrl` / `wireframe` / `hasModel`）语义一律收窄成"当前选中的那个模型"。
>
> 所以场景里只有一个模型时，它们的行为和从前**完全一致**——你不用为升级改任何一行代码。
>
> `setModel()` / `clearModel()` 会在**地址真的变了**时换一个新的 `model.id`，重复提交同一个地址不会换。

---

## 从包里能 import 什么

| 类别 | 导出 |
| --- | --- |
| 组件 | `SceneViewer` / `SceneToolbar` / `SceneFloorplan`（后两个是配套件，`SceneViewer` 已经自动用上了） |
| 插件 | `createThreeDMaker`（默认导出也是它） |
| store | `useSceneStore` |
| 配置 | `DEFAULT_SCENE_CONFIG` / `migrateConfig` / `cloneFloorplanPatch` / `createFloorplanConfig` |
| 事件 | `MODEL_EVENT_TYPES` / `MODEL_EVENT_LABELS` / `activeEventTypes` / `defaultEventCode` |
| 名称与档位 | `deriveModelId`（从地址派生可读短名，`model.name` 留空时的默认值）/ `viewModeOf`（现在算 2D 俯视还是 3D 透视） |
| 开关规则 | `resolveSceneSwitches` / `DEFAULT_SCENE_SWITCHES`（`editable` 那条「分开关 ?? 总闸 ?? 旧默认」的唯一实现，见「预览还是编辑」） |
| 户型图算术 | `wallPieces` / `removeWall` / `wallLength` / `wallRotationY` / `pointAlongWall` / `findNearestWall` / `findEnclosedArea` / `pointInPolygon` / `polygonCenter` / `pickRoomColor` / `createFloorplanId` / `openingFreeGap` / `openingOverlaps` / `openingMagnetOffset` / `resolveOpeningDrag` / `openingFilledByModel` / `openingRejectReason` / `dropOpeningFills` |
| 户型图常量 | `CELL_SIZE` / `DEFAULT_WALL_HEIGHT` / `DEFAULT_WALL_THICKNESS` / `DOOR_WIDTH` / `DOOR_HEIGHT` / `WINDOW_WIDTH` / `WINDOW_HEIGHT` / `WINDOW_SILL` / `OPENING_EDGE_GAP` |
| 墙面与洞口贴装 | `wallFaceTiles` / `wallFaceFit` / `wallFaceIsSheet` / `wallFaceUnusable` / `openingFaceUnusable` / `openingFaceOversized` |
| 零件表几何 | `parseModelParts` / `placeModelParts` / `MAX_PARTS` / `MAX_COUNT` |
| 类型 | `SceneConfig` / `ModelConfig` / `FloorplanWall` / `FloorplanOpening` / `FloorplanRoom` / `SceneViewerProps` / `ThreeDMakerOptions` / `TransformMode` / `EnvironmentPreset` / 各 payload 与分组配置，以及它们的 `DeepPartial` |

> **户型图那一大组算术与常量导出，是为了让你不必抄一遍。**
>
> 户型图的放置、夹取、磁吸与贴面铺法，抄漏一处**不报错**——例如夹取漏掉，墙体就会切出负长度，变成一块法线翻转的黑面。这种 bug 只有眼睛看得出来。
>
> 它们全是不依赖 three、不依赖 DOM 的纯函数，你可以在任何地方直接跑（连浏览器都不需要）。`MAX_PARTS` / `MAX_COUNT` 是**公开约定**而不是内部实现——超了整份零件表会被拒掉。
>
> 曲线与中间结果类型（`EnclosedAreaResult` / `FloorplanPiece` / `NearestWallHit` / `OpeningGap` / `WallFaceBounds` / `WallFaceTile` / `ModelPartsResult` 等）一并导出。

---

本文件只讲怎么用。为什么这么写、内部实现与验收清单都在仓库里那份 `DESIGN.md` 里
（<https://github.com/chen870594504/3deditor/blob/main/DESIGN.md>）——那是给改这个仓库的人
看的内部文档，不面向宿主，也不随这个包发出去。
