import type { DeepPartial, SceneConfig } from '../../src'

/**
 * 按 'camera.fov' 这样的路径读写嵌套对象。
 *
 * 属性面板是 schema 驱动的：字段声明里写的是路径字符串，
 * 而不是 getter/setter。读写集中在这里，schema 才能保持纯数据。
 *
 * 刻意不引入 lodash.get 之类的依赖——路径只有一层点号，
 * 而这个 playground 不打包 lodash，为了两行逻辑装一个依赖不划算。
 */

function segments(path: string): string[] {
  return path.split('.').filter(Boolean)
}

/** 按路径取值，中途遇到 null / 非对象时返回 undefined */
export function getPath<T = unknown>(source: unknown, path: string): T | undefined {
  let cursor = source

  for (const key of segments(path)) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }

  return cursor as T
}

/**
 * 按路径写值。
 *
 * 直接写 store 里的 reactive 对象即可——写入会自动进历史栈，
 * 面板不需要显式调用任何「记录变更」的方法。
 */
export function setPath<T extends object>(target: T, path: string, value: unknown): void {
  const keys = segments(path)
  if (keys.length === 0) return

  let cursor: Record<string, unknown> = target as unknown as Record<string, unknown>

  for (let index = 0; index < keys.length - 1; index += 1) {
    const next = cursor[keys[index]]
    if (typeof next !== 'object' || next === null) return
    cursor = next as Record<string, unknown>
  }

  cursor[keys[keys.length - 1]] = value
}

/** 场景配置的顶层分组名，用于「重置分组」这类操作 */
export type ConfigGroup = keyof SceneConfig

/**
 * 把某个顶层分组恢复成给定默认值。
 *
 * 逐字段赋值而不是整体替换：分组对象本身是 reactive 的，
 * 换掉引用会让已经绑定它的组件和 watch 全部失联。
 */
export function resetGroup<T extends object>(
  target: T,
  defaults: DeepPartial<T>,
  group: string,
): void {
  const current = getPath<Record<string, unknown>>(target, group)
  const source = getPath<Record<string, unknown>>(defaults, group)
  if (!current || !source) return

  for (const key of Object.keys(source)) {
    current[key] = source[key]
  }
}
