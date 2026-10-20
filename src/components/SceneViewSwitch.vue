<script setup lang="ts">
import { computed } from 'vue'
import { useSceneStore } from '../stores/scene'
import { viewModeOf } from '../utils/viewMode'
import type { ViewMode } from '../utils/viewMode'

/**
 * 右上角那枚 2D / 3D 视角胶囊。
 *
 * 它由 `SceneCanvas` 渲染，所以**纯画布也有**——编辑态、只读画布、编辑器预览看到的
 * 是同一个组件，它不再是编辑器界面的一部分（见 DESIGN.md 设计决定 69）。
 * 显不显示由 `SceneCanvas` 的同名 prop 决定，这一层不知道宿主是谁。
 *
 * 它自己**不切档**：点击只 `emit('select', mode)`，真正的 `setViewMode` 由两种形态
 * 各自接——编辑态还要先处理漫游的交接（见 `EditorStage.onViewModeClick`）。
 * 把动作塞进这一层就得 import 编辑器的 composable，纯画布那一路会白背上漫游状态。
 *
 * 档位仍然**从机位推导**（`viewModeOf`），没有独立的 ref：撤销、套预设、在面板里
 * 手改机位之后，亮着的那一档自己就是对的。理由见 `utils/viewMode.ts`。
 */
defineOptions({ name: 'TdmSceneViewSwitch' })

const emit = defineEmits<{
  (e: 'select', mode: ViewMode): void
}>()

const scene = useSceneStore()

const viewMode = computed(() => viewModeOf(scene.config.camera))

/**
 * 两档视角与它们的说明。
 *
 * 这里没有第三列快捷键：2D / 3D 不绑键。Blender 那套 `5` / numpad `7` 与画布上
 * 已有的 W/E/R 不是一套手感，而单键还要与输入框、中文输入法纠缠，收益不抵成本。
 */
const VIEW_MODES: { mode: ViewMode; label: string; title: string }[] = [
  { mode: '2d', label: '2D', title: '2D 俯视角：相机移到正上方并框住当前内容' },
  { mode: '3d', label: '3D', title: '3D 透视视角：回到进入 2D 之前的机位' },
]
</script>

<template>
  <div class="tdm-view" role="group" aria-label="视角模式">
    <button
      v-for="item in VIEW_MODES"
      :key="item.mode"
      type="button"
      class="tdm-view-btn"
      :class="{ 'tdm-view-btn--on': viewMode === item.mode }"
      :aria-pressed="viewMode === item.mode"
      :title="item.title"
      @click="emit('select', item.mode)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
