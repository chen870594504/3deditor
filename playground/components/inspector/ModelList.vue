<script setup lang="ts">
import { useSceneStore, activeEventTypes } from '../../../src'
import type { ModelConfig } from '../../../src'
import { labelOf } from '../../utils/modelLabel'
import { eventDialogOpen } from '../../composables/useEditorState'
import type { IconPath } from '../../composables/useInspectorSchema'

defineOptions({ name: 'ModelList' })

const scene = useSceneStore()

/**
 * 「模型属性」页上半部分：场景里已有的模型列表。
 *
 * 与下半部分的字段是主从关系——点这里选谁，下面那几节就描述谁。
 * 选中项是**界面状态**（store 里的 `selectedIndex`），不进配置、不进历史：
 * 在列表里点一下不该在撤销栈里留一条记录。
 *
 * 字段那边是靠「路径闭包 + computed」自己跟着变的（见 useInspectorSchema
 * 的 modelPath），所以这里除了改下标之外什么都不用做。
 */

/**
 * 行首图标的路径。
 *
 * 「内置示例几何体」与「外部地址的模型」用两个形状区分：一行文字装不下
 * 这件事，而它恰好是列表上最该一眼看清的——名字是从地址派生出来的短 uuid，
 * 看名字分不出这个物体到底存不存在于场景文件之外。
 *
 * 结构与右栏导轨的 NAV_ICONS 一致（`{ d, fill }` 数组），描边参数统一由 CSS
 * 给：两者控制不同属性，不会互相覆盖。
 */
const ICON_BUILTIN: IconPath[] = [
  { d: 'M12 3 20.5 7.8v8.4L12 21 3.5 16.2V7.8z' },
  { d: 'M3.5 7.8 12 12.6l8.5-4.8' },
  { d: 'M12 12.6V21' },
]

const ICON_LINKED: IconPath[] = [
  { d: 'M13.5 3H7a1.8 1.8 0 0 0-1.8 1.8v14.4A1.8 1.8 0 0 0 7 21h10a1.8 1.8 0 0 0 1.8-1.8V8.4z' },
  { d: 'M13.5 3v5.4h5.3' },
]

function iconOf(model: ModelConfig): IconPath[] {
  return model.url === '' ? ICON_BUILTIN : ICON_LINKED
}

/**
 * 行尾闪电按钮的读数：绑了几类事件。
 *
 * 这一行原先有第二行副标题写着「已绑 N 类事件」，改成一行之后那行没了。
 * 信息不能跟着丢——场景里摆了三四个模型时，「哪一个会响应点击」是列表上
 * 唯一看不出来、又最需要一眼看到的东西，不写它就得到下面翻三个
 * 「事件绑定」按钮才找得到。
 */
function boundCount(model: ModelConfig): number {
  return activeEventTypes(model).length
}

/** 悬停提示：把被砍掉的那行副标题补回来（名字 + 这个物体的来历） */
function tipOf(model: ModelConfig): string {
  const count = boundCount(model)
  const origin = model.url === '' ? '内置示例几何体' : model.url
  const events = count > 0 ? `已绑 ${count} 类事件` : '未绑事件'
  return `${labelOf(model)}\n${origin} · ${events}`
}

/**
 * 右侧那个闪电按钮：先选中这一行，再打开弹窗。
 *
 * 顺序不能反。弹窗打开时按的是 `scene.selectedModel` 去钉住目标
 * （见 EventBindingDialog 的 targetId），反过来的话它钉住的还是上一个模型，
 * 用户点的是 3 号、弹窗里改的却是 1 号。
 */
function bindEvents(index: number) {
  scene.selectModel(index)
  eventDialogOpen.value = true
}
</script>

<template>
  <!--
    自己带 ed-scroll：展开成上下两块之后这里是个固定高度的滚动容器，
    列表长了在框内滚，不去顶下面那三节。
  -->
  <div class="ed-models ed-scroll">
    <!--
      表头沿用下面三节的排版（编号 + 标题 + 右侧读数），只是不可折叠：
      它描述的是「谁」，而下面 01/02/03 描述的是「那个谁长什么样」，
      折叠起来会让上下两块看起来是并列的四个节，而它们是主从关系。
      滚动时钉在顶上，否则列表一长就分不清表头属于谁。
    -->
    <div class="ed-models-head">
      <span class="ed-sec-idx">00</span>
      <span class="ed-sec-title">场景模型</span>
      <span class="ed-models-count">{{ scene.models.length }}</span>
      <!-- 与左栏模型库的分类是同一件事的两个入口：一个挑资源，一个只想再摆一个内置几何体 -->
      <button type="button" class="ed-models-add" title="追加内置示例几何体" @click="scene.addModel()">
        ＋ 追加
      </button>
    </div>

    <div v-if="scene.models.length" class="ed-list">
      <!--
        每行是三个并排的兄弟：主按钮（图标 + 名称）、事件按钮、悬停浮现的移除按钮。
        它们不能互相嵌套：按钮套按钮是非法 HTML，浏览器会把内层拆出去，点击区域随之错位。
      -->
      <div v-for="(model, index) in scene.models" :key="model.id" class="ed-models-row">
        <button
          type="button"
          class="ed-item ed-models-pick"
          :class="{ 'ed-item--active': index === scene.selectedIndex }"
          :aria-current="index === scene.selectedIndex"
          :title="tipOf(model)"
          @click="scene.selectModel(index)"
        >
          <svg class="ed-models-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              v-for="(part, i) in iconOf(model)"
              :key="i"
              :d="part.d"
              :fill="part.fill ? 'currentColor' : 'none'"
            />
          </svg>
          <span class="ed-models-name">{{ labelOf(model) }}</span>
        </button>

        <button
          type="button"
          class="ed-models-evt"
          :class="{ 'ed-models-evt--on': boundCount(model) > 0 }"
          :title="`绑定「${labelOf(model)}」的事件`"
          :aria-label="`绑定「${labelOf(model)}」的事件，已绑 ${boundCount(model)} 类`"
          @click="bindEvents(index)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span v-if="boundCount(model) > 0" class="ed-models-evt-n">{{ boundCount(model) }}</span>
        </button>

        <button
          type="button"
          class="ed-models-drop"
          :title="`移除「${labelOf(model)}」`"
          :aria-label="`移除「${labelOf(model)}」`"
          @click="scene.removeModel(index)"
        >
          ×
        </button>
      </div>
    </div>

    <p v-else class="ed-hint ed-hint--quiet ed-models-empty">
      场景里还没有模型。从左栏挑一个模型，或者拖一个 .glb 进视口。
    </p>
  </div>
</template>
