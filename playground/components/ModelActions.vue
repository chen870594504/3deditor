<script setup lang="ts">
import { computed } from 'vue'
import { useSceneStore } from '../../src'
import {
  duplicateModel,
  focusModel,
  groundModel,
  isMeasurable,
  removeSelectedModel,
  resetModelTransform,
  toggleModelVisible,
} from '../composables/useModelActions'
import type { IconPath } from '../composables/useInspectorSchema'

defineOptions({ name: 'ModelActions' })

const scene = useSceneStore()

/**
 * 当前选中的模型。胶囊整块只在它存在时渲染。
 *
 * 「选中才显示」而不是「灰着等选中」：没有选中项时这六个动作一个都做不了，
 * 留一排点不动的圆点只会占住视口右下角——而默认场景**本来就是空的**，
 * 那不是异常状态，不需要用一排禁用控件来表达。
 */
const selected = computed(() => scene.selectedModel)

/**
 * 贴地 / 聚焦现在做不做得成。
 *
 * 做成 computed 而不是在点击时判一下：模型还没加载完时这两个动作做不了任何事，
 * 而唯一的反馈通道 `pushEvent` 只是往控制台打一行日志——用户看不见。
 * 让按钮变灰，比点下去静默失败诚实。
 *
 * 下面两行 `void` 只是**登记依赖**，不参与计算。包围盒会变只可能有三个原因：
 * 节点挂上 / 卸下（`measureModel` 内部读到注册表，自动成为依赖）、资源换了一个
 * （url 变）、加载完成了（loading 变）。后两件不会换节点，必须在这里显式读一下，
 * 否则切到另一个模型之后这个 computed 会一直停在旧结果上。
 */
const measurable = computed(() => {
  void scene.loading
  void selected.value?.url
  return isMeasurable(selected.value)
})

// ---------- 图标 ----------
//
// 六组描边路径，都画在 24 格里、只吃 currentColor，形状与右栏导轨的 NAV_ICONS
// 不重合（那边是立方体 / 相机 / 菱形网格 / 太阳 / 球与影 / 时钟）。
// 留白压在 3 格以上：一排六个挤在一起时，视觉重量不齐会非常明显。

/** 贴地：一条地面线、坐在线上的物体、从上方压下来的箭头 */
const ICON_GROUND: IconPath[] = [
  { d: 'M3 19.5H21' },
  { d: 'M8.5 19.5V15H15.5V19.5' },
  { d: 'M12 3.5V11' },
  { d: 'M9.8 8.7 12 11l2.2-2.3' },
]

/** 聚焦：四角取景框 + 中心十字 */
const ICON_FOCUS: IconPath[] = [
  { d: 'M4 8.5V4H8.5' },
  { d: 'M15.5 4H20V8.5' },
  { d: 'M20 15.5V20H15.5' },
  { d: 'M8.5 20H4V15.5' },
  { d: 'M12 9.5V14.5' },
  { d: 'M9.5 12H14.5' },
]

/** 复制：前后两张错开的纸 */
const ICON_DUPLICATE: IconPath[] = [
  { d: 'M9 4H18.5A1.5 1.5 0 0 1 20 5.5V15' },
  { d: 'M5.5 8.5H15A1.5 1.5 0 0 1 16.5 10V18A1.5 1.5 0 0 1 15 19.5H5.5A1.5 1.5 0 0 1 4 18V10A1.5 1.5 0 0 1 5.5 8.5Z' },
]

/** 归零：逆时针回转的箭头。不用时钟，免得跟导轨那个「操作历史」撞脸 */
const ICON_RESET: IconPath[] = [
  { d: 'M3 12A9 9 0 1 0 12 3A9.75 9.75 0 0 0 5.26 5.74L3 8' },
  { d: 'M3 3V8H8' },
]

/** 显隐：睁开的眼睛 */
const ICON_VISIBLE: IconPath[] = [
  { d: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z' },
  { d: 'M15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12' },
]

/** 被隐藏：同一只眼睛加一道斜杠 */
const ICON_HIDDEN: IconPath[] = [
  { d: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z' },
  { d: 'M15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12' },
  { d: 'M4 4 20 20' },
]

/** 删除：垃圾桶 */
const ICON_REMOVE: IconPath[] = [
  { d: 'M4 6.5H20' },
  { d: 'M9.5 6.5V4.6A1.1 1.1 0 0 1 10.6 3.5H13.4A1.1 1.1 0 0 1 14.5 4.6V6.5' },
  { d: 'M6.6 6.5 7.5 19.2A1.8 1.8 0 0 0 9.3 20.9H14.7A1.8 1.8 0 0 0 16.5 19.2L17.4 6.5' },
  { d: 'M10.5 10.5V17' },
  { d: 'M13.5 10.5V17' },
]
</script>

<template>
  <!--
    画布右下角的模型操作胶囊。

    只在选中某个模型时出现，按钮是**纯图标**（见 .ed-action-tip 那段注释：
    这块地方放不下文字）。六个动作分成两组：前五个都作用在这个物体本身，
    最后一个是破坏性的，用一道竖线隔开。
  -->
  <div v-if="selected" class="ed-viewport-actions">
    <button
      type="button"
      class="ed-action"
      :disabled="!measurable"
      aria-label="贴地：让模型的最低点落到地面上"
      @click="groundModel"
    >
      <svg class="ed-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path v-for="(part, i) in ICON_GROUND" :key="i" :d="part.d" :fill="part.fill ? 'currentColor' : 'none'" />
      </svg>
      <span class="ed-action-tip" aria-hidden="true">贴地</span>
    </button>

    <button
      type="button"
      class="ed-action"
      :disabled="!measurable"
      aria-label="聚焦：把相机拉到刚好装下这个模型"
      @click="focusModel"
    >
      <svg class="ed-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path v-for="(part, i) in ICON_FOCUS" :key="i" :d="part.d" :fill="part.fill ? 'currentColor' : 'none'" />
      </svg>
      <span class="ed-action-tip" aria-hidden="true">聚焦</span>
    </button>

    <button type="button" class="ed-action" aria-label="复制：原地再摆一个一样的" @click="duplicateModel">
      <svg class="ed-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path v-for="(part, i) in ICON_DUPLICATE" :key="i" :d="part.d" :fill="part.fill ? 'currentColor' : 'none'" />
      </svg>
      <span class="ed-action-tip" aria-hidden="true">复制</span>
    </button>

    <button type="button" class="ed-action" aria-label="归零：把物体变换恢复成默认值" @click="resetModelTransform">
      <svg class="ed-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path v-for="(part, i) in ICON_RESET" :key="i" :d="part.d" :fill="part.fill ? 'currentColor' : 'none'" />
      </svg>
      <span class="ed-action-tip" aria-hidden="true">归零</span>
    </button>

    <button
      type="button"
      class="ed-action"
      :class="{ 'ed-action--off': !selected.visible }"
      :aria-pressed="selected.visible"
      :aria-label="selected.visible ? '隐藏这个模型' : '显示这个模型'"
      @click="toggleModelVisible"
    >
      <svg class="ed-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          v-for="(part, i) in selected.visible ? ICON_VISIBLE : ICON_HIDDEN"
          :key="i"
          :d="part.d"
          :fill="part.fill ? 'currentColor' : 'none'"
        />
      </svg>
      <span class="ed-action-tip" aria-hidden="true">{{ selected.visible ? '隐藏' : '显示' }}</span>
    </button>

    <span class="ed-viewport-actions-sep" aria-hidden="true" />

    <button type="button" class="ed-action" aria-label="删除这个模型" @click="removeSelectedModel">
      <svg class="ed-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path v-for="(part, i) in ICON_REMOVE" :key="i" :d="part.d" :fill="part.fill ? 'currentColor' : 'none'" />
      </svg>
      <span class="ed-action-tip" aria-hidden="true">删除</span>
    </button>
  </div>
</template>
