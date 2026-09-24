/**
 * 「一段 JSON 描述的零件表」→「摆在场上的一组几何体」。
 *
 * 回答的是 `ModelConfig.partsJson` 那一段文本的两个问题：**它说了些什么**
 * （`parseModelParts`：读、校验、把缺省值补齐）与**那些零件各摆在哪**
 * （`placeModelParts`：一件零件展开成若干份，每份算出位置与朝向）。
 *
 * ## 为什么单独一个文件、为什么全是纯函数
 *
 * 与 `floorplan.ts` / `wallFace.ts` 同一条理由：它吃字符串、吐数字，既不依赖
 * three 也不依赖 DOM，所以**冒烟测试能直接跑**（`scripts/smoke.mjs`）。而这一点
 * 在这一段代码上格外要紧——几何体是从数据算出来的，算错了不会抛异常，
 * 只会画出一个形状不对的东西，而形状对不对**只有眼睛看得出来**。
 * 把算术从渲染里拆出来，至少「位置 / 旋转 / 参数个数」这几条能被钉死。
 *
 * 它也是**公开面**（`src/index.ts` 导出）：宿主自己画这些几何体时绕不过同一份
 * 算术，抄一份的下场与 `wallFaceFit` 那边写的一样——两处各自漂移，且不报错。
 *
 * ## 零件表的形状（照 demo.md）
 *
 * 一件零件是一个对象，`shape` 决定其余字段怎么读：
 *
 * ```
 * box       { shape: 'box',      w, h, d }        宽 / 高 / 深（米）
 * cylinder  { shape: 'cylinder', rTop, rBottom, h } 上半径 / 下半径 / 高（米）
 * ```
 *
 * 两种都有的是：`x` / `y` / `z`（**中心**位置，缺省 0）、`count` + `radius`
 * （沿圆周均布几份，见下）、`color` / `metalness` / `roughness`、`name`。
 *
 * `y` 是**中心高度**不是底面高度：demo.md 那把椅子里底座（`h: 0.05, y: 0.28`）
 * 与气压杆（`h: 0.35, y: 0.48`）正好接得上，就是这么读出来的。
 *
 * ## 「起点 +Z、每份跟着转 θ」——`count` + `radius` 的摆法
 *
 * 第 `i` 份（`i` 从 0 数起）：
 *
 * ```
 * θ = 2π · i / count
 * 位置 (x + radius·sinθ,  y,  z + radius·cosθ)
 * 朝向 绕 Y 轴转 θ
 * ```
 *
 * **两半缺一不可**，而且第二半是最容易漏掉的那半。依据是 demo.md 里那把椅子能
 * 逐件对上：`腿部横撑` 的长边是 `d`（沿 Z，0.45），`count: 5`、`radius: 0.35`——
 * 只有「起点在 +Z、每一份连朝向一起转」才让五条横撑成为**径向的辐条**；
 * 少了「跟着转」这一半，它们会围成一圈**切向**的方框，五条全都横着摆在圆周上。
 *
 * 反方向的证据也在同一份数据里：没写 `count` 的零件（左右扶手立柱，各自写了
 * `x` 与 `z`）**不旋转、原地不动**——`count` 缺省 1 时 `θ = 0`，位置就是
 * `(x, y, z)`、朝向就是 0，两条规则合成一条，所以这条约定是自洽的。
 *
 * ## 校验的口径：严格 + 逐件剔除
 *
 * 与 `wallFaceUnusable` 那一族同一套：**不静默修补**，判据写在明处，不认的就说出来。
 * 两条：
 *
 * - **一件零件只要有**一处不合格就**剔掉这一件**，其余照样画，`dropped` 报出数。
 *   最要紧的是别让 NaN 混进顶点缓冲——一个 NaN 顶点会让整块几何**整块消失**
 *   （`SceneModelNode.vue` 的 `measure` 上有完整的机制说明），而那时画面只是少了个
 *   东西，没有任何地方报错。
 * - **整份读不出来就一件都不画**（`problem` 给出人话），不做半截渲染：
 *   空串 / 不是 JSON / 顶层不是数组 / 件数超上限，四种都归这一档。
 *
 * 上限（`MAX_PARTS` / `MAX_COUNT`）是**防病态数据把浏览器卡死**的，不是洁癖：
 * 一件 `count: 100000` 的零件就是十万个 mesh、十万次 draw call。超上限**整份拒掉**
 * 而不是静默截断——截断出来的画面看起来「差不多是对的」，最难查。
 */

/** 零件形状。只有这两种，`shape` 是零件表里唯一必填的字段 */
export type ModelPartShape = 'box' | 'cylinder'

/** 一件圆柱的侧面切几段。写死一个常量，不给零件表一个「我要更圆」的口子 */
const CYLINDER_SEGMENTS = 24

/** 没写 `color` 时用的中性灰。与 `SceneFloorplanWallBox` 的灰板同色 */
const DEFAULT_COLOR = '#cbd5e1'

/**
 * 没写 `metalness` / `roughness` 时的默认。
 *
 * **刻意不是 three 自己的默认**（0 与 1）：`roughness: 1` 是完全哑光，
 * 配程序生成的方块在这套有环境贴图、有阴影的场景里看着像纸片。
 * 0.8 还留一点高光，方块的面与面之间才分得开。
 */
const DEFAULT_METALNESS = 0
const DEFAULT_ROUGHNESS = 0.8

/**
 * 一张零件表最多几件（`count` 展开**之前**的数）。
 *
 * 512 是「够用」与「卡死」之间随手取的一个数，不必精确：demo.md 那把椅子 11 件，
 * 一个由参数拼出来的机械臂撑死几十件。**宿主生成零件表时要按它来**，
 * 超了整份会被拒掉，所以这个数是公开约定，不是内部实现。
 */
export const MAX_PARTS = 512

/**
 * 一件零件的 `count` 最大几份（展开之后的件数 = 各件 `count` 之和）。
 *
 * 与 `MAX_PARTS` 一同构成上限：一份**只有一件**零件、`count: 100000` 的表
 * 靠件数那个上限是拦不住的，所以两个都要有。
 */
export const MAX_COUNT = 64

/** 一件零件：字段名照 demo.md，`parseModelParts` 出来的每一件都补齐了全部字段 */
interface ModelPartBase {
  /** 显示名。只为读日志与调试，几何体上不带名字 */
  name: string
  /** 高（米）。两种形状都是「中心高度」口径的 `h`，所以放在公共那半边 */
  h: number
  /** 中心位置（米），缺省 0 */
  x: number
  y: number
  z: number
  /** 沿圆周均布几份，`1` 就是不均布。位置与朝向的算式见文件头 */
  count: number
  /** 均布所在圆的半径（米），缺省 0 */
  radius: number
  color: string
  metalness: number
  roughness: number
}

/**
 * 一件零件，**判别联合**：`shape` 是 `box` 就一定有 `w` / `d`，是 `cylinder`
 * 就一定有 `rTop` / `rBottom`。读它的人因此不必判空，也不可能读错那半边。
 *
 * 判别联合在**这个文件里**买到的正是上面那两条；到了渲染端买的又是另一样
 * （参数表的元组形状），见 `PlacedPart`。
 */
export type ModelPart =
  | (ModelPartBase & { shape: 'box'; w: number; d: number })
  | (ModelPartBase & { shape: 'cylinder'; rTop: number; rBottom: number })

/** 展开之后每一件都有的那几样。分出来是为了让 `PlacedPart` 的联合只差「几何体」那一半 */
interface PlacedPartSpot {
  /** v-for 的 key，`<零件序号>-<第几份>`，在同一次展开里唯一 */
  key: string
  name: string
  position: [number, number, number]
  /** 只有 Y 分量可能非零（就是那个 θ），另外两个恒为 0 */
  rotation: [number, number, number]
  color: string
  metalness: number
  roughness: number
}

/**
 * 展开之后**落在场上的那一件**。
 *
 * 一件 `count: 5` 的零件在这里变成五件，各自算好了位置与朝向——下游
 * （`SceneModelParts.vue`）只负责照着摆，不做任何算术。
 *
 * ## 为什么是判别联合，且 `geometryArgs` 写成**元组**而不是 `number[]`
 *
 * 因为渲染端那一头是**有类型的**，而且它不接受 `number[]`：TresJS 把 three 的
 * 每一个类都映射成了全局组件（`GlobalComponents extends TresComponents`），
 * 于是 `<TresBoxGeometry :args>` 的类型就是 `ConstructorParameters<typeof BoxGeometry>`
 * ——一个**长度确定的元组**。宽口 `number[]` 在那边是编译错误（「源可能更长」）。
 *
 * 顺带也就把「`shape` 与参数表长度必须一致」这条不变式**写进了类型**：
 * 模板里 `v-if="part.shape === 'box'"` 一收窄，`geometryArgs` 就恰好是那个三元组。
 * 一开始这里写的是扁平 `number[]` 加一句「联合在这里买不到东西」的注释，
 * 结果类型检查当场证明了那句话是错的。
 */
export type PlacedPart =
  | (PlacedPartSpot & { shape: 'box'; geometryArgs: [number, number, number] })
  | (PlacedPartSpot & { shape: 'cylinder'; geometryArgs: [number, number, number, number] })

/** 读一张零件表的结果 */
export interface ModelPartsResult {
  /** 通过校验的那些，顺序照原文 */
  parts: ModelPart[]
  /** 剔掉了几件（不合格的零件数，不是展开后的件数） */
  dropped: number
  /**
   * 整份都读不出来时的一句人话，读出来了就是 `null`。
   *
   * 口径与 `wallFaceUnusable` 那一族一致（`string | null` 而不是「空串表示没问题」）：
   * 空串是一个合法的消息吗？不是，所以别拿它当哨兵值——那正是
   * 「忘了判空」与「故意留空」分不开的地方。
   */
  problem: string | null
}

/**
 * 读一段零件表。
 *
 * 不认识输入里**多出来的**键（demo.md 没写的就不发明，比如逐件的 `rotation`），
 * 也不报错——与 `cloneModelPatch` 对未知事件类型的态度一致：多出来的不影响
 * 已知的怎么读，丢了才是丢东西。
 */
export function parseModelParts(json: string): ModelPartsResult {
  const text = json.trim()
  if (!text) return { parts: [], dropped: 0, problem: '零件表是空的' }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    /*
      把 JSON.parse 自己那句话带出来（它会给出行号附近的上下文），
      它比「格式不对」有用得多。前缀是给宿主看的：说清这是**零件表**的问题，
      而不是编辑器坏了。
    */
    return { parts: [], dropped: 0, problem: `零件表不是合法的 JSON：${String(error)}` }
  }

  if (!Array.isArray(raw)) return { parts: [], dropped: 0, problem: '零件表的顶层必须是一个数组' }

  /*
    上限查在**校验之前**：一份 100 万件的表不该先被逐件读一遍再被拒。
    报出的数照原样写进去，让人一眼看出差了几个数量级。
  */
  if (raw.length > MAX_PARTS) {
    return {
      parts: [],
      dropped: 0,
      problem: `零件表最多 ${MAX_PARTS} 件，这一份有 ${raw.length} 件`,
    }
  }

  const parts: ModelPart[] = []
  let dropped = 0

  for (const item of raw) {
    const part = readPart(item)
    if (part) parts.push(part)
    else dropped += 1
  }

  return { parts, dropped, problem: null }
}

/**
 * 把一张零件表展开成场上的一件件几何体。
 *
 * 入参要求是 `parseModelParts` 出来的（字段已补齐、已校验），所以这里不做任何
 * 判空或判 NaN——**校验只有一处**，在两个函数里各写一份的下场是「渲染端放过去了、
 * 导入时又拦住」，两边都觉得自己是对的。传进来的若是手搓的 `ModelPart`，
 * 出了 NaN 顶点也只会得到一块凭空消失的几何体，这里不负责兜。
 */
export function placeModelParts(parts: readonly ModelPart[]): PlacedPart[] {
  const placed: PlacedPart[] = []

  parts.forEach((part, index) => {
    for (let i = 0; i < part.count; i += 1) {
      // 摆法见文件头「起点 +Z、每份跟着转 θ」。位置与朝向必须用**同一个** θ
      const theta = (2 * Math.PI * i) / part.count

      /*
        「位置 / 朝向 / 材质」这几样两种形状一致，先算出来再按形状补上几何体的那一半。
        分成两个字面量写会把这六行抄两遍，而抄漏一行的表现是某一类零件的材质
        悄悄变成默认值——画面上看着只是「有点不一样」。
      */
      const spot: PlacedPartSpot = {
        key: `${index}-${i}`,
        name: part.name,
        position: [
          part.x + part.radius * Math.sin(theta),
          part.y,
          part.z + part.radius * Math.cos(theta),
        ],
        rotation: [0, theta, 0],
        color: part.color,
        metalness: part.metalness,
        roughness: part.roughness,
      }

      /*
        参数表**逐份新建**，不共用同一个数组。

        理由不是性能而是别名：同一份参数表被 5 个 mesh 共用时，任何一个环节
        就地改一下它（或把它包成响应式再改）就是五件几何体一起变。一个 19 件的小东西，
        多 19 个长度为 3 的数组是零成本，不值得为它引一个「约定所有消费方只读」的规矩。
      */
      placed.push(
        part.shape === 'box'
          ? { ...spot, shape: 'box', geometryArgs: [part.w, part.h, part.d] }
          : {
              ...spot,
              shape: 'cylinder',
              geometryArgs: [part.rTop, part.rBottom, part.h, CYLINDER_SEGMENTS],
            },
      )
    }
  })

  return placed
}

/**
 * 读一件零件，不合格返回 `null`。
 *
 * 写成「读进一堆局部变量、一次判完」而不是逐项早返回，是为了让**必填与可选
 * 的分界**在代码里看得见：下面是可选的（不写取默认、写了但不是一个有限数就剔），
 * 再下面是必填的（盒子的 `w` / `d`、圆柱的两个半径）。
 */
function readPart(raw: unknown): ModelPart | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>

  /*
    `shape` 是唯一必填的字段，也是其余字段怎么读的判据，所以先读它。
    认不出的形状直接剔，不去猜「有 w 就当盒子」——猜错的代价是一件零件
    以完全不对的形状立在那里，而它看起来是「画出来了」。
  */
  const shape = source.shape
  if (shape !== 'box' && shape !== 'cylinder') return null

  const h = positive(source.h)
  if (h === null) return null

  const x = optional(source.x, 0)
  const y = optional(source.y, 0)
  const z = optional(source.z, 0)
  const count = readCount(source.count)
  const radius = optional(source.radius, 0)
  const metalness = optional(source.metalness, DEFAULT_METALNESS)
  const roughness = optional(source.roughness, DEFAULT_ROUGHNESS)

  if (
    x === null ||
    y === null ||
    z === null ||
    count === null ||
    radius === null ||
    metalness === null ||
    roughness === null
  ) {
    return null
  }
  // 负半径的圆是「反着转」，位置会落到 θ + π 上去——那不是「摆法不同」，是错的
  if (radius < 0) return null

  const base = {
    /*
      `name` 与 `color` **不是数值**，所以它们的「不合格」与数值那一片不同：
      写了一个空串或一个不是字符串的东西，就当没写、取默认，而不是剔掉这一件。
      一个名字没写对不该让一个几何体消失，而一个尺寸没写对会画出错的东西，
      两条的分界就在这里。

      颜色**不在这里校验语法**（`#rrggbb` / `rgb(...)` / 具名色都合法，判据在
      three 的 `Color` 里）：写了一个 three 认不出来的串，它会退回白色并在控制台
      说一句，比这里抄一份颜色语法可靠。
    */
    name: typeof source.name === 'string' ? source.name : '',
    color: typeof source.color === 'string' && source.color ? source.color : DEFAULT_COLOR,
    h,
    x,
    y,
    z,
    count,
    radius,
    metalness,
    roughness,
  }

  if (shape === 'box') {
    const w = positive(source.w)
    const d = positive(source.d)
    if (w === null || d === null) return null
    return { ...base, shape, w, d }
  }

  // 半径允许为 0（`rTop: 0` 就是一个圆锥），但不能两个都是 0——那是一条线，
  // 建出来的几何体没有体积，画面上什么都看不到
  const rTop = nonNegative(source.rTop)
  const rBottom = nonNegative(source.rBottom)
  if (rTop === null || rBottom === null) return null
  if (rTop === 0 && rBottom === 0) return null

  return { ...base, shape, rTop, rBottom }
}

/**
 * 可选数值：没写（`undefined` / `null`）取默认，写了就必须是有限数，
 * 不是有限数返回 `null`（这一件剔掉）。
 *
 * `null` 当哨兵值不会与合法输入撞车——合法输入要么是默认值要么是有限数，
 * 两者都不是 `null`。
 */
function optional(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback
  return Number.isFinite(value) ? (value as number) : null
}

/** 必填的正数（`h` / `w` / `d`）：0 与负数都建不出几何体 */
function positive(value: unknown): number | null {
  const n = Number.isFinite(value) ? (value as number) : null
  return n !== null && n > 0 ? n : null
}

/** 必填的非负数（圆柱的两个半径），见 `readPart` 里那条「不能都是 0」 */
function nonNegative(value: unknown): number | null {
  const n = Number.isFinite(value) ? (value as number) : null
  return n !== null && n >= 0 ? n : null
}

/**
 * 读 `count`。缺省 1，写了就必须是 `1..MAX_COUNT` 的**整数**。
 *
 * `Number.isInteger` 而不是 `Math.floor`：`count: 2.5` 是一个写错了的数，
 * 取整成 2 会让它静默地少摆一份，而「少摆一份」在画面上与「本来就只有两份」
 * 长得一模一样。带上限是为了拦住 `count: 100000`，见 `MAX_COUNT`。
 */
function readCount(value: unknown): number | null {
  if (value === undefined || value === null) return 1
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 1 && value <= MAX_COUNT ? value : null
}
