import type { CameraConfig } from '../types'

/**
 * 「现在算 2D 俯视还是 3D 透视」——**从机位推导，没有独立的布尔量**。
 *
 * 这条规则原先住在编辑器的 `useViewMode.ts` 里，搬进库是因为**渲染层也要用它**：
 * 2D 档下墙要换成平面图的实色外观（见设计决定 34），而那条路在 `src/` 里。
 * 同一个判断有两份实现的话，光靠肉眼是发现不了它们什么时候开始不一致的——
 * 按钮亮着 2D、墙却是 3D 的贴面，看起来只是「渲染错了」。
 *
 * 留在库里的另一个好处：它是**纯函数**（吃一个 `CameraConfig`、吐一个字面量），
 * 于是能进 `scripts/smoke.mjs` 那唯一一条不依赖浏览器的验证链。
 * 编辑器那边的 `setViewMode`（切档、记/还原机位、收紧轨道控制权限）仍然是
 * 编辑器自己的事，不出现在这里。
 */
export type ViewMode = '2d' | '3d'

/**
 * 判定「算不算正俯视」的容差：视线与竖直方向的夹角小于 5° 就算。
 *
 * 取这个宽度而不是严格相等，是因为 OrbitControls 的 `spherical.makeSafe()`
 * 会把极角夹到 `[EPS, π-EPS]`——写进配置的正上方机位与活的相机差着
 * 1e-6 倍距离的横向偏移，严格相等会立刻掉档。
 *
 * 写成 `sin` 而不是角度：下面的判据比的是**水平偏移与距离之比**，
 * 那个比值的临界值正是 `sin(5°)`，于是这里和那里是同一个量，不用再换一次算。
 */
export const TOP_TOLERANCE = Math.sin((5 * Math.PI) / 180)

/**
 * 现在算哪一档。
 *
 * 收 `camera` 而不是在内部取 store：让调用方自己决定依赖谁——
 * `SceneStage` 拿它算一个 computed，`SceneContent` 也是。
 *
 * 三条判据缺一不可：
 *
 * 1. **机位与注视点重合时视线方向没有意义**（在面板里手填过就会遇到），
 *    一律算 3D——除以 0 会得到 `NaN`，而 `NaN < 容差` 是 `false`，
 *    恰好也落回 3D；但那是「碰巧对」，写出来才是「有意对」。
 * 2. **必须在注视点上方**：从下往上看是仰视，不是俯视。
 * 3. 水平偏移与距离之比小于容差。
 */
export function viewModeOf(camera: CameraConfig): ViewMode {
  const dx = camera.position[0] - camera.target[0]
  const dy = camera.position[1] - camera.target[1]
  const dz = camera.position[2] - camera.target[2]
  const length = Math.hypot(dx, dy, dz)

  if (length < 1e-6) return '3d'
  if (dy <= 0) return '3d'

  return Math.hypot(dx, dz) / length < TOP_TOLERANCE ? '2d' : '3d'
}
