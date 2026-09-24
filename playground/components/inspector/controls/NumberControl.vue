<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { clamp, format, snap } from '../../../utils/number'

defineOptions({ name: 'NumberControl' })

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    precision?: number
    disabled?: boolean
  }>(),
  { min: undefined, max: undefined, step: undefined, precision: undefined, disabled: false },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>()

/**
 * 聚焦期间用本地字符串，不与外部值同步。
 *
 * 否则输入「1.」的瞬间就会被 format 成「1」，小数点根本打不出来；
 * 输入「-」也是同理。失焦时再归一化。
 */
const focused = ref(false)
const draft = ref('')

const display = computed(() =>
  focused.value ? draft.value : format(props.modelValue, props.precision),
)

watch(
  () => props.modelValue,
  () => {
    if (!focused.value) draft.value = ''
  },
)

function onFocus() {
  focused.value = true
  draft.value = format(props.modelValue, props.precision)
}

function onInput(event: Event) {
  const text = (event.target as HTMLInputElement).value
  draft.value = text

  const parsed = Number(text)
  if (text.trim() === '' || !Number.isFinite(parsed)) return
  // 输入过程中只夹范围、不吸附步长，不然刚敲下「0.0」就被吸成「0」
  emit('update:modelValue', clamp(parsed, props.min, props.max))
}

function onBlur() {
  focused.value = false
  const parsed = Number(draft.value)
  if (draft.value.trim() !== '' && Number.isFinite(parsed)) {
    emit('update:modelValue', clamp(snap(parsed, props.step), props.min, props.max))
  }
  draft.value = ''
}

/** 上下键按步长微调；按住 Shift 走十步，长距离调整不必来回拖鼠标 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
    return
  }
  event.preventDefault()

  const step = (props.step ?? 1) * (event.shiftKey ? 10 : 1)
  const delta = event.key === 'ArrowUp' ? step : -step
  const next = clamp(snap(props.modelValue + delta, props.step), props.min, props.max)

  draft.value = format(next, props.precision)
  emit('update:modelValue', next)
}
</script>

<template>
  <input
    class="ed-num"
    type="text"
    inputmode="decimal"
    spellcheck="false"
    :disabled="disabled"
    :value="display"
    @focus="onFocus"
    @input="onInput"
    @blur="onBlur"
    @keydown="onKeydown"
  />
</template>
