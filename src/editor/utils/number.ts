/**
 * 数值控件共用的三个纯函数。
 *
 * 单独放一处是因为它们必须完全一致：滑块写入的值要经过 snap，
 * 输入框回显时要经过 format，两者对「0.1 + 0.2」的处理若不同，
 * 就会出现「拖完滑块数字自己变一位」这种最让人不信任的 bug。
 */

/** 把值夹到 [min, max]；min / max 为 undefined 时该侧不限制 */
export function clamp(value: number, min?: number, max?: number): number {
  let result = value
  if (min !== undefined && result < min) result = min
  if (max !== undefined && result > max) result = max
  return result
}

/**
 * 按步长吸附，并消掉浮点误差。
 *
 * `0.1 * 3 = 0.30000000000000004`，直接显示会撑破输入框。
 * 这里按 step 的小数位数定精度，而不是一律保留固定位数——
 * step 为 0.005 时保留 2 位会把 0.005 吸成 0.01，滑块直接卡死不动。
 */
export function snap(value: number, step?: number): number {
  if (!step || step <= 0) return value
  const snapped = Math.round(value / step) * step
  const decimals = step < 1 ? `${step}`.split('.')[1]?.length ?? 0 : 0
  return Number(snapped.toFixed(Math.min(decimals + 1, 8)))
}

/** 显示用格式化；precision 未给时原样输出 */
export function format(value: number, precision?: number): string {
  return precision === undefined ? String(value) : value.toFixed(precision)
}
