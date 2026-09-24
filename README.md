# 3deditor

基于 **Vue 3 + Vite + TypeScript + Pinia + SCSS + TresJS** 的 3D 场景插件：加载 glTF / GLB、
同时摆多个模型、配相机与日照阴影、画户型图（墙 / 门窗 / 房间）。

技术栈版本：Vue 3.5 / Vite 8 / TypeScript 5.9 / Pinia 4 / sass-embedded 1.104 / TresJS 5 / Three.js 0.186

---

## 安装

```bash
pnpm add 3deditor three pinia @tresjs/core @tresjs/cientos
```

包发在**公共的 npmjs 源**上，匿名可装：不需要令牌、不需要配 `.npmrc` 的 registry，
`pnpm add` 一行就完事。

后面那 5 个**必须显式装**——它们声明在 `peerDependencies` 里，而 peer 的用意正是「宿主自己
必须有一份」，不是可选项。**包本身一行 `dependencies` 都没有**，`dist/index.js` 里对它们是
裸 `import`（`vue` / `three` / `pinia` / `@tresjs/*` 全被外置），所以这些代码一份都不随包发出来。

**这是刻意如此的，不是漏装。** 这几样都持有跨边界共享的状态，出现两份的后果如下，
而且**全是静默失败**：

| 依赖 | 两份的后果 |
| --- | --- |
| `vue` | 宿主那份的响应式追踪不到插件那份的状态 |
| `pinia` | 宿主读到的 `config` 不是组件正在写的那一份，数据永远不动 |
| `three` | 两套类标识，`instanceof` 判断全失效；而库会把手里的**活 three 对象**交给宿主（payload 里的 `object`、`measureModel` 的结果），跨两份根本用不了 |
| `@tresjs/core` | 它靠 Vue 的 `provide` / `inject` 传渲染器与 `useLoop` 上下文，两份就意味着 `<TresCanvas>` 与它的子组件解析到不同上下文 |

宿主本来就是 Vue 应用，`vue` 必然已经有了（而且必须与插件同一份），所以实际要新增的是
`three` / `pinia` / `@tresjs/core` / `@tresjs/cientos` 四条。`pinia` 的 peer 范围是
`^2.3.0 || ^3.0.0 || ^4.0.0`，停在 3 也能直接用。

> `pnpm` 默认开着 `auto-install-peers`，会悄悄把 `three` / `@tresjs/*` 补进 `.pnpm`，于是
> 少装看不出后果。那是插件自己那份，宿主之后自己再装一个别的版本，就是两份并存。
> **要求显式装，是为了让「只有一份」由宿主的顶层依赖决定，而不是碰巧。**

## 注册

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

全局组件名就是 `prefix + SceneViewer / SceneToolbar / SceneFloorplan`，即默认的
`<TdmSceneViewer />`。**模板里的类型提示只覆盖 `Tdm` 这个默认前缀**（`GlobalComponents`
类型增强写死了这三个名字），用自定义前缀或 `registerComponents: false` 时请在模板里
改用具名导入：

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

## 最小示例

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { SceneViewer } from '3deditor'
import type { ModelTransformPayload } from '3deditor'

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
  <SceneViewer
    ref="viewer"
    height="100%"
    model="/chair.glb"
    pickable
    selection
    gizmo
    :camera-transition="450"
    :shadow="{ enabled: true, type: 'contact', contactOpacity: 0.6 }"
    @model-transform="onTransform"
  />
  <button @click="save">保存</button>
</template>
```

---

## SceneViewer Props

9 个扁平 prop 保持原有契约不变，另有 `pickable`、三个选中视觉相关的 prop，
以及 `cameraTransition`：

| Prop          | 类型                              | 默认值      | 说明                                                |
| ------------- | --------------------------------- | ----------- | --------------------------------------------------- |
| `model`       | `string \| DeepPartial<ModelConfig>` | `''`     | 模型地址，或整个模型分组（见下）；写入**当前选中的那个模型**          |
| `background`  | `string`                          | `'#0b1020'` | 画布背景色，传 `'transparent'` 可透出页面背景       |
| `environment` | `EnvironmentPreset`               | —           | 环境贴图预设，**不设置则不发起任何网络请求**        |
| `height`      | `string \| number`                | `'480px'`   | 画布高度，数字按 px 处理                            |
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

`selection` / `gizmo` / `gizmoMode` 读的是 store 里那个选中项（由 `selectModel` 或用户在
编辑器里点出来），不改变选中逻辑，也**不经过 `events`**。

`cameraTransition` 是唯一的动效开关。写 `450` 之类之后，`camera.position` / `camera.target`
的**任何**改动都是滑过去的：2D / 3D 切换、聚焦模型、点「重置机位」、撤销、面板里手改数值。
它只影响画面，配置在写入那一刻就是终点——所以右栏读数、按钮高亮、历史记录立刻都是终点的
样子，不必等画面追上。两端缓入缓出，中途被打断时直接落到终点。

`model` 有两种写法，字符串是「只给地址」的简写：

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

> 对象写法请传**稳定引用**（`setup` 里的常量或 `computed`）：`model` 是深监听的，传内联
> 字面量会在每次渲染时重新同步一遍，把用户在编辑器里改的变换冲掉。
>
> 类型用 `DeepPartial<ModelConfig>`（也就是这个 prop 的类型）。手写一个**完整**的
> `ModelConfig` 字面量会在升级后编译失败，直接读 `exportConfig()` 的结果不受影响。
>
> 这个 prop 的语义是「当前选中的那一个模型」：选中项不存在（空场景）时**追加一个新的**。
> 要同时摆多个模型，用下面「多个模型」一节里的 `addModel` / `patchModel` / `selectModel`。

另有 6 个**分组 prop**（`model` / `camera` / `ground` / `floorplan` / `sun` / `shadow`），类型是各
配置分组的 `DeepPartial`，用来一次配置一整块能力。注意这里没有 `models`：prop 的表达力只到
「那一个模型」，多模型请直接用 store：

```vue
<SceneViewer
  :camera="{ fov: 35, maxPolarAngle: Math.PI / 2 }"
  :ground="{ visible: true, cellSize: 0.5, infiniteGrid: true }"
  :sun="{ showSky: true, elevation: 12, azimuth: 150 }"
  :shadow="{ enabled: true, type: 'contact', contactOpacity: 0.6 }"
/>
```

其中 `floorplan` 比其他五个多一条**必须注意**的事：它的 `walls` / `openings` / `rooms` 是数组，
而深合并对数组是**整体替换**且**按引用**装进配置，宿主自己拼数组时请先过一遍
`cloneFloorplanPatch(patch)`（理由见下面「`floorplan` — 户型图」）。

> 扁平 prop 与分组 prop 都是**初始值**：传入后同步进 store，用户在编辑器里改动不会被覆盖。
> 两层同时给同一个字段时**以分组 prop 为准**——`wireframe` / `draco` / `environment`
> 这几个兼容用的扁平 prop 会先看分组里有没有写该字段，写了就自己让位。
> 物体级的 `castShadow` / `receiveShadow` 只走 `model` 分组这一条路。

## 事件

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

> 单击的判据是「位移 < 4px 且间隔 < 500ms」，所以拖动旋转视角不会误触发。双击再叠加
> 「两次单击间隔 < 500ms 且落在同一小片区域」；与浏览器一致，双击会**先发两次
> `objectClick` 再发一次 `objectDblclick`**。
>
> `object` 是 three 的 `Object3D`，带 `parent` 环，**不能 `JSON.stringify`**——它挂进
> payload 是为了让多部件模型能分辨「点中的是哪个部件」，要透传请只取自己需要的字段。
>
> `name` 与属性面板上看到的是同一个值：配置里留空时回退成从地址派生的短名
> （`builtin` / `local-file` / `damaged-helmet`），因此**永远非空**。`id` 是 uuid，
> 换模型会换一个，适合判断「是不是同一个物体」，不适合当显示文本。

### 点选模型：`pickable` 与 `modelPick`

`objectClick` 回答的是「用户点了**这个模型的某个部件**」，需要模型自己开事件；而「用户想让
**这个模型**变成当前选中的那一个」是另一件事，所以单独给了一条画布级的通道：

|  | `objectClick` | `modelPick` |
| --- | --- | --- |
| 开启方式 | 该模型的 `events.click.enabled` | 画布级 prop `pickable` |
| 开销 | 开了任意一类事件就**每帧** raycast 一次整棵子树 | 两个 DOM 监听器 + **每次点击**一次 raycast |
| 载荷 | 带 `type` / `name` / `url` | 只有 `id` |
| 点空白 | —（点的就是模型） | 什么都不发 |

两者**互不影响**，都开时 `modelPick` 一定**先到**。点空白处（地面、网格、背景）不发
`modelPick`，所以「点一下画布就取消选中」这类行为需要宿主自己补。`pickable` 判定单击用的是
与 `events` 同一个判据，且**跳过 `visible` 为 false 的模型**，所以「点哪选哪」与眼睛里
看到的画面一致。

### 在画布上编辑模型：`selection` 与 `gizmo`

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

- **`selection`** —— 给选中的那个模型套一圈包围框，颜色是内置示例几何体同款的青绿。
- **`gizmo`** —— 给选中的那个模型挂一副 X/Y/Z 手柄，`gizmoMode` 决定拖出来的是平移、
  旋转还是缩放。

两个事件都是**输出**而不是输入——库里已经把值写回 store 了。`modelTransform` 每帧派发，
用来做「拖拽中」的联动；`modelTransformEnd` 只在**松手且值确实变了**时派发一次，用来补一条
可读的历史标签。宿主什么都不做也只有一个「模型属性」标签，不会刷屏。

`selection` / `gizmo` 都不依赖 `pickable`，也不给任何模型带来逐帧 raycast；关掉开关时整个
组件都不渲染。**隐藏的模型不给选中视觉**（否则你会拖一个看不见的东西），但隐藏的模型
仍然能量尺寸。

## 模型事件：`events` 与 `code`

每个模型的 `events` 里存着 5 类指针事件各自的启用位与一段 JS 代码：

```ts
interface ModelEventHandler {
  enabled: boolean   // 唯一门控：决定挂不挂指针监听器、发不发事件
  code: string       // 要执行的 JS 语句体；库**完全不解释**它
}

// 5 个键：click / dblclick / pointerenter / pointerleave / contextmenu
```

**库只负责「发事件 + 读 `enabled`」，从不执行 `code`。** 要真正跑起来，宿主自己接这 5 个
emit 即可：

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

```vue
<SceneViewer
  @object-click="run('click', $event)"
  @object-dblclick="run('dblclick', $event)"
  @object-pointer-enter="run('pointerenter', $event)"
  @object-pointer-leave="run('pointerleave', $event)"
  @object-context-menu="run('contextmenu', $event)"
/>
```

编辑器里默认填的模板是 `console.log('单击', event, model)`。另外三个导出：
`MODEL_EVENT_TYPES`（固定顺序的 5 个键）、`MODEL_EVENT_LABELS`（中文名）、
`defaultEventCode(type)`（默认模板）、`activeEventTypes(model)`（唯一那套门控判断，
宿主想自己画界面时用它，结果一定与库一致）。

## SceneViewer 的对外方法

除了 props 与 emits，`SceneViewer` 还通过 `defineExpose` 暴露 5 个**命令式**方法，用来问
「此刻画布上是什么情况」：

| 方法 | 签名 | 拿不到时 |
| --- | --- | --- |
| `captureCamera` | `() => boolean` | 返回 `false`（相机没就绪） |
| `measureModel` | `(id: string) => ModelBounds \| null` | 返回 `null`（没挂上 / 模型还没加载完） |
| `groundPointAt` | `(clientX, clientY) => [number, number] \| null` | 返回 `null`（落不到地面） |
| `getSceneData` | `() => SceneConfig` | **不会失败** |
| `loadSceneData` | `(data: DeepPartial<SceneConfig>) => boolean` | 返回 `false`（传进来的不是对象） |

> `InstanceType<typeof SceneViewer>` 上就带着这五个方法（产物的 `.d.ts` 里它们是
> `DefineComponent` 的第二个类型参数），宿主**不必自己声明一个接口**，写错了会编译失败。

**没有一个是抛异常的。** 前三条隔着画布问，而画布可能还没挂上——模板里写 `ref="viewer"`
之后要用 `viewer.value?.` 访问；`getSceneData` 只读 store，是唯一一定给得出数据的。

- **`captureCamera`** 抓取当前机位写回配置。平时用不上（拖动结束会自动回写），只有自动旋转
  开着时相机一直在动、永远不会触发拖动结束，才需要主动取一次。
- **`measureModel`** 量一个模型的世界包围盒（`ModelBounds`，就是 `{ min, max }` 两个最小 / 最大角）。
  返回 `null` 时**重试**是有意义的，它多半只是还在加载。
- **`groundPointAt`** 把屏幕坐标换算成地面平面上的 `[x, z]`（米）。它**不是一条事件通道**：
  库只回答「这一点对应地面的哪个位置」，至于这一点意味着「画一面墙」还是「什么都不做」，
  由宿主自己判断。
- **`getSceneData`** 取当前场景配置的深拷贝，可直接 `JSON.stringify` 后交给自己的接口。
  出去的是**裸的 `SceneConfig`**：版本号、场景名、导出时间这类外壳由宿主自己定。
  要存成文件的话，编辑器那边的形状是 `{ version, name, exportedAt, config }`，可以照抄。
- **`loadSceneData`** 用一份场景数据初始化场景。入参与 `applyConfig` 一样按 `DeepPartial`
  收：只写要覆盖的分组，其余保持当前值，`undefined` 表示「本次不改这一项」。两处要注意的：
  它**先走一遍 `migrateConfig`**（早先的配置写的是单个 `model` 对象，现在是 `models` 列表），
  并在载入后**清空撤销栈**。想要「可撤销的载入」，自己调 `applyConfig(patch, '标签')`。

`migrateConfig` 单独导出，因为宿主自己读盘、自己 `applyConfig` 那条路同样合法：

```ts
import { migrateConfig } from '3deditor'

scene.applyConfig(migrateConfig(await fetch('/api/scene/9f2').then((r) => r.json())))
```

## 配置：`SceneConfig`

`scene.config` 就是它，默认值见 `DEFAULT_SCENE_CONFIG`。

### `models` — 模型列表

场景里可以同时摆多个模型，所以这一组是**数组**，默认是**空数组**（打开就是空场景）。
想要那个占位物体（地址为空、渲染成内置示例几何体），调一次 `addModel()`。

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
>
> **`repeat` 默认不存在，不是 `[1, 1]`**：它补偿的是「把一个模型拉伸到一块区域大小」那类
> 用法——`scale` 放大几倍，贴图也跟着拉伸，图案的实物尺寸就随区域大小变。给一个非 1 的
> `repeat` 把这个倍数还回去，图案尺寸就恒定了。它**只改贴图、不改几何**。要求资产的
> **UV 恰好铺满 0..1**，两个分量都必须是正数。
>
> `id` 是 uuid，由 store 生成并维护，也存在配置里，所以导出导入会原样带上——宿主若想
> 「换模型也保持同一个 id」，显式传一个固定值即可。
>
> **`models` 与配置里其他分组有一个不对称**：`applyConfig` 对数组是**整体替换**，
> 所以 `applyConfig({ models: [...] })` 等于把整张列表换掉，而不是按下标合并。只想改其中
> 一个模型请用 `patchModel(patch, label?, index?)`——否则一个只写了 `{ url }` 的补丁会把
> 那个模型其余字段连同 id 一起抹掉。
>
> 物体级 `castShadow` / `receiveShadow` 只有 `shadow.type` 是 `map` 或 `accumulative` 时
> 才有效果（接触阴影走的是另一条烘焙路径）。

### `floorplan` — 户型图

默认是**空户型**（`foundation: null` + 三个空数组）。

| 字段         | 类型                              | 默认值 | 说明                                        |
| ------------ | --------------------------------- | ------ | ------------------------------------------- |
| `foundation` | `{ x, z, width, depth }` 或 null  | `null` | 一块矩形地基板；`x` / `z` 是**中心点**，不是最小角 |
| `walls`      | `FloorplanWall[]`                 | `[]`   | 墙，存**中心线**（两个端点）+ 墙高 + 墙厚 + 可选的外观地址 `url` |
| `openings`   | `FloorplanOpening[]`              | `[]`   | 门窗。**没有自己的坐标**，只有 `hostWallId` + 沿墙米数 |
| `rooms`      | `FloorplanRoom[]`                 | `[]`   | 房间：由墙体泛洪自动围出来的多边形 + 名称 + 颜色 |

> 单位一律**米**、角度一律**弧度**。`SceneConfig` 只放**可 JSON 往返**的数据，
> 「画到一半的那条墙链」不进配置。
>
> `applyConfig({ floorplan: { walls: [...] } })` 里的 `walls` 会**整体替换**整张表
> （与 `models` 同样是数组语义）。宿主自己拼数组时请调一次 `cloneFloorplanPatch(patch)`
> ——`applyPatch` 对数组是别名而非拷贝，逐层拷过再写才切得断宿主与配置之间的暗通道
> （墙的 `start` / `end`、房间的 `polygon` 都是嵌套数组，只拷顶层不够）。

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

> 主光方向由 `elevation` / `azimuth` 用与天空盒相同的球坐标公式推导，所以影子方向和天上的
> 太阳始终一致。
>
> `skybox` 是**六个面地址的定长元组**（顺序 `[+X, -X, +Y, -Y, +Z, -Z]`，即
> `[右, 左, 上, 下, 前, 后]`——后三个字是社区惯例对这三对轴的叫法，本项目的资产**不按它
> 排队**，见 `SkyboxFaces` 与 `SKYBOX_FACE_FILES`），`null` 表示不用天空盒。它与
> `environment` 是**同一个位置的两种填法**：两者写的都是 `scene.environment`，这一组字段里
> 最多只有一个不是空的。

**`shadow`** — 阴影：`enabled` `type`（`'map'` / `'contact'` / `'accumulative'`）`castShadow` `receiveShadow` `mapSize` `bias` `normalBias` `contactOpacity` `contactBlur` `contactScale` `contactResolution` `accFrames` `accOpacity` `accScale` `accBlend`

## Store：`useSceneStore`

store id 为 `tdm-scene`（带前缀避免与宿主撞名）。

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

`resetView()` 恢复的是**显示类开关**：`background` / `camera.autoRotate` / `model.wireframe` /
`model.visible` / `ground.visible`。它不碰机位、也不碰模型的位置旋转缩放（那是
`resetConfig()` 的范畴）。改动 `config` 会被自动记录：400 毫秒内的连续改动合并成一条，
标签按变化的顶层分组自动生成（`模型属性` / `相机` / `地面` / `日照环境` / `阴影` / `背景`）。

### 多个模型

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

> **选中项是界面状态，不是配置**：它是独立的 `selectedIndex`，不进 `config`、不进历史、
> 不进导出物。它只可能因为「列表变短」而越界，store 里 watch 列表长度就足以收回界内。
>
> 单模型时代的那些入口（`model` prop、`setModel` / `clearModel` / `modelUrl` /
> `wireframe` / `hasModel`）语义一律收窄成「当前选中的那个模型」，所以场景里只有一个模型
> 时它们的行为与从前一致。`setModel()` / `clearModel()` 会在**地址真的变了**时换一个新的
> `model.id`，重复提交同一个地址不会换。

---

## 从包里能 import 什么

| 类别 | 导出 |
| --- | --- |
| 组件 | `SceneViewer` / `SceneToolbar` / `SceneFloorplan` |
| 插件 | `createThreeDMaker`（默认导出也是它） |
| store | `useSceneStore` |
| 配置 | `DEFAULT_SCENE_CONFIG` / `migrateConfig` / `cloneFloorplanPatch` / `createFloorplanConfig` |
| 事件 | `MODEL_EVENT_TYPES` / `MODEL_EVENT_LABELS` / `activeEventTypes` / `defaultEventCode` |
| 名称与档位 | `deriveModelId`（从地址派生可读短名，`model.name` 留空时的默认值）/ `viewModeOf`（现在算 2D 俯视还是 3D 透视） |
| 户型图算术 | `wallPieces` / `removeWall` / `wallLength` / `wallRotationY` / `pointAlongWall` / `findNearestWall` / `findEnclosedArea` / `pointInPolygon` / `polygonCenter` / `pickRoomColor` / `createFloorplanId` / `openingFreeGap` / `openingOverlaps` / `openingMagnetOffset` / `resolveOpeningDrag` / `openingFilledByModel` / `openingRejectReason` / `dropOpeningFills` |
| 户型图常量 | `CELL_SIZE` / `DEFAULT_WALL_HEIGHT` / `DEFAULT_WALL_THICKNESS` / `DOOR_WIDTH` / `DOOR_HEIGHT` / `WINDOW_WIDTH` / `WINDOW_HEIGHT` / `WINDOW_SILL` / `OPENING_EDGE_GAP` |
| 墙面与洞口贴装 | `wallFaceTiles` / `wallFaceFit` / `wallFaceIsSheet` / `wallFaceUnusable` / `openingFaceUnusable` / `openingFaceOversized` |
| 零件表几何 | `parseModelParts` / `placeModelParts` / `MAX_PARTS` / `MAX_COUNT` |
| 类型 | `SceneConfig` / `ModelConfig` / `FloorplanWall` / `FloorplanOpening` / `FloorplanRoom` / `SceneViewerProps` / `ThreeDMakerOptions` / `TransformMode` / `EnvironmentPreset` / 各 payload 与分组配置，以及它们的 `DeepPartial` |

> 户型图那一大组算术与常量导出是为了让宿主不必抄一遍：户型图的放置、夹取、磁吸与
> 贴面铺法，抄漏一处**不报错**（例如夹取漏掉 → 墙体切出负长度、变成一块法线翻转的黑面）。
> 它们全是不依赖 three、不依赖 DOM 的纯函数，宿主可以在任何地方直接跑。
> `MAX_PARTS` / `MAX_COUNT` 是公开约定而不是内部实现——超了整份零件表会被拒掉。
> 曲线与中间结果类型（`EnclosedAreaResult` / `FloorplanPiece` / `NearestWallHit` /
> `OpeningGap` / `WallFaceBounds` / `WallFaceTile` / `ModelPartsResult` 等）一并导出。

---

本文件只讲怎么用。为什么这么写、内部实现与验收清单都在仓库里那份 `DESIGN.md` 里
（<https://github.com/chen870594504/3deditor/blob/main/DESIGN.md>）——那是给改这个仓库的人
看的内部文档，不面向宿主，也不随这个包发出去。
