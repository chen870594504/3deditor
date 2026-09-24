import type { App, Component, Plugin } from 'vue'
import { createPinia } from 'pinia'
import SceneFloorplan from './components/SceneFloorplan.vue'
import SceneToolbar from './components/SceneToolbar.vue'
import SceneViewer from './components/SceneViewer.vue'

/**
 * 样式随入口一并构建，产出 dist/style.css 供宿主显式引入。
 *
 * 这一行是副作用导入，必须留着：漏掉它构建依然成功，但产物里不会有
 * 任何组件样式——宿主项目中渲染出来的是一堆没有外观的裸 DOM，
 * 从报错上看不出问题。scripts/smoke.mjs 专门守这个回归。
 *
 * 样式本身是手写 SCSS（src/styles/index.scss），不经过任何原子 CSS 引擎。
 */
import './styles/index.scss'

import type { ThreeDMakerOptions } from './types'

// 具名导出：支持宿主按需引入组件
export { SceneFloorplan, SceneToolbar, SceneViewer }

// 状态与类型
export { useSceneStore } from './stores/scene'

/**
 * 默认配置对外导出：宿主想基于默认值拼一份自己的预设时，
 * 不必再去猜插件内部用了哪些数值。
 */
export { DEFAULT_SCENE_CONFIG, cloneFloorplanPatch, createFloorplanConfig } from './utils/config'

/**
 * 把旧版格式的配置折成当前格式。
 *
 * 导出它是为了让宿主自己存的那份配置也能过同一道迁移：`SceneViewer` 的
 * `loadSceneData` 内部会调它，但宿主若是自己读盘、自己 `applyConfig`
 * （那条路合法且常见），就没有任何一处替他做这件事。
 * 而漏掉它的表现是静默的——见函数自身的注释。
 */
export { migrateConfig } from './utils/config'

/**
 * 平面图的几何引擎。
 *
 * 这是本次改动里**公开面最大的一处**，是刻意的：户型图的数据在配置里
 * （`SceneConfig.floorplan`），而这一组纯函数是**唯一**能把它变成几何、
 * 再从几何回答问题的实现。宿主想自己画一层楼板、自己做一个「点到哪面墙」的
 * 高亮、或把平面图接到自己的业务数据上，都得用它们——
 * 不导出的话那些宿主只能抄一遍，而抄漏一处（比如 `placeOpenings` 那几处夹取）
 * 的表现是「墙体切出负长度、变成一块法线翻转的黑面」，不报错。
 *
 * 全部是**不依赖 three、不依赖 DOM 的纯函数**（`wallPieces` 只吐数字），
 * 因此可以在没有任何渲染环境的地方直接跑——冒烟测试里那组几何断言就是这么来的。
 *
 * `dropOpeningFills` / `openingFilledByModel` 也在这里，尽管它们听起来像渲染层的
 * 事：宿主自己铺墙时**绕不过它们**。一个洞口写了外观地址（门与窗都会写）之后，
 * 洞里的框条与门扇必须由**装模型的那一方**画，而墙那一侧要么抑制、要么重复画
 * ——重复画的表现是同一个包围盒上两组共面几何，逐像素 z-fighting。
 */
export {
  CELL_SIZE,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  OPENING_EDGE_GAP,
  WINDOW_HEIGHT,
  WINDOW_SILL,
  WINDOW_WIDTH,
  createFloorplanId,
  dropOpeningFills,
  findEnclosedArea,
  findNearestWall,
  openingFilledByModel,
  openingFreeGap,
  openingMagnetOffset,
  openingOverlaps,
  openingRejectReason,
  pickRoomColor,
  pointAlongWall,
  pointInPolygon,
  polygonCenter,
  removeWall,
  resolveOpeningDrag,
  wallLength,
  wallPieces,
  wallRotationY,
} from './utils/floorplan'

export type {
  EnclosedAreaResult,
  FloorplanPiece,
  FloorplanPieceRole,
  NearestWallHit,
  OpeningGap,
  OpeningRejectReason,
} from './utils/floorplan'

/**
 * 墙面铺装的算术。
 *
 * 与上面那组同一个理由导出（宿主自己想铺墙就得用它俩），另外还有一条这里独有的：
 * **它是本次改动里唯一能自动化验证的一段**。切段、开洞、房间识别那些都已经在
 * 冒烟测试里跑着，而「一段墙该摆几块砖」这段算术既盖不到静态检查、
 * 又要有真资产才能目视——放进公开面，`scripts/smoke.mjs` 就能不靠浏览器验它。
 *
 * `wallFaceIsSheet` 是同一段算术的**入口检查**（逐网格判实体还是片），
 * 宿主自己铺墙时同样绕不过去：它决定「量出来的包围盒」到底量的是墙，还是连
 * 建模时那块背景板一起量了。见 DESIGN.md 的资产制作要求。
 *
 * 洞口那一件也在这一组里（`wallFaceFit` / `openingFaceUnusable` /
 * `openingFaceOversized`）：宿主自己要往洞口里装模型（门或窗），用的就是同一份
 * 算术与同一条筛片判据——两处各写一份的下场是「中心没减掉、模型偏出半个身位」
 * 这类不报错的错（`wallFaceFit` 有完整说明）。最后那个是**只说话不办事**的体检
 * （资产里混进了道具时点名），一并放出来，宿主自己那条链上同样需要它。
 */
export { wallFaceFit, wallFaceIsSheet, wallFaceTiles, wallFaceUnusable, openingFaceUnusable, openingFaceOversized } from './utils/wallFace'

export type { WallFaceBounds, WallFaceTile } from './utils/wallFace'

/**
 * 「现在算 2D 俯视还是 3D 透视」。
 *
 * 库自己要用它：2D 档下墙换成平面图的实色外观、不铺贴面（见 DESIGN.md 设计决定 34），
 * 而这套界面的档位本来就是**从机位推导**的。导出去是因为宿主只要做与户型图
 * 有关的界面（自己画一条工具栏、自己决定什么时候允许绘制），迟早要问同一个问题，
 * 而抄一份的代价是两份规则悄悄不一致——表现是「按钮亮着 2D、画面是 3D」。
 *
 * `TOP_TOLERANCE` 刻意不导出：那 5° 是这条规则的内部实现，宿主拿它做不了别的事。
 */
export { viewModeOf } from './utils/viewMode'

export type { ViewMode } from './utils/viewMode'

/**
 * 模型 id 的派生子。
 *
 * `object-click` 载荷里的 id 就是这么算出来的，导出它是为了让宿主
 * 能自己对齐——比如拿它去查一张业务表，而不必再抄一遍这条规则。
 */
export { deriveModelId } from './utils/modelId'

/**
 * 由 JSON 零件表**程序生成**几何体的算术。
 *
 * 与上面几组同一个理由导出，但它多一条：这一组是**唯一能把
 * `ModelConfig.partsJson` 那段文本读成几何体**的实现。宿主那边有两处绕不过它——
 *
 * - **生成端**：宿主自己要造这把椅子（或把它存进自己的库、做一次预览、
 *   算一次体积），必须按同一套摆法算位置。`count` + `radius` 那条
 *   「起点 +Z、每份跟着绕 Y 转 θ」的约定抄错了，五条横撑会围成一圈切向的方框，
 *   而画面上看着仍然「像那么回事」。
 * - **校验端**：一段零件表能不能用，判据就是 `parseModelParts`。宿主在自己的
 *   表单里先读一遍，就能在存下去之前告诉用户哪一件不对，而不是等到
 *   渲染时得到一片空白。
 *
 * 全部是**不依赖 three、不依赖 DOM 的纯函数**（吃字符串、吐数字），
 * 所以冒烟测试里能直接跑——这一点在这一组上格外要紧：几何体算错了不抛异常，
 * 只会画出一个形状不对的东西，而形状对不对只有眼睛看得出来。
 *
 * `MAX_PARTS` / `MAX_COUNT` 是**公开约定而不是内部实现**：超了整份会被拒掉，
 * 所以生成端必须按它来。DESIGN.md 的「宿主可以往左栏里追加分类」一节有完整说明。
 */
export { MAX_COUNT, MAX_PARTS, parseModelParts, placeModelParts } from './utils/modelParts'

export type { ModelPart, ModelPartShape, ModelPartsResult, PlacedPart } from './utils/modelParts'

/**
 * 模型事件相关的常量与判断。
 *
 * `MODEL_EVENT_TYPES` / `MODEL_EVENT_LABELS` 导出是为了让宿主的界面
 * （比如自己画的事件配置面板）与库用同一份类型顺序与中文名，
 * 不必再抄一遍；`activeEventTypes` 则是那套门控逻辑的唯一实现——
 * 宿主想知道「这个模型到底挂了几类事件」时，用它得到的结果一定与库一致。
 *
 * 注意 `defaultEventCode` 只是默认模板文本，库自身**从不执行**它，
 * 也不执行配置里的任何 `code`。要跑起来请见 README 的「模型事件」一节。
 */
export {
  MODEL_EVENT_LABELS,
  MODEL_EVENT_TYPES,
  activeEventTypes,
  defaultEventCode,
} from './utils/eventCode'

export type * from './types'

/** 需要注册为全局组件的组件表 */
const COMPONENTS: Record<string, Component> = {
  SceneViewer,
  SceneToolbar,
  SceneFloorplan,
}

/**
 * 补齐全局组件的模板类型提示。
 *
 * `app.component()` 是运行时注册，TypeScript 无法感知，
 * 没有这段增强，宿主在模板里写 <TdmSceneViewer /> 就得不到任何类型检查。
 * 这里只声明默认前缀 'Tdm' 对应的名字；使用自定义 prefix 时模板内没有提示，
 * 此时建议宿主改用具名导入。
 */
declare module 'vue' {
  export interface GlobalComponents {
    TdmSceneViewer: typeof SceneViewer
    TdmSceneToolbar: typeof SceneToolbar
    TdmSceneFloorplan: typeof SceneFloorplan
  }
}

/**
 * 创建插件实例。
 *
 * ```ts
 * import { createApp } from 'vue'
 * import { createThreeDMaker } from '3deditor'
 * import '3deditor/style.css'
 *
 * createApp(App).use(createThreeDMaker()).mount('#app')
 * ```
 */
export function createThreeDMaker(options: ThreeDMakerOptions = {}): Plugin {
  const { pinia, registerComponents = true, prefix = 'Tdm' } = options

  return {
    install(app: App) {
      /**
       * 宿主已经装过 Pinia 时直接复用，避免同一页面出现两份插件状态；
       * 没装过才补一个私有实例，保证插件在零配置的项目里也能直接跑起来。
       */
      if (!app.config.globalProperties.$pinia) {
        app.use(pinia ?? createPinia())
      }

      if (!registerComponents) return

      for (const [name, component] of Object.entries(COMPONENTS)) {
        app.component(`${prefix}${name}`, component)
      }
    },
  }
}

export default createThreeDMaker
