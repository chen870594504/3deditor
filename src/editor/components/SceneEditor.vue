<script setup lang="ts">
import { computed, provide, useTemplateRef } from 'vue'
import EditorStage from './EditorStage.vue'
import EventBindingDialog from './inspector/EventBindingDialog.vue'
import InspectorPanel from './inspector/InspectorPanel.vue'
import SidePanel from './side/SidePanel.vue'
import { EDITOR_ASSETS_KEY, useEditorAssets } from '../assets'
import type {
  CameraChangePayload,
  DeepPartial,
  EditorPanelTab,
  ModelPickPayload,
  ModelTransformPayload,
  ObjectClickPayload,
  SceneConfig,
  SceneViewerApi,
  SceneViewerMode,
} from '../../types'
import { useSceneStore } from '../../stores/scene'
import type { ExtraLibrarySection } from '../composables/useModelLibrary'
import { useAssetManifest } from '../composables/useAssetManifest'
import { useEditorShortcuts } from '../composables/useEditorShortcuts'
import {
  INSPECTOR_TAB_PREFIX,
  SIDE_TAB_PREFIX,
  panelSlotNames,
} from '../utils/panelSlots'

/*
  编辑器那三栏。**不注册、不导出**——它是 `SceneViewer` 在 `editable` 为真时的形状。

  顶栏**不在这里**：场景名、保存、预览那几个按钮全是策略，属于宿主
  （见 DESIGN.md 设计决定 47）。这里只有能力——左栏挑料、中栏画布、右栏改属性。

  于是宿主拿到的是这样一个盒子：给它一个有高度的容器，它就铺满；
  想在上面加一条自己的顶栏，就在外面套一层。
*/
defineOptions({ name: 'TdmSceneEditor' })

/**
 * 高度与 `SceneCanvas` 同一口径（数字补 `px`、字符串原样）。
 *
 * 默认 `480px` 与画布那份一致：宿主只写 `<SceneViewer editable />` 时
 * 拿到的是一个 480px 高的完整编辑器，而不是一个塌成 0 的盒子。
 *
 * 两个 `tabs` **不给默认值**：不写时是 `undefined`，而两个面板各自
 * `withDefaults` 成了 `[]`（Vue 对 `undefined` 的 prop 照常取默认值）。
 * 在这一层再兜一次空数组等于把那个默认值抄成两份，改一处不漏另一处也不报错。
 */
const props = withDefaults(
  defineProps<{
    height?: string | number
    /**
     * 编辑场景还是编辑模型。默认 `'scene'`，与本组件出现之前逐字一致。
     *
     * 它是**字符串**而不是布尔：布尔 prop 缺失会被 Vue 转成 `false`，
     * 而这里「不传」与 `'scene'` 本来就是一回事，写成布尔反而要把那条特例
     * 再抄一遍（见 `SceneViewer` 里 `editable: undefined` 那段）。
     */
    mode?: SceneViewerMode
    sideTabs?: EditorPanelTab[]
    inspectorTabs?: EditorPanelTab[]
    /** 宿主追加的模型分类。scene 模式追加在五类之后，model 模式是左栏的全部内容 */
    extraSections?: ExtraLibrarySection[]
    /**
     * 右上角 2D / 3D 视角胶囊是否显示。
     *
     * 一路透传到中栏，与 `SceneViewer` 的公开 prop 同名同义。默认 `true`——
     * 这一条不能像那五个开关那样写 `undefined`：没有默认值时，缺失的布尔 prop
     * 会被 Vue 转成 `false`，胶囊会静默消失（见 `SceneViewer` 里那段）。
     */
    showViewSwitch?: boolean
  }>(),
  { height: '480px', mode: 'scene', showViewSwitch: true },
)

const isModelMode = computed(() => props.mode === 'model')

const workbenchHeight = computed(() =>
  typeof props.height === 'number' ? `${props.height}px` : props.height,
)

const scene = useSceneStore()

/*
  编辑器的全局快捷键（W/E/R 切手柄、Esc 四级、⌘Z 撤销）在这一层挂上。
  只有编辑器存在时才有意义，所以挂在编辑器上而不是 `SceneViewer` 上：
  画布态下按 W 不该有任何事发生，也不该有一个常驻的 window 监听器。

  ⌘S 保存**不在这里**——它是宿主的策略，见该 composable 的头部注释。
*/
useEditorShortcuts()

/*
  素材：把宿主给的那一份补成**编辑器实际要用的那一份**，再往下一层 provide。

  补的那一步是「清单从服务器上读」——素材根**根目录那一份** `<地址>index.json`
  （`useAssetManifest` 里写了判据、失败怎么降级、以及为什么空地址不发请求）。
  宿主整份给了清单时这一层什么都不做，与从前完全一样。

  **同一个 key 在这里被 provide 了第二次，这不是笔误。** `SceneViewer` 那一层
  说的是「宿主给了什么素材」，这一层说的是「编辑器实际用哪一份」；`inject` 取的是
  **最近的一层**，所以只有编辑器内部看得到这份合并结果，宿主那侧不受影响。
  之所以重新 provide 而不是换个键：下游（`useLibrarySections`、以及
  `ModelLibrary` 那条兜底）只认 `EDITOR_ASSETS_KEY`，同一个键就让它们一行都不用改。

  与 `SceneViewer` 那条纪律相同：**必须无条件执行**。setup 只跑一次，而编辑态 /
  画布态是模板里的 `v-if`——塞进分支里，挂载时是画布态就再也补不回来了。
  放在这一层（而不是 `SceneViewer`）另有个好处：画布态根本不渲染本组件，
  预览态的宿主不会白付那几条请求。
*/
const sourceAssets = useEditorAssets()

/*
  模型编辑页**一条素材请求都不发**：那一页左栏只放宿主给的 `extraSections`，
  服务器清单与分类图标都用不上。`remote: false` 只是不让它去读清单；
  下面 `SidePanel` 那一支还会关掉图标探测（另一个口子、另一条代理前缀）。

  按**页面级**使用来判断：mode 是挂载时就定下的形态，运行中从 model 切回 scene
  不保证补发请求（`useAssetManifest` 的 watcher 只盯地址）。宿主换页面请换实例。
*/
provide(EDITOR_ASSETS_KEY, useAssetManifest(sourceAssets, { remote: !isModelMode.value }))

/*
  12 个事件与 6 个方法在**这一层也要再声明一次**。

  `SceneViewer` 是拿本组件当黑盒用的（它只认 `SceneEditor` 这个引用），所以
  中栏那两层（本组件 → `EditorStage` → `SceneCanvas`）每多一层的插槽 / 事件 /
  方法都要显式接一下——插槽不会自己走，事件也不会。少接一条的表现分别是
  「宿主的事件收不到」与「宿主调方法得到 undefined」，两者都不报错。
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

const stageRef = useTemplateRef<SceneViewerApi>('stage')

defineExpose<SceneViewerApi>({
  captureCamera: () => stageRef.value?.captureCamera() ?? false,
  measureModel: (id) => stageRef.value?.measureModel(id) ?? null,
  groundPointAt: (clientX, clientY) => stageRef.value?.groundPointAt(clientX, clientY) ?? null,
  getSceneData: () => stageRef.value?.getSceneData() ?? scene.exportConfig(),
  loadSceneData: (data: DeepPartial<SceneConfig>) => stageRef.value?.loadSceneData(data) ?? false,
  exportModel: (id, options) => stageRef.value?.exportModel(id, options) ?? null,
})
</script>

<template>
  <div class="tdm-body" :style="{ height: workbenchHeight }">
    <!--
      左右两栏各接一份宿主页的声明，以及**按前缀挑出来的插槽**。

      插槽转发必须写成 `v-for` + 动态名：宿主写了几页是在运行时才知道的，
      而 `panelSlotNames($slots, …)` 又必须在**渲染期**读 `$slots` 才建立依赖
      （理由写在 `utils/panelSlots.ts`）。

      按前缀挑而不是「除了 `#scene` 全都转」：那会把右栏的插槽也塞进左栏，
      而一个没被用到的插槽是**合法**的——塞错了不报错，只在将来 `$slots`
      多出一个名字时莫名其妙（左栏的 `railButtons` / `ModelLibrary` 都在读 `$slots`）。
    -->
    <SidePanel
      :tabs="sideTabs"
      :model-mode="isModelMode"
      :extra-sections="extraSections"
    >
      <template v-for="name in panelSlotNames($slots, SIDE_TAB_PREFIX)" #[name]="scope">
        <slot :name="name" v-bind="scope" />
      </template>
    </SidePanel>
    <EditorStage
      ref="stage"
      :model-mode="isModelMode"
      :show-view-switch="showViewSwitch"
      @loaded="emit('loaded')"
      @progress="emit('progress', $event)"
      @error="emit('error', $event)"
      @camera-change="emit('cameraChange', $event)"
      @object-click="emit('objectClick', $event)"
      @object-dblclick="emit('objectDblclick', $event)"
      @object-pointer-enter="emit('objectPointerEnter', $event)"
      @object-pointer-leave="emit('objectPointerLeave', $event)"
      @object-context-menu="emit('objectContextMenu', $event)"
      @model-pick="emit('modelPick', $event)"
      @model-transform="emit('modelTransform', $event)"
      @model-transform-end="emit('modelTransformEnd', $event)"
    >
      <!--
        宿主自己的 3D 内容透传下去。中间隔了本组件与 EditorStage 两层，
        而插槽不会自己走——每一层都要显式接一下。
      -->
      <template #scene>
        <slot name="scene" />
      </template>
    </EditorStage>
    <InspectorPanel :tabs="inspectorTabs" :model-mode="isModelMode">
      <template v-for="name in panelSlotNames($slots, INSPECTOR_TAB_PREFIX)" #[name]="scope">
        <slot :name="name" v-bind="scope" />
      </template>
    </InspectorPanel>

    <!--
      事件绑定弹窗。它用 Teleport 挂到 body 上，所以放在这一层**不占网格格子**
      （渲染出来是一个注释节点），也不会把 `.tdm-body` 那三列挤歪。
    -->
    <EventBindingDialog />
  </div>
</template>
