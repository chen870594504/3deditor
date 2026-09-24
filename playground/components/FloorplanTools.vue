<script setup lang="ts">
import { FLOORPLAN_TOOLS, floorplanTool, planView, setFloorplanTool } from '../composables/useFloorplanTool'

defineOptions({ name: 'FloorplanTools' })

/**
 * 视口左边缘中部那条竖排绘制工具条。
 *
 * 五个工具，没有「选择」按钮：`select` 是「什么工具都没开」的空档，不是一件工具——
 * 它由「再点一次当前工具」「Esc」「右键两次」进入（见 `setFloorplanTool`）。
 * 工具条上放一枚永久的「选择」按钮只会多出一个「点了它什么都不会发生」的按钮。
 *
 * ## 整条只在 2D 里出现（`planView`）
 *
 * 3D 里画不了，按钮留在那儿唯一的下场是**用户点了一下、什么也没发生**
 * （点了工具确实还会顺手切回 2D，可那正是「他本来没打算切档」的那种意外：
 * 想看看斜视角上的这面墙，手一抖把相机拽回了正俯视）。
 * 「允许旋转」开着、以及预览模式下同样是隐藏的，理由与 `planView` 那三条闸完全重合。
 *
 * **隐藏不等于把工具关掉。** 开着一个工具切到 3D 时，工具状态与画到一半的墙链
 * **原样留着**（`setFloorplanTool` 那条「切回 3D 不会把工具关掉」是有意的，
 * 见 README），切回 2D 就能接着画；这段空档里想退出工具用 `Esc` 或右键两次，
 * 提示行也会说清「绘制只在 2D 俯视角下可用」。
 *
 * `title` 直接挂该工具的常驻说明：这些规则在画面上别处没有落点，
 * 悬停能读到比没有好（真正常显的那一份在视口底部的 `.ed-draw-hint`）。
 */
</script>

<template>
  <div v-if="planView" class="ed-draw" role="group" aria-label="平面图绘制工具">
    <button
      v-for="item in FLOORPLAN_TOOLS"
      :key="item.tool"
      type="button"
      class="ed-draw-btn"
      :class="{ 'ed-draw-btn--on': floorplanTool === item.tool }"
      :aria-pressed="floorplanTool === item.tool"
      :title="item.hint"
      @click="setFloorplanTool(item.tool)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
