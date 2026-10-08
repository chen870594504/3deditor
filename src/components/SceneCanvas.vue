<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { TresCanvas } from '@tresjs/core'
import type { Object3D } from 'three'
import SceneContent from './SceneContent.vue'
import ScenePicker from './ScenePicker.vue'
import SceneSelection from './SceneSelection.vue'
import SceneToolbar from './SceneToolbar.vue'
import { useSceneStore } from '../stores/scene'
import { resolveSceneSwitches } from '../utils/sceneSwitches'
import type {
  CameraChangePayload,
  DeepPartial,
  ModelBounds,
  ModelPickPayload,
  ModelTransformPayload,
  ObjectClickPayload,
  SceneConfig,
  SceneViewerApi,
  TransformMode,
} from '../types'

/*
  画布本体。**不注册、不导出、宿主看不见**——它是 `SceneViewer` 的实现，
  与编辑器共用的只有这一层。名字带 `Canvas` 而不是 `Viewer`：`TdmSceneViewer`
  这个全局名归公开面那个组件所有（`src/index.ts` 的 GlobalComponents 里那一条）。

  它的 prop 是**内部签名**，不随公开面走：公开面只剩四个与「能力」有关的
  （`height` / `editable` / `autoRotate` / `draco`，见 `SceneViewerProps`），
  而这里留住能决定画布本身的那些，好让编辑器按自己的意思喂——
  `EditorStage` 正是靠这一点传 `:toolbar="false"`（内置工具栏让位）、
  `:gizmo-mode`、`:camera-transition`。

  两边的分界不是「哪些 prop 有用」，而是**谁有资格替宿主决定**：
  `gizmoMode` / `cameraTransition` 是编辑器的手感偏好，不该出现在宿主的 prop 列表里；
  而 `background` / `wireframe` / 那几组分组配置是「场景长什么样」，它们本来就住在
  `store.config` 里，让 prop 再转一手等于同一个事实有两个来源。所以那些桥全删了。
*/
defineOptions({ name: 'TdmSceneCanvas' })

const props = withDefaults(defineProps<{
  /** 画布高度，数字按 px 处理 */
  height?: string | number
  /** 编辑模式总闸，见 `resolveSceneSwitches` 那条三级规则 */
  editable?: boolean
  /** 是否显示内置工具栏。**分开关**：编辑器自绘界面时传 `false`，它优先于总闸 */
  toolbar?: boolean
  /** 是否允许在画布上点选模型（输入通道，`modelPick` 是它的出口） */
  pickable?: boolean
  /** 选中项是否画包围框 */
  selection?: boolean
  /** 是否显示 X/Y/Z 变换手柄 */
  gizmo?: boolean
  /** 手柄模式：平移 / 旋转 / 缩放。编辑器与右栏都在改它 */
  gizmoMode?: TransformMode
  /** 机位过渡时长（毫秒），0 = 瞬移。编辑器给 450，纯画布给 0 */
  cameraTransition?: number
}>(), {
  height: '480px',
  /*
    这五个必须显式写成 `undefined`，**不是**可有可无的写法，也不是「顺手对齐格式」。

    它们的类型都是 `boolean`，而 Vue 对声明为布尔的 prop 有一条特例：**缺失且没有
    default 时把值转成 `false`**，而不是留成 `undefined`。于是 `props.toolbar` 就分不出
    「宿主说了 false」与「宿主什么都没说」——而下面那条三级规则
    （`分开关 ?? 总闸 ?? 旧默认`，实现见 utils/sceneSwitches.ts）全靠这个区分：

    - `toolbar` / `pickable` / `selection` / `gizmo` 漏了 `undefined`：分开关恒有值，
      总闸永远轮不到，`:editable="true"` 变成一句空话；
    - `editable` 漏了它：**默认变成 `false`**，也就是所有宿主一夜之间进入预览模式——
      内置工具栏消失、点不中模型、手柄也不出来。不报错，只有肉眼看得出来。

    写 `default: undefined` 是关掉那条布尔特例的办法（`hasDefault` 为真即跳过转换），
    冒烟测试里「一个 prop 都不传仍然有内置工具栏」那一条守的就是它。
  */
  editable: undefined,
  toolbar: undefined,
  pickable: undefined,
  selection: undefined,
  gizmo: undefined,
  gizmoMode: 'translate',
  cameraTransition: 0,
})

/**
 * 四个开关的**生效值**——模板与所有判断一律读它，不要直接读上面的 prop。
 *
 * 直接读 prop 的后果是总闸整个失效（`editable` 只管默认值，不改 prop 本身），
 * 而这件事在画面上只表现为「传了 editable 没反应」。
 *
 * `computed` 是必要的：`props` 是响应式的，规则本身是条纯算术，
 * 写成普通常量会把开关冻结在首次渲染那一刻。
 */
const switches = computed(() => resolveSceneSwitches(props))

const emit = defineEmits<{
  (e: 'loaded'): void
  (e: 'progress', percentage: number): void
  (e: 'error', message: string): void
  (e: 'cameraChange', payload: CameraChangePayload): void
  (e: 'objectClick', payload: ObjectClickPayload): void
  (e: 'objectDblclick', payload: ObjectClickPayload): void
  (e: 'objectPointerEnter', payload: ObjectClickPayload): void
  (e: 'objectPointerLeave', payload: ObjectClickPayload): void
  (e: 'objectContextMenu', payload: ObjectClickPayload): void
  (e: 'modelPick', payload: ModelPickPayload): void
  (e: 'modelTransform', payload: ModelTransformPayload): void
  (e: 'modelTransformEnd', payload: ModelTransformPayload): void
}>()

const scene = useSceneStore()

/**
 * 右键只在自己真的会响应时才拦下原生菜单。
 *
 * 无条件的 `@contextmenu.prevent` 更省事，但那是**对外行为的变化**：
 * 宿主把画布嵌在自己的页面里，用户右键时该看到自己页面的菜单，
 * 除非宿主明确打开了右击事件。所以这个判断不能省。
 *
 * 多模型下判据是「有没有**任意一个**模型开了右击」：菜单是画布级的，
 * 只要有一个模型想响应右键，整块画布就得让开；至于最后是谁被点到，
 * 由各自的包裹组决定。
 */
function onContextMenu(event: MouseEvent) {
  const armed = scene.config.models.some(
    (model) => model.events?.contextmenu?.enabled === true,
  )
  if (!armed) return
  event.preventDefault()
}

/*
  这里原本盘着一整段 `props → store` 的桥（`model` / `background` / `autoRotate` /
  `wireframe` / `showGrid` / `draco` / `environment` 以及六个分组配置），
  它们全部删掉了，原因是那类桥**天然与「谁是唯一事实来源」打架**：

  - 它们都是 `immediate` 的，父组件的 setup 先于子组件跑，于是「父层刚写进 store 的值」
    会被子层这条 immediate 的 watcher 立刻覆盖回去——而覆盖与否取决于两层注册顺序，
    不取决于谁更该赢；
  - 编组写入要处理「扁平 prop 让位给分组 prop」这类优先级（`wireframe` 与
    `model.wireframe`、`environment` 与 `sun.environment`），每一种都是一处
    漏了不报错的静默优先级；
  - 而桥那头连着的值本来就住在 `store.config` 里，prop 只是二道贩子。

  现在只剩 `SceneViewer`（公开面）上两条真正属于「能力」的桥：
  `autoRotate` 与 `draco`（见那个文件），以及编辑器从上往下传的那几个内部值。
*/

const canvasHeight = computed(() =>
  typeof props.height === 'number' ? `${props.height}px` : props.height,
)

/** 'transparent' 时让 canvas 透明透出宿主页面，否则用 store 里的背景色 */
const isTransparent = computed(() => scene.background === 'transparent')
const clearColor = computed(() => (isTransparent.value ? '#000000' : scene.background))

/**
 * 任何一类阴影都要打开 renderer.shadowMap。
 *
 * 接触阴影与累积阴影虽然是自己渲染到独立 target 的，
 * 但累积阴影内部那盏聚光灯仍然依赖 shadowMap 才能出图，
 * 所以这里不按 type 收窄；重复投影的问题在 SceneContent 里靠
 * 主光的 cast-shadow 收窄解决。
 */
const shadowsEnabled = computed(() => scene.config.shadow.enabled)

function onLoaded() {
  scene.markLoaded()
  emit('loaded')
}

function onProgress(percentage: number) {
  scene.setProgress(percentage)
  emit('progress', percentage)
}

function onError(message: string) {
  scene.markFailed(message)
  emit('error', message)
}

/**
 * TresCanvas 的 error 事件给的是 Error 实例，与组件对外的
 * error 事件（字符串）不是同一个形状，这里做一次转换，
 * 顺带把 WebGL 上下文创建失败也纳入同一套错误状态。
 */
function onCanvasError(error: unknown) {
  onError(error instanceof Error ? error.message : String(error))
}

/**
 * 拖动结束后把相机写回 store，编辑器面板才能显示当前视角。
 * 这次写入同时会进历史栈，因此一次拖动正好是一条可撤销记录。
 */
function onCameraChange(payload: CameraChangePayload) {
  scene.applyConfig({ camera: { position: payload.position, target: payload.target } })
  emit('cameraChange', payload)
}

/**
 * 画布内部的内容组件，用来取它的 `captureCamera` / `measureModel` / `modelObjectOf`。
 *
 * 隔着 TresCanvas 拿模板引用是可行的——TresJS 换的是渲染器，
 * 组件仍然由 Vue 创建和挂载。
 *
 * 这几条是**内部通道**，与下面 `defineExpose` 里那些不是一回事：
 * 后者是组件对宿主的公开面，而 `modelObjectOf` 只在库内部被选中视觉（`selectedObject`）
 * 用一次，交出去的是一只活的 three 对象，不该成为宿主的 API。
 *
 * `useTemplateRef` 返回的是 `readonly(代理)`，但这里可以照用：readonly 的代理
 * 没有 apply trap，调用方法时仍然落到原函数上，返回值也不经过包装
 * （见 SceneContent 里那段「为什么不给 three 对象用 useTemplateRef」——
 * 那条讲的是**读 `.value` 拿裸对象**，与这里「调用一个方法」是两回事）。
 */
const contentRef = useTemplateRef<{
  captureCamera: () => CameraChangePayload | null
  measureModel: (id: string) => ModelBounds | null
  modelObjectOf: (id: string) => Object3D | null
  groundPointAt: (clientX: number, clientY: number) => [number, number] | null
}>('contentRef')

/**
 * 抓取当前机位并写回配置，返回是否抓到了。
 *
 * 拖动结束会自动回写，所以平时用不上；但自动旋转开着时相机一直在动、
 * 永远不会触发拖动结束，只能靠这个方法主动取一次。
 */
function captureCamera(): boolean {
  const pose = contentRef.value?.captureCamera()
  if (!pose) return false

  // 带标签写入：历史里记成一步明确的操作，而不是自动拼出的「相机」
  scene.applyConfig(
    { camera: { position: pose.position, target: pose.target } },
    '抓取当前视角',
  )
  emit('cameraChange', pose)
  return true
}

/**
 * 量一个模型的世界包围盒，量不了时返回 null。
 *
 * 纯转发，只在 `contentRef` 还没挂上时兜底成 null——那与「模型还没加载完」
 * 是同一个返回值，调用方本来就只需要处理一种「现在量不了」。
 */
function measureModel(id: string): ModelBounds | null {
  return contentRef.value?.measureModel(id) ?? null
}

/**
 * 把屏幕坐标换算成地面平面上的 `[x, z]`，落不到时返回 `null`。
 *
 * 纯转发，与 `measureModel` 同一条路数。**它不是一条事件通道**：库只回答
 * 「这一点对应地面的哪个位置」，至于这一点意味着「画一面墙」还是「什么都不做」，
 * 是宿主/编辑器自己的事。所以这里既没有 emit 也没有 payload 类型，
 * 与 `pickable` / `modelPick` 那一套是两回事。
 *
 * 落不到地面的三种情况（相机或画布没就绪、画布还没尺寸、视线与地面平行）
 * 一律返回 null，调用方自己决定怎么办——编辑器那边是「这一步不算数」。
 */
function groundPointAt(clientX: number, clientY: number): [number, number] | null {
  return contentRef.value?.groundPointAt(clientX, clientY) ?? null
}

/**
 * 当前选中模型的那只 three 组；没有选中、还没挂上、或模型被隐藏时是 null。
 *
 * 「隐藏就不给」是刻意的：包围框与手柄都会让用户以为那个位置有个可操作的东西，
 * 而它此刻并不在画面上。隐藏的模型**仍然可以被量尺寸**（贴地那条路径依赖这一点），
 * 两件事不冲突——一个要的是数字，一个要的是可交互的对象。
 *
 * 依赖链是完整的：`scene.selectedModel`（换人 / 改可见性）→ `measurers` 那张表
 * （节点增删）→ 节点自己的 `modelGroup`（组挂上）。三者任一变化，
 * 这个 computed 都会重算，所以 `contentRef` 还没挂上时先拿到 null 也没关系。
 */
const selectedObject = computed(() => {
  const model = scene.selectedModel
  if (!model || !model.visible) return null
  return contentRef.value?.modelObjectOf(model.id) ?? null
})

/**
 * 手柄拖拽过程中的写回。
 *
 * **不传 label**：一次拖拽会产生几十次写入，逐次入栈没法看——store 里那个 400ms
 * 的防抖窗口正是为这种连续改动准备的（与拖动滑块同一条路）。于是整段拖拽在历史里
 * 只会留下一条记录，标签是自动拼出的「模型属性」；想要更好看的标签，宿主持
 * `modelTransformEnd` 再写一次即可，那次会把这个防抖提交顶掉。
 *
 * 库自己写回而不是只发事件，与相机拖动那条路（`onCameraChange`）是对称的：
 * 「在画布上拖出一个物理量」这件事默认就该生效，宿主一行代码都不写也能用。
 *
 * 按 id 找下标而不是直接用当前选中项：库这一层不假设「拖的一定是选中的那个」，
 * 手柄的物体本来就是宿主选中的，两者一致时结果相同，不一致时也不会改错人。
 */
function onTransform(payload: ModelTransformPayload) {
  const index = scene.models.findIndex((model) => model.id === payload.id)
  if (index < 0) return

  scene.patchModel(
    { position: payload.position, rotation: payload.rotation, scale: payload.scale },
    undefined,
    index,
  )
  emit('modelTransform', payload)
}

/**
 * 取当前场景配置的深拷贝，可直接 JSON 序列化后交给宿主自己的接口。
 *
 * **不返回 null**，与上面三条不同：那三条要隔着 `contentRef` 问画布，
 * 画布还没挂上时只能给空；这一条只读 store，而 store 一定在。
 * 写成「可能为 null」只会让宿主多写一层永远走不到的分支。
 *
 * 出去的是**裸的** `SceneConfig`：版本号、场景名、导出时间这类外壳由宿主自己定，
 * 库不替它立这个契约。场景名本来也不在 `SceneConfig` 里——它是编辑器的界面状态。
 */
function getSceneData(): SceneConfig {
  return scene.exportConfig()
}

/**
 * 用一份场景数据初始化场景，返回是否用上了。
 *
 * **实现只有一份，在 store 的 `loadSceneData` 里**（先 `migrateConfig`、
 * 再 `applyConfig`、最后 `clearHistory`，理由写在那边）。这一层只做转发，
 * 与上面四个方法同形——`SceneViewerApi` 声明这 5 个方法四层都在，
 * 少了它这一层的类型契约就断了。
 *
 * 不在这里直接调 store、而是留一个转发函数，也是为了让 `defineExpose` 的
 * 五条形状完全一致：四层里那一层长得不一样，正是「改一处返回值另三处不报错」
 * 的温床（见 `SceneViewerApi` 上方那段）。
 */
function loadSceneData(data: DeepPartial<SceneConfig>): boolean {
  return scene.loadSceneData(data)
}

/*
  显式写上 `SceneViewerApi` 而不是让它推断：这一层是那 5 个方法的**起点**，
  上游三层都按同一个类型转手。让它推断的话，这里改一个返回值只有直接调用
  它的地方报错，转手那几层（`EditorStage` → `SceneEditor` → `SceneViewer`）
  因为拿的是宽类型，会安安静静地把新形状透出去。
*/
defineExpose<SceneViewerApi>({
  captureCamera,
  measureModel,
  groundPointAt,
  getSceneData,
  loadSceneData,
})
</script>

<template>
  <div class="tdm-root" :style="{ height: canvasHeight }" @contextmenu="onContextMenu">
    <TresCanvas
      :clear-color="clearColor"
      :alpha="isTransparent"
      :shadows="shadowsEnabled"
      @error="onCanvasError"
    >
      <SceneContent
        ref="contentRef"
        :models="scene.config.models"
        :floorplan="scene.config.floorplan"
        :camera="scene.config.camera"
        :ground="scene.config.ground"
        :sun="scene.config.sun"
        :shadow="scene.config.shadow"
        :camera-transition="cameraTransition"
        @loaded="onLoaded"
        @progress="onProgress"
        @error="onError"
        @camera-change="onCameraChange"
        @object-click="emit('objectClick', $event)"
        @object-dblclick="emit('objectDblclick', $event)"
        @object-pointer-enter="emit('objectPointerEnter', $event)"
        @object-pointer-leave="emit('objectPointerLeave', $event)"
        @object-context-menu="emit('objectContextMenu', $event)"
      />

      <!--
        画布级的点选拾取。放在这一层而不是 SceneContent 里，是为了不动
        SceneContent 那句「不依赖 TresCanvas 内部的注入链」的承诺：
        本组件是第一个绕开那条链的（全仓库共三处，见 DESIGN.md 设计决定 4），
        它只碰 3D 层的东西、不访问 store，命中之后只说「这个 id 被点了」。

        它是空模板组件（渲染返回 null），只在 pickable 打开时才存在；
        关掉时连那两个 DOM 监听器都不挂。
      -->
      <ScenePicker v-if="switches.pickable" @pick="emit('modelPick', $event)" />

      <!--
        选中视觉：包围框与变换手柄，作用于 store 里那个选中的模型。

        与 ScenePicker 一样放在这一层、不进 SceneContent：本层是唯一读 store 的地方，
        而选中项正是 store 里的界面状态，交给 SceneContent 就得再定义一套 props
        把它传进去，那条链上没有任何一环需要知道这件事。

        它是空组件之外的普通组件，但一样「关掉就什么都不存在」：
        两个开关都没开时连这个组件都不渲染，里面那次每帧的包围盒计算自然也没有。
      -->
      <SceneSelection
        v-if="switches.selection || switches.gizmo"
        :model-id="scene.selectedModel?.id ?? ''"
        :object="selectedObject"
        :box="switches.selection"
        :gizmo="switches.gizmo"
        :mode="gizmoMode"
        @transform="onTransform"
        @transform-end="emit('modelTransformEnd', $event)"
      />

      <!--
        宿主注入自有 3D 内容的入口。
        注意：这里只能是组件或元素，不能用裸 <template> 包裹——
        TresJS 的编译器会把裸 <template> 当成字面量标签，
        其子节点会被静默挂到 Scene 根上；带 v-if / v-for 的 <template> 不受影响。
      -->
      <slot name="scene" />
    </TresCanvas>

    <SceneToolbar v-if="switches.toolbar" />

    <!--
      加载进度遮罩。pointer-events: none 是必须的：它是 inset-0 的，
      命中判定留在身上就会把整张画布的指针事件全吃掉——不只是点选拾取，
      连 OrbitControls 的转视角都一起失效（它的监听器就挂在 canvas 上）。
      这一层是纯信息、没有任何可点内容，去掉命中不会让它变得不好用。
    -->
    <div
      v-if="scene.loading"
      class="tdm-loading"
    >
      <span>模型加载中 {{ scene.progress }}%</span>
      <div class="tdm-progress">
        <div
          class="tdm-progress-bar"
          :style="{ width: `${scene.progress}%` }"
        />
      </div>
    </div>

    <!--
      失败提示：只覆在画布顶部，不遮挡已经渲染出来的内容。
      同样要 pointer-events: none——它横跨整个宽度，不然画布顶边那一条
      会变成点不到、也拖不动的死区。
    -->
    <div
      v-if="scene.hasError"
      class="tdm-error"
    >
      模型加载失败：{{ scene.error }}
    </div>
  </div>
</template>
