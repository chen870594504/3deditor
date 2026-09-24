<script setup lang="ts">
import { useSceneStore } from '../stores/scene'

defineOptions({ name: 'TdmSceneToolbar' })

const scene = useSceneStore()

/** 工具栏开关项，key 必须与 store 上的布尔状态同名 */
const TOGGLES = [
  { key: 'autoRotate', label: '自动旋转' },
  { key: 'wireframe', label: '线框' },
  { key: 'showGrid', label: '网格' },
] as const
</script>

<template>
  <div
    class="tdm-toolbar"
  >
    <button
      v-for="item in TOGGLES"
      :key="item.key"
      type="button"
      class="tdm-toolbar-btn"
      :class="{ 'is-active': scene[item.key] }"
      @click="scene.toggle(item.key)"
    >
      {{ item.label }}
    </button>

    <span class="tdm-toolbar-sep" />

    <button
      type="button"
      class="tdm-toolbar-btn"
      @click="scene.resetView()"
    >
      重置
    </button>
  </div>
</template>
