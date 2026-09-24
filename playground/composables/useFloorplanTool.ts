import { computed, ref } from 'vue'
import { useSceneStore } from '../../src'
import type {
  DeepPartial,
  FloorplanConfig,
  FloorplanOpening,
  FloorplanOpeningKind,
  FloorplanPoint,
  FloorplanWall,
  OpeningGap,
  OpeningRejectReason,
} from '../../src'
import {
  CELL_SIZE,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  WINDOW_HEIGHT,
  WINDOW_SILL,
  WINDOW_WIDTH,
  cloneFloorplanPatch,
  createFloorplanId,
  findEnclosedArea,
  findNearestWall,
  openingFreeGap,
  openingMagnetOffset,
  openingRejectReason,
  pickRoomColor,
  pointAlongWall,
  pointInPolygon,
  removeWall,
  resolveOpeningDrag,
  wallLength,
  wallPieces,
  wallRotationY,
} from '../../src'
/**
 * 「算不算一次点击」的判据从 `src/utils/pointerClick.ts` 直接引入，不走 `'../../src'` 入口。
 *
 * 它没有做成公开导出（库的公开面只收「宿主也会需要」的东西），而这里**必须**用同一份：
 * 另写一套阈值的话，拖着转视角就会顺手落下一个点，与「拖着转视角顺手选中了模型」
 * 是同一类 bug。`useInspectorSchema.ts` 引 `createModelConfig` 是同一个先例。
 */
import { CLICK_MAX_DRIFT, isClickGesture, trackPress } from '../../src/utils/pointerClick'
import type { PressRecord } from '../../src/utils/pointerClick'
import { applyMeasuredAssetSize, canvasApi, openLibrarySection, pickedAssetOf, previewMode, pushEvent, setAssetPick, toggleAssetPick } from './useEditorState'
import type { PickedAsset } from './useEditorState'
import type { LibrarySectionKey } from './useModelLibrary'
/**
 * 铺地板那一步住在 `useModelActions.ts`，与 `measureOf` / 「无变化就不写」那些约定同一份；
 * 这里只负责「区域是怎么划出来的」。**依赖方向只能是这一边引那一边**：
 * 那边需要往提示行说话时走 `onFail` 回调，反过来引它就是真环，理由见那边的文件头。
 */
import { layFloorModel } from './useModelActions'
import { setViewMode, viewModeOf } from './useViewMode'

/**
 * 视口里的绘制工具。
 *
 * 状态机在**编辑器**这一侧，不在库里：库只回答「这个屏幕坐标落在地面哪一点」
 * （`canvasApi.groundPointAt`），至于这一点意味着「画一面墙」还是「什么都不做」，
 * 是编辑器的事。这与 `measureModel` / `captureCamera` 是同一条分界线。
 *
 * 全部是模块级 ref，与 `gizmoMode` / `uniformScale` 同一条约定：**界面状态，
 * 不进配置、不进历史、不进导出物**。尤其「画到一半的那条墙链」绝不能进配置——
 * `SceneConfig` 只放可 JSON 往返的、用户已经确认存在的东西。
 */

export type FloorplanTool = 'select' | 'foundation' | 'wall' | 'door' | 'window' | 'room'

/**
 * 工具条上的五个工具及其常驻说明。
 *
 * `select` 不在这个列表里——它是「什么工具都没开」的空档，不是一件工具，
 * 所以它不出现在工具条上，只能由「再点一次当前工具」「Esc」「切回 3D」进入。
 *
 * **空档不是「什么都不做」**：点选门窗、沿墙拖动就住在那儿
 * （见下面「点选与拖动」那一节）。放在空档而不是新加一枚「选择」工具，
 * 是因为这套界面的惯例一直是不为「什么都不做」发明一个状态：
 * 再点一次当前工具就是回到它。代价是这套交互**没有按钮可点**，
 * 只能靠提示行那一句话被发现——所以 `floorplanHint` 在空档里必须说话。
 *
 * 说明文字是**必须的**：这套交互里有好几条规则（点回起点闭合、只能横平竖直、
 * 再点一下删掉）在画面上没有任何别的落点，不写下来用户不可能猜到。
 */
export const FLOORPLAN_TOOLS: { tool: FloorplanTool; label: string; hint: string }[] = [
  {
    tool: 'foundation',
    label: '地基',
    /*
      两种输出都写进来，因为这条同时是按钮的 `title`（见 FloorplanTools.vue）：
      用户还没点过任何地板、只是把鼠标挪上来时读到的就是它。
      真正常显的那一句在 `floorplanHint` 里按「选没选地板」分开说。
    */
    hint: '按住左键拖出一个矩形：选过地板就按区域铺满那块地板，没选就落成一块灰色地基板',
  },
  {
    tool: 'wall',
    label: '画墙',
    hint: '逐点点击落墙（只能横平竖直），点回起点闭合；Shift + 点击删掉一面墙；选过墙壁模型的话，落下的墙会铺上它',
  },
  {
    tool: 'door',
    label: '门',
    hint: '点墙放下门洞；再点同一个位置删掉；选过门模型的话，落下的门会装上它',
  },
  { tool: 'window', label: '窗', hint: '点墙放下窗洞；再点同一个位置删掉；选过窗模型的话，落下的窗会装上它' },
  { tool: 'room', label: '房间', hint: '点墙体围出的区域内部，识别成一个房间' },
]

/** 当前工具 */
export const floorplanTool = ref<FloorplanTool>('select')

/**
 * 每个工具从模型库的**哪一类**里挑料、挑了之后是「装什么」。
 *
 * 唯一真相表：`setFloorplanTool` 用它决定顺手切到哪个分类，`floorplanHint`
 * 用它说出现在落笔会得到什么，`ModelLibrary.vue` 用它反查「当前分类是不是
 * 正在给某个工具选料」。这三处原本各写一遍 `'foundation'` / `'floor'`，
 * 多一个配料工具就要改三处、漏一处的表现是「点了工具，左栏没跟着走」这种静默错误。
 *
 * **只收有「得先挑一件东西」这回事的工具**：房间没有料可挑
 * （它的位置由点在哪块区域里决定、也没有第二件资产可选），所以这张表是
 * `Partial`——查不到就意味着这个工具不切分类。
 * **门与窗都在表里**：库里两者都是「整樘」资产（框 + 扇 / 框 + 玻璃），
 * 选一件之后落笔就会把它装进洞口。两者走的是**同一条链**——同一个渲染组件
 * （`SceneFloorplanOpeningModel`）、同一对清单字段（`width` / `height`）、
 * 同一个落笔函数（`placeOpeningAt`），所以表里也是对称的两行。
 *
 * `purpose` 是动词短语，会拼进提示行的句子里（「用『瓷砖地板』铺地基」），
 * 所以它得能接在「会」和「想」后面读通。
 *
 * `tail` 可选，拼在两句话的末尾，用来补一句**这个工具特有的操作提醒**。
 * 它存在的理由是一个具体的坑：规则句会**整句替换**掉 `FLOORPLAN_TOOLS` 里那条
 * 操作说明（见 `floorplanHint`），而门窗那两条说明里「再点同一个位置删掉」是这套
 * 交互里唯一说出来的一次——门窗没有别的删法（墙是 Shift + 点击，有单独的提示）。
 * 不给它们留这一句，用户选中一扇门之后就再也看不到怎么撤销了。
 */
export const TOOL_ASSET_RULES: Partial<
  Record<FloorplanTool, { section: LibrarySectionKey; purpose: string; tail?: string }>
> = {
  foundation: { section: 'floor', purpose: '铺地基' },
  wall: { section: 'wall', purpose: '铺墙面' },
  door: { section: 'door', purpose: '装门', tail: '点在这个门洞上再点一次删掉它' },
  window: { section: 'window', purpose: '装窗', tail: '点在这个窗洞上再点一次删掉它' },
}

/**
 * 这个工具当前待用的料。
 *
 * 两个包装存在的唯一理由是**把 `pickedAssets` 的 `string` 键收在模块内部**
 * （理由见 `useEditorState.ts` 里那个 ref 的注释）：本模块知道工具名的取值集合，
 * 于是这里能给出真正的类型，而调用方不必知道「那个表是按字符串索引的」。
 */
export function pickedAssetFor(tool: FloorplanTool): PickedAsset | null {
  return pickedAssetOf(tool)
}

/** 选用 / 取消选用一件料。**点已选用的那一件就是取消**，见 `toggleAssetPick` */
export function toggleAssetPickFor(tool: FloorplanTool, entry: PickedAsset): void {
  toggleAssetPick(tool, entry)
}

/**
 * **设置**这个工具待用的料（点同一件不取消），替换那条路要的语义，见 `setAssetPick`。
 *
 * 与上面那个一样，存在只是为了把 `pickedAssets` 的 `string` 键收在模块内部。
 */
export function setAssetPickFor(tool: FloorplanTool, entry: PickedAsset): void {
  setAssetPick(tool, entry)
}

/**
 * 这类洞口的外观资产住在左栏哪一类，查不到就是 `null`。
 *
 * **从 `TOOL_ASSET_RULES` 查，不写第二张表**：那张表是「这个工具从哪一类里挑料」
 * 的唯一真相（`setFloorplanTool` 与 `floorplanHint` 都读它），而「这扇门的外观资产
 * 住在哪」问的是同一件事。另起一张表的代价是将来加第五个配料工具时要改两处，
 * 而漏一处的表现是「点了门，左栏走到别处去」——它不报错，只是走错门。
 *
 * 表是 `Partial`（房间那种工具不在里面），所以要回答「可能没有」。
 */
export function sectionKeyForOpening(kind: FloorplanOpeningKind): LibrarySectionKey | null {
  return TOOL_ASSET_RULES[kind]?.section ?? null
}

/**
 * 把量出来的洞口尺寸补到待用的那份料上。道理在 `applyMeasuredAssetSize` 上
 * （**清单写了数就听清单的**，只在清单没写时才补，差得远时点一句名），
 * 这里与上面两个一样只负责**把 `string` 键收在模块内部**。
 */
export function applyMeasuredSizeFor(
  tool: FloorplanTool,
  url: string,
  size: { width: number; height: number },
): void {
  applyMeasuredAssetSize(tool, url, size)
}

/**
 * 这个工具落笔时占的是一个**洞口**（门 / 窗），洞口的大小要照资产的外廓量。
 *
 * 判据取自 `OPENING_SIZES` 这张表本身，而不是写 `tool === 'door' || tool === 'window'`：
 * 工具名与洞口种类**一一对应**这句话正是 `placeOpeningAt` 依赖的那一条
 * （那边有一段解释），照表判就永远是同一句话，将来多一种洞口也不会漏。
 *
 * 用它的是 `ModelMeasureProbe.vue`：只有洞口那一件需要量宽高，地板用的是 `span`、
 * 墙两者都不用，给它们也各拉一次 glb 是白花一次请求。
 */
export function isOpeningTool(tool: FloorplanTool): boolean {
  return tool in OPENING_SIZES
}

/**
 * 画到一半的墙链（已吸附的拐点，按点击顺序）。
 *
 * 它只是**橡皮筋的骨架**：每落一点都已经提交了一段真墙（见 `pickWallPoint`），
 * 链本身没有任何东西进了配置。所以丢掉它是安全的，也是右键回退一点的做法。
 */
export const wallChain = ref<FloorplanPoint[]>([])

/** 墙工具下光标所在的那个格点，用来画「上一点 → 光标」那条橡皮筋 */
export const hoverPoint = ref<FloorplanPoint | null>(null)

/** 地基工具下正在拖的矩形，两个对角格点 */
export const foundationDrag = ref<{ from: FloorplanPoint; to: FloorplanPoint } | null>(null)

/**
 * 临时顶掉常驻说明的一句话，空串表示「没有话要说」。
 *
 * 编辑器没有 toast 体系（`pushEvent` 只往控制台打日志，用户在界面上看不见），
 * 而「斜着点不落点」这类**拒绝**必须让用户看见——否则就是点了没反应。
 * 所以让提示行兼一个 1.6 秒的临时态，而不是新引一层浮层。
 */
const override = ref('')

/** 临时说明挂多久（毫秒）。够读完一句话，又不至于压在常驻说明上太久 */
const OVERRIDE_MS = 1600

let overrideTimer: ReturnType<typeof setTimeout> | null = null

/** 在提示行上顶一句临时说明，同时往控制台留一条回执（与其它动作一致） */
function flash(text: string): void {
  override.value = text
  if (overrideTimer) clearTimeout(overrideTimer)
  overrideTimer = setTimeout(() => {
    override.value = ''
  }, OVERRIDE_MS)
  pushEvent(text)
}

/** 距墙端点多近算「吸上去」 */
const ENDPOINT_SNAP = 0.4

/**
 * 门窗落点的命中阈值，0.6 米。
 *
 * 参考项目用的是 0.45 —— 但那个数是在 SVG **像素**空间里用的（它另一处
 * `findWallAt` 又用 16px，两处并不一致）。换到米制 + 1 米格上偏紧：
 * 1 米宽的走廊，站在中间时离两面墙各 0.5 米，0.45 点不中；而 2 米宽的屋子
 * 中心离墙 1 米，0.6 也不会误中。
 */
const WALL_HIT_DISTANCE = 0.6

/**
 * 判「算不算点上了某个洞口」时，除了落点在它沿墙的跨度里，还往外放宽一点，米。
 *
 * 5 厘米，比落点本身的网格（1 米）小两个数量级，只用来吸收**投影**那一步的
 * 角度误差：斜墙（用户能画出斜墙，只是房间识别不认）上，屏幕上一个像素对应
 * 沿墙好几厘米。放宽的是「点中」，不影响任何写入的位置。
 */
const OPENING_PICK_SLACK = 0.05

// ---------------------------------------------------------------------------
// 读
// ---------------------------------------------------------------------------

/**
 * 取 store。
 *
 * 写成函数而不是模块级的 `const scene = useSceneStore()`：模块求值发生在
 * `app.use(createThreeDMaker())` 之前，那一刻 Pinia 还没装上（`useEditorState` /
 * `useViewMode` 都是同一个写法，函数内部各自取一次）。
 */
function usePlan() {
  return useSceneStore()
}

/**
 * 现在是不是「能改平面图」的那一档：2D 俯视、允许旋转关着、且不在预览里。
 *
 * 它从 `floorplanEnabled` 里抽出来，是因为**空档里那件事（点选 / 拖动门窗）
 * 要用同一道闸**：两处判据必须逐字相同，分开各写一遍迟早会出现
 * 「工具开着时画不了、空档里却能拖」这种一半好使的状态，而它不报错。
 *
 * 三道闸，任何一道不过就**不派发**任何改动：
 *
 * 1. 不在 2D 档——「在 2D 里画」是这套界面的前提。工具条切工具时会顺手切到 2D，
 *    但用户之后完全可以自己点回 3D，那时不该还能在斜视角上落点；
 * 2. `enableRotate` 为真——2D 档会把它关掉，可用户能在面板里手动打开。
 *    那时左键既要转视角又要改平面图，两条规则直接冲突，所以让平面图这侧退让。
 *    （不去改 OrbitControls 的 `enabled`：那会引入一个可能静默锁死视角的新失败态，
 *    而 `pointercancel`、窗口失焦、组件卸载三条路都得记着置回 true。）
 * 3. **预览**。预览是「看成品」，而这套界面里的每一个动作都会**真的改配置**。
 *    今天进预览靠 `enterPreview` 把工具落回空档兜着，而空档这条路正好从那个
 *    兜底里漏出去（它本来就是空档），所以这一层只能在这儿——
 *    靠调用方记得，迟早会漏一处。
 *
 * 它做成 computed 是为了让提示行能说出**为什么**不能改——静默失效和
 * 「点了没反应」是同一种体验，而这两条又恰恰都是用户自己改出来的。
 *
 * 导出是因为它同时也是**绘制工具条摆不摆出来**的判据（`FloorplanTools.vue`）：
 * 画不了的时候把五枚按钮留在那儿，唯一的下场就是用户点了一下、什么也没发生
 * （点了工具确实还会顺手切回 2D，可那正是「用户没打算切档」的那种意外）。
 * 隐藏**不等于**把工具关掉：开着的工具与画到一半的墙链原样留着，
 * 于是切回 2D 就能接着画——那条决定见 DESIGN.md（不关掉是有意的）。
 */
export const planView = computed(() => {
  if (previewMode.value) return false
  const { camera } = usePlan().config
  if (camera.enableRotate) return false
  return viewModeOf(camera) === '2d'
})

export const floorplanEnabled = computed(
  () => floorplanTool.value !== 'select' && planView.value,
)

/**
 * 被挡住的原因，没被挡住时是空串。
 *
 * 返回**代号而不是句子**：原因是同一件事，但两处要说的句子不一样
 * （工具开着时说「绘制已停用」，空档里说「拖不动它」），把句子写在
 * 各处的调用点上，这里就永远只是判据。
 *
 * **顺序不能换**：`enableRotate` 必须判在 2D 之前。在 2D 档上手动打开
 * 「允许旋转」是完全可能的（那正是这道闸存在的原因），先判 2D 会返回空串，
 * 于是提示行说「可以拖」，而按下去其实在转视角。
 */
function planBlockReason(): 'rotate' | 'view' | '' {
  const { camera } = usePlan().config
  if (camera.enableRotate) return 'rotate'
  if (viewModeOf(camera) !== '2d') return 'view'
  return ''
}

/**
 * 提示行现在该显示什么，空串表示整行不渲染。
 *
 * 临时说明优先于常驻说明，常驻说明优先于「被挡住的解释」。
 * 最后那条只有在工具确实开着、却被闸门挡下时才会出现——那时常驻说明是误导
 * （它描述的是一套按不动的操作），必须让位。
 *
 * **空档这一支是这套交互唯一的发现路径**：点选东西没有按钮可点
 * （工具条上刻意不为「什么都不做」加一枚「选择」），所以只要场上有得可点、
 * 而当下的操作又做得成（没被闸门挡住），就得说出来。这一段是那次改动里唯一
 * 「用户看不出出错」的地方。
 */
export const floorplanHint = computed(() => {
  if (override.value) return override.value

  const blocked = planBlockReason()

  if (floorplanTool.value === 'select') {
    // 预览是看成品：提示行在这时说话只会变成噪音
    if (previewMode.value) return ''

    const selected = selectedOpening.value
    if (selected) {
      const noun = selected.opening.kind === 'door' ? '门' : '窗'
      const where = `沿墙 ${selected.opening.offset.toFixed(2)} 米`

      if (blocked === 'rotate') {
        return `已选中一个${noun}（${where}），但左键此刻会旋转视角，拖不动它——请在「相机」页关掉「允许旋转」`
      }
      if (blocked === 'view') return `已选中一个${noun}（${where}）：切到 2D 俯视角才能沿墙拖动它`

      /*
        删掉它那半句指到右栏，而不是复述「再点一次当前工具」：
        要删一个已经选中的洞口，用户得先开一个门 / 窗工具（那会切走选中的状态），
        而右栏「平面图 → 04 门窗」那一行的 × 与选中状态无关。

        「左栏点一格就换掉它」这句也不能省：这套交互的入口只有**这条提示行**
        （设计决定 38 那段写着的），而替换是**第二个**入口——左栏自己会切到
        这一类的分类上，但「切过去之后点一格会发生什么」得说出来，不然那看起来
        只是「左栏跳了一下」，用户点下去之前不知道自己在换模型。
      */
      return `已选中一个${noun}（${where}）：按住左键沿墙拖就能挪位置；左栏点一格就换掉它；删掉它用右栏「平面图 → 04 门窗」那一行`
    }

    /*
      墙这一支。三句都得另写，一句都不能照搬洞口那套：

      - **墙没有「拖」这回事**（换墙面模型只重写一个 `url`，几何一个字节都不动），
        所以洞口那句「按住左键沿墙拖就能挪位置」在这里是假的；连 `blocked`
        那两种「拖不动它」也不适用——墙本来就没有那个手势，那不叫「被挡住」。
      - 中点取两端平均，**与右栏「03 墙」那一行是同一个式子**（那边显示时去掉了
        尾零、这里保留两位，数字一样，用户照着这个数能在右栏认出是哪一行）。
        没把那个格式化函数提出来共用，是因为它住在一个组件的 `<script setup>` 里，
        只为这一处显示去动那个文件不划算；两处显示的数相同，能对上。
      - 删墙那半句指到右栏：空档里 `Shift + 点击` 够不到（那条路要过
        `floorplanEnabled` 闸，而按下时的 Shift 守卫在 `select` 上直接返回）。
    */
    const wall = selectedWall.value
    if (wall) {
      const [cx, cz] = pointAlongWall(wall, wallLength(wall) / 2)
      return `已选中一面墙（中点 ${cx.toFixed(2)}, ${cz.toFixed(2)}）：左栏点一格就换掉它；删掉它用右栏「平面图 → 03 墙」那一行`
    }

    /*
      未选中这一句是空档这套交互**唯一的发现路径**（点选没有按钮可点，工具条上
      刻意不为「什么都不做」加一枚「选择」），所以它得说给所有人听：原先它只在
      「场上有洞口」时才出现，于是「画了几面墙、还没放门窗」这个最常见的状态下，
      用户根本不知道画布可以点。

      后半句「可以沿墙挪位置」**只对洞口成立**（墙没有那个手势，见上），
      所以按有没有洞口分开说——与下面 `blocked` 那条同一个理由：
      不描述做不了的手势。

      两样都没有（空场景）时整句不说：那时画布上确实没有可点选的东西。
    */
    // 拖不动时不说：那时这句话描述的是一套按不动的手势
    if (blocked) return ''

    const { walls, openings } = plan()
    if (openings.length > 0) {
      return '点一个门或窗就能选中它，选中后按住左键可以沿墙挪位置；点一面墙也能选中它'
    }
    return walls.length > 0 ? '点一面墙就能选中它，左栏点一格就换掉它的墙面模型' : ''
  }

  if (blocked === 'rotate') {
    return '左键此刻会旋转视角，绘制已停用——请在「相机」页关掉「允许旋转」'
  }
  if (blocked === 'view') return '绘制只在 2D 俯视角下可用，点右上角的「2D」'

  /*
    有配料的工具（地基、画墙、门、窗）分两句说：选过料 / 没选。这是这条链上**唯一**
    说得出「现在落笔会得到什么」的地方——左栏那一格只有一圈高亮，说不清它是
    「待用」还是「已经在场景里」。所以这两句不退回 FLOORPLAN_TOOLS 里那条
    笼统的说明（那条说的是**怎么操作**，这条说的是**会得到什么**，两件事）。

    句子从 TOOL_ASSET_RULES 的 `purpose` 拼出来，而不是按工具名写死四句话：
    少一个配料工具就少一处要同步改的地方。没选料那句统一说「灰色默认外观」——
    地基的灰板、墙的灰盒子、门窗的灰框条加门扇 / 玻璃正是这同一件事。

    `tail` 是那个「怎么操作」的补偿：规则句替换掉了 FLOORPLAN_TOOLS 那条，
    而门窗那两条里「再点同一个位置删掉」是它们唯一的删法（墙是 Shift + 点击，
    在墙那条自己的说明里）。理由写在 TOOL_ASSET_RULES 那段。
  */
  const rule = TOOL_ASSET_RULES[floorplanTool.value]
  if (rule) {
    const asset = pickedAssetFor(floorplanTool.value)
    const tail = rule.tail ? `；${rule.tail}` : ''
    if (!asset) return `现在落笔是灰色默认外观；想${rule.purpose}，先在左栏点一块${tail}`

    /*
      选了料就顺嘴说一句**洞口会开多大**。

      这一句不是装饰：洞口尺寸跟着料走（`placeOpeningAt` 顶上那段解释了为什么），
      而下笔之前「墙上的洞会变成 1.8 米宽」这件事**没有别的地方看得见**——
      左栏那一格只有一圈高亮，它说不清这个。不说的话用户点完料、在墙上点一下，
      得到的是一个比预期宽一倍（或窄一半）的洞，还会多一条撤销记录。

      只在料带了这两个数时才说（今天只有门与窗）：地基与墙的料没有它们，
      句子与改造前一模一样。
    */
    const opening =
      asset.width !== undefined && asset.height !== undefined
        ? `，洞口按 ${asset.width.toFixed(2)} × ${asset.height.toFixed(2)} 米开`
        : ''

    return `现在落笔会${rule.purpose}，用的是「${asset.label}」${opening}；再点一次左栏的「${asset.label}」就取消${tail}`
  }

  return FLOORPLAN_TOOLS.find((item) => item.tool === floorplanTool.value)?.hint ?? ''
})

/** 当前有工具开着（不管能不能用） */
function floorplanActive(): boolean {
  return floorplanTool.value !== 'select'
}

// ---------------------------------------------------------------------------
// 写
// ---------------------------------------------------------------------------

/**
 * 户型图配置的唯一写入口。
 *
 * 补丁一律先过一遍 `cloneFloorplanPatch`：`applyConfig` 走的 `applyPatch`
 * 对数组是 `target[key] = value`（**别名而非拷贝**），而这里的数组元素都是从
 * `scene.config` 上读出来的 **reactive 代理**——直接写回去等于把代理装进配置，
 * 之后它就成了一条编辑器与配置之间的隐式通道。过一遍拷贝，写进去的永远是纯对象。
 *
 * 每次写入都是一次带标签的 `applyConfig`，于是撤销、历史、导出全部白拿
 * （把平面图数据放进 `SceneConfig` 而不是另立一个 store 的主要理由）。
 *
 * `label` 可省，给的语义是**中间态**：不带 label 的 `applyConfig` 走 400ms 防抖、
 * 不立刻进历史，与 `SceneViewer` 拖模型那条路一致（拖动中每一帧都往历史里
 * push 一条的话，一次拖动会留下几十条记录）。抬手时再补一条带 label 的，
 * 一次拖动在历史里就是**一条**「移动门」。
 */
function writeFloorplan(patch: DeepPartial<FloorplanConfig>, label?: string): void {
  usePlan().applyConfig({ floorplan: cloneFloorplanPatch(patch) }, label)
}

/** 已有的全部墙 / 门窗 / 房间 */
function plan(): FloorplanConfig {
  return usePlan().config.floorplan
}

// ---------------------------------------------------------------------------
// 坐标换算
// ---------------------------------------------------------------------------

/** 四舍五入到最近的 1 米格点 */
function snap(point: FloorplanPoint): FloorplanPoint {
  return [
    Math.round(point[0] / CELL_SIZE) * CELL_SIZE,
    Math.round(point[1] / CELL_SIZE) * CELL_SIZE,
  ]
}

/**
 * 屏幕坐标 → 吸附后的地面格点。
 *
 * 落不到地面（相机或画布还没就绪、视线与地面平行）时返回 null，
 * 调用方一律当成「这一步不算数」——与库那一侧「拿不准就不给」是同一条。
 */
function groundPointOf(event: PointerEvent): FloorplanPoint | null {
  const raw = rawGroundPointOf(event)
  return raw ? snap(raw) : null
}

/**
 * 屏幕坐标 → **未吸附**的地面点。
 *
 * 与 `groundPointOf` 是同一件事、少一步 `snap`，而那一步在这两处都不能省：
 *
 * - **命中判定**（`selectAtPointer`）要用它。`snap` 把光标吸到最近的整米格点，
 *   最远偏 0.5 米，拿吸过的点去找洞口会选中**旁边那一个**——而屏幕上高亮的
 *   是另一个，用户唯一能得到的结论是「点选不准」；
 * - **拖动**也要用它。落点的取整在 `resolveOpeningDrag` 里做，而且吸的是
 *   **移动量**；这里先吸一次就成了两次取整，非整米的墙起点上不是恒等变换
 *   （那段注释里有完整推演）。
 */
function rawGroundPointOf(event: PointerEvent): FloorplanPoint | null {
  return canvasApi.groundPointAt?.(event.clientX, event.clientY) ?? null
}

/**
 * 落在某个已有墙端点的吸附半径内时，直接吸到那个端点上。
 *
 * 参考项目**没有**这一条（它只吸附到格点），这是让墙与墙真正接上的必要条件：
 * 两段墙必须共用**同一个坐标**才能围出房间，而只吸格点的话，从别处延伸过来的墙
 * 想接上原有的角就得手动对准——差一个格点就是一个豁口，泛洪直接从那儿漏出去，
 * 房间工具报「这里没围起来」。这是对参考项目的一处刻意改进。
 *
 * 判据用 0.4 米（`ENDPOINT_SNAP`）：比格点吸附（0.5 米一半格）紧一点，
 * 于是「想落在格点上」与「想接上这个角」冲突时，格点优先。
 */
function snapToEndpoint(point: FloorplanPoint): FloorplanPoint {
  let best: FloorplanPoint | null = null
  let bestDistance = ENDPOINT_SNAP

  for (const wall of plan().walls) {
    for (const endpoint of [wall.start, wall.end]) {
      const distance = Math.hypot(endpoint[0] - point[0], endpoint[1] - point[1])
      if (distance < bestDistance) {
        bestDistance = distance
        best = [endpoint[0], endpoint[1]]
      }
    }
  }

  return best ?? point
}

// ---------------------------------------------------------------------------
// 工具切换
// ---------------------------------------------------------------------------

/**
 * 选一个工具。
 *
 * 顺手切到 2D：能画的地方只有一个，让用户先自己切档再点工具是多余的一步。
 * 再点一次当前工具 = 关掉它，于是不需要在工具条上单独放一枚「选择」按钮
 * 来表达「什么都不画」这个状态。
 */
export function setFloorplanTool(tool: FloorplanTool): void {
  if (floorplanTool.value === tool) {
    cancelFloorplanTool()
    return
  }

  floorplanTool.value = tool
  resetDraft()
  void setViewMode('2d')

  /*
    点一个有「配料」的工具（地基、画墙、门、窗）的下一个动作一定是「挑一件东西」，
    让左栏自己走过去，比让用户想起来「模型库里好像有地板」少一次搜索。
    与上面顺手切 2D 是同一类动作：把「能画的地方」与「要用的料」两样都备好。

    只认 TOOL_ASSET_RULES 里有的那几个：房间没有得先挑的东西，
    跟着切分类只会把用户从正在做的事上拽走。

    门与窗跟着切过去还有一层意思：这两类眼下都只有一两个条目，
    「不选料也能画」（落下来是程序生成的框条加门扇 / 玻璃）这件事
    **只能靠不点选来发现**，而左栏自动停在它那一格，正好把这个选择摆到眼前。
  */
  const rule = TOOL_ASSET_RULES[tool]
  if (rule) openLibrarySection(rule.section)

  pushEvent(`绘制工具：${FLOORPLAN_TOOLS.find((item) => item.tool === tool)?.label ?? tool}`)
}

/** 落回空档，并丢掉画到一半的东西 */
export function cancelFloorplanTool(): void {
  if (floorplanTool.value === 'select') return
  floorplanTool.value = 'select'
  resetDraft()
}

/** 丢掉全部草稿状态。切工具、Esc、进预览都走这里 */
function resetDraft(): void {
  wallChain.value = []
  hoverPoint.value = null
  foundationDrag.value = null
  press = null
  // 选中也是草稿状态的一种：切工具、退出工具之后高亮不该还留在那儿
  clearSelection()
}

// ---------------------------------------------------------------------------
// 空档里：点选门窗与墙、沿墙拖动
// ---------------------------------------------------------------------------

/**
 * 空档里选中的那个东西：一个洞口，或者一面墙。
 *
 * 一个 ref 装两种，而不是「洞口一个、墙一个」两个并排的 ref：**互斥是按构造
 * 成立的**——一个格子只装得下一件东西，于是不需要「点墙的时候记得清洞口」那种
 * 两处都要维护的规则（漏一处的表现是两块高亮同时亮，或者左栏换掉了另一个）。
 * 这与 `ModelLibrary.vue` 的 `cellIntent` 是同一条路子。
 *
 * 它是**界面状态**，与「画到一半的墙链」同一条约定：不进配置、不进历史、
 * 不进导出物。理由比墙链还直白——它连几何都不是，纯粹是「现在高亮谁」。
 *
 * 改动这个状态的四处：按下时命中（点空处则清）、Esc、进预览；切工具走
 * `resetDraft`，也清。**撤销 / 重做不清**：撤销把洞口挪回原位、把墙的外观退回去时，
 * 高亮跟着走正是想要的，而 id 万一悬空了由 `selectedOpening` / `selectedWall`
 * 兜住（见那里的注释）。
 */
type PlanSelection = { kind: 'opening' | 'wall'; id: string } | null
const selection = ref<PlanSelection>(null)

/**
 * 选中的那个洞口**以及它的宿主墙**，两个都查得到才算选中。
 *
 * 判据是「在配置里查得到」，**不是 `selection` 里存着这个 id**：
 * 撤销 / 重做、右栏删掉一行之后 id 可能悬空，而两种表现里只有一种是可以接受的——
 * 「提示行说已选中、画面上什么都没有」会让用户以为界面坏了。
 * 所以这里返回 `null`，提示行与高亮一起跟着哑掉。
 */
export const selectedOpening = computed<{
  opening: FloorplanOpening
  wall: FloorplanWall
} | null>(() => {
  const picked = selection.value
  if (picked?.kind !== 'opening') return null

  const { walls, openings } = plan()
  const opening = openings.find((item) => item.id === picked.id)
  if (!opening) return null

  const wall = walls.find((item) => item.id === opening.hostWallId)
  return wall ? { opening, wall } : null
})

/**
 * 选中的那面墙，**在配置里查得到才算选中**。
 *
 * 判据与 `selectedOpening` 同款、理由也是同一条（悬空的 id 要让提示行与高亮
 * 一起哑掉）。它比自己那一侧少收一样东西：墙没有「宿主」。
 */
export const selectedWall = computed<FloorplanWall | null>(() => {
  const picked = selection.value
  if (picked?.kind !== 'wall') return null

  return plan().walls.find((item) => item.id === picked.id) ?? null
})

/** 放开选中的那个东西。Esc、进预览、切工具三处都走它 */
export function clearSelection(): void {
  selection.value = null
}

/**
 * 选中一个洞口 / 一面墙。
 *
 * 这两个是 `selection` **唯一**的写入路径（`clearSelection` 之外），所以
 * 「同一时刻只选中一个」不需要谁来维护：写进去的时候自然就顶掉了上一个。
 */
function selectOpening(id: string): void {
  selection.value = { kind: 'opening', id }
}

function selectWall(id: string): void {
  selection.value = { kind: 'wall', id }
}

/** 选中高亮要的那一点东西，全是模板直接能用的数，组件里不做算术 */
export interface PlanHighlight {
  /** 稳定的 v-for key */
  key: string
  position: [number, number, number]
  rotationY: number
  /** [沿墙跨度（洞口是洞宽、墙是整段长）, 板厚, 比墙厚多出来的那一点] */
  size: [number, number, number]
}

/** 高亮板的中心抬到墙顶之上多少，米 */
const HIGHLIGHT_LIFT = 0.015
/** 高亮板多厚，米 */
const HIGHLIGHT_THICKNESS = 0.03
/** 高亮板比墙厚多出来多少（两边各一半），米 */
const HIGHLIGHT_MARGIN = 0.06

/**
 * 洞口的外观由哪一片碎片承担（门是门扇、窗是玻璃）。
 *
 * 与 `SceneFloorplanOpeningModel.vue` 里那个同名函数是同一个对应关系——那边
 * 按它取「装模型的锚点」，这边按它取「画高亮的范围」。两处都写死在一处、
 * 不共用，是因为它们分属库与编辑器两侧（库那边不认「选中」这件事）；
 * 真改了对应关系（比如门改成填玻璃），这两处都得改。
 */
function fillRole(kind: FloorplanOpeningKind): 'leaf' | 'glass' {
  return kind === 'door' ? 'leaf' : 'glass'
}

/**
 * 洞口那一块高亮板摆在哪、多大、朝哪边。
 *
 * ## 位置与跨度**从渲染出来的那一片碎片上取**
 *
 * 不去自己写一遍三角函数：`wallPieces` 已经算好了世界坐标与朝向，而它与画面上
 * 那些盒子**同源**（同一个函数、同一份 `wall`），于是高亮与洞口逐像素对齐，
 * 不会出现「板子比洞偏了两厘米」这种只有肉眼能发现的错。
 *
 * 取不到那一片时要**退回自己算**：`makePiece` 在退化尺寸上返回 null、
 * 导入的重叠配置也会被 `placeOpenings` 裁掉，而这些都是合法输入——
 * 高亮整块消失比位置略偏更难解释。
 *
 * ## 高度必须在墙顶之上，而且用**这面墙自己的** `height`
 *
 * 俯视图里看到的是**过梁的顶面**（`PLAN_LINTEL`，顶面就在墙高上），
 * 贴地画的高亮会被它整个盖住——`depth-write=false` 只关写、不关深度**测试**。
 * 用默认墙高也是个坑：这面墙可能是 2.6 米的，板子会浮在半空。
 */
function openingMark(selected: {
  opening: FloorplanOpening
  wall: FloorplanWall
}): PlanHighlight {
  const { opening, wall } = selected
  const y = wall.height + HIGHLIGHT_LIFT
  const depth = wall.thickness + HIGHLIGHT_MARGIN

  const fill = wallPieces(wall, [opening]).find(
    (piece) => piece.openingId === opening.id && piece.role === fillRole(opening.kind),
  )

  if (fill) {
    return {
      key: opening.id,
      position: [fill.position[0], y, fill.position[2]],
      rotationY: fill.rotationY,
      size: [fill.size[0], HIGHLIGHT_THICKNESS, depth],
    }
  }

  const [cx, cz] = pointAlongWall(wall, opening.offset)
  return {
    key: opening.id,
    position: [cx, y, cz],
    rotationY: wallRotationY(wall),
    size: [opening.width, HIGHLIGHT_THICKNESS, depth],
  }
}

/**
 * 墙那一块高亮板：**整面墙通长**一条，同样抬在墙顶之上（理由见 `openingMark`
 * 那一段）。
 *
 * ## 为什么不从碎片上取（与洞口那一块相反）
 *
 * 洞口的高亮要与那一扇门逐像素对齐，所以从 `wallPieces` 吐出来的碎片上取。
 * 墙没有这个需求——它要表达的是「**这一整面**被选中了」，而被洞口切开的那几段
 * 各画一块，看起来像同时选中了几个东西。跨度直接由 `wallLength` 给。
 *
 * （`slab` 那个 role 帮不上忙：它在 `FloorplanPieceRole` 里有名字、材质表里也有
 * 一格，但 `wallPieces` 从来没产生过——墙段自己的 role 是 `'wall'`。）
 *
 * ## 零长度的墙不画
 *
 * 一个长度为 0 的盒子画不出来，而 `wallPieces` 对这种墙本来就直接返回空数组
 * （`MIN_SEGMENT` 那道闸），所以它在画面上本来也不存在。
 */
function wallMark(wall: FloorplanWall): PlanHighlight | null {
  const length = wallLength(wall)
  if (length < 1e-6) return null

  const [cx, cz] = pointAlongWall(wall, length / 2)
  return {
    key: wall.id,
    position: [cx, wall.height + HIGHLIGHT_LIFT, cz],
    rotationY: wallRotationY(wall),
    size: [length, HIGHLIGHT_THICKNESS, wall.thickness + HIGHLIGHT_MARGIN],
  }
}

/**
 * 现在该高亮的那一块板，`null` 表示不该画。
 *
 * ## 只有一个 computed，而不是「洞口一块、墙一块」两个
 *
 * 洞口与墙**按构造互斥**（`selection` 一个格子只装得下一件），所以这里最多给出
 * 一块。写成两个 computed 会让下面那道闸、以及这条互斥各出现两次——其中一处
 * 将来改动时会只改到一半。
 *
 * ## 只在 2D 里画
 *
 * 板子抬在墙顶之上，3D 里就是一块浮着的琥珀片，看着像 bug。所以闸放在这里
 * （`planView`），而不是让组件那边记得判——`SceneFloorplanDraft` 是**无条件**
 * 挂在场景里的（它在 `#scene` 插槽里，3D 里也渲染，只是画的东西不可见），
 * 让每个新加的东西各自想一遍「3D 里该不该画」是迟早漏一个的写法。
 */
export const selectionHighlight = computed<PlanHighlight | null>(() => {
  if (!planView.value) return null

  const opening = selectedOpening.value
  if (opening) return openingMark(opening)

  const wall = selectedWall.value
  return wall ? wallMark(wall) : null
})

/**
 * 左栏「替换模式」的靶子：现在选中、而且**看得见**的那个东西（洞口或墙）。
 *
 * 左栏拿到的是一个**描述符**，不是「洞口或墙」两选一：它要的四件事——停在哪一类、
 * 现在装的是哪一件、说给用户听的两句话、点下去做什么——两种靶子各有一套说法，
 * 而把这些收在这里，左栏就完全不必认识「门 / 窗 / 墙」（`ModelLibrary.vue` 的
 * 四个读点原本各写一遍种类分派）。带回调的描述符在这个仓库里有先例：
 * `useInspectorSchema` 的 `FieldDef.apply`。
 *
 * `item` 与 `verb` 拆成两个字段、而不是一整句模板，是为了让**两边都读通**：
 * 洞口是「这个门洞**装**的就是…」、墙是「这面墙**贴**的就是…」——名词（量词跟着
 * 变）与动词（墙没有「装」这回事）都不同，而两句句子的其余部分是一样的。
 */
export interface ReplaceTarget {
  /** 左栏里换它的时候该停在哪一类。`null` = 查不到（`TOOL_ASSET_RULES` 是 `Partial`） */
  section: LibrarySectionKey | null
  /** 说给用户听的宾语，自带量词：「这个门洞」/「这个窗洞」/「这面墙」 */
  item: string
  /** 铺上去的那个动词：「装」/「贴」 */
  verb: string
  /** 它现在装的是哪一件。没有外观时是 `undefined`，于是没有一格会亮 */
  url: string | undefined
  /** 点一格 → 换成它 */
  apply(asset: PickedAsset): void
}

/**
 * 现在选中的那个东西的靶子，`null` 表示没有。
 *
 * 两种靶子的名词与动词都写在各自的构造里，不共用一张表：它们只有三项数据，
 * 而共用一张表等于为「加第三种能换外观的东西」提前抽象——那一天真来了，
 * 这一处本来也要改。
 */
function replaceTargetOf(): ReplaceTarget | null {
  const opening = selectedOpening.value
  if (opening) {
    const { kind } = opening.opening
    return {
      section: sectionKeyForOpening(kind),
      item: `这个${kind === 'door' ? '门' : '窗'}洞`,
      verb: '装',
      url: opening.opening.url,
      apply: replaceSelectedOpening,
    }
  }

  const wall = selectedWall.value
  if (wall) {
    return {
      section: TOOL_ASSET_RULES.wall?.section ?? null,
      item: '这面墙',
      verb: '贴',
      url: wall.url,
      apply: replaceSelectedWall,
    }
  }

  return null
}

/**
 * 左栏「替换模式」的靶子，带**看得见**那道闸。
 *
 * ## 为什么不直接用 `selectedOpening` / `selectedWall`
 *
 * 与上面那块高亮**同一道闸**（`planView`），这不是洁癖：3D 里选中状态其实还活着
 * （`selection` 只在 Esc / 切工具 / 进预览 / 点空处才清），而高亮有闸所以不画。
 * 高亮看不见却把左栏点成替换模式，用户点一格就会去改一个屏幕上不存在的东西，
 * 而**一个字都不会报**——历史里还多出一条正常的「替换门模型」。
 *
 * ## 为什么要导出这一份，而不是让左栏自己判
 *
 * 让「看得见」只有一处判断。左栏那几个读点（格子高亮、无障碍名字、点击分流）
 * 共用这一个 computed，将来闸变了（比如预览模式下也要放开）不会只改到一半。
 */
export const replaceTarget = computed<ReplaceTarget | null>(() =>
  planView.value ? replaceTargetOf() : null,
)

/** 正在拖的那一次。`null` 表示没在拖 */
let openingDrag: {
  id: string
  wallId: string
  kind: FloorplanOpeningKind
  /** 洞口的宽度，从抓起那一刻起就不会变，存下来免得每次移动都重查一遍 */
  width: number
  /** 抓起时的沿墙位置。整米步进是从它加起的（吸的是移动量，不是绝对位置） */
  origin: number
  /** 抓起那一刻**冻住**的活动范围，见 `openingFreeGap` */
  gap: OpeningGap
  pointerId: number
  /**
   * 指针真的移动过没有。
   *
   * 它决定这一次算「拖动」还是「点一下选中」——后者不该在历史里留任何东西。
   * **只能用位移判**：`isClickGesture` 还要求 500 毫秒以内，慢慢拖会被它判成
   * 「没动过」，于是抬手时既不收尾、还会走进点击分支（在空档里什么都不做，
   * 表现是「拖完松手，历史里没有这一笔」）。
   */
  moved: boolean
  /** 最后写进配置的位置，抬手时用它判断要不要补一条历史 */
  last: number
} | null = null

/**
 * 抓住指针。
 *
 * 必须抓，否则拖到视口外面松手时 `pointerup` 落在别的地方（可能压根不在这个
 * 元素上），这一次拖动就永远收不了尾——表现是**松开之后洞口还跟着鼠标走**。
 * 抓住之后事件一律派发到 `.ed-viewport` 那一层（也就是 `event.currentTarget`），
 * `pointerup` / `pointercancel` 一定到得了下面那两个处理函数。
 *
 * 抢不着别的手势：`Shift + 左键`在按下那一刻就被上面那道守卫退让了（2D 下它是平移），
 * 而 2D 档里 `enableRotate` 是关着的，OrbitControls 的左键分支第一步就返回。
 */
function capturePointer(event: PointerEvent): void {
  const layer = event.currentTarget as HTMLElement | null
  layer?.setPointerCapture?.(event.pointerId)
}

/**
 * 松手前先还回去。
 *
 * `hasPointerCapture` 兜一层再 release：`pointerup` 与 `pointercancel` 都走这里，
 * 而 release 一个没抓着的 pointerId 会抛 `NotFoundError`（捕获可能已经被浏览器
 * 自己收走了，比如元素被摘掉）。
 */
function releasePointer(event: PointerEvent): void {
  const layer = event.currentTarget as HTMLElement | null
  if (layer?.hasPointerCapture?.(event.pointerId)) layer.releasePointerCapture(event.pointerId)
}

/**
 * 按下时看看点到了什么：点到一面墙就选中它，点到一个洞口就选中并准备沿墙拖，
 * 点空处就放开选中的那个东西。
 *
 * 命中用**未吸格的原始点**（`rawGroundPointOf`）：`snap` 最多把光标挪半米，
 * 拿吸过的点去找洞口会选中旁边那一个。
 *
 * 选中一律发生在**按下的那一刻**，不等抬手：否则「这一下选中的是谁」在按住期间
 * 看不出来。洞口那条下面会接着进拖动，墙没有可拖的东西，选中完就结束。
 */
function selectAtPointer(event: PointerEvent): void {
  const raw = rawGroundPointOf(event)
  // 落不到地面（相机还没就绪）：什么都不做，**不要把选中清掉**
  if (!raw) return

  const { walls, openings } = plan()
  const hit = findNearestWall(walls, raw, WALL_HIT_DISTANCE)
  if (!hit) {
    clearSelection()
    return
  }

  /*
    命中判据与「再点一下删掉」那条同形（落点在某洞口沿墙的跨度里），只是多放宽
    `OPENING_PICK_SLACK`。**多个洞口都命中的取中心最近的那个**：两个洞口挨着时
    「数组里排前面」是个用户看不见的规则，而「离你点的那个点最近的」正是他以为的规则。
  */
  let picked: FloorplanOpening | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const item of openings) {
    if (item.hostWallId !== hit.wall.id) continue
    const distance = Math.abs(item.offset - hit.offset)
    if (distance > item.width / 2 + OPENING_PICK_SLACK) continue
    if (distance < bestDistance) {
      bestDistance = distance
      picked = item
    }
  }

  /*
    没点中洞口——那就是点在**墙身上**了（`hit` 已经证明这一下离这面墙足够近）。

    墙与洞口共用 `WALL_HIT_DISTANCE`：它是「离墙面多近算点上这面墙」，两种
    命中回答的是同一个问题，而 `hit` 本来就是按它算出来的。代价是**一米宽的
    走廊里点正中会选中一面墙**（离两面墙各 0.5 米）——那是这一档刻意接受的，
    目视清单里有一条专门看它。

    墙**不进拖动**：它没有可挪的东西（两个端点就是它自己），所以下面那一整套
    `openingDrag` 与它无关。左栏照样跟着走到「墙壁」那一类，理由与洞口那条一样。
  */
  if (!picked) {
    selectWall(hit.wall.id)

    const wallSection = TOOL_ASSET_RULES.wall?.section
    if (wallSection) openLibrarySection(wallSection)
    return
  }

  // 按下即亮：不必等抬手，否则「选中」这件事在按住期间看不出发生过
  selectOpening(picked.id)

  /*
    左栏跟着走到这一类，让「上哪儿找这一扇的新模型」不必靠用户猜。

    放在这里而不是拖动真的开始之后：下面那条 `!gap` 的分支会 `flash` 并 return，
    可是**选中已经是事实**了（右栏那一行还能删掉它），左栏就该跟着走。

    切分类只是 `librarySection.value = key` 这一句赋值（`openLibrarySection`），
    值相等时 Vue 不触发，所以幂等；它不进历史、不进配置，也不会打断拖动——
    指针捕获挂在视口那个元素上，与左栏不是一棵子树。
  */
  const section = sectionKeyForOpening(picked.kind)
  if (section) openLibrarySection(section)

  const { id, hostWallId, offset, width } = picked
  const siblings = openings.filter(
    (item) => item.hostWallId === hostWallId && item.id !== id,
  )
  const gap = openingFreeGap(wallLength(hit.wall), offset, width, siblings)
  if (!gap) {
    /*
      没余量就不进拖动，但**选中照旧**：右栏那一行还能删掉它，
      而「一按下去连选中都没有」会让用户以为这个洞口点不得。
    */
    flash('这个洞口两侧没余量，挪不动')
    return
  }

  openingDrag = {
    id,
    wallId: hostWallId,
    kind: picked.kind,
    width,
    origin: offset,
    gap,
    pointerId: event.pointerId,
    moved: false,
    last: offset,
  }
  capturePointer(event)
}

/**
 * 改一个洞口的沿墙位置。
 *
 * `openings` 是**整体替换**的（`applyPatch` 对数组不做逐项合并），所以整份重写、
 * 只动那一个元素。元素必须用 `{ ...o }` 展开：洞口的 `url` 是**条件展开**出来的
 * （没选料时那个键整个不存在，见 `FloorplanOpening.url`），手写字段会把它丢掉，
 * 表现是「拖一下，装好的门模型没了」。
 *
 * `label` 可省：不传就是拖动中的**中间态**，走 400ms 防抖、不立刻进历史，
 * 与 `SceneViewer` 拖模型那条路一致。
 */
function writeOpeningOffset(id: string, offset: number, label?: string): void {
  writeFloorplan(
    { openings: plan().openings.map((item) => (item.id === id ? { ...item, offset } : item)) },
    label,
  )
}

/** 拖动中的每一帧：算落点，变了才写 */
function moveOpeningDrag(event: PointerEvent): void {
  const drag = openingDrag
  if (!drag) return

  /*
    浏览器没给 `pointerup` 时的最后一层兜底：`buttons` 里左键已经不在了，
    说明这次拖动其实早就结束（指针被系统拿走、元素被摘掉那些情形）。
    没有它的话，鼠标移回视口时洞口会继续跟着走。
  */
  if ((event.buttons & 1) === 0) {
    abandonOpeningDrag(event)
    return
  }

  if (!drag.moved && press) {
    drag.moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_MAX_DRIFT
  }

  const wall = plan().walls.find((item) => item.id === drag.wallId)
  if (!wall) {
    // 这面墙在拖动中间没了（撤销、右栏删除）：收尾，别拿一个不存在的墙算下去
    abandonOpeningDrag(event)
    return
  }

  const raw = rawGroundPointOf(event)
  if (!raw) return

  /*
    光标此刻指到沿墙几米。把 `findNearestWall` 的搜索范围**限死在这一面墙上、
    且不设距离上限**（`POSITIVE_INFINITY`）：

    - 限死在它自己这面墙上 → 拖到别的墙附近时洞口**不会跳墙**（不设这一层的话
      光标划过去的那一瞬间它会换一面墙，而这是不可逆的：中间态已经写进配置了）；
    - 不设距离上限 → 光标摆到墙外一米也照常算数。否则光标一离开墙线
      `findNearestWall` 就返回 null，拖动当场卡住，手感是「拖着拖着不动了」。
  */
  const wanted = findNearestWall([wall], raw, Number.POSITIVE_INFINITY)?.offset
  if (wanted === undefined) return

  const others = plan().openings.filter(
    (item) => item.hostWallId === drag.wallId && item.id !== drag.id,
  )
  const next = resolveOpeningDrag(drag.origin, wanted, drag.width, others, drag.gap)
  if (next === drag.last) return

  drag.last = next
  writeOpeningOffset(drag.id, next)
}

/**
 * 抬手：把这一次拖动收成一条历史记录。
 *
 * 中间态是不带 label 的防抖写入（400ms），所以「拖到一半停手超过 400ms」
 * 那一下已经提交过一条了。这里补的那条**要先比一次**：`commit(forcedLabel)`
 * 在零差异时**照样 push**（`src/stores/scene.ts:220` 那个短路只在没有 label
 * 时生效），不比的话会留下两条内容相同、标签不同的记录，用户按一次撤销
 * 看着像没撤。
 */
function finishOpeningDrag(event: PointerEvent): void {
  const drag = openingDrag
  openingDrag = null
  releasePointer(event)

  if (!drag || !drag.moved) return

  const scene = usePlan()
  const committed = scene.history[scene.historyIndex]?.config.floorplan.openings.find(
    (item) => item.id === drag.id,
  )?.offset
  if (committed === drag.last) return

  writeOpeningOffset(drag.id, drag.last, `移动${drag.kind === 'door' ? '门' : '窗'}`)
}

/**
 * 不等抬手也要结束（`pointercancel`、光标离开视口、左键已经不在了）。
 *
 * **位置保留**：中间态早就写进配置了，这时还原成抓起来之前那个位置才是错的
 * （用户看到的确实是它跟到了最后那里）。所以这里只清状态、不收尾。
 */
function abandonOpeningDrag(event?: PointerEvent): void {
  const drag = openingDrag
  openingDrag = null
  if (!drag) return
  if (event) releasePointer(event)
  pushEvent(`拖动${drag.kind === 'door' ? '门' : '窗'}结束（沿墙 ${drag.last.toFixed(2)} 米）`)
}

// ---------------------------------------------------------------------------
// 指针通道
// ---------------------------------------------------------------------------

/**
 * 按下时刻的记录，判据与 `ScenePicker` / `SceneModelNode` 共用同源实现。
 *
 * 只记一份、不按 pointerId 分开存：一次单击只可能由一根手指构成。
 */
let press: PressRecord | null = null

export function onFloorplanPointerDown(event: PointerEvent): void {
  // 只认左键：右键走 contextmenu（回退一点），中键留给浏览器
  if (event.button !== 0) return

  /*
    `Shift + 左键`在 2D 下是**平移**——OrbitControls 那条分支只看 `enablePan`，
    与 `enableRotate` 无关（见 DESIGN.md 里那段）。所以「带 Shift 的拖拽」不能参与平面图：
    地基正是拖出来的，按住 Shift 拖会一边平移一边画；空档里则会把平移做成拖动洞口。

    只在地基与空档这两处退让：其余工具靠**点击**工作，而点击有 `CLICK_MAX_DRIFT`
    兜着，手抖四个像素仍然算点击，`Shift + 点击`正好是「删掉一面墙」。
  */
  if (
    event.shiftKey &&
    (floorplanTool.value === 'foundation' || floorplanTool.value === 'select')
  ) {
    return
  }

  /*
    `press` 记在**这道 Shift 守卫之后**，而不是函数最前面。

    它是「按在哪儿、按了多久」那条记录，`pointerup` 那一侧会拿它算 `isClickGesture`——
    记在守卫之前的话，`Shift + 点一下`（本来什么都不做）会算成一次点击，
    直接撞上那条 `deleteWallAt`：「Shift 点一下」从「什么都不做」变成「删掉一面墙」。

    记在 `floorplanEnabled` 那道闸**之前**：空档里 `floorplanEnabled` 是假的，
    而拖动正要用这条记录判「移动过没有」。
  */
  press = trackPress(press, event)

  /*
    空档：点一个门窗就选中它、按住就能沿墙拖；点一面墙就只选中它。
    它走的是自己那道闸（`planView`），不是 `floorplanEnabled`——后者要求「有工具开着」，
    而这件事故意不在任何工具里（见 `FLOORPLAN_TOOLS` 顶上那段）。
  */
  if (floorplanTool.value === 'select') {
    if (planView.value) selectAtPointer(event)
    return
  }

  if (!floorplanEnabled.value) return

  if (floorplanTool.value === 'foundation') {
    const point = groundPointOf(event)
    if (point) foundationDrag.value = { from: point, to: point }
  }
}

export function onFloorplanPointerMove(event: PointerEvent): void {
  /*
    拖动中这一支排在最前，而且**不看 `floorplanEnabled`**（空档里它是假的）：
    拖动中途用户按了 Esc、切了档，这次拖动也得走完它的落点与收尾——
    否则指针捕获还抓着、状态还留着，表现是「鼠标一动洞口隔空跟着跳」。
  */
  if (openingDrag) {
    moveOpeningDrag(event)
    return
  }

  if (!planView.value) {
    /*
      改不了平面图的时候橡皮筋没有落点，所以把光标位置清掉。

      不清的话，切到 3D 之后那一根还指着 2D 里最后停的地方——看起来像
      「草稿卡住了」。墙链不清：它是由**已经落成的墙段**构成的，
      而 tool 本身也不清（见 `floorplanHint` 那段：留在 3D 里的工具
      由提示行说明为什么改不了，而不是被静默关掉）。
    */
    hoverPoint.value = null
    return
  }

  const tool = floorplanTool.value
  // 只有墙工具要光标位置（画橡皮筋），其余工具在移动时无事可做——别白跑一次射线
  if (tool !== 'wall' && !foundationDrag.value) return

  const point = groundPointOf(event)
  /*
    墙工具还要多一层「吸到已有墙的端点」，而且**预览与落点必须是同一个函数的结果**：
    只给落点吸、不给橡皮筋吸的话，光标指着 4 米处、墙却接到 3.9 米那个角上，
    看起来就是「这一笔接歪了」。
  */
  if (tool === 'wall') hoverPoint.value = point ? snapToEndpoint(point) : null
  if (foundationDrag.value && point) {
    foundationDrag.value = { from: foundationDrag.value.from, to: point }
  }
}

export function onFloorplanPointerUp(event: PointerEvent): void {
  const click = isClickGesture(press, event)
  press = null

  /*
    拖动这一支排在最前，而且**不看** `floorplanEnabled`：拖动是从空档里开始的，
    而空档里那道闸本来就是假的。收尾（补一条历史）必须发生，与「现在还是不是
    空档、还是不是 2D」无关——用户在拖动中途切了档，这一笔也得记上。
  */
  if (openingDrag) {
    finishOpeningDrag(event)
    return
  }

  if (!floorplanEnabled.value) return

  // 地基是拖出来的，不看点击判据：拖了多远就画多大
  if (foundationDrag.value) {
    commitFoundation()
    return
  }
  if (!click) return

  const point = groundPointOf(event)
  if (!point) return

  /*
    落笔时还要把**未吸格**的那个点算出来，只给门窗的磁吸用（`placeOpeningAt`
    第三个参数，那边有一段完整解释：吸过格的点永远够不着半米上的贴齐位置）。

    与 `point` 一起在这里算，是因为再往下走一步事件对象就散了；顺带也说清了
    这两个点是**同一个屏幕坐标的两种解读**，不是两次命中。
  */
  const raw = rawGroundPointOf(event)

  // Shift + 点击 = 删掉点到的那面墙（连带它身上的门窗）
  if (event.shiftKey) {
    deleteWallAt(point)
    return
  }

  switch (floorplanTool.value) {
    case 'wall':
      pickWallPoint(point)
      break
    case 'door':
      placeOpeningAt(point, 'door', raw)
      break
    case 'window':
      placeOpeningAt(point, 'window', raw)
      break
    case 'room':
      markRoomAt(point)
      break
    default:
      break
  }
}

/**
 * 指针被系统收走（手指滑出画布、浏览器接管了手势）。
 *
 * **丢掉拖到一半的矩形，而不是把它落成地基**——这与「当 pointerup 处理」
 * 那条泛泛的规则不同，理由是拿这个场景量过的：真正会被卡住的是那个拖到一半的
 * 矩形（它让下一次 pointerdown 从半途接着画），而对一次被取消的手势来说，
 * 「不产生任何东西」既更安全，也正是 cancel 二字的含义。墙链不清——它是由
 * 已提交的墙段构成的，清掉等于把用户画好的东西丢了。
 */
export function onFloorplanPointerCancel(): void {
  press = null
  foundationDrag.value = null
  // 拖到一半被打断：**位置保留**，只把状态清掉（理由写在 `abandonOpeningDrag`）
  abandonOpeningDrag()
}

/**
 * 光标离开视口。
 *
 * 橡皮筋的终点无处可指，所以清掉；拖动也一样收掉——指针捕获正常情况下会让
 * `pointerleave` 根本不派发（捕获期间浏览器不给这个元素发离开事件），
 * 所以走到这里多半意味着捕获没成功，那就更不能让拖动继续挂着。
 */
export function onFloorplanPointerLeave(): void {
  hoverPoint.value = null
  abandonOpeningDrag()
}

/**
 * 视口里按右键。
 *
 * 有链就退掉最后一点（链空则什么都不做，而不是直接关掉工具——那样一次右键
 * 会把整套操作丢掉）。链已经空了才把工具关掉，等于「连按两次右键退出」。
 *
 * 只有真的处理了什么才 `preventDefault`：没处理时让宿主的右键菜单照常弹出，
 * 与 `SceneViewer.onContextMenu` 那条「只在自己真的会响应时才拦下」同一条。
 */
export function onFloorplanContextMenu(event: MouseEvent): void {
  if (!floorplanActive()) return

  event.preventDefault()

  if (wallChain.value.length > 0) {
    wallChain.value = wallChain.value.slice(0, -1)
    pushEvent(`回退一个点，链上还剩 ${wallChain.value.length} 个`)
    return
  }

  cancelFloorplanTool()
  pushEvent('已退出绘制工具')
}

// ---------------------------------------------------------------------------
// 各工具的落笔
// ---------------------------------------------------------------------------

/** 地基：两个对角格点 → 一块板，或者按这块区域铺一块地板。中心点 + 宽深 */
function commitFoundation(): void {
  const drag = foundationDrag.value
  foundationDrag.value = null
  if (!drag) return

  const width = Math.abs(drag.to[0] - drag.from[0])
  const depth = Math.abs(drag.to[1] - drag.from[1])

  /*
    小于一格直接丢弃。这一条比「画一个 0.2 米的地基」好：点一下不算数，
    是「拖出来」这个动作最自然的下限，也顺手挡住了「只想点一下看看」的误触。
    文案里不再提「地基」——选过地板时这里落的是地板模型，说「地基」就指错了东西。
    **早退时一律不碰 `pickedAssets`**：误拖一下不该把刚选好的料丢掉。
  */
  if (width < CELL_SIZE || depth < CELL_SIZE) {
    flash('至少要 1 米见方——按住左键拖出一格再松手')
    return
  }

  const region = {
    x: (drag.from[0] + drag.to[0]) / 2,
    z: (drag.from[1] + drag.to[1]) / 2,
    width,
    depth,
  }

  /*
    两条路，判据只有一个：左栏有没有选过地板。

      - 选过 → 铺一块**普通模型**进 `config.models`（右栏「场景模型」里能选中、
               能缩放、能删）。**不落灰板**：一块铺满区域的地板会把灰板整个盖住，
               而两者只差不到一个深度单位（见 `FLOOR_SURFACE_Y`），
               叠着画就是逐像素比大小，成片闪。
      - 没选 → 老路径原样，落那块灰板。

    「没选就落灰板」这条必须一直够得到：它是这个工具改造前的唯一行为，
    也是「先摆个位置看看」的用法。取消选用是再点一次左栏那一格（`toggleAssetPick`）。
  */
  const floor = pickedAssetFor('foundation')
  if (floor) {
    // `flash` 作 onFail 传进去：那边不引本模块，拒绝文案才回得到这条提示行上
    layFloorModel(floor, region, flash)
    return
  }

  writeFloorplan({ foundation: region }, '绘制地基')
  pushEvent(`地基 ${width}×${depth} 米`)
}

/**
 * 画墙：把一个已吸附的点接进墙链。
 *
 * 三条规则：只能横平竖直、点回起点即闭合、每落一点**立刻提交一段真墙**。
 *
 * 最后这条是对参考项目 `finishWallChain`（攒到闭合成一圈才一次落库）的刻意偏离：
 * 点到第四个角时，第三段本来就该是「实」的而不是一条橡皮筋；副产物是每段墙
 * 各是一步历史，`⌘Z` 退掉一段——这正是画墙时想要的手感。参考项目那种攒法换来的是
 * 「画到一半反悔只能按 Escape 全丢」。
 */
function pickWallPoint(raw: FloorplanPoint): void {
  const chain = wallChain.value
  const point = snapToEndpoint(raw)

  if (chain.length === 0) {
    wallChain.value = [point]
    return
  }

  const last = chain[chain.length - 1]!
  if (point[0] === last[0] && point[1] === last[1]) return // 原地再点一下：忽略

  // 只能横平竖直。斜墙没法参与房间识别的整数格泛洪（见 floorplan.ts 的拒绝路径），
  // 所以这一步就得挡住，而不是等用户点「标记房间」时才说「识别不了」
  if (point[0] !== last[0] && point[1] !== last[1]) {
    flash('墙只能横平竖直——请沿着上一格点的行或列落点')
    return
  }

  const closes = chain.length >= 3 && point[0] === chain[0]![0] && point[1] === chain[0]![1]
  addWall(last, point)

  /*
    闭合时清零，否则保留链并把新点接上。

    闭合的判据是「点回了起点」而不是「点回了链上任意一点」：回到链中间某一点
    在几何上确实能围出一个小区域，但那个区域的多边形会在**已有的墙**上自接触，
    房间识别会（正确地）判成 `complex` 而拒绝——既然如此，不如不让它成立。
  */
  wallChain.value = closes ? [] : [...chain, point]
}

/**
 * 往配置里加一段墙。
 *
 * 两件事要做：跳过零长段（`pointAlongWall` 在零长墙上会算出 NaN），
 * 以及与已有一面**同样的墙**去重。
 *
 * 去重按**无序端点对**比较，而不是参考项目那样先把每段规范化成
 * `x1<x2 / y1<y2` 再比：一套规则就够了，多一个「规范化」的概念只会给它
 * 引入一个「什么时候该规范化、什么时候不该」的问题。
 */
function addWall(from: FloorplanPoint, to: FloorplanPoint): void {
  const walls = plan().walls

  const same = (a: FloorplanPoint, b: FloorplanPoint) => a[0] === b[0] && a[1] === b[1]
  const duplicated = walls.some(
    (wall) =>
      (same(wall.start, from) && same(wall.end, to)) ||
      (same(wall.start, to) && same(wall.end, from)),
  )
  if (duplicated) return

  /*
    新墙的墙高 / 墙厚取**已有墙**的取值，一面墙都没有时用库的默认值。

    这样只有一处真相：面板上那个「墙高」改的是所有已有的墙，而新画的墙自动
    沿用它们。若另立一份「新墙默认值」的编辑器状态，就会多出一个「面板上写着 3.9 米、
    画出来却是 2.8 米」的状态，只因为它没画过墙。
  */
  const reference = walls[0]
  const height = reference?.height ?? DEFAULT_WALL_HEIGHT
  const thickness = reference?.thickness ?? DEFAULT_WALL_THICKNESS

  /*
    外观**不继承**，只来自当前画笔：尺寸是「这栋房子的墙都多高多厚」这种作用于
    全部已有墙的量，而外观是这一次落笔选的那件料。上面的注释讲了尺寸为什么该沿用，
    这里反过来——沿用外观会让「改选另一种料」看起来像没生效（新墙用新的，老墙不动），
    两件事混在一起就没法解释了。

    写的时候**必须条件展开**：没选料时 `url` 这个键要**整个不存在**，不是 `undefined`
    （见 `types.ts` 里 `FloorplanWall.url` 那条注释——`undefined` 在 JSON 往返里
    键会消失，于是「有键无值」与「没有键」会同时在内存里存在）。
  */
  const asset = pickedAssetFor('wall')

  writeFloorplan(
    {
      walls: [
        ...walls,
        {
          id: createFloorplanId(),
          start: [...from],
          end: [...to],
          height,
          thickness,
          ...(asset ? { url: asset.url } : {}),
        },
      ],
    },
    '绘制墙体',
  )
}

/** Shift + 点击：删掉点到的那面墙，连带挂在它上面的门窗 */
function deleteWallAt(point: FloorplanPoint): void {
  const { walls, openings } = plan()
  const hit = findNearestWall(walls, point, WALL_HIT_DISTANCE)
  if (!hit) {
    flash('没点到墙——请点在墙线上再按 Shift')
    return
  }

  const removed = removeWall(walls, openings, hit.wall.id)
  writeFloorplan({ walls: removed.walls, openings: removed.openings }, '删除墙体')

  const orphanCount = openings.length - removed.openings.length
  pushEvent(orphanCount > 0 ? `已删除一面墙，连带 ${orphanCount} 个门窗` : '已删除一面墙')
}

/** 门窗的默认尺寸。两者的差别只在竖直方向的切法，这里给的是水平宽度与高度 */
const OPENING_SIZES = {
  door: { label: '门', width: DOOR_WIDTH, height: DOOR_HEIGHT, sillHeight: 0 },
  window: { label: '窗', width: WINDOW_WIDTH, height: WINDOW_HEIGHT, sillHeight: WINDOW_SILL },
} as const

/**
 * 洞口放不下的两种理由，与 `openingRejectReason` 的两个原因码一一对应。
 *
 * 文案在这一侧、代号在库里，是库那一族既有的分工（`REJECT_HINTS` 与
 * `findEnclosedArea` 的 reason 同形）：库不认识「门」与「窗」这两个词，
 * 只有编辑器知道该把它们念成什么。
 */
const OPENING_REJECT_HINTS: Record<OpeningRejectReason, (what: string) => string> = {
  'too-short': (what) => `这面墙太短，放不下一个${what}`,
  overlap: (what) => `此处已有门窗，请挪开一点再放${what}`,
}

/**
 * 在墙上放一个门窗。
 *
 * 三条拒绝路径各给一句提示，其中「再点一下删掉」是**先**判的：
 * 同一个位置上点第二次应当是撤销，而不是撞上「此处已有门窗」。
 *
 * ## 洞口有多大：料说了算
 *
 * 选了料就按**料自己的尺寸**开洞（`PickedAsset.width` / `height`，
 * 清单里手写、一路搬过来），没选料才退回 `OPENING_SIZES` 那一档。
 *
 * 这是「门看着怎么这么窄」那个反馈的正解，值得写下来免得被当成可选优化：
 * 装法（`wallFaceFit`）是**三轴等比**、宽度永不变形，所以一扇 1.8 米的门装进
 * 0.9 米的洞是**不报错、也不变形的**——它照原比例画成 1.8 米宽、居中对齐，
 * 而洞口只有 0.9 米，多出来的两侧各 0.45 米**嵌进墙里被墙面吞掉**
 * （门厚 0.167 < 墙厚 0.18，整个藏在墙体内部一点都露不出来）。
 * 屏幕上就是「门怎么这么窄」，控制台一个字都没有。
 *
 * **尺寸必须在这条函数的最前面定下来**，不能等写洞口时才算：上面那两条拒绝
 * （墙太短、与已有门窗重叠）判的正是宽度，拉到最后一行去用就会拿 0.9 米去判
 * 1.8 米的门——表现是「明明放得下却说墙太短」。
 *
 * ## 第三个参数 `magnetAt` 是**未吸格**的同一个位置，只有磁吸用得上
 *
 * 它不能省：`point` 是先 `snap` 过的，而 `snap` 把落点取整到**1 米格**，
 * 于是 `hit.offset` 永远是整数米——贴齐位置却常常落在半米上（2.5 米的窗对
 * 2.5 米的窗就是 3.5，离最近的整数 0.5 米远，比磁吸半径 0.35 还大）。
 * 拿吸过格的点去磁吸，等于**把磁吸关掉**，而用户瞄的正是那个半米位置。
 *
 * 传 `null`（相机还没就绪、落不到地面）时退化成「不磁吸」，与改造前一样。
 */
function placeOpeningAt(
  point: FloorplanPoint,
  kind: keyof typeof OPENING_SIZES,
  magnetAt: FloorplanPoint | null,
): void {
  const { walls, openings } = plan()
  const hit = findNearestWall(walls, point, WALL_HIT_DISTANCE)
  const size = OPENING_SIZES[kind]

  /*
    洞口的**外观与尺寸**来自当前画笔（门与窗都有），与上面那面新墙是同一套。

    **按 `kind` 通用，不写死 `'door'`**：`pickedAssetFor` 本来就只认工具名，
    而工具名与洞口种类一一对应（`TOOL_ASSET_RULES` 那张表说的就是这件事）。
    门与窗在这条链上的差别只有两处（替身碎片与日志名词，都在渲染组件里），
    尺寸与外观这两条路是完全对称的，所以这里一个字都不用分岔。

    用 `??` 而不是三目：清单里**没写**这两个键时才是 `undefined`，
    而「写了 0」是一个合法的（虽然没人会填的）宽度——两种状态在下游应当同形。
    这也与 `span` 那条链的口径一致（那边同样是整份原样搬、用的人自己 `??`）。
  */
  const picked = pickedAssetFor(kind)
  const width = picked?.width ?? size.width
  const height = picked?.height ?? size.height

  if (!hit) {
    flash(`${size.label}要挂在墙上——请点在墙面附近`)
    return
  }

  const { wall, offset: hitOffset } = hit
  const siblings = openings.filter((opening) => opening.hostWallId === wall.id)

  // 再点一下同一个洞口 = 删掉。判据是「落点在已有洞口的宽度范围内」，
  // 所以不需要精确点回原位——这是参考项目那套 toggle 语义，很好用，照抄
  const existing = siblings.find((opening) => Math.abs(opening.offset - hitOffset) < opening.width / 2)
  if (existing) {
    writeFloorplan(
      { openings: openings.filter((opening) => opening.id !== existing.id) },
      `删除${size.label}洞`,
    )
    pushEvent(`已删除一个${size.label}`)
    return
  }

  /*
    磁吸：落点附近有「与某个洞口贴齐（间隔 0）」的位置就吸上去，没有就照格点放。

    **这一步是「两扇窗贴着放」唯一的实现途径**，而它算在**未吸格**的那个点上
    （`magnetAt`，函数头那段解释了为什么不能拿 `hitOffset` 当输入）：`groundPointOf`
    先把光标吸到 1 米格上，于是 `hitOffset` 永远是整米，而贴齐位置（2.5 米的窗对
    2.5 米的窗 → 3.5）离最近的整数差半米——输入取 `hitOffset` 的话，用户瞄着
    那个位置点下去，得到的是「此处已有门窗，请挪开一点再放窗」。**落点本身仍然
    取格点**（`?? hitOffset`），所以不磁吸时画出来的东西与改造前一模一样。

    顺序上它必须排在**判重叠之前**（磁吸给出的位置正是要拿去判的那个），
    也要排在**上面那条 toggle 删除之后**：点在邻居的边线上是「贴着放」，
    点在邻居身上才是「删掉它」，而磁吸会把边线附近的落点拉到邻居的边上，
    先磁吸再判删除的话，点在邻居外侧一点点就会被判成点在邻居身上。

    这里只对**同一面墙**的洞口磁吸（`siblings`）：贴齐是「沿墙的位置」这件事，
    另一面墙上的洞口与本洞口之间没有可贴的边（它们各自垂直于不同的方向）。
  */
  const magnetHit = magnetAt ? findNearestWall([wall], magnetAt, Number.POSITIVE_INFINITY) : null
  const offset = openingMagnetOffset(magnetHit?.offset ?? hitOffset, width, siblings) ?? hitOffset

  /*
    放不下就拒绝，理由由库里的 `openingRejectReason` 给（两个 0.1 米的边距放不下、
    或者压到邻居身上），说人话留在下面那张表里。

    **判据走库**而不是在这里内联两段：替换一个已存在洞口的尺寸时要重跑同一份判据
    （`replaceSelectedOpening`），两边各写一遍迟早只改一处，症状是
    「同样一扇窗，放得下、换不上去」。它内部那一层比「严格不相交」放宽了一颗 1e-9，
    而那正是磁吸刚算出来的贴齐位置需要的余量（那个减法在浮点上差最后一位，
    严格比较会把磁吸自己的结果判成压上）。
  */
  const reject = openingRejectReason(wallLength(wall), offset, width, siblings)
  if (reject) {
    flash(OPENING_REJECT_HINTS[reject](size.label))
    return
  }

  /*
    写洞口。

    **条件展开**的理由与上面那面墙逐字相同：没选料时 `url` 这个键要**整个不存在**。
    这里还有一层更要紧的——渲染端**按 `kind` + `url` 两个一起判**这个洞口是不是
    由模型负责（`openingFilledByModel`），所以一个「有键无值」的 `undefined`
    会让判据在内存与 JSON 往返之后给出两个不同的答案。

    `width` / `height` 是**必填的 number**，取的是上面算好的那两个（料自带就跟着料
    走），所以没有「有时有键、有时没键」的问题，与 `sillHeight` 同理。
  */
  const opening: FloorplanOpening = {
    id: createFloorplanId(),
    kind,
    hostWallId: wall.id,
    offset,
    width,
    height,
    // 门恒为 0，窗由 `WINDOW_SILL` 抬起来。这一项在类型里是**必填的 number**，
    // 不是可选的：`undefined` 在 JSON 往返里整个键会消失，洞口的形状就成了
    // 「有时有键、有时没键」
    sillHeight: size.sillHeight,
    ...(picked ? { url: picked.url } : {}),
  }

  writeFloorplan({ openings: [...openings, opening] }, `放置${size.label}`)
  pushEvent(
    `在墙上放了一个${size.label}（沿墙 ${offset.toFixed(2)} 米，${width.toFixed(2)} × ${height.toFixed(2)} 米）`,
  )
}

/**
 * 替换失败时的两句人话。
 *
 * 与 `OPENING_REJECT_HINTS` 分开写、而不是共用一张表，因为**说的事情不一样**：
 * 那边是在说「这一笔落不下」，这边必须点出**用户刚点的那件资产的名字**——
 * 他点的就是它，出错时不提它是不可理解的。另外这边还要报出新料要多宽，
 * 否则「这面墙太短」在换窗的场景里看不出短在哪（用户心里那面墙是够长的，
 * 够长只是对原来那扇窗而言）。
 */
const REPLACE_REJECT_HINTS: Record<OpeningRejectReason, (asset: string, width: number) => string> = {
  'too-short': (asset, width) =>
    `这面墙太短——「${asset}」要 ${width.toFixed(2)} 米宽，放不下`,
  overlap: (asset) => `这里两侧不够——换成「${asset}」会和旁边的门窗叠上`,
}

/**
 * 把选中的那个洞口换成一件资产。左栏在「空档 + 选中洞口」时点一格就走这里。
 *
 * ## 尺寸跟着新料重开洞，所以要重跑放得下那两道判据
 *
 * 新料自带宽度（清单里手写、或量出来的）时洞口按它重开，于是原来放得下的一扇门
 * 换一件宽的之后就未必——不重跑的话会写出一个压着邻居、或长出墙外的洞口，
 * 而画面上只是「墙上的洞怪怪的」。所以判据与 `placeOpeningAt` 共用库里的那一个，
 * 过不了就闪一句人话、**一个字都不写**。
 *
 * ## 尺寸的兜底是「洞口原尺寸」，不是 `OPENING_SIZES`
 *
 * 空档这条路上量不到尺寸（`ModelMeasureProbe` 的判据是「有配料工具开着」，
 * `isOpeningTool` 那条），所以清单又没写数时就只能兜底。这时候取 `OPENING_SIZES`
 * 那一档等于**凭空把洞换成 0.9 米**：配一樘 2.5 米的窗就是「窗被墙吞掉、不报错」
 * ——正是 `placeOpeningAt` 那段「洞口有多大：料说了算」记的那个 bug 的复现。
 * 保持原尺寸至少不会更坏，而且它是**用户看得见的那一个数**。
 *
 * ⚠ 这与 `placeOpeningAt` 的兜底**不同源**、也不该被「统一成一处」：那边是新开洞，
 * 没有「原尺寸」可言。两处的兜底回答的是两个问题。
 *
 * ## 「记成当前料」放在 no-op 早返回**之前**
 *
 * 它是界面状态、不进历史，而且「刚才用的是哪一樘」必须留住：不然用户换完、
 * Esc 一下再点「门」工具，落笔又回到程序构件那套，而他以为自己已经选过了。
 *
 * ## 算下来一模一样时只闪一句、**不写配置**
 *
 * 不能省：带 label 的 `commit(forcedLabel)` 在零差异时照样 push
 * （`src/stores/scene.ts`），不防的话点一下同一格就多一条撤销记录。
 */
function replaceSelectedOpening(asset: PickedAsset): void {
  const target = selectedOpening.value
  /*
    空地址到不了这里（左栏那一支判过 `entry.url`），兜一层是防**有键无值**：
    洞口的「外观是不是由模型负责」判据只看 `url` 真不真（`openingFilledByModel`），
    写进一个空串会让它翻回程序构件那一侧，于是洞里同时少了框扇、又没有模型。
  */
  if (!target || !asset.url) return

  const { opening, wall } = target
  const size = OPENING_SIZES[opening.kind]
  const width = asset.width ?? opening.width
  const height = asset.height ?? opening.height
  // 不含被替换的这一个自己：它会与自己重叠，判据恒真，一扇都换不了
  const siblings = plan().openings.filter(
    (item) => item.hostWallId === wall.id && item.id !== opening.id,
  )

  const reject = openingRejectReason(wallLength(wall), opening.offset, width, siblings)
  if (reject) {
    flash(REPLACE_REJECT_HINTS[reject](asset.label, width))
    return
  }

  setAssetPickFor(opening.kind, asset)

  if (opening.url === asset.url && opening.width === width && opening.height === height) {
    flash(`这个${size.label}洞装的就是「${asset.label}」`)
    return
  }

  /*
    整份重写、只动这一个元素，且元素必须 `{ ...item }` 展开：洞口的 `url` 是
    **条件展开**出来的，手写字段会把它丢掉（`writeOpeningOffset` 那边记着同一条）。
    `url` 在这里是必填的——上面已经判过 `asset.url` 非空。

    `sillHeight` 刻意不动：它是 `kind` 的函数（门恒 0、窗 `WINDOW_SILL`），
    而替换不换种类，顺手写一遍等于给导入配置里那个合法的怪数做归一化。
  */
  writeFloorplan(
    {
      openings: plan().openings.map((item) =>
        item.id === opening.id ? { ...item, url: asset.url, width, height } : item,
      ),
    },
    `替换${size.label}模型`,
  )
  pushEvent(
    `把${size.label}换成了「${asset.label}」（洞口按 ${width.toFixed(2)} × ${height.toFixed(2)} 米重开）`,
  )
}

/**
 * 把选中的那面墙换成一件墙面资产。左栏在「空档 + 选中墙」时点一格就走这里。
 *
 * ## 一道判据都不跑（与上面那条相反）
 *
 * 洞口那边要重跑「放得下」两道判据，因为**新料的尺寸会变成洞口的新尺寸**。
 * 墙没有这件事：`wallFaceTiles` 把资产沿墙长平铺、高与厚各自拉伸
 * （`src/utils/wallFace.ts`），它压根不看资产装不装得下，而墙的长宽厚也一个字
 * 都不来自资产。所以这条路上没有「拒绝」这种结果，别照 `REPLACE_REJECT_HINTS`
 * 补一张表。
 *
 * ## 也不预检资产达不达得到「墙的资产要求」
 *
 * 不达标（零厚度、全是片、顶点里有 NaN）的表现是**整面墙退回灰盒子**，外加
 * `SceneFloorplanWallSkin` 那条点名地址与原因的 warn。画墙时选料同样不预检，
 * 替换沿用同一条才是一致的——为一句话就在选择时先拉一遍 glb 出来量，是把洞口
 * 那条链的代价（DESIGN.md 里记着「同一条 glb 被加载两遍」那笔账）搬到这里。
 *
 * ## 「记成当前料」放在 no-op 早返回**之前**
 *
 * 与上面那条同一个理由：它是界面状态、不进历史，而「刚才用的是哪一件」必须留住
 * ——不然用户换完、切个工具再回来画墙，落下来的又是灰盒子。
 *
 * ## 算下来一模一样时只闪一句、**不写配置**
 *
 * 同样与上面那条一个理由：带 label 的 `commit(forcedLabel)` 在零差异时照样 push。
 */
function replaceSelectedWall(asset: PickedAsset): void {
  const wall = selectedWall.value
  /*
    空地址到不了这里（左栏那一支判过 `entry.url`），兜一层是防**有键无值**：
    写进空串会在这面墙上留下一个 `url: ''` 的脏键——渲染上它照样落回灰盒子那一组
    （`SceneFloorplan.vue` 判的是 `!url`），但「没有外观时这个键整个不存在」是
    `FloorplanWall.url` 明写着的契约，写空串会让「这面墙有没有外观」在
    `'url' in wall` 与 JSON 往返之间给出两种答案。
  */
  if (!wall || !asset.url) return

  setAssetPickFor('wall', asset)

  if (wall.url === asset.url) {
    flash(`这面墙贴的就是「${asset.label}」`)
    return
  }

  /*
    整份重写、只动这一个元素，且元素必须 `{ ...item }` 展开：手写字段会丢掉
    `id`、两个端点、`height`、`thickness` 里的任何一个。而 `height` 与 `thickness`
    **恰好是绝对不能自己写的那两个**——它们是「这栋房子的墙都多高多厚」的全局量
    （见 `addWall` 顶上那段），顺手写一遍等于把导入配置里那个合法的怪数归一化。
    （`setWallSize` 也是靠同一个展开把 `url` 保住的。）

    `url` 在这里是必填的——上面已经判过 `asset.url` 非空。墙的外观字段只有它一个，
    没有别的要同步写的。
  */
  writeFloorplan(
    {
      walls: plan().walls.map((item) =>
        item.id === wall.id ? { ...item, url: asset.url } : item,
      ),
    },
    '替换墙面模型',
  )
  pushEvent(`把墙面换成了「${asset.label}」`)
}

/** 房间工具的三条拒绝理由，与 `findEnclosedArea` 的三种 reason 一一对应 */
const REJECT_HINTS: Record<'not-on-grid' | 'outrun' | 'complex', string> = {
  'not-on-grid': '当前墙体不在 1 米网格上（或有斜墙），无法自动识别房间',
  outrun: '这里没有被墙围起来的区域',
  complex: '这个区域形状不被支持（内部有孔洞，或有只在一角相接的两块）',
}

/**
 * 标记房间：点封闭区域内部，把围住它的多边形算出来存进配置。
 *
 * 判重（参考项目算了却没用的那个 `cellSet` 本来大概就是干这个的）：
 * 落点已经在某个房间的多边形里就拒绝。不做的话，同一个屋里点两下会出现两块
 * 完全重叠的色块，而且**删不掉**——用户能看见的只有颜色变深了一点。
 */
function markRoomAt(point: FloorplanPoint): void {
  const { walls, rooms } = plan()

  const existing = rooms.find((room) => pointInPolygon(point, room.polygon))
  if (existing) {
    flash(`这里已经是「${existing.name}」了`)
    return
  }

  const found = findEnclosedArea(walls, point)
  if (!found.ok) {
    flash(REJECT_HINTS[found.reason])
    return
  }

  const room = {
    id: createFloorplanId(),
    name: `房间${rooms.length + 1}`,
    polygon: found.polygon.map((vertex) => [...vertex] as FloorplanPoint),
    color: pickRoomColor(rooms.length),
  }

  writeFloorplan({ rooms: [...rooms, room] }, '标记房间')
  pushEvent(`已标记「${room.name}」（${room.polygon.length} 个角）`)
}
