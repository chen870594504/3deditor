<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useSceneStore } from '../../../src'
import { getPath, setPath } from '../../utils/path'
import { defaultFor, INSPECTOR_ACTIONS, resolvePath } from '../../composables/useInspectorSchema'
import type { FieldDef } from '../../composables/useInspectorSchema'
import ColorControl from './controls/ColorControl.vue'
import NumberControl from './controls/NumberControl.vue'
import SelectControl from './controls/SelectControl.vue'
import SliderControl from './controls/SliderControl.vue'
import TextControl from './controls/TextControl.vue'
import ToggleControl from './controls/ToggleControl.vue'
import VectorControl from './controls/VectorControl.vue'

defineOptions({ name: 'InspectorField' })

const props = defineProps<{ field: FieldDef }>()

const scene = useSceneStore()

/**
 * 字段的当前值。
 *
 * 控件层不认识 store，只收发 modelValue——「值从哪来、写到哪去」
 * 全部收在这个文件里。所以换一种控件不必碰 store，加一个配置项也不必碰控件。
 *
 * `resolvePath` 要么返回写死的字符串、要么去读 store 里当前选中的模型下标。
 * 两种情况下这个 computed 都追得到依赖，所以在列表里点一下换模型，
 * 下面每一行都会自己重算——不需要任何「切换时刷新一下字段」的代码。
 */
const value = computed<unknown>(() =>
  props.field.read ? props.field.read() : getPath(scene.config, resolvePath(props.field.path)),
)

/** 双击回默认值要落到哪个值上；没有 path 的字段（如「事件绑定」）没有默认值可回 */
const defaultValue = computed(() =>
  props.field.path ? (defaultFor(resolvePath(props.field.path)) as number | undefined) : undefined,
)

const visible = computed(() => props.field.when?.(scene.config) ?? true)
const dimmed = computed(() => props.field.dim?.(scene.config) ?? false)

/**
 * 写入路径分两条：schema 给了 `apply` 就用它，否则落到 `path` 指向的字段。
 *
 * `apply` 存在的意义是那些「不能只写自己」的字段——
 * 角度要做度转弧度，minDistance 要顺带把 maxDistance 抬上去。
 */
function write(next: unknown) {
  // 只读字段可能连 path 都没有，写进去只会凭空多出一条历史记录
  if (props.field.readonly) return

  if (props.field.apply) props.field.apply(next)
  else if (props.field.path) setPath(scene.config, resolvePath(props.field.path), next)
  else return

  pulse()
}

function runAction() {
  if (!props.field.action) return
  INSPECTOR_ACTIONS[props.field.action]?.()
}

/**
 * 改动落地时整行亮一下。
 *
 * 这是编辑器里唯一的即时反馈：配置写进场景之后，画面上的变化可能很细微
 * 或者要等一帧，但这一下高亮会立刻告诉你「输入被吃进去了」。
 */
const pulsing = ref(false)
let pulseTimer: ReturnType<typeof setTimeout> | null = null

function pulse() {
  pulsing.value = true
  if (pulseTimer) clearTimeout(pulseTimer)
  pulseTimer = setTimeout(() => {
    pulsing.value = false
  }, 320)
}

onUnmounted(() => {
  if (pulseTimer) clearTimeout(pulseTimer)
})
</script>

<template>
  <template v-if="visible">
    <!-- 纯说明行：不绑任何配置，只解释上面那组字段为什么长这样 -->
    <p v-if="field.type === 'note'" class="ed-hint ed-hint--quiet">{{ field.hint }}</p>

    <!-- 按钮行：动作名交给 schema 里登记的实现，这里只负责渲染 -->
    <button
      v-else-if="field.type === 'action'"
      type="button"
      class="ed-btn ed-btn--block"
      @click="runAction"
    >
      {{ field.label }}
    </button>

    <!--
      字段行是两段式：`.ed-field` 三列网格 + 下方可选的说明。
      根节点因此是 Fragment——父级 .ed-sec-body 是普通块容器，多根不影响布局，
      换成包一层 div 只会让每行多一个无语义的层级。
    -->
    <template v-else>
      <div class="ed-field" :class="{ 'ed-field--dim': dimmed, 'ed-field--pulse': pulsing }">
        <label class="ed-field-label">{{ field.label }}</label>

        <!--
          每种类型显式一个分支，不用 <component :is> 动态分发。
          动态组件的 props 在 vue-tsc 下是所有候选控件的并集，
          而各控件需要的 prop 本来就不同，只能靠 v-bind 一个 `Record<string, unknown>`
          糊过去，等于把这一层的类型检查全部关掉。
        -->

        <!--
          弹窗入口。与上面的 action 走同一个 runAction，不额外 pulse：
          弹窗本身开了就是反馈，再让这一行亮一下反而像「点错了」。
        -->
        <button
          v-if="field.type === 'dialog'"
          type="button"
          class="ed-btn ed-btn--block"
          :disabled="dimmed"
          @click="runAction"
        >
          {{ field.label }}
        </button>
        <TextControl
          v-else-if="field.type === 'text'"
          :model-value="value as string"
          :placeholder="field.placeholder"
          :readonly="field.readonly"
          :disabled="dimmed"
          @update:model-value="write"
        />
        <ToggleControl
          v-else-if="field.type === 'toggle'"
          :model-value="value as boolean"
          :disabled="dimmed"
          @update:model-value="write"
        />
        <ColorControl
          v-else-if="field.type === 'color'"
          :model-value="value as string"
          :disabled="dimmed"
          @update:model-value="write"
        />
        <SelectControl
          v-else-if="field.type === 'select'"
          :model-value="value as string | number"
          :options="field.options ?? []"
          :disabled="dimmed"
          @update:model-value="write"
        />
        <VectorControl
          v-else-if="field.type === 'vector'"
          :model-value="value as [number, number, number]"
          :step="field.step"
          :precision="field.precision"
          :disabled="dimmed"
          @update:model-value="write"
        />
        <NumberControl
          v-else-if="field.type === 'number'"
          :model-value="value as number"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :precision="field.precision"
          :disabled="dimmed"
          @update:model-value="write"
        />
        <SliderControl
          v-else-if="field.type === 'slider'"
          :model-value="value as number"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :default-value="defaultValue"
          :disabled="dimmed"
          @update:model-value="write"
        />

        <!-- 滑块自己只有一根轨道，可编辑的读数与单位放在第 3 列 -->
        <span v-if="field.type === 'slider'" class="ed-field-tail">
          <NumberControl
            :model-value="value as number"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :precision="field.precision"
            :disabled="dimmed"
            @update:model-value="write"
          />
          <span v-if="field.unit" class="ed-field-unit">{{ field.unit }}</span>
        </span>
        <!-- 弹窗入口的读数（例如「2/5」）：第 2 列是按钮，读数落在第 3 列与它对齐 -->
        <span v-else-if="field.type === 'dialog'" class="ed-field-value">{{ value }}</span>
        <!-- 三元组自己占了整条可伸缩列，单位单独放进第 3 列，与滑块读数对齐 -->
        <span v-else-if="field.type === 'vector' && field.unit" class="ed-field-unit">
          {{ field.unit }}
        </span>
      </div>

      <p v-if="field.hint" class="ed-hint">{{ field.hint }}</p>
    </template>
  </template>
</template>
