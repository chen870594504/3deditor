<script setup lang="ts">
import { useSceneStore } from '../../../src'
import type { FloorplanRoom } from '../../../src'
import { cloneFloorplanPatch } from '../../../src'
import { setPath } from '../../utils/path'
import TextControl from './controls/TextControl.vue'

defineOptions({ name: 'FloorplanRoomList' })

const scene = useSceneStore()

/**
 * 「平面图」页 05 房间：一行一个房间。
 *
 * 房间是**墙体推出来的**东西（`findEnclosedArea` 泛洪出来的多边形），所以这里
 * 只提供删除与改名改色——不能「新建一个房间」，也不能改它的形状：形状是墙的函数，
 * 想改形状就去改墙。参考项目的右栏也是这么划分的。
 *
 * 它没有做成 schema 驱动的一节，理由与「操作历史」相同：一行里有输入框、色块、
 * 删除按钮三样东西，还要按下标定位到配置里的某一条，字段声明那套（一字段一控件、
 * 路径是定长字符串）表达不了。由 `InspectorPanel` 接在 01~04 之后，
 * 序号 05 是**手写的**——加一节就要跟着改这里（03 墙 / 04 门窗在
 * `FloorplanStructureList` 里，同样是手写的）。
 *
 * 与「模型属性」页不同，这里没有选中态：房间是并列的注释，不是「当前正在改的那一个」。
 */

/**
 * 房间数组的写入口。
 *
 * 照 `useFloorplanTool.writeFloorplan`：补丁一律先过 `cloneFloorplanPatch`。
 * `applyConfig` 对数组是整体装入（`applyPatch` 的 `isPlainObject` 显式排除数组），
 * 而这里读出来的每个房间都是 reactive 代理、它的 `polygon` 还是代理数组——
 * 不过一遍拷贝，装进配置的就是代理本身，等于给编辑器留了一条隐式改场景的通道。
 */
function writeRooms(rooms: FloorplanRoom[], label: string): void {
  scene.applyConfig({ floorplan: cloneFloorplanPatch({ rooms }) }, label)
}

/**
 * 改名。
 *
 * 空名字直接丢弃（TextControl 失焦后会把 `modelValue` 重新显示出来，
 * 于是输入框自己弹回原名）：房间名是这块色块在画面上的唯一标签，
 * 允许它为空等于让一个房间在 3D 里彻底认不出来。
 */
function rename(room: FloorplanRoom, name: string): void {
  if (!name) return
  writeRooms(
    scene.config.floorplan.rooms.map((item) => (item.id === room.id ? { ...item, name } : item)),
    '重命名房间',
  )
}

/**
 * 改色。
 *
 * **这一处与改名走的是两条路，是刻意的：** 拖动系统取色器时 `input` 会一路连发
 * （Windows 下移动色相条就是几十次），而 `applyConfig` 带了 label 就**立即**入栈、
 * 不做防抖（见 `stores/scene.ts` 的 `applyConfig`）——照改名那么写，拖一次颜色
 * 会留下几十条历史，`⌘Z` 得按几十下。
 *
 * 直接 `setPath` 写一个字符串则走 store 的深度监听，400ms 内的连续写入合成一条，
 * 而且色块在**拖动过程中就是活的**（房间颜色实时跟着变）。
 * 这也是面板里所有颜色字段的既有做法（`ColorControl` 用的就是 `input`）。
 *
 * `setPath` 在这里没有别名风险：写进去的是个原始值，不牵扯任何数组或对象。
 */
function recolor(index: number, color: string): void {
  setPath(scene.config, `floorplan.rooms.${index}.color`, color)
}

function removeRoom(room: FloorplanRoom): void {
  writeRooms(
    scene.config.floorplan.rooms.filter((item) => item.id !== room.id),
    '删除房间',
  )
}
</script>

<template>
  <div class="ed-plan">
    <!--
      表头沿用 01/02 两节的排版（编号 + 标题 + 右端读数），不可折叠：
      它是「有哪些」，上面几节是「户型长什么样」，折叠起来会让几块看起来并列。
    -->
    <div class="ed-plan-head">
      <span class="ed-sec-idx">05</span>
      <span class="ed-sec-title">房间</span>
      <span class="ed-plan-count">{{ scene.config.floorplan.rooms.length }}</span>
    </div>

    <div v-if="scene.config.floorplan.rooms.length" class="ed-plan-list">
      <!--
        一行是三个并列的兄弟：名称输入框、色块、删除按钮。
        房间用 id 做 key 而不是下标——删除中间一行时，下标会让后面每一行的
        输入框都跟着错位一格（Vue 会复用 DOM，正在编辑的那个框会突然换到别人身上）。
      -->
      <div v-for="(room, index) in scene.config.floorplan.rooms" :key="room.id" class="ed-plan-row">
        <TextControl
          class="ed-plan-name"
          :model-value="room.name"
          placeholder="房间名称"
          @update:model-value="rename(room, $event)"
        />

        <!--
          系统取色器而不是 ColorControl：这里只需要一个色块。
          ColorControl 那一半是个十六进制文本框，而房间列表是一份**清单**——
          每行摆两个输入框，扫一眼就看不清有哪几个房间了。
          少掉文本框也不丢安全性：取色器只会吐出 `#rrggbb`，
          唯一可能塞进非法色值的路径就是手打十六进制，而这条路径这里没有。

          `title` 挂真实色值：导入的配置里颜色可能不是十六进制（写在命名色上），
          那时色块会退成黑色（浏览器只认 #rrggbb），把原值挂在悬停上至少查得到。
        -->
        <input
          type="color"
          class="ed-plan-tint"
          :value="room.color"
          :title="room.color"
          :aria-label="`「${room.name}」的颜色`"
          @input="recolor(index, ($event.target as HTMLInputElement).value)"
        />

        <button
          type="button"
          class="ed-plan-drop"
          :title="`删除「${room.name}」`"
          :aria-label="`删除「${room.name}」`"
          @click="removeRoom(room)"
        >
          ×
        </button>
      </div>
    </div>

    <p v-else class="ed-hint ed-hint--quiet ed-plan-empty">
      还没有房间。用视口左侧的「房间」工具点墙体围出的区域内部，识别成一个房间。
    </p>
  </div>
</template>
