<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import EditorStage from './EditorStage.vue'
import EventBindingDialog from './inspector/EventBindingDialog.vue'
import InspectorPanel from './inspector/InspectorPanel.vue'
import SidePanel from './side/SidePanel.vue'
import type {
  CameraChangePayload,
  DeepPartial,
  EditorPanelTab,
  ModelPickPayload,
  ModelTransformPayload,
  ObjectClickPayload,
  SceneConfig,
  SceneViewerApi,
} from '../../types'
import { useSceneStore } from '../../stores/scene'
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
    sideTabs?: EditorPanelTab[]
    inspectorTabs?: EditorPanelTab[]
  }>(),
  { height: '480px' },
)

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
  12 个事件与 5 个方法在**这一层也要再声明一次**。

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
    <SidePanel :tabs="sideTabs">
      <template v-for="name in panelSlotNames($slots, SIDE_TAB_PREFIX)" #[name]="scope">
        <slot :name="name" v-bind="scope" />
      </template>
    </SidePanel>
    <EditorStage
      ref="stage"
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
    <InspectorPanel :tabs="inspectorTabs">
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
