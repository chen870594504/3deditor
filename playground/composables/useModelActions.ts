import { useSceneStore } from '../../src'
import type {
  ModelBounds,
  ModelConfig,
  ModelPickPayload,
  ModelTransformPayload,
  TransformMode,
} from '../../src'
import { createModelConfig } from '../../src/utils/config'
import { canvasApi, pushEvent } from './useEditorState'
import type { PickedAsset } from './useEditorState'
import { labelOf } from '../utils/modelLabel'

/**
 * 中栏画布右下角那排模型操作按钮的**动作**。
 *
 * 放在 composable 而不是组件里：这些动作是「编辑器能对当前模型做什么」的定义，
 * 与按钮怎么画无关。右栏「模型属性」页里的「重置变换」也调这里的同一个函数，
 * 两处入口因此不可能出现「同一个操作、两种结果」（历史标签也就只有一条）。
 *
 * 六个动作全部**只作用于当前选中的模型**，且一律：
 *
 * - 先取 `scene.selectedModel`，没有就返回；
 * - 需要几何尺寸的（贴地 / 聚焦）先量一次包围盒，量不出来就返回；
 * - 算出「其实什么都不会变」时提前返回，不写配置。
 *
 * 最后一条不是抠性能：带 label 的 `patchModel` / `applyConfig` 会**绕过**
 * 历史栈里那道「没有实际变化就不记录」的闸门（`forcedLabel` 优先于分组 diff），
 * 于是「本来就贴在地上的模型再点一次贴地」会在撤销栈里留下一条空记录。
 * 撤销两次才能退到真正的上一步，比不做这件事更烦人。
 */

/**
 * 量一个模型的世界包围盒。
 *
 * `canvasApi.measureModel` 由 SceneStage 在挂载时登记，测试环境或消息时序
 * 错开时它可能是 null，所以走可选调用。
 */
function measureOf(model: ModelConfig): ModelBounds | null {
  return canvasApi.measureModel?.(model.id) ?? null
}

/**
 * 这个模型现在量得出尺寸吗。
 *
 * 胶囊用它决定「贴地 / 聚焦」是否可点：模型还没加载完时这两个动作做不了任何事，
 * 而唯一的反馈通道 `pushEvent` 只是往控制台打一行日志——用户看不见。
 * 让按钮变灰，比点下去静默失败诚实。
 *
 * **它必须在 computed 里调用**才会跟着变。依赖有两类：函数内部读到的
 * `measurers`（节点挂上 / 卸下）与调用方自己额外读的 store 状态——
 * 「glTF 加载完成」不会换节点，只能靠 `scene.loading` 这类字段捕捉，
 * 见 ModelActions.vue 里那个 computed。
 */
export function isMeasurable(model: ModelConfig | undefined): boolean {
  return model !== undefined && measureOf(model) !== null
}

/** 两个三元组在容差内相等 */
function sameTriple(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) < 1e-4)
}

/**
 * 贴地：把模型的最低点落到 y = 0 上，x / z 不动。
 *
 * 位移量取 `-box.min[1]`，只有在包裹组的父级是场景根（单位矩阵）时才严格等于
 * 世界 y 的增量——当前场景图下成立，理由见 `SceneModelNode.measure()`。
 */
export function groundModel(): void {
  const scene = useSceneStore()
  const model = scene.selectedModel
  if (!model) return

  const box = measureOf(model)
  if (!box) {
    pushEvent('模型还没就位，量不出尺寸，暂时无法贴地')
    return
  }

  const delta = -box.min[1]
  // 已经贴地：不写。容差取 0.1mm，比任何一次拖动的精度都小得多
  if (Math.abs(delta) < 1e-4) return

  scene.patchModel(
    { position: [model.position[0], model.position[1] + delta, model.position[2]] },
    `贴地 · ${labelOf(model)}`,
  )
}

/**
 * 聚焦：把相机拉到刚好装下当前模型，视线方向保持不变。
 *
 * 三个必须照顾到的地方：
 *
 * 1. **距离要自己夹进 min / maxDistance。** 不夹的话配置里留下的是夹取前的值，
 *    而 OrbitControls 会在 `update()` 里把真实距离夹回去——于是「再点一次聚焦」
 *    写出的机位键与上一次完全相同，`syncCamera` 的 watch 不触发，相机一动不动，
 *    字面意义上的点了没反应。顺带也保证了面板上的读数与实际一致。
 * 2. **宽高比要按视口现量。** `camera.fov` 是**垂直**视场角，视口比相机宽时
 *    水平方向反而更窄、成为约束，只按垂直算会把模型左右切掉。
 *    `atan(tan(v/2) * aspect)` 就是由垂直推水平，取两者里更小的那个。
 * 3. **视线方向取当前机位到注视点的向量。** 只换半径、不换方向，用户不会因为
 *    点了个按钮而「视角被转到别处」；而极角因此不变，本来就在合法区间里，
 *    不需要额外夹取。
 */
export function focusModel(): void {
  const scene = useSceneStore()
  const model = scene.selectedModel
  if (!model) return

  const box = measureOf(model)
  if (!box) {
    pushEvent('模型还没就位，量不出尺寸，暂时无法聚焦')
    return
  }

  const { camera } = scene.config

  const center: [number, number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ]

  // 半对角线当包围球半径：球一定装得下盒，偏大一点点是安全的方向
  const radius = Math.hypot(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ) / 2

  const aspect = canvasApi.viewportAspect?.() ?? 1
  const vFov = (camera.fov * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const fitFov = Math.min(vFov, hFov)

  const fitted = (Math.max(radius, 0.5) / Math.sin(fitFov / 2)) * 1.15
  const distance = Math.min(Math.max(fitted, camera.minDistance), camera.maxDistance)

  const offset: [number, number, number] = [
    camera.position[0] - camera.target[0],
    camera.position[1] - camera.target[1],
    camera.position[2] - camera.target[2],
  ]
  const length = Math.hypot(offset[0], offset[1], offset[2])

  // 机位与注视点重合时方向是 NaN（面板里手填过就会遇到），退回一个斜上方的默认视线
  const direction: [number, number, number] =
    length < 1e-6 ? [0, 0.35, 1] : [offset[0] / length, offset[1] / length, offset[2] / length]

  const position: [number, number, number] = [
    center[0] + direction[0] * distance,
    center[1] + direction[1] * distance,
    center[2] + direction[2] * distance,
  ]

  // 已经对准了这一个模型：别写，否则撤销栈里多一条空记录（见文件头）
  if (sameTriple(camera.target, center) && sameTriple(camera.position, position)) return

  scene.applyConfig({ camera: { position, target: center } }, `聚焦模型 · ${labelOf(model)}`)
}

/**
 * 复制：原地再摆一个一模一样的。
 *
 * 副本与原件**变换完全一致、原地重叠**，靠右栏「场景模型」列表与新加的
 * 「XX 副本」名字区分——「同一个模型摆两种姿态对比」的用法，第一步总是先复制出来。
 *
 * 补丁里必须**剥掉 `id`**：`addModel` 已经给新条目配了一个新 uuid，而
 * `applyPatch` 只跳过 `undefined`、不跳过任何值，把旧 id 带过去会让两个模型
 * 共用一个 uuid——`v-for` 的 key 冲突、测量句柄按 id 索引会互相覆盖、
 * 事件载荷也分不清是谁发的。剥成解构而不是 `delete`，意图更直白。
 *
 * `index` 取 `addModel` 的返回值而不是重读 `selectedIndex`：`addModel` 本来
 * 就会把选中项移到新条目上，但依赖这一点等于依赖两处实现细节对齐。
 */
export function duplicateModel(): void {
  const scene = useSceneStore()
  const model = scene.selectedModel
  if (!model) return

  const { id: _id, ...rest } = model
  const index = scene.addModel(model.url)

  scene.patchModel(
    { ...rest, name: model.name ? `${model.name} 副本` : '' },
    `复制模型 · ${labelOf(model)}`,
    index,
  )
  pushEvent(`已复制模型「${labelOf(model)}」（场景中第 ${index + 1} 个）`)
}

/**
 * 归零：把物体变换恢复成默认值，不碰模型地址。
 *
 * 与右栏那个「重置变换」是同一个函数，因此历史里的标签也只有一条。
 * 默认值从工厂现取，而不是查默认配置里的第一个模型——默认场景是空的，
 * `models[0]` 求值是 undefined；所有模型的默认变换完全一样。
 */
export function resetModelTransform(): void {
  const scene = useSceneStore()
  const model = scene.selectedModel
  if (!model) return

  const { position, rotation, scale } = createModelConfig()

  // 已经是默认变换：不写（见文件头那段）
  if (
    sameTriple(model.position, position) &&
    sameTriple(model.rotation, rotation) &&
    sameTriple(model.scale, scale)
  ) return

  scene.patchModel({ position, rotation, scale }, `重置变换 · ${labelOf(model)}`)
}

/**
 * 显隐：把当前模型隐藏 / 显示。
 *
 * 隐藏的模型照样能选中、能贴地、能聚焦——包围盒的测量不看 `visible`
 * （见 `SceneModelNode.measure()`），所以「先隐藏、贴好、再显示」是通的。
 * 也因此这里不需要为可见性做任何额外处理，只翻转那一个字段。
 */
export function toggleModelVisible(): void {
  const scene = useSceneStore()
  const model = scene.selectedModel
  if (!model) return

  const visible = !model.visible
  scene.patchModel(
    { visible },
    `${visible ? '显示' : '隐藏'}模型 · ${labelOf(model)}`,
  )
}

/**
 * 删除当前选中的模型。
 *
 * 没有二次确认：撤销栈是完整的，弹窗在这个界面里只会更烦人。
 *
 * 一个要知道的既有行为：删掉中间那个之后 `selectedIndex` 数值不变、
 * 指向原位置的后一个（store 的 `clampSelection` 只在越界时才收），
 * 所以**连着点两下会删掉两个模型**。这与右栏列表里那个 × 是同一套语义，
 * 不是这里引入的——两个入口保持一致比各自「聪明」更要紧。
 */
export function removeSelectedModel(): void {
  const scene = useSceneStore()
  const model = scene.selectedModel
  if (!model) return

  scene.removeModel(scene.selectedIndex, `删除模型 · ${labelOf(model)}`)
  pushEvent(`已移除模型「${labelOf(model)}」`)
}

/**
 * 在画布上点中了某个模型。
 *
 * id → 下标 的换算在这里做，而不是给 store 加一个 `selectModelById`：
 * 库只负责说「这个 id 被点了」，它不该知道编辑器有「选中项」这回事。
 *
 * 找不到就什么都不做（模型刚被删掉的竞态），而不是退回选中第一个——
 * 那会让一次没打中的点击莫名其妙跳到别的模型上。
 *
 * **不打 `pushEvent`**：选中是一次即时、且在三处（列表高亮 / 属性面板 /
 * 右下角胶囊）都有回显的界面操作，而控制台的约定是「只报操作回执」。
 * 点一下打一行日志是纯噪音——画布点击恰恰是这个界面里最高频的动作。
 */
export function selectPickedModel(payload: ModelPickPayload): void {
  const scene = useSceneStore()
  const index = scene.models.findIndex((model) => model.id === payload.id)
  if (index < 0) return
  scene.selectModel(index)
}

/** 手柄三种模式在历史标签里的说法 */
const TRANSFORM_LABELS: Record<TransformMode, string> = {
  translate: '移动',
  rotate: '旋转',
  scale: '缩放',
}

/**
 * 画布上的手柄拖完了。
 *
 * **值已经在拖动过程中由库写回 store 了**，这里只补一件事：一个可读的历史标签。
 * 库那边逐帧写入时**不传 label**，因为一次拖拽会产生几十次变更，逐次入栈没法看——
 * store 里那个 400ms 的防抖窗口正是为这类连续改动准备的（与拖动滑块同一条路），
 * 于是整段拖拽在历史里本来就只会留下一条记录，标签是自动拼出来的「模型属性」。
 *
 * 这里带 label 再写一次同样的值，靠的是 store 的既有语义：带 label 的 `patchModel`
 * 会先 `clearTimeout` 掉那次挂起的防抖提交、再立刻 `commit(label)`，
 * 所以**记录条数不变**，只是那条的标签变好看了。
 *
 * 也因此这里**不能**再自己判一遍「到底动没动」：库在发 `modelTransformEnd` 之前
 * 已经比对过起始与结束快照，没动过的（在轴上按一下没拖就松手）根本不会发这个事件。
 * 那一道判断必须留在库那一侧——等事件发出来时值已经写进配置了，
 * 这边再也分不出改没改，而带 label 的写入会**绕过**空改动闸门，
 * 照做就会多出一条什么都没改的记录。
 *
 * payload 里的 id 用来找下标，而不是直接用 `scene.selectedModel`：
 * 库不假设「拖的一定是选中的那个」，这边也不该假设。
 *
 * **不打 `pushEvent`**：与 `selectPickedModel` 同一条约定——控制台的约定是
 * 「只报操作回执」，而拖动是高频动作，每次打一行会盖掉真正有用的那几行。
 * 历史面板里那条标签本身就是回执。
 */
export function commitTransform(payload: ModelTransformPayload, mode: TransformMode): void {
  const scene = useSceneStore()
  const index = scene.models.findIndex((model) => model.id === payload.id)
  if (index < 0) return

  const model = scene.models[index]
  scene.patchModel(
    { position: payload.position, rotation: payload.rotation, scale: payload.scale },
    `${TRANSFORM_LABELS[mode]}模型 · ${labelOf(model)}`,
    index,
  )
}

/**
 * 一块地板要铺的区域。
 *
 * 与 `FloorplanFoundation` 同口径：x / z 是**中心点**（不是左上角），
 * width / depth 是米。`commitFoundation` 那边就是这么算出来的，直接搬过来。
 */
export interface FloorRegion {
  x: number
  z: number
  width: number
  depth: number
}

/**
 * 地板铺完之后的表面高度。
 *
 * 三个邻居都要让开：网格线在 `y = 0`，房间色块在 `y = 0.035`
 * （`SceneFloorplanRoom.vue` 的 `FLOOR_Y`），地基板顶面在 `y = 0.005`
 * （`SceneFloorplanFoundation.vue` 的 `TOP_GAP`）。
 *
 * 15 毫米是照那两处的算法定的：2D 档相机在 110 米高、`near 0.1` / `far 200` 下
 * 深度缓冲约每 7 毫米一个单位，15 毫米就是 2 个单位，与房间色块最后剩下的
 * 那点余量同量级。
 *
 * **不取 5 毫米**（贴着地基板顶面）：那正是那两个常量反复警告的位置——落在噪声带里
 * 逐像素比大小。地基板能在那里站住，靠的是它材质上那组 `polygonOffsetUnits = -2`，
 * 而 glb 的材质是加载出来的，我们够不着、也就给不了同样的保证；
 * 照抄它的高度只会得到一片闪烁。**宁可浮着 10 毫米**：2D 俯视下看不出来，
 * 3D 档凑近看是「地板搁在地上」，比闪要体面得多。
 *
 * 不改成从 `src/utils/floorplan.ts` 引一个共享常量，是因为那会让公开的 `.d.ts`
 * 多一个符号（那个文件是 `export type *` 之外的运行时导出），而这里只有一个消费者。
 */
const FLOOR_SURFACE_Y = 0.015

/**
 * 等加载的上限，毫秒。
 *
 * 超过就当成加载失败。两个地板 glb 是 7~9 MB，慢网下要好几秒，所以给得宽；
 * 但**不能不给**——否则一块永远加载不出来的地板会以 `visible: false` 的样子
 * 一直挂在场景里，用户只能看到一个右栏删不掉的幽灵条目。
 */
const FLOOR_FIT_TIMEOUT_MS = 12_000

/** 脚印小于这个尺寸的模型没法「铺满」一个区域：除法会给出一个天文数字的缩放 */
const MIN_FOOTPRINT = 1e-3

/**
 * 模型清单里没写 `span`（或写了个不合法的值）时的兜底：2.4 米。
 *
 * 2.4 不是一个凑出来的数，是现有两块地板的实测值（`tile1` 的 4 × 4 块砖 ×
 * 0.6 米、`wood` 的 12 行板 × 0.2 米，见 `utils/modelList.ts`），也是这类
 * 可平铺贴图很常见的尺寸。
 *
 * **猜一个总比不猜好**：不猜就是 `repeat` 恒为 1，也就是改造前那个
 * 「图案跟着区域一起放大」的现象——一个没写 `span` 的新资产会原样复现用户
 * 报的那个 bug。猜错的代价只是砖看起来偏大或偏小，**但每一块都一样大**，
 * 而且改回来是清单里加一个数。
 */
const DEFAULT_FLOOR_SPAN = 2.4

/**
 * 把一块地板模型按区域尺寸铺开——「点地基 → 选地板 → 划一块区域」那条链的最后一环。
 *
 * 区域那边由 `commitFoundation()` 算好（它才是知道手势状态的地方），这里只管模型。
 * 所以本函数**不 import `useFloorplanTool`**：那边反过来要调这里，双向引用就是真环——
 * 两个模块顶层都有副作用（那边建 ref 与状态机、这边取 store），环下必有一方拿到
 * `undefined`，而且是在生产构建里才发作。需要往视口提示行说话时走 `onFail` 回调
 * （传进来的是那边的私有 `flash`）。
 *
 * 三件事依次做，顺序不能换：
 *
 * 1. **追加一个模型，立刻把它设成不可见。** 为什么不攒到最后一起写：区域的宽深是
 *    已知的，但模型自己的原生脚印要等 glb 加载完才知道，而这中间隔着一次网络往返。
 *    不可见让这段时间屏幕上什么都不出现——否则会看到一块 1:1 的模型先落在原点、
 *    再跳到位。**测量不看 `visible`**（见 `SceneModelNode.measure()`），所以藏起来
 *    照样量得出。副产物是「撤销一次」看起来就是「那块地板没了」，正合直觉。
 *
 * 2. **逐帧重试测量**，直到量得出包围盒。没有 Promise 可以等：`measureModel` 在
 *    「节点没挂上 / 没加载完 / 顶点含 NaN」时一律返回 null（见 `isMeasurable`
 *    上面那段），「加载完成」也不是一个可 await 的事件。
 *
 * 3. **一次写入把位置与缩放补齐。** 这一步**必须带 label**：中间隔着几百毫秒，
 *    用户完全可能已经点了别的模型，不带 label 的 `patchModel` 会落到
 *    `selectedIndex` 上，把尺寸写到别人身上。
 *
 * 代价要说在明处：一次操作留**两条**历史（第 1 步一条「生成地板」、第 3 步一条
 * 「铺满区域」），与文件头那条「不写空记录」的规矩不冲突——这两条都是实打实的变化。
 * 压成一条只能先自己 fetch 一遍 glb、量好尺寸再入场景，那是重复下载加重复解析，
 * 而且 draco 压缩过的 glb 在裸 GLTFLoader 下会直接失败，不划算。
 *
 * 已知边界：如果用户在加载完成前就撤销掉那块地板，重试会静默退出（见下），
 * 于是「再重做」回来的那个模型会保持隐藏。撤销本身是对的，这个尾巴就留着。
 */
export function layFloorModel(
  floor: PickedAsset,
  region: FloorRegion,
  onFail: (text: string) => void,
): void {
  const scene = useSceneStore()
  const index = scene.addModel(floor.url)

  /** 之后一律按 id 找下标，不再信任上面这个 index——中间可能有别的增删 */
  const id = scene.models[index]?.id
  if (!id) return

  scene.patchModel({ name: floor.label, visible: false }, `生成地板 · ${floor.label}`, index)

  const deadline = performance.now() + FLOOR_FIT_TIMEOUT_MS

  /**
   * 放弃：把那块永远不可见的地板删掉，而不是留在右栏列表里当幽灵。
   *
   * 用 id 重新找下标，不记住 `index`：这中间用户可能已经删过别的模型，
   * 而删错一个比留一个幽灵严重得多。已经不在列表里（用户自己删了）就只报错、不删。
   */
  function giveUp(text: string): void {
    const current = scene.models.findIndex((model) => model.id === id)
    if (current >= 0) scene.removeModel(current, `移除没加载出来的地板 · ${floor.label}`)
    onFail(text)
  }

  function step(): void {
    const current = scene.models.findIndex((model) => model.id === id)

    /*
      模型已经不在了——用户撤销了，或者把它删了。这是他的意思，静默收手：
      再写一次补丁会落在一个不存在的下标上（`patchModel` 越界是静默 return，
      看上去没事），但下一次撤销会退到一个他从没见过的状态。
    */
    if (current < 0) return

    const box = canvasApi.measureModel?.(id) ?? null

    if (!box) {
      if (performance.now() > deadline) {
        giveUp(`地板「${floor.label}」没能加载出来，检查一下服务器上的文件`)
      } else {
        requestAnimationFrame(step)
      }
      return
    }

    const footprintX = box.max[0] - box.min[0]
    const footprintZ = box.max[2] - box.min[2]

    // 退化成一条线的东西铺不满任何区域：除出来的是天文数字，几何体会直接飞到画面外
    if (footprintX < MIN_FOOTPRINT || footprintZ < MIN_FOOTPRINT) {
      giveUp(`「${floor.label}」在地面上没有脚印（宽或深近乎 0），铺不满这块区域`)
      return
    }

    const scaleX = region.width / footprintX
    const scaleZ = region.depth / footprintZ

    /*
      贴图按区域尺寸重复，图案的实物尺寸才不随地基大小变。

      **摊的是区域尺寸，不是上面那两个 `scale`**。`scaleX` 说的是「几何被放大了
      几倍」，它与贴图密度无关；而贴图的一个 uv 重复在缩放后覆盖的就是**整块区域**
      （资产的 UV 铺满 0..1），所以「想让一个重复 = `span` 米」就是
      「这块区域里有几个 `span`」。反过来把 `scaleX` 当 repeat 用，得到的正是
      用户报的那个现象：地基画多大，砖就有多大。

      `span` 是资产自己的属性（一个 uv 重复铺几米），一路从模型清单原样搬到这里
      （`LibraryFile.span` → `LibraryEntry.span` → `PickedAsset.span`），
      解释在清单那边。不合法的值（0、负数、NaN）当没写，走兜底——
      重复次数为 0 或负数会让采样塌成一条线。
    */
    const span =
      typeof floor.span === 'number' && Number.isFinite(floor.span) && floor.span > 0
        ? floor.span
        : DEFAULT_FLOOR_SPAN
    const repeat: [number, number] = [region.width / span, region.depth / span]

    /*
      位置要连同「缩放是以模型自己的原点为中心做的」一起算掉：量出来的 min/max 是
      相对那个原点的，乘完缩放之后脚印中心跑到了 (min + max) / 2 × scale 上，
      把它减掉，脚印中心才落在区域中心。

      y 那一路是另一件事：给的是**底面的落点**，所以只跟 min.y 有关（y 方向不缩放，
      见下）。写成「减 min.y」而不是「等于 FLOOR_SURFACE_Y」，是为了让
      底面不在原点上、或者原点在模型中间的 glb 也照样贴对。
    */
    const position: [number, number, number] = [
      region.x - ((box.min[0] + box.max[0]) / 2) * scaleX,
      FLOOR_SURFACE_Y - box.min[1],
      region.z - ((box.min[2] + box.max[2]) / 2) * scaleZ,
    ]

    /*
      y 方向的缩放**恒为 1**：这是「把区域铺满」而**不是**「把模型拉成区域那么大」。
      跟着 x / z 一起拉 y，会得到「区域越大地板越厚」的怪东西，而厚薄是模型的
      美术设定，跟区域尺寸没有关系。两块现有地板都是零厚度平面，这一项对它们是恒等。
    */
    scene.patchModel(
      { visible: true, position, scale: [scaleX, 1, scaleZ], repeat },
      `铺满区域 · ${floor.label}`,
      current,
    )
    pushEvent(`已铺「${floor.label}」：${region.width} × ${region.depth} 米`)
  }

  requestAnimationFrame(step)
}
