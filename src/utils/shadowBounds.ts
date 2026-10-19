import type { FloorplanConfig, ModelConfig } from '../types'

/**
 * 主光阴影正交相机该盖多大、盖在哪儿。
 *
 * ## 为什么需要算，而不是写死一个半径
 *
 * 阴影贴图的覆盖范围就是那只正交相机的盒子：**盒子外面既不投影、也不接影**，
 * 而且完全不报错——盒子里的东西照常亮着，只是像没开阴影一样。
 * 早先这里写死 `±12`（24 × 24 米），小模型站在原点附近时一切正常，
 * 一到真实户型（一栋房子动辄四五十米）就只剩正中间那一小块有影子，
 * 其余模型**怎么调太阳高度、方位都不会出影子**。用户看到的正是这一条。
 *
 * 所以半径与圆心都得跟着场景内容走：
 *
 * - **圆心**取内容包围盒的中心，而不是原点——场景整体偏移到 x=100 时，
 *   贴着原点的盒子一个影子也罩不到。
 * - **半径**取包围盒对角线的一半（外接圆半径）。正交相机在光空间里是一个
 *   正方形，太阳转到任何方位，转着圈的包围盒都还在这个圆里；用 `max(半宽,
 *   半深)` 的话，太阳转到对角线方向就会把两个角切出去，表现是
 *   「影子方向一变，远处的模型又没影了」。
 *
 * ## 各条边界的来源
 *
 * - 地基：中心点 + 宽深
 * - 墙：中心线两端各外扩半个墙厚（墙是按中心线往两边长的）
 * - 房间：多边形所有顶点
 * - 模型：位置再外扩一个**按缩放估算**的足迹。这里拿不到 glTF 的真实包围盒
 *   （它要到加载完才存在，而阴影参数在加载前就得定下来），只能按缩放猜；
 *   猜小了只是模型的影子可能在边缘被切，不会把整张阴影贴图弄坏。
 *
 * 留一点余量：墙高几米，低太阳时影子会从包围盒边缘再伸出去一截。
 * 被切掉的只是「内容之外的空地」，不影响场景里的模型。
 */

/** 阴影正交相机的默认半径，与改造前写死的值一致：空场景与极小场景的行为不变 */
export const DEFAULT_SHADOW_HALF = 12

/** 内容之外再留的余量（米），给墙高与贴图边缘的软过渡 */
const SHADOW_PADDING = 2

/** 一个模型在包围盒里占的默认足迹（米），再乘上它自己的最大缩放 */
const MODEL_FOOTPRINT = 1.5

export interface ShadowBounds {
  /** 正交相机的圆心，世界坐标下的 `[x, z]`（地面上的点） */
  center: [number, number]
  /** 正交相机的半边长（米）。四个方向都是 ±half */
  half: number
}

/**
 * 场景里有没有值得罩住的东西。
 *
 * 用 `null` 表示「还没有」，而不是把所有值初始化成 ±Infinity 再自己判——
 * 后者在算中心点时会得到 `Infinity - Infinity`，那是 `NaN`，
 * 而 `NaN` 半径交给 three 不会报错，只会让整张阴影贴图凭空消失。
 */
interface Extent {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 一个模型在地面上占的足迹按「最大缩放 × 固定基数」估，旋转不影响外接圆 */
function footprintOf(model: ModelConfig): number {
  const scale = model.scale ?? [1, 1, 1]
  const largest = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]))
  return MODEL_FOOTPRINT * Math.max(largest, 1)
}

/**
 * 算一遍场景内容的包围盒，返回阴影正交相机该用的圆心与半径。
 *
 * 不依赖 three、不读 store：编辑器与宿主走的是同一份实现，
 * 也不会因为 SSR 下拿不到 WebGL 而变形。
 */
export function computeShadowBounds(
  floorplan: FloorplanConfig,
  models: ModelConfig[],
): ShadowBounds {
  const extent: Extent = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  let hasContent = false

  const include = (x: number, z: number) => {
    hasContent = true
    if (x < extent.minX) extent.minX = x
    if (x > extent.maxX) extent.maxX = x
    if (z < extent.minZ) extent.minZ = z
    if (z > extent.maxZ) extent.maxZ = z
  }

  const foundation = floorplan?.foundation
  if (foundation) {
    const halfWidth = Math.abs(foundation.width) / 2
    const halfDepth = Math.abs(foundation.depth) / 2
    include(foundation.x - halfWidth, foundation.z - halfDepth)
    include(foundation.x + halfWidth, foundation.z + halfDepth)
  }

  for (const wall of floorplan?.walls ?? []) {
    const halfThickness = Math.abs(wall.thickness) / 2
    include(wall.start[0] - halfThickness, wall.start[1] - halfThickness)
    include(wall.start[0] + halfThickness, wall.start[1] + halfThickness)
    include(wall.end[0] - halfThickness, wall.end[1] - halfThickness)
    include(wall.end[0] + halfThickness, wall.end[1] + halfThickness)
  }

  for (const room of floorplan?.rooms ?? []) {
    for (const point of room.polygon ?? []) include(point[0], point[1])
  }

  for (const model of models ?? []) {
    const radius = footprintOf(model)
    const [x, , z] = model.position
    include(x - radius, z - radius)
    include(x + radius, z + radius)
  }

  // 空场景：保持旧行为（±12 罩住原点附近可能出现的网格与零散物体）
  if (!hasContent) return { center: [0, 0], half: DEFAULT_SHADOW_HALF }

  const center: [number, number] = [
    (extent.minX + extent.maxX) / 2,
    (extent.minZ + extent.maxZ) / 2,
  ]
  const halfX = (extent.maxX - extent.minX) / 2
  const halfZ = (extent.maxZ - extent.minZ) / 2
  const radius = Math.hypot(halfX, halfZ) + SHADOW_PADDING

  return { center, half: Math.max(DEFAULT_SHADOW_HALF, radius) }
}
