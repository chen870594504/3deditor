<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { TresCanvas } from '@tresjs/core'
import type { Object3D } from 'three'
import SceneContent from './SceneContent.vue'
import ScenePicker from './ScenePicker.vue'
import SceneSelection from './SceneSelection.vue'
import SceneToolbar from './SceneToolbar.vue'
import { useSceneStore } from '../stores/scene'
import { cloneFloorplanPatch, cloneModelPatch } from '../utils/config'
import type {
  CameraChangePayload,
  DeepPartial,
  ModelBounds,
  ModelConfig,
  ModelPickPayload,
  ModelTransformPayload,
  ObjectClickPayload,
  SceneViewerProps,
} from '../types'

defineOptions({ name: 'TdmSceneViewer' })

const props = withDefaults(defineProps<SceneViewerProps>(), {
  model: '',
  background: '#0b1020',
  environment: undefined,
  height: '480px',
  toolbar: true,
  autoRotate: false,
  wireframe: false,
  showGrid: true,
  draco: false,
  pickable: false,
  selection: false,
  gizmo: false,
  gizmoMode: 'translate',
  cameraTransition: 0,
  camera: undefined,
  ground: undefined,
  floorplan: undefined,
  sun: undefined,
  shadow: undefined,
})

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

/**
 * props 是对外的受控入口，先同步进 store，
 * 之后工具栏等内部组件直接读写 store，实现状态共享。
 * 同步只在 prop 真正变化时触发，因此用户用工具栏改过开关后不会被覆盖。
 *
 * `model` 有两种写法：只给地址的字符串，以及直接给整个模型分组。
 * 分组比扁平的 `wireframe` 更具体，两者同时给出时应当由分组胜出
 * （与 `sun.environment` / 扁平 `environment` 是同一个规则）。
 *
 * 但这件事**不能靠注册顺序**：两个 watcher 都是 immediate，会在 setup 里
 * 同步按注册顺序各跑一次，后注册的那个反而最后落笔、赢的是它。
 * 所以让位的责任落在扁平那一侧——见下面 `wireframe` 的 watcher。
 */
function applyModelProp(value: string | DeepPartial<ModelConfig> | undefined) {
  if (typeof value === 'string') {
    value ? scene.setModel(value) : scene.clearModel()
    return
  }
  if (!value) return

  const { url, ...rest } = value

  /**
   * url 单独走 setModel 而不是一起深合并：只有它会顺带复位
   * loading / progress / error，并换一个新的模型 id，这正是它存在的理由。
   *
   * 先落 url 再落其余字段，顺序是有讲究的：宿主若显式传了 `id`
   * （想要「换模型也保持同一个 id」的场景），按这个顺序它最后落笔、说了算；
   * 反过来就会被 setModel 新生成的 id 冲掉。
   *
   * 其余字段走 `patchModel` 写进「刚被 setModel 选中」的那个模型。
   * 早先这里是一句 `applyConfig({ model: rest })`，多模型之后那个顶层键
   * 已经不存在了；而写成 `applyConfig({ models: [rest] })` 又会把整张列表
   * 换成只有一个模型——宿主传一个 prop 不该顺手删掉场景里的其他模型。
   */
  if (url !== undefined) {
    url ? scene.setModel(url) : scene.clearModel()
  } else if (Object.keys(rest).length > 0 && !scene.selectedModel) {
    /*
     * 宿主只给了物体级字段、没给 url，而场景又是空的：先补一个条目出来。
     *
     * `patchModel` 落在**选中项**上，空场景里没有选中项，它会静静地什么都不做——
     * 一个 prop 被无声忽略，比报错更难查。补出来的就是内置示例几何体，
     * 紧接着由下面那句把宿主给的字段写上去。
     *
     * 这与字符串形态的承诺是同一条：选中项不存在（空场景）时追加一个新的。
     */
    scene.addModel()
  }

  if (Object.keys(rest).length > 0) scene.patchModel(cloneModelPatch(rest))
}

/** model 分组里是否显式写了这个字段 */
function modelDeclares(key: keyof ModelConfig): boolean {
  const value = props.model
  return typeof value === 'object' && value !== null && value[key] !== undefined
}

watch(() => props.model, applyModelProp, { immediate: true, deep: true })
watch(() => props.background, (value) => { scene.background = value }, { immediate: true })
watch(() => props.autoRotate, (value) => { scene.autoRotate = value }, { immediate: true })
/**
 * 扁平的 wireframe / draco 是分组配置出现之前的写法，保留以免破坏已发布的 API。
 *
 * 让位条件放进依赖列表而不是在回调里只读一次：宿主事后把 `wireframe`
 * 从 model 对象里摘掉、只留扁平 prop 时，这条路径要能重新接管。
 */
watch(
  [() => props.wireframe, () => modelDeclares('wireframe')],
  ([value, declared]) => {
    if (!declared) scene.wireframe = value
  },
  { immediate: true },
)
watch(
  [() => props.draco, () => modelDeclares('draco')],
  ([value, declared]) => {
    if (!declared) scene.patchModel({ draco: value })
  },
  { immediate: true },
)
watch(() => props.showGrid, (value) => { scene.showGrid = value }, { immediate: true })

/**
 * 分组配置走深合并，宿主只写要覆盖的那几项即可。
 *
 * 刻意不做「卸载时还原」：这些 prop 表达的是宿主的期望值，
 * 而不是一次性的初始值，反复挂载同一个组件不该产生不同的结果。
 */
watch(() => props.sun, (value) => { if (value) scene.applyConfig({ sun: value }) }, {
  immediate: true,
  deep: true,
})
watch(() => props.camera, (value) => { if (value) scene.applyConfig({ camera: value }) }, {
  immediate: true,
  deep: true,
})
watch(() => props.ground, (value) => { if (value) scene.applyConfig({ ground: value }) }, {
  immediate: true,
  deep: true,
})
watch(() => props.shadow, (value) => { if (value) scene.applyConfig({ shadow: value }) }, {
  immediate: true,
  deep: true,
})
/**
 * 户型图是唯一一个**必须自己先克隆一遍**的分组桥。
 *
 * 上面前四条直接把 `value` 交给 `applyConfig` 就够了——它们的补丁全是标量，
 * 没有数组也没有嵌套对象，`applyPatch` 按值装进去即可。
 * 户型图不一样：`walls` / `openings` / `rooms` 都是数组，而 `applyPatch` 的
 * `isPlainObject` **显式排除了数组**，于是走 `target[key] = value`——
 * 宿主那个 reactive 数组会**本体**成为配置里的一份。它之后就地 push 一下
 * 就是静默改场景，历史栈里还查无此事（正是 `cloneFloorplanPatch` 存在的理由，
 * 也是 `types.ts:457` 那句「宿主调 applyConfig 传数组时请先过一遍」的落点）。
 *
 * **这一条特别要紧**：`applyConfig` 自己不克隆（只有 `patchModel` 走
 * `cloneModelPatch`），所以漏了这一句不会有任何报错，
 * 只会在宿主某天改了自己那个数组时诡异地生效。
 */
watch(
  () => props.floorplan,
  (value) => {
    if (value) scene.applyConfig({ floorplan: cloneFloorplanPatch(value) })
  },
  { immediate: true, deep: true },
)

/**
 * 扁平的 environment 是分组配置出现之前的写法，保留以免破坏已发布的 API。
 * 分组写法更具体，两者同时给出时以 sun.environment 为准。
 */
watch(
  () => props.environment,
  (value) => {
    if (value === undefined || props.sun?.environment !== undefined) return
    scene.applyConfig({ sun: { environment: value } })
  },
  { immediate: true },
)

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
 * 这三条是**内部通道**，与下面 `defineExpose` 那两个方法不是一回事：
 * 后两者是组件对宿主的公开面，而 `modelObjectOf` 只在库内部被选中视觉（`selectedObject`）
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

defineExpose({ captureCamera, measureModel, groundPointAt })
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
        本组件是全仓库唯一需要 useTresContext 的地方，它只碰 3D 层的东西、
        不访问 store，命中之后只说「这个 id 被点了」。

        它是空模板组件（渲染返回 null），只在 pickable 打开时才存在；
        关掉时连那两个 DOM 监听器都不挂。
      -->
      <ScenePicker v-if="pickable" @pick="emit('modelPick', $event)" />

      <!--
        选中视觉：包围框与变换手柄，作用于 store 里那个选中的模型。

        与 ScenePicker 一样放在这一层、不进 SceneContent：本层是唯一读 store 的地方，
        而选中项正是 store 里的界面状态，交给 SceneContent 就得再定义一套 props
        把它传进去，那条链上没有任何一环需要知道这件事。

        它是空组件之外的普通组件，但一样「关掉就什么都不存在」：
        两个开关都没开时连这个组件都不渲染，里面那次每帧的包围盒计算自然也没有。
      -->
      <SceneSelection
        v-if="selection || gizmo"
        :model-id="scene.selectedModel?.id ?? ''"
        :object="selectedObject"
        :box="selection"
        :gizmo="gizmo"
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

    <SceneToolbar v-if="toolbar" />

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
