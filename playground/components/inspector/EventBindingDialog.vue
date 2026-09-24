<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import {
  MODEL_EVENT_LABELS,
  MODEL_EVENT_TYPES,
  defaultEventCode,
  deriveModelId,
  useSceneStore,
} from '../../../src'
import type {
  DeepPartial,
  ModelEventHandler,
  ModelEventType,
} from '../../../src'
import { eventDialogOpen } from '../../composables/useEditorState'

defineOptions({ name: 'EventBindingDialog' })

const scene = useSceneStore()

/**
 * 事件的绑定弹窗：左侧 5 类事件，右侧选中那一类的启用位与代码。
 *
 * 做成 master-detail 而不是 5 个代码框平铺，是因为一段脚本动辄十几行，
 * 5 个挤在一屏里每个只剩两三行高，连一句 console.log 都得滚动着看。
 *
 * 这个弹窗是编辑器里唯一会执行用户代码的地方（见 useEventRunner），
 * 但它自己一行都不执行——只负责把文本写进配置。
 *
 * 场景里可以有好几个模型，所以弹窗作用在**打开它的那一刻选中的那一个**上，
 * 而不是「提交那一刻选中了谁」——理由见 targetId。
 */

/** 当前展开的那一类事件 */
const current = ref<ModelEventType>(MODEL_EVENT_TYPES[0])

/**
 * 弹窗作用在哪个模型上：打开时记下它的 id，之后一律按 id 找回。
 *
 * 不用「提交那一刻的选中项」是因为这样一个操作：打开弹窗之后按 ⌘Z
 * （初始焦点在面板上，不在文本域里，所以这一下撤销的是**场景**）。
 * 撤销完全可能把列表里的模型增删掉，下标随之整体位移——按下标提交
 * 就会把 A 的代码写进 B，而且是静默的。
 *
 * id 找不到（这个模型被撤销掉了）时下标解析成 -1，`patchModel` 会跳过，
 * 也就是**什么都不写**。这比写错人要好：写错是污染另一个模型的配置，
 * 不写只是这一次编辑没落地。
 */
const targetId = ref<string | null>(null)

const targetIndex = computed(() => {
  const id = targetId.value
  if (id === null) return scene.selectedIndex
  return scene.models.findIndex((model) => model.id === id)
})

const target = computed(() => scene.models[targetIndex.value])

/** 弹窗标题旁点明改的是谁——多模型下「事件绑定」四个字本身已经不足以定位 */
const targetLabel = computed(() => {
  const model = target.value
  if (!model) return '模型已不存在'
  return model.name || deriveModelId(model.url)
})

/**
 * 面板本身要拿引用（打开时把焦点移进来），文本域不需要——
 * 它所有的读都发生在自己的事件里，`event.target` 就是它。
 */
const panelRef = useTemplateRef<HTMLElement>('panelRef')
/**
 * 正在被编辑的那一类事件，null 表示文本域没有焦点。
 *
 * 它只有一个用途：决定外部的配置变化要不要覆盖本地草稿。
 * 光标还在文本域里时不能覆盖——擦掉用户正在敲的字，比同步慢一拍糟糕得多；
 * 没有焦点时必须覆盖，否则「开着弹窗去撤销一步」这类操作会在关闭时
 * 被一份过期的草稿静默盖回去。
 */
const editing = ref<ModelEventType | null>(null)

/**
 * 各事件的代码草稿。
 *
 * 边打字边写配置等于每敲一个字符进一条历史，所以本地先攒着，
 * 失焦或关闭时再落一次（与 TextControl 的既有惯例一致）。
 *
 * 键类型写成 string 而不是 ModelEventType：它的下标来自 `current.value`，
 * 而草稿的存在意义就是「可能和配置不一致」，类型上不必假装两者等价。
 */
const drafts = ref<Record<string, string>>(seedDrafts())

/** 目标模型的绑定，缺失时给一份等价于「关闭且无代码」的兜底 */
function handlerFor(type: ModelEventType): ModelEventHandler {
  return target.value?.events?.[type] ?? { enabled: false, code: '' }
}

function isEnabled(type: ModelEventType): boolean {
  return handlerFor(type).enabled
}

/**
 * 从配置里重新播种草稿。
 *
 * `keep` 是正在编辑的那一类：它的草稿保留本地值，其余一律以配置为准。
 */
function seedDrafts(keep: ModelEventType | null = null): Record<string, string> {
  const next: Record<string, string> = {}
  for (const type of MODEL_EVENT_TYPES) {
    next[type] = keep === type ? (drafts.value[type] ?? '') : handlerFor(type).code
  }
  return next
}

/**
 * 外部改动同步回草稿。
 *
 * 没有这一条会留下一个很难复现的 bug：开着弹窗按 ⌘Z 撤销（或者从「操作历史」
 * 里跳回某一步），文本域里还是旧内容，一点「完成」就把刚撤销掉的代码又写回去，
 * 而且这次写入还会再进一条历史——用户看到的是「撤销被吃掉了」。
 *
 * 监听的是**目标模型**的 events 而不是当前选中项的：弹窗开着的时候选中项
 * 本来就该跟着目标走，而目标一旦因为撤销消失，这里也会收到一次通知。
 */
watch(
  () => target.value?.events,
  () => {
    drafts.value = seedDrafts(editing.value)
  },
  { deep: true },
)

/**
 * 统一的写入口：一条改动一条历史，标签里能看出改的是哪一类事件的哪一半。
 *
 * 走 `patchModel` 而不是 `applyConfig({ model: … })`：多模型下要指名改哪一个，
 * 而且 `patchModel` 会先克隆补丁、断开与宿主的别名（见 utils/config 的 cloneModelPatch）。
 * 目标模型不存在时它自己会跳过，这里不必再判一次。
 */
function commit(
  events: DeepPartial<Record<ModelEventType, ModelEventHandler>>,
  label: string,
) {
  scene.patchModel({ events }, `事件绑定 · ${label}`, targetIndex.value)
}

/**
 * 勾选启用位。
 *
 * 首次打开且代码还是空的时候补一段默认模板——「启用后文本内默认有内容」
 * 是这次需求的一部分，不然用户看到的是一个启用着却什么都没有的框。
 * 不覆盖已有的代码：那多半是用户自己写的，或者是上一次启用时留下的。
 *
 * 点勾选框之前文本域必然已经失焦（mousedown 先于 change），
 * 所以这里读到的 code 一定是刚落库的那一份，不会丢字符。
 */
function toggle(type: ModelEventType, enabled: boolean) {
  const handler: Partial<ModelEventHandler> = { enabled }
  if (enabled && !handlerFor(type).code) handler.code = defaultEventCode(type)

  commit({ [type]: handler }, `${MODEL_EVENT_LABELS[type]} · ${enabled ? '启用' : '关闭'}`)
}

/** 把某一类的草稿写回配置（没有变化就什么都不写） */
function commitCode(type: ModelEventType) {
  const draft = drafts.value[type] ?? ''
  if (draft === handlerFor(type).code) return
  commit({ [type]: { code: draft } }, `${MODEL_EVENT_LABELS[type]} · 代码`)
}

function onCodeBlur() {
  commitCode(current.value)
  editing.value = null
}

/** 清空全部 5 类：启用位与代码一起复位，一次提交一条历史 */
function clearAll() {
  const events = {} as Record<ModelEventType, ModelEventHandler>
  for (const type of MODEL_EVENT_TYPES) events[type] = { enabled: false, code: '' }

  commit(events, '清空全部')
}

function close() {
  eventDialogOpen.value = false
}

/**
 * 文本域里的按键。
 *
 * Tab 插两个空格而不是切走焦点：这里写的是代码，缩进是刚需，
 * 而弹窗里能聚焦的元素本来就没几个，Tab 的导航价值远不如缩进。
 *
 * **Esc 什么都不做**，让它冒泡给 App 统一关闭弹窗。若在这里也做一次「放弃编辑」，
 * 就会与 App 的关闭互相抵消，用户看到的是「想撤销输入却把弹窗关了，
 * 而且提交的还是改后的内容」——比不做还糟。
 */
function onCodeKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  event.preventDefault()

  const area = event.target as HTMLTextAreaElement
  const { selectionStart, selectionEnd } = area
  drafts.value[current.value] =
    `${area.value.slice(0, selectionStart)}  ${area.value.slice(selectionEnd)}`

  // 受控绑定会重写 value，光标随之跳到末尾，所以等 DOM 更新后再摆回去
  nextTick(() => {
    area.selectionStart = selectionStart + 2
    area.selectionEnd = selectionStart + 2
  })
}

/**
 * 开关弹窗。
 *
 * 打开时记住触发它的元素，关闭时把焦点还回去——不然键盘用户每关一次弹窗
 * 就得从页面开头重新 Tab 一遍。
 *
 * 初始焦点落在面板本身而不是文本域上：文本域一拿到焦点，上面那条同步逻辑
 * 就停止工作，而「打开弹窗 → 撤销一步 → 关闭」正好是它要防的场景。
 */
let restoreTo: HTMLElement | null = null

watch(eventDialogOpen, async (open) => {
  if (open) {
    restoreTo = document.activeElement as HTMLElement | null
    // 先钉住目标再播种：seedDrafts 读的是 target，顺序反了会读到上一个模型
    targetId.value = scene.selectedModel?.id ?? null
    drafts.value = seedDrafts()
    await nextTick()
    panelRef.value?.focus()
    return
  }

  /**
   * 关闭时补一次提交。点「完成」的路径上文本域已经先行失焦、这里是个空转；
   * 但按 Esc 关闭时，被聚焦的元素是随弹窗一起被摘掉的，
   * 浏览器不会为它补发 blur 事件，只剩这一条路能保住那几行没提交的代码。
   */
  commitCode(current.value)
  editing.value = null
  restoreTo?.focus()
  restoreTo = null
})

/** 面板上那一小行摘要：「未填写」比一个空框更能说明状态 */
const codeSummary = computed(() => {
  const draft = (drafts.value[current.value] ?? '').trim()
  return draft ? `${draft.split('\n').length} 行` : '未填写'
})
</script>

<template>
  <Teleport to="body">
    <div v-if="eventDialogOpen" class="ed-modal" @click="close">
      <!--
        .stop 是必须的：作用是「点遮罩关闭」，没有它连面板内部的每一次点击
        都会冒泡到遮罩上、把弹窗关掉，等于整个弹窗点哪儿都没了。
      -->
      <div
        ref="panelRef"
        class="ed-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ed-evt-title"
        tabindex="-1"
        @click.stop
      >
        <header class="ed-modal-head">
          <h2 id="ed-evt-title" class="ed-modal-title">事件绑定</h2>
          <span class="ed-modal-sub">
            <b class="ed-modal-target">{{ targetLabel }}</b> · 库只负责发事件，代码由编辑器执行
          </span>
          <button type="button" class="ed-btn ed-btn--sm" @click="clearAll">清空全部</button>
        </header>

        <div class="ed-modal-body">
          <ul class="ed-evt-list">
            <li v-for="type in MODEL_EVENT_TYPES" :key="type">
              <button
                type="button"
                class="ed-evt-item"
                :class="{ 'ed-evt-item--on': type === current }"
                @click="current = type"
              >
                <span class="ed-evt-dot" :class="{ 'ed-evt-dot--on': isEnabled(type) }" />
                <span class="ed-evt-name">{{ MODEL_EVENT_LABELS[type] }}</span>
                <span class="ed-evt-badge">{{ handlerFor(type).code.trim() ? 'JS' : '—' }}</span>
              </button>
            </li>
          </ul>

          <div class="ed-modal-detail">
            <!--
              复用面板上的 .ed-toggle 开关，而不是原生 checkbox：
              原生勾选框在深色下怎么调都像外来物，而这个是全站统一的「开关」语义。
              它是个按钮，所以要自己算取反后的值，不能像 checkbox 那样读 checked。
            -->
            <div class="ed-evt-toggle">
              <button
                type="button"
                class="ed-toggle"
                :class="{ 'ed-toggle--on': isEnabled(current) }"
                role="switch"
                :aria-checked="isEnabled(current)"
                :aria-label="`启用${MODEL_EVENT_LABELS[current]}`"
                @click="toggle(current, !isEnabled(current))"
              />
              <span>启用「{{ MODEL_EVENT_LABELS[current] }}」</span>
            </div>

            <textarea
              class="ed-code"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              :placeholder="`console.log('${MODEL_EVENT_LABELS[current]}', event, model)`"
              :value="drafts[current] ?? ''"
              @input="drafts[current] = ($event.target as HTMLTextAreaElement).value"
              @focus="editing = current"
              @blur="onCodeBlur"
              @keydown="onCodeKeydown"
            />

            <p class="ed-hint">
              可用变量：<code>event</code>（指针载荷：type / name / point / distance / object）与
              <code>model</code>（配置快照，改它不影响场景）。失焦时保存，{{ codeSummary }}
            </p>
          </div>
        </div>

        <footer class="ed-modal-foot">
          <span class="ed-hint ed-hint--quiet">
            关闭后点击模型即可看到效果，代码的输出与报错都在浏览器控制台（F12）
          </span>
          <button type="button" class="ed-btn ed-btn--primary" @click="close">完成</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
