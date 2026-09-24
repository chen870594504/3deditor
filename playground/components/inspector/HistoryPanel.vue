<script setup lang="ts">
import { computed } from 'vue'
import { useSceneStore } from '../../../src'

defineOptions({ name: 'HistoryPanel' })

const scene = useSceneStore()

/**
 * 时间倒序。
 *
 * store 里的 history 是正序的（索引即位置，undo/redo 直接加减），
 * 面板倒过来显示——最近的一步在最上面，符合「刚做完的事先看到」。
 * 序号仍用原始索引，所以列表上往下数序号是递减的，那正好是时间的走向。
 */
const ordered = computed(() =>
  scene.history
    .map((entry, index) => ({ entry, index }))
    .slice()
    .reverse(),
)

/**
 * 显示绝对时刻而不是「N 分钟前」。
 *
 * 相对时间需要定时器刷新，否则它会在面板上静静地变成错的；
 * 而这个面板整屏都是等宽数字，HH:MM:SS 反而更好扫。
 */
function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="ed-history">
    <div class="ed-history-bar">
      <button type="button" class="ed-btn ed-btn--sm" :disabled="!scene.canUndo" @click="scene.undo()">
        撤销
      </button>
      <button type="button" class="ed-btn ed-btn--sm" :disabled="!scene.canRedo" @click="scene.redo()">
        重做
      </button>
      <span class="ed-spacer" />
      <span class="ed-micro">可退 {{ scene.historyIndex }} 步</span>
    </div>

    <button
      v-for="row in ordered"
      :key="row.entry.id"
      type="button"
      class="ed-history-item"
      :class="{ 'ed-history-item--active': row.index === scene.historyIndex }"
      @click="scene.jumpTo(row.index)"
    >
      <span class="ed-history-idx">{{ String(row.index).padStart(2, '0') }}</span>
      <span class="ed-history-label">{{ row.entry.label }}</span>
      <span class="ed-history-time">{{ formatTime(row.entry.at) }}</span>
    </button>

    <p class="ed-hint ed-hint--quiet">
      最多保留 50 步。拖动滑块产生的连续改动会在 400 毫秒内合并成一条，不会把历史刷满。
    </p>

    <button
      type="button"
      class="ed-btn ed-btn--block ed-btn--sm"
      :disabled="scene.history.length <= 1"
      @click="scene.clearHistory()"
    >
      清空历史
    </button>
  </div>
</template>
