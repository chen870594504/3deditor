<script setup lang="ts">
import { computed, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useSceneStore } from '../../stores/scene'
import type {
  CameraChangePayload,
  ModelEventPayload,
  ModelEventType,
  ModelPickPayload,
  ModelTransformPayload,
  ObjectClickPayload,
  SceneViewerApi,
  TransformMode,
} from '../../types'
import SceneCanvas from '../../components/SceneCanvas.vue'
import ModelActions from './ModelActions.vue'
import FloorplanTools from './FloorplanTools.vue'
import PreviewBar from './PreviewBar.vue'
import SceneFloorplanDraft from './SceneFloorplanDraft.vue'
import {
  canvasApi,
  gizmoMode,
  previewMode,
  pushEvent,
} from '../composables/useEditorState'
import {
  floorplanEnabled,
  floorplanHint,
  onFloorplanContextMenu,
  onFloorplanPointerCancel,
  onFloorplanPointerDown,
  onFloorplanPointerLeave,
  onFloorplanPointerMove,
  onFloorplanPointerUp,
} from '../composables/useFloorplanTool'
import { commitTransform, selectPickedModel } from '../composables/useModelActions'
import { useEditorHooks } from '../hooks'
import { setViewMode, viewModeOf } from '../composables/useViewMode'
import type { ViewMode } from '../composables/useViewMode'

defineOptions({ name: 'TdmEditorStage' })

/*
  12 个事件原样透出去，一个不删——它们是宿主已在用的公开面，
  而编辑器只是这块画布的一层壳。

  与 `SceneCanvas` 的声明逐条对应（同 `SceneViewer` 里那张 `forwarded` 表）。
  有的在这里多一件本地的事（`loaded` 顺带推一条事件日志、`model-transform-end`
  先提交变换再透出去），但**透出去这一步谁都不能省**：宿主在编辑模式下
  收不到事件，与「这个模式不支持事件」是无法分辨的。
*/
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
 * 执行某类模型事件绑定的代码——这件事**不由库来做**。
 *
 * 那段代码是字符串，跑起来只能靠 `new Function`，而库产物里不许出现它
 * （见 `hooks.ts`）。所以执行器由宿主经 `createThreeDMaker({ hooks })` 交进来：
 * 宿主没交时这里整段是空操作，事件照发、代码照存，只是没有人跑。
 *
 * 中间不做任何加工——`payload.id` 就是「谁发的」，宿主照它取那个模型的代码。
 */
const { runEventCode } = useEditorHooks()

function onModelEvent(type: ModelEventType, payload: ModelEventPayload): void {
  runEventCode?.(type, payload)
}

/*
  画布那几条事件，编辑器各自有一件本地的事要做（推一条日志、把选中项切过去、
  提交手柄变换），做完**必须继续透给宿主**。

  这也是「编辑器是宿主的一个消费者」这句话的落点：宿主在编辑模式下也要能收到
  `loaded` / `modelPick` / `modelTransformEnd`，否则同一个 `SceneViewer`
  在两种形态下的事件能力就不一样了，而那是没法从文档上看出来的差别。
*/
function onLoaded(): void {
  pushEvent('模型加载完成')
  emit('loaded')
}

function onProgress(percentage: number): void {
  pushEvent(`模型加载中 ${percentage}%`)
  emit('progress', percentage)
}

function onError(message: string): void {
  pushEvent(`模型加载失败：${message}`)
  emit('error', message)
}

function onCameraChange(payload: CameraChangePayload): void {
  pushEvent('视角已更新，相机参数已写回配置')
  emit('cameraChange', payload)
}

function onPicked(payload: ModelPickPayload): void {
  selectPickedModel(payload)
  emit('modelPick', payload)
}

/**
 * 画布对外那 5 个方法，逐条转给 `SceneCanvas`。
 *
 * 转手是本组件在「编辑态」这一支上的唯一职责——`SceneViewer` 只认一个入口，
 * 它拿到的是 `SceneEditor` 的实例，所以中间两层都得把同一组方法再交一遍。
 * 方法名与签名由 `SceneViewerApi` 定死，漏一条 `typecheck` 会红。
 *
 * 四条要隔着挂载好的画布问的，用 `?? ` 兜成「现在拿不到」（与原实现同值）；
 * `getSceneData` 那一条**只在画布没挂上时才可能走兜底**，而它只读 store，
 * 所以这里给出的是商店里那份配置，而不是 `null`。
 */
const viewerRef = useTemplateRef<SceneViewerApi>('viewer')

defineExpose<SceneViewerApi>({
  captureCamera: () => viewerRef.value?.captureCamera() ?? false,
  measureModel: (id) => viewerRef.value?.measureModel(id) ?? null,
  groundPointAt: (clientX, clientY) => viewerRef.value?.groundPointAt(clientX, clientY) ?? null,
  getSceneData: () => viewerRef.value?.getSceneData() ?? scene.exportConfig(),
  loadSceneData: (data) => viewerRef.value?.loadSceneData(data) ?? false,
})

/**
 * 视口元素本身。
 *
 * 唯一需要它的地方是 `.tdm-viewport-actions` 的聚焦：算距离要知道「画面有多宽」，
 * 而 `camera.fov` 只管垂直方向。TresCanvas 的 canvas 元素尺寸与它一致，
 * 但那个元素在插件内部、拿不到，也没必要为此扩库的 API。
 */
const viewportRef = useTemplateRef<HTMLElement>('viewport')

/**
 * 把画布能力登记到 canvasApi，供属性面板与模型操作胶囊调用。
 *
 * 用注册表而不是把状态提升到 App：调用方分别在右栏与中栏视口里，
 * 与 SceneCanvas 之间隔着 TresCanvas，「抓取视角」这类动作
 * 在中间两层都只是原样透传，白白多出几组 props 和几个 emit。
 */
canvasApi.captureCamera = () => {
  if (viewerRef.value?.captureCamera()) pushEvent('已抓取当前视角并写回配置')
}

canvasApi.measureModel = (id) => viewerRef.value?.measureModel(id) ?? null

canvasApi.viewportAspect = () => {
  const el = viewportRef.value
  // 高度为 0 只可能出现在布局还没算完的那一帧，退回 1 而不是给出 Infinity
  if (!el || el.clientHeight === 0) return 1
  return el.clientWidth / el.clientHeight
}

/**
 * 屏幕坐标 → 地面坐标。绘制工具（`useFloorplanTool`）唯一的入口。
 *
 * 与上面三条同一条路数：库只给「能力」，怎么用是编辑器的事。
 * 中间那两层（本组件、SceneCanvas）都只是原样转发，不认「墙」这个概念。
 */
canvasApi.groundPointAt = (clientX, clientY) =>
  viewerRef.value?.groundPointAt(clientX, clientY) ?? null

/**
 * 取场景数据，登记给顶栏的「保存」与 ⌘S 用。
 *
 * 与上面三条同一条路数，但这一条是编辑器第一次**以宿主的身份**去用库的公开面：
 * 取数据这件事本身不落盘，落盘是拿到数据之后的事（编辑器不落盘，只打一条日志）。
 * 走这条路而不是直接读 store，是为了让编辑器踩在宿主将来要踩的那条路上。
 */
canvasApi.getSceneData = () => viewerRef.value?.getSceneData() ?? null

/**
 * 拖入过的本地文件的 object URL。
 *
 * 存一个列表而不是「最后一个」：现在每次拖入都是往场景里**追加**一个模型，
 * 旧的模型还留在场景里，它的贴图与几何体仍然从这个 URL 上取。
 * 只记住最后一个就等于把先前那些模型的资源提前释放掉，画面会在下次渲染时塌掉。
 * 全部留到卸载时统一回收。
 */
const dropUrls: string[] = []

// ---------- 视口四角角标 ----------

/**
 * 模型就位时四角短暂亮起。
 *
 * 这是全站唯一的装饰性动效，但它同时传递信息：角标亮起 = 场景里已经有东西了。
 * 触发条件选 progress 到 100 而不是 loading 变 false——
 * 后者在「切回内置示例」时也会变 false，会亮得莫名其妙。
 */
const lit = ref(false)
let litTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => scene.progress,
  (progress) => {
    if (progress !== 100) return
    if (litTimer) clearTimeout(litTimer)
    lit.value = true
    litTimer = setTimeout(() => {
      lit.value = false
    }, 900)
  },
)

onUnmounted(() => {
  if (litTimer) clearTimeout(litTimer)
  for (const url of dropUrls) URL.revokeObjectURL(url)
  dropUrls.length = 0
})

// ---------- 拖放导入 ----------

const dropping = ref(false)

const GLTF_EXTENSIONS = ['.glb', '.gltf']

function isGltf(name: string) {
  const lower = name.toLowerCase()
  return GLTF_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  // 不 preventDefault 的话浏览器会直接打开文件，drop 事件也不会来
  event.preventDefault()
  dropping.value = true
}

function onDragLeave(event: DragEvent) {
  /**
   * 移到子元素上也会触发 dragleave。
   * 用 relatedTarget 判断指针是否还在视口内，比维护 enter/leave 计数器可靠得多。
   */
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as HTMLElement).contains(next)) return
  dropping.value = false
}

function onDrop(event: DragEvent) {
  dropping.value = false

  const file = event.dataTransfer?.files?.[0]
  if (!file) return

  if (!isGltf(file.name)) {
    pushEvent(`不支持的文件类型：${file.name}（只接受 .glb / .gltf）`)
    return
  }

  event.preventDefault()

  // 用 blob URL 交给 GLTFLoader 就地上传，本地文件不必先起一个静态服务
  const url = URL.createObjectURL(file)
  dropUrls.push(url)
  const index = scene.addModel(url)
  pushEvent(`从本地拖入模型：${file.name}（场景中第 ${index + 1} 个）`)
}

// ---------- 选中项 ----------

/**
 * 当前选中的模型。
 *
 * 视口里现在只剩一处读它：下面那条 `gizmoVisible`（判断该不该给手柄）。
 *
 * 它原先还喂着视口左上角那条 **HUD** 的四行读数（`CAM` / `FOV·TRI·CALL·FPS` /
 * `SKY·阴影` / `MDL·ID·EVT`）——那条 HUD 连同**只喂它**的 `PerfProbe` 与
 * `stats` 一起删掉了，理由与代价见 DESIGN.md 设计决定 51。这里因此只剩一个消费者。
 */
const selected = computed(() => scene.selectedModel)

// ---------- 变换手柄 ----------

/**
 * 三档模式与它们的快捷键。
 *
 * 快捷键文案与 App.vue 里那份 keydown 是同一套 W/E/R，两处必须一起改——
 * 这一份只负责把它显示出来（按钮的 title），真正响应按键的是那边。
 *
 * 顺序按「用得多少」排：平移是绝对主力，缩放次之，旋转最少。也因此默认档是平移。
 */
const TRANSFORM_MODES: { mode: TransformMode; label: string; key: string }[] = [
  { mode: 'translate', label: '移动', key: 'W' },
  { mode: 'rotate', label: '旋转', key: 'E' },
  { mode: 'scale', label: '缩放', key: 'R' },
]

/**
 * 现在该不该有手柄。
 *
 * 判据是「应该有一个」而不是「手柄的物体已经拿到了」：后者要等 glTF 加载完才会
 * 从 null 变实，加载那几百毫秒里切换条会闪一下。隐藏的模型仍然被选中，
 * 但画布上不会给它手柄（那等于让你拖一个看不见的东西），所以这里也要跟着不显示，
 * 与库那一侧「隐藏就不给选中视觉」的判断对齐。
 */
const gizmoVisible = computed(() => selected.value !== undefined && selected.value.visible && !previewMode.value)

/**
 * 切换模式。
 *
 * 写成函数而不是在模板里直接给 `gizmoMode` 赋值：它是从别的模块 import 进来的 ref，
 * 模板里对 import 绑定的赋值要走一层 `isRef` 判断才能落到 `.value` 上，
 * 而这种「编译器帮我猜」的写法没有任何好处——一个三行的函数把意图写死。
 */
function setGizmoMode(mode: TransformMode): void {
  gizmoMode.value = mode
}

/**
 * 手柄拖完的那一刻。
 *
 * 包一层而不是在模板里写 `commitTransform($event, gizmoMode)`：那个写法要在模板表达式里
 * 读一个 import 进来的 ref，得指望编译器替我补上取值那一层——而这里只需要一行函数，
 * 没有理由把正确性押在「编译器会怎么做」上。
 *
 * 取的是**当次拖拽时**的模式，正常就是当前档位；之所以按值读而不是在
 * `commitTransform` 里自己读 `gizmoMode`，是为了让「这次拖的是什么」这件事由调用方说清。
 */
function onTransformEnd(payload: ModelTransformPayload): void {
  commitTransform(payload, gizmoMode.value)
  emit('modelTransformEnd', payload)
}

// ---------- 相机过渡 ----------

/**
 * 机位改动滑过去用多久（毫秒）。
 *
 * 写死的编辑器偏好，不做成开关：过渡的意义是「让人看清相机是怎么过去的」，
 * 不是一种可选风格，450ms 落在「看得清路径」与「不拖沓」之间。库那侧默认是 0
 * （瞬移），宿主不写这一行就还是原来的瞬间到位。
 *
 * 它**不进 config**：配置记的是「这个场景长什么样」，而过渡时长是这一刻的手感，
 * 跟着配置一起导出、一起进撤销栈都没有道理（同 `gizmoMode`）。
 */
const CAMERA_TRANSITION = 450

// ---------- 视角档位 ----------

/**
 * 两档视角与它们的说明。
 *
 * 与 `TRANSFORM_MODES` 不同，这里没有第三列快捷键：2D / 3D 不绑键。
 * Blender 那套 `5` / numpad `7` 与画布上已有的 W/E/R 不是一套手感，
 * 而单键还要与输入框、中文输入法纠缠（App.vue 里那道 typing 判断），收益不抵成本。
 */
const VIEW_MODES: { mode: ViewMode; label: string; title: string }[] = [
  { mode: '2d', label: '2D', title: '2D 俯视角：相机移到正上方并框住当前内容' },
  { mode: '3d', label: '3D', title: '3D 透视视角：回到进入 2D 之前的机位' },
]

/**
 * 现在是哪一档。
 *
 * **它是算出来的，不是存下来的**——判据只看机位（视线是否接近竖直朝下）。
 * 于是撤销、套预设、点「重置机位」、在面板里手改位置之后，档位自己就是对的，
 * 不可能出现「写着 2D、画面其实已经转走」。
 *
 * 代价是每次配置写入都要重算一次。这一段只有几个 `Math.hypot`，
 * 与拖动时每帧都要跑的渲染相比可以忽略。
 */
const viewMode = computed(() => viewModeOf(scene.config.camera))
</script>

<template>
  <div
    class="tdm-stage"
    :class="{ 'tdm-stage--preview': previewMode }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!--
      预览窗口的标题栏。只在预览时渲染，**浮在视口之上**（绝对定位，不占布局），
      所以它出现与否都不会动到画面尺寸。它自己不带任何状态，出口按钮走的是与 Esc
      同一个 exitPreview（见 PreviewBar.vue）。

      全屏之下没有「窗口外面」可以点，于是退出只有两条路：这一行的按钮、以及 Esc。
    -->
    <PreviewBar v-if="previewMode" />

    <div
      ref="viewport"
      class="tdm-viewport"
      :class="{ 'tdm-viewport--draw': floorplanEnabled }"
      @pointerdown="onFloorplanPointerDown"
      @pointermove="onFloorplanPointerMove"
      @pointerup="onFloorplanPointerUp"
      @pointercancel="onFloorplanPointerCancel"
      @pointerleave="onFloorplanPointerLeave"
      @contextmenu="onFloorplanContextMenu"
    >
      <!--
        编辑器直接挂在 `SceneCanvas`（**内部签名**）上，不经过公开面那个 `SceneViewer`
        ——后者在编辑模式下渲染的就是本组件所在的那三栏，从那边绕一圈就成了环
        （`SceneViewer` → `SceneEditor` → 本组件 → `SceneViewer`）。

        于是下面这几条「编辑器要用、宿主不该管」的值，由这里直接给：

        - `:editable="!previewMode"` —— 总闸的**唯一常驻消费者**：预览态一个开关关掉
          一整组（点选 / 包围框 / 手柄），不必再摆三个 `!previewMode`——那种写法漏一个
          不报错，画面上只是「预览里还能点中模型」。
        - `:toolbar="false"` —— 编辑器自绘界面，内置那条浮动工具栏让位。走的正是
          「分开关优先于总闸」那一支（见 DESIGN.md 设计决定 46）。
        - `:gizmo-mode` 取编辑器自己的 ref（右栏与 W/E/R 快捷键都在改它），
          `:camera-transition` 取下面那个常量。两条都不是宿主的 prop。
      -->
      <SceneCanvas
        ref="viewer"
        height="100%"
        :editable="!previewMode"
        :toolbar="false"
        :gizmo-mode="gizmoMode"
        :camera-transition="CAMERA_TRANSITION"
        @loaded="onLoaded"
        @progress="onProgress"
        @error="onError"
        @camera-change="onCameraChange"
        @model-pick="onPicked"
        @model-transform="emit('modelTransform', $event)"
        @model-transform-end="onTransformEnd"
        @object-click="onModelEvent('click', $event)"
        @object-dblclick="onModelEvent('dblclick', $event)"
        @object-pointer-enter="onModelEvent('pointerenter', $event)"
        @object-pointer-leave="onModelEvent('pointerleave', $event)"
        @object-context-menu="onModelEvent('contextmenu', $event)"
      >
        <!--
          `#scene` 里的内容位于 TresCanvas 内部，能拿到 useTres / useLoop。
          编辑器自己的户型草稿要的正是这个：它得是画布里的**真 3D 对象**。
          插件不必为此新增 prop，3D 层也不必引入 Pinia。
        -->
        <template #scene>
          <!--
            画到一半的东西只在这里出现（橡皮筋、拖到一半的矩形）。
            库渲染的是配置里那份「用户已经确认存在」的房子，草稿是编辑态，
            所以它不走库、也不进配置——`SceneConfig` 只放可 JSON 往返的数据。
          -->
          <SceneFloorplanDraft />
          <!--
            宿主自己的 3D 内容排在**最后**：上面那件是编辑器的内部件，
            它要在，而宿主注入的东西不该插在它前面——顺序会影响渲染次序，
            内部件的位置是编辑器说了算的。
          -->
          <slot name="scene" />
        </template>
      </SceneCanvas>

      <span class="tdm-corner tdm-corner--tl" :class="{ 'tdm-corner--lit': lit }" />
      <span class="tdm-corner tdm-corner--tr" :class="{ 'tdm-corner--lit': lit }" />
      <span class="tdm-corner tdm-corner--bl" :class="{ 'tdm-corner--lit': lit }" />
      <span class="tdm-corner tdm-corner--br" :class="{ 'tdm-corner--lit': lit }" />

      <!--
        手柄模式切换。放在顶边中部。

        这个位置原先是被**挤**出来的（「左上角被视口 HUD 的四行读数占着」）——
        视口 HUD 删掉之后左上角空了出来，所以这一条**现在是可以挪的**；这次没动它：
        删读数与重排浮层是两件事，真要挪就把右上角的视角档位、左中部的绘制工具条
        一起看（三者的位置本来是互相让出来的）。

        它是**编辑控件**而不是读数，所以预览模式下跟胶囊一起消失（CSS 里同一条规则），
        没有选中模型时也整块不渲染——没有手柄就没有模式可言。
      -->
      <div v-if="gizmoVisible" class="tdm-gizmo" role="group" aria-label="变换手柄模式">
        <button
          v-for="item in TRANSFORM_MODES"
          :key="item.mode"
          type="button"
          class="tdm-gizmo-btn"
          :class="{ 'tdm-gizmo-btn--on': gizmoMode === item.mode }"
          :aria-pressed="gizmoMode === item.mode"
          :title="`${item.label}（快捷键 ${item.key}）`"
          @click="setGizmoMode(item.mode)"
        >
          {{ item.label }}
        </button>
      </div>

      <!--
        视角档位切换。放在右上角。

        左上角原先被那条视口 HUD 的四行读数占着，HUD 删掉之后那里空了出来
        ——挪不挪见上面手柄条那一段。顶边中部是手柄条，右下是操作胶囊，
        四个角还有 13×13 的装饰角标。

        与手柄条不同，它**没有 v-if**：它管的是相机而不是模型，
        空场景里同样有意义。预览模式下跟着其余编辑控件一起由 CSS 关掉。
      -->
      <div class="tdm-view" role="group" aria-label="视角模式">
        <button
          v-for="item in VIEW_MODES"
          :key="item.mode"
          type="button"
          class="tdm-view-btn"
          :class="{ 'tdm-view-btn--on': viewMode === item.mode }"
          :aria-pressed="viewMode === item.mode"
          :title="item.title"
          @click="setViewMode(item.mode)"
        >
          {{ item.label }}
        </button>
      </div>

      <!--
        选中某个模型时才出现的操作胶囊。放在 .tdm-dropzone 之前只是因为
        阅读顺序上它属于视口内容，实际由 z-index 决定谁在上面（30 > 10）。
      -->
      <ModelActions />

      <!--
        绘制工具：竖排贴在视口左边缘中部。

        为什么不并进顶边那条手柄条：那条只在**有选中模型**时才出现
        （`gizmoVisible`），而平面图工具要在空场景里就能用；而且「手柄模式」
        与「绘制工具」是两类东西，混在一条上会让「这条到底管什么」变模糊。

        为什么在左侧中部：右上角是视角档位、右下角是操作胶囊、四周还有角标；
        左上角原先被那条视口 HUD 占着，HUD 删掉之后那里空了出来（挪不挪见手柄条那段）。

        **摆不摆由组件自己按 `planView` 决定**（3D、「允许旋转」开着、预览，
        三种情况下都不摆）：画不了的时候留着按钮，只会让人点一下、什么也没发生。
        所以下面那条 CSS 的预览规则与它有一部分是重叠的——留着是因为同一条
        CSS 还要管提示行，而提示行与工具条不是一回事（画不了的原因照样得说出来）。
      -->
      <FloorplanTools />

      <!--
        绘制提示行：视口底部居中的一条细横条。

        **它是必须的**，不是装饰：「点回起点闭合」「只能横平竖直」「再点一下删掉」
        这几条规则在画面上没有任何别的落点，不写下来用户不可能猜到；
        而「斜着点不落点」这类**拒绝**如果没有一句话说明，表现出来就是
        「点了没反应」——编辑器没有 toast 体系，只有这里能说。
      -->
      <p v-if="floorplanHint" class="tdm-draw-hint">{{ floorplanHint }}</p>

      <div v-if="dropping" class="tdm-dropzone">释放以载入 glTF / GLB</div>
    </div>
  </div>
</template>
