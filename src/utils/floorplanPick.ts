import type { Object3D } from 'three'
import type { FloorplanPickTarget } from '../types'

/**
 * 「这一块 three 物体属于哪面墙 / 哪个门窗」的**内部**登记簿。
 *
 * 与 `modelNodeRegistry.ts` 是同一个套路、同一个理由：墙与门窗的碎片是
 * `wallPieces()` 现算出来的一堆 mesh，画布级点选（`ScenePicker`）命中之后要
 * 沿 parent 往上查回「它是谁」。往 three 对象上写标记（`userData` / `name`）
 * 那条路的三个坑那边写得完整，这里只重复最要紧的一个：**贴面墙与洞口模型是
 * glb 克隆出来的**，克隆会原样带着资产自己的 `userData` 与 `name`，冲突起来
 * 不报错，只会选错。
 *
 * 键是 three 对象，所以条目随对象回收（WeakMap），不需要卸载时反登记。
 *
 * **它是内部模块，刻意不从 `index.ts` 导出**：宿主拿不到场景里的 three 对象，
 * 这份簿子对他们没有意义；而公开面只收「宿主自己也绕不过去」的东西。
 * 能被宿主用上的那一半（`pickTargetOfPiece` / `findPlanSelectionTarget`）在
 * `utils/floorplan.ts` 里，从公开入口出去。
 */

/** 点中之后往上抛的东西，与选中状态存的是同一种形状 */
export type FloorplanPickPayload = FloorplanPickTarget

const targets = new WeakMap<Object3D, FloorplanPickTarget>()

/**
 * 把一块 three 物体登记到某个墙 / 洞口上。
 *
 * 登记点必须覆盖**全部真实渲染路径**：灰墙盒子、贴面墙的每一块砖、贴面之外
 * 补画的框 / 玻璃 / 门扇、洞口模型（以及它装不上时退回的那批构件）。
 * 漏掉一处的表现是「那一块点不中」，不报错。
 *
 * 存一份**拷贝**而不是调用方传进来的对象：调用方给的多半是个 computed 的产物，
 * 直接存引用等于把一份会重算的数据钉进簿子里。
 */
export function registerFloorplanNode(object: Object3D, target: FloorplanPickTarget): void {
  targets.set(object, { kind: target.kind, id: target.id })
}

/**
 * 这个对象属于哪面墙 / 哪个洞口。
 *
 * 射线命中的永远是最深层的 mesh，所以要沿 parent 找到最近一个登记过的节点。
 * 返回值里带上 `group` 本身，让调用方在同一趟里读它的 `visible`——射线检测
 * 不看可见性，隐藏的对象照样会被命中（与 `modelNodeOf` 同一条约定）。
 *
 * 找不到返回 `undefined`：地面、网格、房间地面色块、草稿层与宿主插槽里的东西
 * 都走这一条。它们**刻意不登记**，于是对射线「透明」——被房间色块挡住的墙
 * 仍然点得中。代价也写进了设计决定 66：色块自己不能被点，这件事用户看不出来。
 */
export function floorplanNodeOf(
  object: Object3D | null,
): { target: FloorplanPickTarget; group: Object3D } | undefined {
  let node: Object3D | null = object

  while (node) {
    const target = targets.get(node)
    if (target) return { target, group: node }
    node = node.parent
  }

  return undefined
}
