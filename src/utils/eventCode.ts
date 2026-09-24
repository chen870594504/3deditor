import type { DeepPartial, ModelEventHandler, ModelEventType } from '../types'

/**
 * 5 类指针事件，顺序即界面上的展示顺序。
 *
 * 这里用 `as const` 元组而不是 `Object.keys(MODEL_EVENT_LABELS)`：
 * 元组的顺序是写死的、可被类型系统看住的，而对象的键顺序在任何人看来都不是契约。
 * 同时它也是 `Record<ModelEventType, …>` 的穷尽性检查来源之一——
 * 漏掉一个类型时类型检查会先报错。
 */
export const MODEL_EVENT_TYPES = [
  'click',
  'dblclick',
  'pointerenter',
  'pointerleave',
  'contextmenu',
] as const

/**
 * 事件的中文名。
 *
 * 中文文案进了库而不是留在编辑器里，是被 `defaultEventCode` 逼的：
 * 默认模板要产出 `console.log('单击', event, model)`，那句中文必须由库给出，
 * 否则编辑器得自己再维护一份「类型 → 中文」的映射，两份迟早对不上。
 *
 * 先例是 `config.ts` 里的 `GROUP_LABELS`。
 * 代价是这个映射会作为公开 API 进入发布物，改文案等于改 API。
 */
export const MODEL_EVENT_LABELS: Record<ModelEventType, string> = {
  click: '单击',
  dblclick: '双击',
  pointerenter: '鼠标经过',
  pointerleave: '鼠标移出',
  contextmenu: '右击',
}

/**
 * 某类事件的默认脚本。
 *
 * 参数固定是 `event` 与 `model`（README 里的宿主示例同样按这两个名字注入）。
 * 写成一个纯函数而不是常量表，是为了让「默认内容与事件类型对得上」
 * 这件事由代码保证：改标签时不会漏改某个模板。
 */
export function defaultEventCode(type: ModelEventType): string {
  return `console.log('${MODEL_EVENT_LABELS[type]}', event, model)`
}

/**
 * 取出已启用的事件类型。
 *
 * 这是**唯一**的门控谓词，三个消费者共用：画布内挂监听器的挂载表、
 * HUD 的 `n/5` 读数、面板按钮的读数。三处若各写各的判断，
 * 迟早出现「HUD 说 1/5 但点了没反应」这类对不上的状态。
 *
 * 参数只要求 `events` 这一部分，而且整棵链路上每一层都可省略：
 * 这里的调用方既有完整的 `ModelConfig`，也有刚从文件里读出来、
 * 还没落进配置的半成品。收窄成 `ModelConfig` 的话后者就得靠断言硬塞，
 * 而它读到的无非是一堆 `undefined`——类型上不假装等价，两边都省事。
 *
 * 容错也不是可选项：这个函数是在 watch 的 getter 里被调用的，
 * 在那里抛异常会直接炸掉整次渲染。
 *
 * 返回值每次都是新数组，只能立即消费（例如 `.join(',')`），**不能当 ref 的值存**——
 * 每次都变会让 watch 永远触发。
 */
export function activeEventTypes(model: {
  events?: DeepPartial<Record<ModelEventType, ModelEventHandler>>
}): ModelEventType[] {
  return MODEL_EVENT_TYPES.filter((type) => model.events?.[type]?.enabled === true)
}
