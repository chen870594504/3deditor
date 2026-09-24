<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { clamp, snap } from '../../../utils/number'

defineOptions({ name: 'SliderControl' })

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    /** 双击回落到这个值，通常是配置里的默认值 */
    defaultValue?: number
    disabled?: boolean
  }>(),
  { min: 0, max: 1, step: undefined, defaultValue: undefined, disabled: false },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>()

const rootRef = useTemplateRef<HTMLElement>('root')
const dragging = ref(false)

/** 0–1 的归一化位置。min === max 时直接归零，避免除零得到 NaN */
const ratio = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return clamp((props.modelValue - props.min) / span, 0, 1)
})

const percent = computed(() => `${(ratio.value * 100).toFixed(2)}%`)

/**
 * 按指针横坐标取值。
 *
 * 用 getBoundingClientRect 而不是 offsetX：指针捕获后 offsetX 的参照系
 * 会跟着事件目标变化，拖出控件范围时会跳。
 */
function valueFromEvent(event: PointerEvent) {
  const element = rootRef.value
  if (!element) return props.modelValue

  const rect = element.getBoundingClientRect()
  if (rect.width === 0) return props.modelValue

  const position = clamp((event.clientX - rect.left) / rect.width, 0, 1)
  return clamp(snap(props.min + position * (props.max - props.min), props.step), props.min, props.max)
}

function onPointerdown(event: PointerEvent) {
  if (props.disabled || event.button !== 0) return
  dragging.value = true
  // 捕获指针，这样拖出这个 22px 高的行之后依然收得到 pointermove
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  emit('update:modelValue', valueFromEvent(event))
}

function onPointermove(event: PointerEvent) {
  if (!dragging.value) return
  emit('update:modelValue', valueFromEvent(event))
}

function onPointerup(event: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

/** 双击回默认值——比拖回原位快得多，也是这个面板里唯一能「撤销」单次拖动的手势 */
function onDblclick() {
  if (props.disabled || props.defaultValue === undefined) return
  emit('update:modelValue', props.defaultValue)
}
</script>

<template>
  <div
    ref="root"
    class="ed-slider"
    :class="{ 'ed-slider--active': dragging }"
    @pointerdown="onPointerdown"
    @pointermove="onPointermove"
    @pointerup="onPointerup"
    @pointercancel="onPointerup"
    @dblclick="onDblclick"
  >
    <div class="ed-slider-track">
      <div class="ed-slider-fill" :style="{ width: percent }" />
      <div class="ed-slider-thumb" :style="{ left: percent }" />
    </div>
  </div>
</template>
