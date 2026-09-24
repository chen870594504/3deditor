import type {
  FloorplanOpening,
  FloorplanPoint,
  FloorplanWall,
} from '../types'
import { createModelId } from './modelId'

/**
 * 户型图的**纯数学**：几何切分、命中判定、区域识别。
 *
 * 刻意**不 import three**（与 `config.ts` / `pointerClick.ts` 同一条约定）：
 * 这里的每个函数都只吃数字、吐数字，所以 `scripts/smoke.mjs` 能在 Node 里
 * 直接跑它们，不需要 WebGL 上下文。渲染那一半在
 * `components/SceneFloorplan*.vue` 里，它只负责把这里产出的描述数据摆进模板。
 *
 * 参考项目把这两半混在一起（`sceneRenderer.js` 里一边切段一边 `new THREE.Mesh`），
 * 于是任何一个几何规则都测不了，只能靠肉眼看。这条分界线是移植时最主要的一处改动。
 */

/**
 * 默认墙高，米。
 *
 * 它是**这套编辑器的默认值**，不是一条物理常数：住宅层高去掉楼板厚度是 2.8 左右，
 * 而这个项目画的是层高 3.9 的房子，所以默认值取 3.9。**改这一个数**就够——
 * 它是「一面墙都没有时，第一面新墙多高」的唯一来源（见 `useFloorplanTool.ts` 里
 * `pushWall` 那一段），之后所有新墙都沿用已有墙的取值，面板上那个「墙高」
 * （`useInspectorSchema.ts`）改的也是同一处真相。
 *
 * 往上加会连带影响两处，都不是错、但第一次看见会以为出问题了：
 *
 * ① **过梁变高**。门窗洞口本身是绝对尺寸（门恒为 2.1 米），所以墙越高，
 *    洞上那根过梁（`height - 洞高`）越长、窗下的矮墙也越高。
 * ② **墙皮竖向被拉伸**。墙面资产是按段高拉伸的（`wallFaceTiles` 的 `sy`），
 *    一件照 2.8 米建的墙板铺在 3.9 米的墙上会被拉 1.39 倍——砖会变成长方形。
 *    想让它一比一，把资产也改成 3.9 米高（README 的资产要求里有这一条）。
 */
export const DEFAULT_WALL_HEIGHT = 3.9

/**
 * 默认墙厚，米。
 *
 * 0.18 是 240 砖墙抹灰后的常见厚度，也是参考项目的取值。它同时是
 * 门窗框、玻璃、门扇那一堆微小厚度的参照系，改它会连带影响它们的观感。
 */
export const DEFAULT_WALL_THICKNESS = 0.18

/** 门洞默认宽高，米 */
export const DOOR_WIDTH = 0.9
export const DOOR_HEIGHT = 2.1

/** 窗洞默认宽高与窗台高，米 */
export const WINDOW_WIDTH = 1.2
export const WINDOW_HEIGHT = 1.2
export const WINDOW_SILL = 0.9

/** 地基板厚，米 */
export const FOUNDATION_THICKNESS = 0.12

/**
 * 短于这个长度的片段直接丢弃，米。
 *
 * 5 毫米。用这么小的值是因为它的职责只是拦住「浮点误差算出 1e-17 宽的盒子」
 * 这种退化情况——几何体重建的开销在几十面墙的规模上可以忽略，
 * 但一个宽高为 0 的 `BoxGeometry` 会在 three 内部产生 NaN 法线，
 * 表现出来是一块闪烁的黑面。刻意不设成「小于 1 厘米的墙就不画」那种产品规则：
 * 用户画了多短的墙是他的事，我们只负责别把数学搞崩。
 */
const MIN_SEGMENT = 0.005

/** 门窗框条的截面尺寸（沿墙方向 × 垂直墙面方向），米 */
const FRAME_BAR = 0.06
const FRAME_DEPTH_RATIO = 1.6
/** 玻璃与门扇的厚度，米 */
const GLASS_THICKNESS = 0.02
const LEAF_THICKNESS = 0.045
/**
 * 洞口两端的边距：门窗不能压到墙角上，米。
 *
 * 导出给编辑器用：放置门窗时要拿它算「这面墙够不够长」，
 * 而这里切段时也要保证洞口不贴到段端。两处必须是同一个数——
 * 分开写死的话会出现「工具说放得下、渲染出来却是一段负长度的墙」。
 */
export const OPENING_EDGE_GAP = 0.1
/** 超过这个宽度的窗加一根中竖梃，米。照参考项目 */
const MULLION_FROM_WIDTH = 1.05

/**
 * 生成一个户型图对象的 id。
 *
 * 直接复用 `createModelId`：它的函数名带着 "Model" 是历史原因
 * （见那个文件自己的注释），实现就是一个通用的 v4 uuid——
 * 本地随机值回退、安全上下文判断那两条都在里面，没必要抄第二遍。
 */
export function createFloorplanId(): string {
  return createModelId()
}

/** 墙中心线的长度，米 */
export function wallLength(wall: Pick<FloorplanWall, 'start' | 'end'>): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

/**
 * 沿墙中心线从 `start` 量出去 `offset` 米的那一点，`[x, z]`。
 *
 * 超过墙长也不夹：调用方要的就是「沿这条线量」，夹取是各自的事
 * （放置门窗时夹、切段时不需要）。
 */
export function pointAlongWall(
  wall: Pick<FloorplanWall, 'start' | 'end'>,
  offset: number,
): FloorplanPoint {
  const length = wallLength(wall)
  // 零长墙没有方向可言，退回起点而不是产生 NaN
  if (length < 1e-9) return [...wall.start] as FloorplanPoint

  const ratio = offset / length
  return [
    wall.start[0] + (wall.end[0] - wall.start[0]) * ratio,
    wall.start[1] + (wall.end[1] - wall.start[1]) * ratio,
  ]
}

/**
 * 墙盒子的绕 y 轴旋转角，弧度。
 *
 * 取负是因为 three 的 y 轴旋转在 (x, z) 平面上是**逆时针看下去为正**，
 * 而这里的角度是从 +x 轴量向 +z 的。参考项目也是这个负号（`-Math.atan2(dz, dx)`）。
 * 写成函数而不是各处内联，是因为它同时被墙段、门窗框、玻璃、门扇用到——
 * 这四个只要有一个符号反了，门窗就会横着插进墙里。
 */
export function wallRotationY(wall: Pick<FloorplanWall, 'start' | 'end'>): number {
  return -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
}

/**
 * 盒子在模板里要用的材质类别。
 *
 * 组件按这个选材质，而不是在模板里判断 `key` 的前缀——那样每加一种构件
 * 都要动模板逻辑，而这只是一张查表。
 */
export type FloorplanPieceRole = 'wall' | 'frame' | 'glass' | 'leaf' | 'slab'

/**
 * 一个可以直接摆进模板的盒子。
 *
 * `position` / `size` / `rotationY` 三样齐备，**组件里不做任何算术**：
 * 它们是同一个 `computed` 的产物，所以两次渲染之间引用恒定，
 * TresJS 不会因为「模板表达式又造了个新数组」而反复重建几何体
 * （`SceneGround.vue:54-60` 的注释是这条约定的出处）。
 */
export interface FloorplanPiece {
  /** 稳定的 v-for key */
  key: string
  /** 盒子中心的**世界坐标** */
  position: [number, number, number]
  rotationY: number
  /** [沿墙长, 竖直高, 垂直墙厚] */
  size: [number, number, number]
  role: FloorplanPieceRole
  /**
   * 这一片是**哪个洞口的构件**（框条 / 中竖梃 / 玻璃 / 门扇），墙段没有它。
   *
   * 有它才能把「某个洞口的那一套内饰件」整套认出来（`dropOpeningFills`）：
   * 那些碎片与洞口的联系只有 `key` 里拼的那个 id，而按字符串前缀认是**猜**，
   * 换个拼法就静默失效。`-below` / `-above` 这两块补墙**刻意不带它**——
   * 它们是墙，洞口换成模型之后仍然要留在那儿把洞口的上下补平。
   */
  openingId?: string
}

/** 造一个盒子；退化到没有体积时返回 null（调用方 filter 掉） */
function makePiece(
  key: string,
  wall: Pick<FloorplanWall, 'start' | 'end'>,
  rotationY: number,
  role: FloorplanPieceRole,
  from: number,
  to: number,
  y0: number,
  y1: number,
  depth: number,
  /**
   * 只有**洞口自己的构件**才传（见 `FloorplanPiece.openingId`）。
   * 沿墙的实心段与洞口上下的补墙都不传，它们属于墙本身。
   */
  openingId?: string,
): FloorplanPiece | null {
  const along = to - from
  const up = y1 - y0
  if (along < MIN_SEGMENT || up < MIN_SEGMENT || depth < MIN_SEGMENT) return null

  /*
   * 世界坐标一次算出来，不留一层 Group 再靠子物体的局部偏移补
   * （参考项目的 `createWallSegment` 是「组摆中点 + 盒子抬高 h/2」两层）。
   * 两处偏移合起来就是：中心 = (段中点, 竖直中点)。
   */
  const [cx, cz] = pointAlongWall(wall, (from + to) / 2)
  return {
    key,
    role,
    rotationY,
    position: [cx, (y0 + y1) / 2, cz],
    size: [along, up, depth],
    // 条件展开而不是 `openingId` 直接写：墙段那三个调用点不传它，
    // 而「有键无值」与「没有键」在别处是按 `Object.keys` 比出来的
    // （`FloorplanWall.url` 那段注释讲的是同一个坑）
    ...(openingId ? { openingId } : {}),
  }
}

/** 洞口沿墙归一化之后的区间与竖直范围 */
interface PlacedOpening {
  opening: FloorplanOpening
  /** 沿墙中心线，从 start 量起 */
  from: number
  to: number
  /** 洞口下沿与上沿（世界 y） */
  bottom: number
  top: number
}

/**
 * 把这面墙上的洞口归一化成「沿墙区间 + 竖直范围」，并**裁掉互相重叠的部分**。
 *
 * 裁重叠这一步参考项目没有：它靠「新增洞口时拒绝重叠」来维持不重叠，
 * 一旦配置是从别处导入的（手写 JSON、旧版本文件）就会切出**负长度**的盒子。
 * 负长度的 `BoxGeometry` 不会报错，只会变成一块法线翻转的黑面——
 * 所以这里宁可多写几行。
 */
function placeOpenings(
  wall: FloorplanWall,
  openings: readonly FloorplanOpening[],
): PlacedOpening[] {
  const length = wallLength(wall)
  if (length < MIN_SEGMENT) return []

  const raw: PlacedOpening[] = []

  for (const opening of openings) {
    const half = opening.width / 2
    // 夹进 [0, length]：洞口不能探出墙的两端
    const from = Math.max(0, Math.min(opening.offset - half, length))
    const to = Math.max(0, Math.min(opening.offset + half, length))
    if (to - from < MIN_SEGMENT) continue

    /*
     * 竖直范围的两个夹取都是必要的：
     * 洞口的「下沿」是窗台高，「上沿」还要再夹一次墙高——
     * 一扇 1.2 高、0.9 窗台高的窗装在 2 米高的墙上时，
     * 上沿会是 min(2.1, 2.0) = 2.0，于是它上面的墙段高度为 0、被丢掉，
     * 而不是算出一个 -0.1 高的盒子。
     */
    const bottom = Math.max(0, Math.min(opening.sillHeight, wall.height))
    const top = Math.max(bottom, Math.min(opening.sillHeight + opening.height, wall.height))

    raw.push({ opening, from, to, bottom, top })
  }

  raw.sort((a, b) => a.from - b.from)

  // 逐个裁掉与前者重叠的部分；裁完还不够长的直接丢
  const placed: PlacedOpening[] = []
  let cursor = 0
  for (const item of raw) {
    const from = Math.max(item.from, cursor)
    if (item.to - from < MIN_SEGMENT) continue
    placed.push({ ...item, from })
    cursor = item.to
  }

  return placed
}

// ---------------------------------------------------------------------------
// 洞口的落点规则：磁吸邻边、空档夹取
// ---------------------------------------------------------------------------

/**
 * 浮点噪声的门槛，米。
 *
 * 用在两处作差的地方（判重叠、判落点在不在空档里）。**不能写成严格小于**：
 * 磁吸给出的贴齐位置本身就是「邻居 offset ± 两个半宽之和」算出来的，
 * 再拿同一个和去减一遍，最后一位可能差一点（`0.45 + 0.45` 加出来是
 * 0.9000000000000001 那种），严格小于会把磁吸**自己刚算出来的位置**拒掉——
 * 用户看到的是「瞄着边线点一下，它说此处已有门窗」。
 *
 * 1e-9 米是纳米量级，任何肉眼或工程意义上的差别都比它大十亿倍，
 * 它唯一的作用就是把这最后一两位抖掉。
 */
const OFFSET_EPS = 1e-9

/**
 * 门窗的**磁吸半径**，米。
 *
 * 「与相邻洞口边缘贴齐」（两洞之间一段墙都不剩）这个落点，靠 1 米格是够不着的：
 * 贴齐位置是 `邻居 offset ± 两洞半宽之和`，两个 2.5 米宽的窗挨着放时那落在
 * 3.5 米这种**半米上**的位置上，而格点只在整米上。所以要有第二个吸附源。
 *
 * 必须**严格小于半格**（1 米）：半径够到半格之外的话，磁吸会在两格的正中间
 * 把光标从它本来要落的那一格抢走，于是「整米吸附」这件事在洞口附近整个失效。
 * 0.35 与画墙吸附端点用的 0.4 是同一种「比半格紧一点」的取舍。
 *
 * 它不导出（改这个数要连着 README 那段说明一起改），但它是
 * `openingMagnetOffset` 的**默认参数**而不是写死在函数体里——
 * 冒烟要拿它当门槛验，写死之后测试只能把那个字面量再抄一遍。
 */
const OPENING_MAGNET = 0.35

/** 沿墙的一个闭区间（洞口中心能落在哪），米 */
export interface OpeningGap {
  from: number
  to: number
}

/**
 * 想放的位置附近有没有「与某个邻居贴齐」的落点；有就给那个位置，没有给 `null`。
 *
 * 候选位置是每个邻居的 `offset ± (邻居半宽 + 自己半宽)`——**两边都算**，
 * 而不是按「邻居在左还是在右」只取一侧：左右只是两个 offset 比大小，
 * 判错了会得到「只有从左边靠过去才吸得上」这种一半不好使的手感，而且不报错。
 *
 * ## `others` **不含被移动 / 被放置的那个洞口自己**
 *
 * 参数名叫 `others` 而不是 `siblings` 就是为了这一条：调用方手里那一份
 * `floorplan.openings` 是**全量**的，这里按「邻居」用它，谁用谁滤。
 * 把自己算进去的后果不是报错，而是**离原位一个洞宽的地方发黏**
 * （把自己当邻居，贴齐位置正好是它现在待的地方）——拖起来像有道看不见的坎。
 *
 * ## 输入必须是**未吸格**的那个落点
 *
 * 这一条是拿 2.5 米的窗算出来的，放置那条路上很容易踩：`groundPointOf` 先把光标
 * 吸到 1 米格上，于是 `hit.offset` 永远是**整数米**，而贴齐位置常常落在半米上
 * ——2.5 米的窗对 2.5 米的窗是 `1.0 + 2.5 = 3.5`，离最近的整数差 **0.5 米，
 * 比半径 0.35 还大**。拿吸过格的点当输入，磁吸对这两扇窗**永远不触发**，
 * 而用户瞄的正是那个半米位置（他按「洞口落在点击处」这个既有手感点的就是它）。
 * 所以 `placeOpeningAt` 多收一个未吸格的参数、**只喂给这里**；落点本身仍取格点，
 * 不磁吸时画出来的东西与改造前一模一样。
 *
 * ## 命中给数、没命中给 `null`，**不在这里退回落点**
 *
 * `null` 的意思是「附近没有可贴齐的地方，按你原来打算的落点放」。
 * 不返回兜底值，是因为调用方那侧的落点有两种来源（放置走 1 米格点、
 * 拖动走整米步进），**格子的取整在调用方**：这里替它取一次整，
 * 就成了两次取整，而两次取整在非整米的墙起点上不是恒等变换
 * （见 `resolveOpeningDrag`）。
 *
 * 两边同时命中时取**绝对值最近的**；并列（正负各一、距离相同）取**较小的
 * offset**。必须是确定性规则，否则同一个光标位置在不同顺序的 `openings` 上
 * 可能吸到两个地方，而冒烟也没有稳定的东西可断言。
 */
export function openingMagnetOffset(
  wanted: number,
  width: number,
  others: readonly FloorplanOpening[],
  tolerance = OPENING_MAGNET,
): number | null {
  const half = width / 2
  let best: number | null = null

  for (const other of others) {
    for (const edge of [-1, 1]) {
      const candidate = other.offset + edge * (other.width / 2 + half)
      if (Math.abs(candidate - wanted) > tolerance) continue

      if (best === null) {
        best = candidate
        continue
      }

      const distance = Math.abs(candidate - wanted)
      const current = Math.abs(best - wanted)
      // 最近的优先；并列取较小的那一个（左 / 上方优先），确定性规则
      if (distance < current || (distance === current && candidate < best)) best = candidate
    }
  }

  return best
}

/**
 * 这个洞口此刻所处的**空档**：左右邻居夹出来的自由范围（洞口中心能落在哪）。
 *
 * 拖动开始那一刻算一次，**整场拖动都用它**（不逐帧重算）：逐帧重算的话，
 * 拖到别人边上、空档当场变窄，被夹住的窗口会一跳一跳；更糟的是拖动中间态
 * 每次都写进配置，凭空缩水的那部分区间**再也回不去**了。
 *
 * ## 边界只由邻居给，**两端不缩 `OPENING_EDGE_GAP`**
 *
 * 这一条是拿一个死角换来的，别改回去。墙的两端确实有边距（门窗不该压在墙角上），
 * 但那是**放置**那条路的规则，而且它在放置那条路上只用来判「这面墙够不够长」——
 * `placeOpeningAt` **不夹 `offset`**。于是「3 米的墙上、offset 1.0、宽 2.5 米的窗」
 * 是一个合法状态（洞口两侧各探出 0.25 米，渲染端会把它裁回墙内）。
 *
 * 这里若按边距夹，上面那扇窗落点就**不在空档里**，本函数返回 `null`、
 * 调用方拒绝拖动——表现是「这扇窗挪不动」，而它明明是正常放上去的。
 * 两头对同一个规则一个松一个紧，就是这个结果。
 *
 * 所以 `from` / `to` 的初值就是墙的**两个端头**（洞口中心不能跑到墙外），
 * 由邻居收窄。与放置那条路同宽同松：拖动到不了放置到不了的地方，
 * 也去得了放置去得了的地方。
 *
 * ## 洞口与洞口之间是 0，不是边距
 *
 * 上一轮要的就是「两洞之间间隔 0」，而 `openingMagnetOffset` 给出的贴齐位置
 * 正是那个间隔 0 的点。若在这里对邻居缩 `OPENING_EDGE_GAP`，磁吸目标会落在
 * 区间**外面** 0.1 米处，于是每一次磁吸都被夹走 0.1 米，表现是
 * 「贴不上去、手感发黏」，而不是任何一条错误。
 *
 * ## 空档里放不下它自己时返回 `null`
 *
 * 两种情形：`from > to`（左右邻居把它夹得比它自己还窄），以及**当前位置本来
 * 就不在空档里**（邻居与它重叠着，或旧配置有脏数据）。后者不能省：只判
 * `from > to` 的话，一扇与邻居重叠着、但墙足够长的洞口会拿到一个
 * 「挪到邻居另一侧」的合法区间，于是「抓起来跳一下、位置还变了」——
 * 把一个已存在的重叠悄悄改成另一种重叠。
 *
 * `null` 让调用方拒绝开始拖动并说明原因（「两侧没余量，挪不动」），
 * 而不是返回一个退化区间让调用方去夹。
 */
export function openingFreeGap(
  length: number,
  offset: number,
  width: number,
  others: readonly FloorplanOpening[],
): OpeningGap | null {
  const half = width / 2
  let from = 0
  let to = length

  for (const other of others) {
    const otherHalf = other.width / 2
    /*
      左右由**中心**比大小决定，而不是由区间是否相接决定：相接与否正是要算的东西，
      拿它当判据会绕回来。中心在左边就只约束左边界，于是「与它重叠」这种脏数据
      自动落到「当前位置不在空档里」那条上去（重叠邻居算出来的 from 一定大于它自己）。
    */
    if (other.offset <= offset) from = Math.max(from, other.offset + otherHalf + half)
    else to = Math.min(to, other.offset - otherHalf - half)
  }

  if (from > to) return null

  // 当前位置本身就在空档外（重叠的邻居、脏配置）：没有可挪的余地
  if (offset < from - OFFSET_EPS || offset > to + OFFSET_EPS) return null

  return { from, to }
}

/**
 * 往这个位置放一个 `width` 宽的洞口，会不会压到别的洞口。
 *
 * 判据是「两个沿墙区间相交」（转写成了中心距小于两半宽之和），并把门槛
 * 往下让 `OFFSET_EPS`——让出去的那点重合小到不可见，而它换来的是
 * **磁吸给出的贴齐位置一定能通过这道判据**（见 `OFFSET_EPS` 那段）。
 *
 * 它是一支导出的函数而不是 `placeOpeningAt` 里的一段内联表达式，图的是
 * 「让出去多少」与「磁吸算出来多少」是同一个 1e-9、不会在两处各写一遍：
 * 分开写死的话，两处哪天只改了一处，症状是「贴着放时灵时不灵」。
 */
export function openingOverlaps(
  offset: number,
  width: number,
  others: readonly FloorplanOpening[],
): boolean {
  const half = width / 2
  return others.some(
    (other) => Math.abs(other.offset - offset) < other.width / 2 + half - OFFSET_EPS,
  )
}

/**
 * 一个洞口放不下时，是哪个原因。
 *
 * **文案不在这里**，与 `EnclosedAreaResult.reason` 同一条约定：库给代号，
 * 说人话留给编辑器（`useFloorplanTool.ts` 里的 `OPENING_REJECT_HINTS`）。
 * 原因码只有两种，因为放置与替换要走的是**同一份判据**——两处各写一遍
 * 迟早只改一处，症状是「同样一扇窗，放得下、换不上去」。
 *
 * ## 顺序是定的：先报墙短
 *
 * 两条同时成立时（墙又短、位置上又压着邻居）报 `'too-short'`：那是更根本的
 * 原因，而另一条在墙变长之后还在。顺序换了文案会跟着实现漂，且不报错。
 *
 * ## `others` 不含被检的那个洞口自己
 *
 * 沿用 `openingMagnetOffset` 的口径。替换一条已存在的洞口时若把自己也传进来，
 * 它会与自己重叠——判据恒真，一个都换不了。
 *
 * ## 刻意不管「洞口探出墙端」
 *
 * 那不是错误状态：`placeOpeningAt` 本来就不夹 `offset`，`openingFreeGap`
 * 顶上那段写着为什么。在这里加一道「必须在墙内」会让替换比放置更严，
 * 症状同上面那条。
 *
 * `length` 取 `wallLength(wall)`，与 `openingFreeGap` 的入参口径一致。
 */
export type OpeningRejectReason = 'too-short' | 'overlap'

export function openingRejectReason(
  length: number,
  offset: number,
  width: number,
  others: readonly FloorplanOpening[],
): OpeningRejectReason | null {
  if (length < width + OPENING_EDGE_GAP * 2) return 'too-short'
  if (openingOverlaps(offset, width, others)) return 'overlap'
  return null
}

/**
 * 拖动一个洞口时，它此刻该落在哪。
 *
 * 三步，顺序不能换：**整米步进 → 磁吸 → 夹进空档**。
 *
 * ## 吸的是「移动量」，不是「绝对位置」
 *
 * `wanted - origin` 四舍五入到整米再加回 `origin`，而不是直接对 `wanted`
 * 四舍五入。理由是拿手试出来的：绝对吸附会让**已经贴齐放好**的一扇窗
 * （offset 3.5，落在半米上）一动就跳——手移 0.1 米时磁吸还拽着它、
 * 手移满 1 米时 `Math.round(4.5)` 会给出 5.0，屏幕上变成「我拖了一米、
 * 它跳了一米半」，而且每次抓起来都跳一下。
 *
 * 按移动量吸则是「手走一米、窗走一米」，而且**格相是从原来的位置继承的**：
 * 放置给的整米、磁吸给的半米都原样保持，导入的老配置（墙起点不在整米上，
 * 比如 `start: [2.4, 0]`）也不会被硬拽到另一套格子上。
 *
 * ## 磁吸算在 `wanted` 上，不是算在步进之后的那个数上
 *
 * 步进之后才磁吸的话，磁吸几乎永远不会命中：贴齐位置多半在**半米**上，
 * 而步进只会给出「origin 加整数米」，两者差着半米，正好大于磁吸半径 0.35。
 * 换句话说，把磁吸接在步进后面等于把它关掉——而它不报错，只是「贴着放不上去」。
 *
 * ## 夹取放在最后
 *
 * 磁吸给出的位置也照夹（它可能落在空档之外：这一侧的邻居比那个贴齐目标更近），
 * 所以「拖过邻居」这件事在这里被挡住——`gap` 是拖动开始时冻住的那一份，
 * 拖到邻居身上只会停在紧挨着的位置，**过不去**。
 */
export function resolveOpeningDrag(
  origin: number,
  wanted: number,
  width: number,
  others: readonly FloorplanOpening[],
  gap: OpeningGap,
): number {
  const stepped = origin + Math.round((wanted - origin) / CELL_SIZE) * CELL_SIZE
  const landed = openingMagnetOffset(wanted, width, others) ?? stepped
  return Math.max(gap.from, Math.min(landed, gap.to))
}

/**
 * 一面墙切成哪些实心盒子、以及每个洞口自己的框条 / 玻璃 / 门扇。
 *
 * 这是开洞的全部机制：**没有 CSG、没有布尔运算**，就是把墙沿中心线切成
 * 若干段实心墙，洞口所在的那一段上下补两个盒子（窗台下的矮墙、洞口上的过梁）。
 * 参考项目刻意选了这条路（见 README 设计决定），它也正是这套东西
 * 能整段搬进 3dmaker、且一个新依赖都不需要的原因。
 *
 * 门与窗在这里**没有分支**：门的 `sillHeight` 是 0，于是它的下段高度为 0、
 * 自动消失，只剩过梁。参考项目把这两种写成两套几乎一样的代码。
 */
export function wallPieces(
  wall: FloorplanWall,
  openings: readonly FloorplanOpening[],
): FloorplanPiece[] {
  const length = wallLength(wall)
  if (length < MIN_SEGMENT) return []

  const rotationY = wallRotationY(wall)
  const { thickness, height } = wall
  const frameDepth = thickness * FRAME_DEPTH_RATIO
  /*
   * **入口这里必须按 `hostWallId` 滤一遍。** 调用方拿到的是配置里那份**全量**
   * `floorplan.openings`（渲染端是一面墙一个组件，各自从同一个数组里挑自己那几个），
   * 而下面 `placeOpenings` 只看 `offset`、不认识宿主——不滤的话
   * 每一个门窗都会被装到**每一面**墙上。
   *
   * 滤在这一层而不是交给调用方，是因为「这面墙上该有哪几个洞口」这件事
   * 只有墙自己知道（判据就是它自己的 id）；要求每个调用方记得先滤一遍，
   * 漏掉一处的表现是整栋房子的门窗数量翻几倍，而且不报错。
   */
  const hosted = openings.filter((opening) => opening.hostWallId === wall.id)
  const placed = placeOpenings(wall, hosted)
  const pieces: FloorplanPiece[] = []

  // ---------- 1. 沿墙的实心段：洞口与洞口之间，以及两端的余量 ----------
  let cursor = 0
  for (const item of placed) {
    const piece = makePiece(
      `wall-${item.opening.id}-before`,
      wall,
      rotationY,
      'wall',
      cursor,
      item.from,
      0,
      height,
      thickness,
    )
    if (piece) pieces.push(piece)
    cursor = item.to
  }
  const tail = makePiece(
    'wall-tail',
    wall,
    rotationY,
    'wall',
    cursor,
    length,
    0,
    height,
    thickness,
  )
  if (tail) pieces.push(tail)

  // ---------- 2. 每个洞口上下的补墙 + 自己的构件 ----------
  for (const item of placed) {
    const { opening, from, to, bottom, top } = item

    // 窗台下面的矮墙；门的 bottom 是 0，这一块自然为空
    const below = makePiece(
      `wall-${opening.id}-below`,
      wall,
      rotationY,
      'wall',
      from,
      to,
      0,
      bottom,
      thickness,
    )
    if (below) pieces.push(below)

    // 洞口上方的过梁
    const above = makePiece(
      `wall-${opening.id}-above`,
      wall,
      rotationY,
      'wall',
      from,
      to,
      top,
      height,
      thickness,
    )
    if (above) pieces.push(above)

    // 洞口四周的框条：左右两根竖的 + 上下两根横的
    const bars: Array<[string, number, number, number, number]> = [
      [`frame-l`, from, from + FRAME_BAR, bottom, top],
      [`frame-r`, to - FRAME_BAR, to, bottom, top],
      [`frame-b`, from, to, bottom, bottom + FRAME_BAR],
      [`frame-t`, from, to, top - FRAME_BAR, top],
    ]
    for (const [suffix, bFrom, bTo, bY0, bY1] of bars) {
      const bar = makePiece(
        `${opening.id}-${suffix}`,
        wall,
        rotationY,
        'frame',
        bFrom,
        bTo,
        bY0,
        bY1,
        frameDepth,
        opening.id,
      )
      if (bar) pieces.push(bar)
    }

    // 窗够宽就加一根中竖梃
    if (opening.kind === 'window' && to - from > MULLION_FROM_WIDTH) {
      const middle = (from + to) / 2
      const mullion = makePiece(
        `${opening.id}-mullion`,
        wall,
        rotationY,
        'frame',
        middle - FRAME_BAR / 2,
        middle + FRAME_BAR / 2,
        bottom,
        top,
        frameDepth,
        opening.id,
      )
      if (mullion) pieces.push(mullion)
    }

    // 窗填玻璃，门填门扇。两者的差别只在厚度与材质
    const infill = makePiece(
      `${opening.id}-${opening.kind === 'door' ? 'leaf' : 'glass'}`,
      wall,
      rotationY,
      opening.kind === 'door' ? 'leaf' : 'glass',
      from,
      to,
      bottom,
      top,
      opening.kind === 'door' ? LEAF_THICKNESS : GLASS_THICKNESS,
      opening.id,
    )
    if (infill) pieces.push(infill)
  }

  return pieces
}

/**
 * 这个洞口的外观**已经由模型负责**了没有。
 *
 * 判据只有一条：**写了地址**。
 *
 * 它原先还有第二半（`kind === 'door'`），那一条在**窗也接上模型**这一轮里去掉了。
 * 理由就写在当时那段注释里：门那条渲染路按「取这个洞口那片**门扇**」找位置，
 * 而窗洞里没有门扇这个碎片（窗填的是玻璃），只按地址放行会让一个写了地址的窗洞
 * 连框带玻璃一起消失——墙那侧被抑制掉、模型那侧又拿不到东西可摆，两边都不画。
 * 现在那条渲染路按 `opening.kind` 分别取门扇（`leaf`）与玻璃（`glass`），
 * 两者都带着洞宽、洞高、世界位置与朝向，是同一件事的两种碎片
 * （见 `SceneFloorplanOpeningModel.vue`），于是这个判据可以退回它本来的含义：
 * **「外观是不是交给模型了」与洞口的种类无关。**
 *
 * 反过来说，**没有地址的洞口照旧走程序构件那套**（四根框条 + 门扇 / 玻璃），
 * 这正是改造前唯一的行为，也是「再点一次取消选用」之后画出来的那种门窗。
 *
 * 签名写成**类型谓词**而不是 `boolean`：分组那一处要拿这个地址当 key，
 * 守卫让它不必写一个非空断言（`opening.url!` 会把判据将来被改坏这件事
 * 从编译错误降级成运行期的 `undefined`）。
 */
export function openingFilledByModel(
  opening: FloorplanOpening,
): opening is FloorplanOpening & { url: string } {
  return !!opening.url
}

/**
 * 把**已经由模型负责的洞口**那一套内饰件摘掉：框条 / 中竖梃 / 玻璃 / 门扇。
 *
 * 摘的只有内饰件，**洞口照旧把墙切开**——这一点是整个机制的支点：抑制的办法
 * 不能是「把这些洞口从 `openings` 里滤掉」，那样 `placeOpenings` 收不到它，
 * 墙上就没有洞，换进来的门模型会被整个埋在实心墙里（而它不报错，只是看不见）。
 * 所以判据挂在**碎片**上（`FloorplanPiece.openingId`），不挂在洞口列表上。
 *
 * `-below` / `-above` 这两块补墙不带 `openingId`，因此不受影响：洞口上下照样
 * 补平（窗台矮墙留着，过梁留着），换掉的只是洞里面那套东西。
 *
 * **调用点是三个、不是两个**，这也是它值得是一个导出函数的原因：
 * `SceneFloorplanWall` 自己那条路、`SceneFloorplanWallSkin` 贴面之外的补件那条路，
 * 以及贴面退化时**回到 `SceneFloorplanWall`** 的那条路——第三条跟门资产的状态
 * 毫无关系（墙资产加载失败也会走它），漏掉它的表现是同一个包围盒上两组共面几何、
 * 逐像素 z-fighting。前两条各自调本函数，第三条由 `SceneFloorplanWall` 自己兜住。
 */
export function dropOpeningFills(
  pieces: readonly FloorplanPiece[],
  openings: readonly FloorplanOpening[],
): FloorplanPiece[] {
  const filled = new Set<string>()
  for (const opening of openings) {
    if (openingFilledByModel(opening)) filled.add(opening.id)
  }

  if (!filled.size) return [...pieces]
  return pieces.filter((piece) => !piece.openingId || !filled.has(piece.openingId))
}

/**
 * 多边形的形心，用来摆房间名标签。
 *
 * 用**面积形心**（鞋带公式）而不是顶点平均或包围盒中心：
 *
 * - 顶点平均会被「边上多打了几个点」带偏；
 * - 包围盒中心在 L 形、U 形这类凹多边形上会落到**房间外面**——
 *   名字飘到隔壁房间或墙里，是看得见的错。
 *
 * 凹得极端的多边形（细长的 C 形）形心也可能落在外面，那属于这个量级的
 * 取舍：真要绝对落内，得做「取一个内点」的多边形分解，代价与收益不成比例。
 *
 * 面积为 0（点都共线、或不足三个点）时退回顶点平均——那时形心公式是 0/0。
 */
export function polygonCenter(polygon: readonly FloorplanPoint[]): FloorplanPoint {
  if (polygon.length === 0) return [0, 0]

  let twiceArea = 0
  let cx = 0
  let cz = 0

  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, z0] = polygon[i]
    const [x1, z1] = polygon[(i + 1) % polygon.length]
    const cross = x0 * z1 - x1 * z0
    twiceArea += cross
    cx += (x0 + x1) * cross
    cz += (z0 + z1) * cross
  }

  if (Math.abs(twiceArea) < 1e-9) {
    let sx = 0
    let sz = 0
    for (const [x, z] of polygon) {
      sx += x
      sz += z
    }
    return [sx / polygon.length, sz / polygon.length]
  }

  return [cx / (3 * twiceArea), cz / (3 * twiceArea)]
}

/**
 * 点是否在多边形内部（射线法 / 奇偶规则）。
 *
 * 用于「这块区域已经有房间了」的判重，以及后续阶段的空间查询。
 * 边界上的点归为**内部**——房间是墙围出来的，而墙中心线正好是多边形的边，
 * 用户点在墙上的情况按「已经在房间里」处理更符合直觉。
 */
export function pointInPolygon(point: FloorplanPoint, polygon: readonly FloorplanPoint[]): boolean {
  const [px, pz] = point
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!

    // 水平射线向右：只统计「跨越 pz 的那条边」与它的交点是否在 px 右侧
    const straddles = zi > pz !== zj > pz
    if (!straddles) continue

    const crossX = ((xj - xi) * (pz - zi)) / (zj - zi) + xi
    if (px < crossX) inside = !inside
  }

  return inside
}

/** 点到线段的最短距离，以及投影在线段上的比例（夹进 [0,1]） */
function distanceToSegment(
  point: FloorplanPoint,
  a: FloorplanPoint,
  b: FloorplanPoint,
): { distance: number; ratio: number } {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz

  // 退化成一点：距离就是到那一点的距离
  if (lengthSq < 1e-12) {
    return { distance: Math.hypot(point[0] - a[0], point[1] - a[1]), ratio: 0 }
  }

  const raw = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq
  const ratio = Math.max(0, Math.min(raw, 1))
  const cx = a[0] + dx * ratio
  const cz = a[1] + dz * ratio

  return { distance: Math.hypot(point[0] - cx, point[1] - cz), ratio }
}

/** 「最近的那面墙」的答案 */
export interface NearestWallHit {
  wall: FloorplanWall
  /** 落点沿墙中心线的米数，从 `wall.start` 量起。放置门窗直接用它当 offset */
  offset: number
  /** 点到墙中心线的垂直距离，米 */
  distance: number
}

/**
 * 找离某个点最近的墙。
 *
 * `maxDistance` 由调用方给：编辑器放置门窗时用 0.6 米（见
 * `useFloorplanTool.ts` 里那段为什么不是参考项目的 0.45），
 * 绘制墙时用 0.4 米去吸附已有端点。两个场景要的松紧不一样，
 * 所以这个数不写成默认参数——默认值会让调用方懒得想这件事。
 */
export function findNearestWall(
  walls: readonly FloorplanWall[],
  point: FloorplanPoint,
  maxDistance: number,
): NearestWallHit | null {
  let best: NearestWallHit | null = null

  for (const wall of walls) {
    const length = wallLength(wall)
    if (length < MIN_SEGMENT) continue

    const { distance, ratio } = distanceToSegment(point, wall.start, wall.end)
    if (distance > maxDistance) continue
    if (best && distance >= best.distance) continue

    best = { wall, offset: ratio * length, distance }
  }

  return best
}

/**
 * 房间多边形的配色循环。
 *
 * 八个颜色，按房间顺序取模。参考项目那套的价值在于**相邻房间颜色不会撞**——
 * 它挑的是同一明度下色相均匀铺开的八个，所以色块铺在一起时边界看得清。
 */
const ROOM_COLORS = [
  '#7dd3fc',
  '#c4b5fd',
  '#fca5a5',
  '#fcd34d',
  '#86efac',
  '#f9a8d4',
  '#a5b4fc',
  '#fdba74',
] as const

/** 按已有房间数量取一个颜色 */
export function pickRoomColor(index: number): string {
  return ROOM_COLORS[index % ROOM_COLORS.length]!
}

// ---------------------------------------------------------------------------
// 房间识别：由墙围出的封闭区域
// ---------------------------------------------------------------------------

/**
 * 单元格边长，米。
 *
 * 编辑器的吸附步长（`useFloorplanTool.ts` 的 `snap`）**就是照着这个数四舍五入**的，
 * 不是另写一个 1：下面那套整数格算法建立在「一格正好是一米」上，
 * 两个数分开写死迟早漂移，而漂移之后编辑器画出来的墙会过不了这里的校验
 * （`onGrid` 把「端点不在整米上」判成不可用，房间工具于是永远报「识别不了」）。
 * 它是公开导出而不是模块内常量，正是为了让编辑器取它、而不是自己写一个 1。
 */
export const CELL_SIZE = 1

/** 网格坐标下的一点（整数米） */
type Cell = [number, number]

/** 端点是否落在整米上（允许浮点误差） */
function onGrid(value: number): boolean {
  return Math.abs(value - Math.round(value)) < 1e-6
}

/** 键：两个整数拼成 `"a,b"`。用它当 Set / Map 的键比嵌套数组省事得多 */
function key(a: number, b: number): string {
  return `${a},${b}`
}

/**
 * 墙的阻塞关系与包围盒。
 *
 * `blockedH` 里的 `"cx,cz"` 表示「单元格 (cx, cz) 与 (cx, cz-1) 之间被挡」，
 * 也就是 z = cz 那条水平线上有一段墙；`blockedV` 的 `"cx,cz"` 同理表示
 * x = cx 那条竖直线。两套键长得一样但含义正交，用两个 Set 分开存
 * 而不是拼前缀，是因为它们各自都是纯粹的「有没有」查询。
 */
interface WallTopology {
  blockedH: Set<string>
  blockedV: Set<string>
  /** 所有墙端点撑出的整数格包围盒；泛洪撞到它就说明没围住 */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
}

/**
 * 把墙列表变成整数格上的阻塞关系。
 *
 * **只支持落在整米上、且正交的墙**。不满足就返回 null——这套泛洪算法
 * 的每一个环节（单元格、邻接、边界顶点）都假定整数格，硬套到斜墙或
 * 0.5 米偏移的墙上只会得到一个错的环，而错的环会变成配置里一块
 * 永远删不掉的垃圾色块。返回 null 让调用方去说「识别不了」，
 * 这比默默算错好。
 */
function buildTopology(walls: readonly FloorplanWall[]): WallTopology | null {
  const blockedH = new Set<string>()
  const blockedV = new Set<string>()
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity

  for (const wall of walls) {
    const [x1, z1] = wall.start
    const [x2, z2] = wall.end
    if (!onGrid(x1) || !onGrid(z1) || !onGrid(x2) || !onGrid(z2)) return null

    const ax = Math.round(x1)
    const az = Math.round(z1)
    const bx = Math.round(x2)
    const bz = Math.round(z2)
    // 零长墙不影响封闭性，跳过
    if (ax === bx && az === bz) continue
    // 斜墙不支持
    if (ax !== bx && az !== bz) return null

    minX = Math.min(minX, ax, bx)
    maxX = Math.max(maxX, ax, bx)
    minZ = Math.min(minZ, az, bz)
    maxZ = Math.max(maxZ, az, bz)

    if (az === bz) {
      // 水平墙：z = az 这条线上，每一米挡一格
      for (let cx = Math.min(ax, bx); cx < Math.max(ax, bx); cx++) {
        blockedH.add(key(cx, az))
      }
    } else {
      for (let cz = Math.min(az, bz); cz < Math.max(az, bz); cz++) {
        blockedV.add(key(ax, cz))
      }
    }
  }

  if (!Number.isFinite(minX)) return null

  return { blockedH, blockedV, bounds: { minX, minZ, maxX, maxZ } }
}

/** `findEnclosedArea` 的结果：要么给出多边形，要么给出**为什么**给不出 */
export type EnclosedAreaResult =
  | { ok: true; polygon: FloorplanPoint[] }
  /**
   * `not-on-grid`：有墙不在整米上或是斜的
   * `outrun`：泛洪撞出包围盒，说明没围住
   * `complex`：区域在某个顶点上自接触（两格只对角相接），会被切成两块
   */
  | { ok: false; reason: 'not-on-grid' | 'outrun' | 'complex' }

/**
 * 从某一格出发，找出它所在的封闭区域的多边形。
 *
 * 算法：由墙生成阻塞集 → 四邻泛洪（越界即放弃）→ 收集「四邻里有不属于本区域的」
 * 那些格边当边界 → 串成一个环 → 折掉共线点。
 *
 * **与参考项目 `editor.vue:580-666` 那版的三处实质差别**：
 *
 * 1. **串环那段是重写的。** 它把边界边收成一个数组，然后每步用
 *    `outlineEdges.indexOf(c)` 线性查找下一条（O(n²)），而且起点写死
 *    `outlineEdges[0]`——当第一个格子的上方也有填充时，那一条可能是区域
 *    **内部**的边，于是追出一个残缺的环或中途放弃。这里改成在顶点上建无向图，
 *    并显式校验「每个顶点度数恰好为 2」。
 * 2. **度数校验同时就是形状校验。** 简单正交区域的每个边界顶点度数恰好是 2；
 *    出现别的度数说明两格只在对角相接（一个「掐点」），这种多边形会让
 *    `ShapeGeometry` 三角化出垃圾面片，所以直接拒绝（`complex`）。
 * 3. **折掉共线点。** 参考项目存的是「一格一条边」的原始顶点表，
 *    一个 4×3 的房间能存出二十多个点；折完只剩 4 个拐角，
 *    配置小一个量级，三角化也干净得多。
 *
 * 洞口（门窗）**不参与**泛洪：一扇开着的门不算通路。语义上「有门就算围起来了」
 * 确实别扭，但把门当通路会让「一间房开门通向另一间」直接漏出去，那是和门扇
 * 一起在后续阶段想的事。
 */
export function findEnclosedArea(
  walls: readonly FloorplanWall[],
  start: FloorplanPoint,
): EnclosedAreaResult {
  const topology = buildTopology(walls)
  if (!topology) return { ok: false, reason: 'not-on-grid' }

  const { blockedH, blockedV, bounds } = topology
  const startCell: Cell = [Math.floor(start[0] / CELL_SIZE), Math.floor(start[1] / CELL_SIZE)]

  /** 单元格是否在包围盒内 */
  const inside = (cx: number, cz: number): boolean =>
    cx >= bounds.minX && cx <= bounds.maxX && cz >= bounds.minZ && cz <= bounds.maxZ

  /** 单元格 (cx,cz) 往某个方向走是否被墙挡住 */
  const blocked = (cx: number, cz: number, dx: number, dz: number): boolean => {
    if (dx > 0) return blockedV.has(key(cx + 1, cz))
    if (dx < 0) return blockedV.has(key(cx, cz))
    if (dz > 0) return blockedH.has(key(cx, cz + 1))
    return blockedH.has(key(cx, cz))
  }

  const visited = new Set<string>()
  const cells: Cell[] = []
  const queue: Cell[] = [startCell]
  visited.add(key(startCell[0], startCell[1]))

  const DIRS: Cell[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]

  while (queue.length > 0) {
    const [cx, cz] = queue.pop()!
    cells.push([cx, cz])

    for (const [dx, dz] of DIRS) {
      if (blocked(cx, cz, dx, dz)) continue

      const nx = cx + dx
      const nz = cz + dz
      // 撞出包围盒 = 这一片连到外面去了，没围住
      if (!inside(nx, nz)) return { ok: false, reason: 'outrun' }

      const next = key(nx, nz)
      if (visited.has(next)) continue
      visited.add(next)
      queue.push([nx, nz])
    }
  }

  // 单个单元格的区域没有意义（点在了墙缝里）
  if (cells.length === 0) return { ok: false, reason: 'outrun' }

  // ---------- 收集边界边，建成顶点图 ----------
  const neighbors = new Map<string, string[]>()
  const link = (a: string, b: string): void => {
    const list = neighbors.get(a)
    if (list) list.push(b)
    else neighbors.set(a, [b])
  }

  for (const [cx, cz] of cells) {
    for (const [dx, dz] of DIRS) {
      // 邻居也在区域里 → 这条格边是内部的，不是边界
      if (visited.has(key(cx + dx, cz + dz))) continue

      // 边界边的两个端点：朝 dx/dz 那侧的那条边的两端。顶点用格坐标，
      // 于是一个格 (cx,cz) 的角分别是 (cx,cz) (cx+1,cz) (cx+1,cz+1) (cx,cz+1)
      const a = dx > 0 || dz > 0 ? key(cx + 1, cz + 1) : key(cx, cz)
      let b: string
      if (dx > 0) b = key(cx + 1, cz)
      else if (dx < 0) b = key(cx, cz + 1)
      else if (dz > 0) b = key(cx, cz + 1)
      else b = key(cx + 1, cz)

      link(a, b)
      link(b, a)
    }
  }

  /*
   * 每个顶点度数必须是 2。
   *
   * 这一条既是「能串成一个环」的前提，也是形状校验：度数 4 出现在
   * 两格只对角相接的那个掐点上，那种多边形是自接触的。
   * 顺带也挡住了「边界边没能围出一个闭合环」这种不该发生的情况。
   */
  for (const [, list] of neighbors) {
    if (list.length !== 2) return { ok: false, reason: 'complex' }
  }

  // ---------- 沿图走一圈 ----------
  const startKey = neighbors.keys().next().value
  if (startKey === undefined) return { ok: false, reason: 'outrun' }

  const ring: string[] = [startKey]
  let previous = ''
  let current = startKey

  for (;;) {
    const list = neighbors.get(current)!
    // 来路是上一条边；第一次走第一条
    const next = list[0] === previous ? list[1]! : list[0]!
    if (next === startKey) break
    ring.push(next)
    previous = current
    current = next
  }

  /*
   * 走过的顶点必须**覆盖全部**顶点。
   *
   * 「所有顶点度数为 2」只说明图是由若干个环拼成的，不保证只有一个环。
   * 反例是区域带洞：大正方形里套一个小正方形并且小正方形自身封闭，
   * 从外面泛洪得到的边界就是外圈 + 内圈两条独立的环。
   * 这时走一圈只会拿到其中一个环，返回的多边形**看着像个正经房间，
   * 其实完全不对**——必须在这里拦住，而不是让它变成配置里一块错的色块。
   */
  if (ring.length !== neighbors.size) return { ok: false, reason: 'complex' }

  // ---------- 折掉共线点 ----------
  const points: FloorplanPoint[] = ring.map((item) => {
    const [cx, cz] = item.split(',')
    return [Number(cx) * CELL_SIZE, Number(cz) * CELL_SIZE]
  })

  const collapsed: FloorplanPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]!
    const next = points[(i + 1) % points.length]!
    const current = points[i]!
    // 叉积为 0 = 三点共线，中间那个点可以删
    const cross =
      (current[0] - prev[0]) * (next[1] - current[1]) -
      (current[1] - prev[1]) * (next[0] - current[0])
    if (Math.abs(cross) > 1e-9) collapsed.push(current)
  }

  // 全共线（一条直线）不是多边形
  if (collapsed.length < 3) return { ok: false, reason: 'complex' }

  return { ok: true, polygon: collapsed }
}

/**
 * 删除一面墙，连同挂在它上面的门窗。
 *
 * 这条级联是**必须**的，而且只能有一个实现：门窗只记 `hostWallId`，
 * 墙一没它们就成了指向不存在对象的孤儿——渲染端会静默跳过，
 * 配置里留下一批永远不显示、也没法删的垃圾。
 *
 * 参考项目在 `undoLast` 里手写了两段 splice 加下标回退（因为它的门窗
 * 记的是 `wallIdx` 而不是 id），删墙时还要逐个重映射下标。我们用 id，
 * 所以只有两句 filter——这是数据模型上的一处实质改进。
 *
 * 原地改：调用方拿到的通常是配置里那个数组，`applyConfig` 要走「替换」
 * 语义，所以这里返回新的两份数组，由调用方写回配置。
 */
export function removeWall(
  walls: readonly FloorplanWall[],
  openings: readonly FloorplanOpening[],
  wallId: string,
): { walls: FloorplanWall[]; openings: FloorplanOpening[] } {
  return {
    walls: walls.filter((wall) => wall.id !== wallId),
    openings: openings.filter((opening) => opening.hostWallId !== wallId),
  }
}
