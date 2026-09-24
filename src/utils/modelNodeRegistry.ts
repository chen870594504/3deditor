import type { Object3D } from 'three'

/**
 * 「这个 three 对象属于哪个模型」的**内部**登记簿。
 *
 * `SceneModelNode` 在挂载时把包裹组登记进来，`ScenePicker` 在射线命中之后
 * 沿 parent 往上查回去——画布上点一下要选中哪个模型，靠的就是这份对应关系。
 *
 * 为什么不往 three 对象上写标记（`userData` 或 `name`）：
 *
 * 1. `name` 是 three 的**功能性**字段，`getObjectByName` 靠它查找，宿主也在用它。
 *    往上面编码身份等于和所有人生抢同一个命名空间。
 * 2. `userData` 会被 `Object3D.toJSON()` 原样序列化进宿主导出的资产里
 *    （`Object3D.js` 的 `toJSON` 里那段 userData 拷贝）。这份标记纯属库的内部
 *    约定，不该出现在宿主的产物里，更不该变成一个「看起来能用」的公开契约。
 * 3. 用登记簿还顺带堵掉一个口子：宿主通过 `#scene` 插槽塞进来的任何对象都
 *    伪造不了身份——簿子里只可能有 `SceneModelNode` 写进去的东西。
 *
 * 键是 three 对象，所以对象被回收时条目跟着消失，不需要手动清理，
 * 也不需要在组件卸载时补一次「反登记」。
 */
const owners = new WeakMap<Object3D, string>()

/** 把包裹组登记到某个模型 id 上。只由 `SceneModelNode` 调用。 */
export function registerModelNode(object: Object3D, id: string): void {
  owners.set(object, id)
}

/**
 * 这个对象属于哪个模型。
 *
 * 射线命中的永远是子树里的某个 mesh（`intersection.object` 的语义就是最深层网格），
 * 所以要沿 parent 往上找到最近的、登记过的那一个。
 *
 * 返回值里带上 `group` 本身，是为了让调用方在同一趟里就能读它的 `visible`——
 * 射线检测不看 `visible`，隐藏的模型照样会被命中，调用方必须自己过滤，
 * 再走一遍父链只为拿同一个对象没有意义。
 *
 * 找不到返回 `undefined`：地面、网格辅助线、宿主塞进 `#scene` 的东西都走这条路，
 * 调用方据此判断「点到的不是模型」。
 */
export function modelNodeOf(object: Object3D | null): { id: string; group: Object3D } | undefined {
  let node: Object3D | null = object

  while (node) {
    const id = owners.get(node)
    if (id !== undefined) return { id, group: node }
    node = node.parent
  }

  return undefined
}
