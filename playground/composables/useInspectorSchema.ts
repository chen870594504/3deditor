import { MathUtils } from 'three'
import {
  DEFAULT_SCENE_CONFIG,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  activeEventTypes,
  cloneFloorplanPatch,
  useSceneStore,
} from '../../src'
import type { SceneConfig } from '../../src'
/**
 * 工厂从 `src/utils/config` 直接引入，不走 `'../../src'` 那个入口。
 *
 * 它是「一个新模型长什么样」的唯一一份定义，而模型页有几个字段的默认值
 * 要从它取——但默认场景是空的，`DEFAULT_SCENE_CONFIG` 里已经查不到了。
 * 这一层没做成公开导出：宿主想要一份新模型，`addModel()` 就是那个入口，
 * 再开一个具名导出只是为了让这个面板少写一行 import。
 */
import { createModelConfig } from '../../src/utils/config'
import { getPath, setPath } from '../utils/path'
import { canvasApi, eventDialogOpen, uniformScale } from './useEditorState'
import type { InspectorTab } from './useEditorState'
import { resetModelTransform } from './useModelActions'

/**
 * 属性面板的字段声明。
 *
 * 7 个 tab 的控件全部由下面的数据描述，而不是写 7 个手写组件。
 * 好处很直接：新增一个配置项 = 加一行声明；7 个 tab 的 UI 代码量
 * 与 1 个 tab 相当，也就不会出现「某个 tab 的交互跟其他 tab 不一致」。
 *
 * 两个逃生口，都只在必要时用：
 * - `read` / `apply` 覆盖默认的路径读写。角度（度 ↔ 弧度换算）、
 *   相互约束的上下限（minDistance / maxDistance）都要靠它。
 * - `when` 隐藏字段，`dim` 保留字段但灰显。
 */

export type FieldType =
  | 'text'
  | 'number'
  | 'slider'
  | 'color'
  | 'toggle'
  | 'select'
  | 'vector'
  | 'action'
  /**
   * 打开一个弹窗的按钮。
   *
   * 与 `action` 的区别只在语义上：`action` 是「按一下就做完一件事」，
   * `dialog` 是「按一下进入另一层界面」。分成两类是为了让第 3 列
   * 有个合理的读数可显示（`action` 那列是空的），两者的点击行为完全一样。
   */
  | 'dialog'
  /** 不渲染控件，只占一行说明文字。用来解释某组字段为什么会长这样 */
  | 'note'

export interface FieldOption {
  label: string
  value: string | number
}

/**
 * 字段指向的配置路径。
 *
 * 既可以是写死的字符串（'camera.fov'），也可以是一个返回字符串的函数。
 * 需要后者的是「模型属性」页：那里的字段全部属于**列表里的某一个**模型，
 * 是第几个由界面当前的选中项决定，路径只能在读写发生的那一刻才求得出来。
 * 写成 'models.0.position' 就等于无论选中谁都在改第一个。
 */
export type FieldPath = string | (() => string)

/** 把字段的 path 求成字符串 */
export function resolvePath(path: FieldPath | undefined): string {
  if (!path) return ''
  return typeof path === 'string' ? path : path()
}

/** 图标里的一段路径。`fill` 为真时用 currentColor 填实，否则只描边 */
export interface IconPath {
  d: string
  fill?: boolean
}

export interface FieldDef {
  /** 稳定标识，用作列表 key */
  key: string
  label: string
  type: FieldType
  /** 指向 store.config 的路径，例如 'camera.fov'；可以是一个推迟求值的闭包 */
  path?: FieldPath
  /** 覆盖默认读取；readonly 类型下返回的是「显示文本」 */
  read?: () => unknown
  /** 覆盖默认写入 */
  apply?: (value: unknown) => void
  min?: number
  max?: number
  step?: number
  /** 显示用的小数位 */
  precision?: number
  unit?: string
  options?: FieldOption[]
  /** 返回 false 时整个字段不渲染 */
  when?: (config: SceneConfig) => boolean
  /** 返回 true 时字段仍在但灰显不可操作 */
  dim?: (config: SceneConfig) => boolean
  /** 字段下方的说明文字 */
  hint?: string
  /** action / dialog 类型要触发的动作名 */
  action?: InspectorActionName
  /** text 类型的输入提示 */
  placeholder?: string
  /**
   * text 类型只读。
   *
   * 与 `dim` 不同：灰显的输入框点不动、内容也选不中，
   * 而这个值（比如派生出来的模型 id）恰恰是用来复制出去用的。
   */
  readonly?: boolean
}

export interface SectionDef {
  /**
   * 分区序号，面板上显示成「01 / 相机」。
   *
   * 它说的是**在页面上排第几块**，而不是「在下面这个数组里排第几项」——
   * 所以互斥的分区可以共用一个序号（「阴影」页那三组就是这么写的：同一时刻
   * 只有一个存在，它就是 02，不必为了让序号连上而留一堆空壳）。
   */
  index: string
  title: string
  fields: FieldDef[]
  /** 默认是否展开 */
  open?: boolean
  /**
   * 整节的条件显隐，口径与 `FieldDef.when` 一致：**隐藏**，不是置灰。
   *
   * 用在「几组参数各管一种模式、同一时刻只有一组是活的」这种地方。三组全摆在
   * 页面上而只活一组，比少摆两组糟得多——拖了没反应的滑杆会让人怀疑是自己
   * 拖错了地方，而界面一个字都不解释。今天唯一的用法是「阴影」页那三组，
   * 判据是 `shadow.type`。
   *
   * 它天然是响应式的（和 `FieldDef.when` 一样收 `SceneConfig`）：换掉实现方式，
   * 页面上那一组参数跟着整组换一批。
   */
  when?: (config: SceneConfig) => boolean
}

export interface InspectorTabDef {
  key: InspectorTab
  label: string
  /** 导轨上的图标，24 格描边路径 */
  icon: IconPath[]
  sections: SectionDef[]
}

const SHADOW_TYPE_OPTIONS: FieldOption[] = [
  { label: 'Shadow Map', value: 'map' },
  { label: '接触阴影', value: 'contact' },
  { label: '累积阴影', value: 'accumulative' },
]

/**
 * 导轨图标。
 *
 * 七个图标都画在 24 格里，只用描边、只吃 currentColor —— 于是激活态的琥珀、
 * 悬停态的灰阶全由 CSS 决定，图标本身不认识主题。留白统一压在 3 格以上，
 * 摆成一列时视觉重量才一致。
 *
 * 唯一的填充是接触阴影那块地面：不填实的话「物体 + 影子」的关系读不出来。
 * `satisfies` 保证漏画一个 tab 或写错 key 都是编译错误。
 */
const NAV_ICONS = {
  /** 等轴测立方体：外六边形 + 交于前上角的三条棱 */
  model: [
    {
      d: 'M12 3 L19.8 7.5 L19.8 16.5 L12 21 L4.2 16.5 L4.2 7.5 Z M12 12 L12 21 M12 12 L4.2 7.5 M12 12 L19.8 7.5',
    },
  ],
  /** 相机机身（带取景器凸起）+ 镜头 */
  camera: [
    {
      d: 'M3 9.5 A1.5 1.5 0 0 1 4.5 8 H7.6 L9.2 5.8 H14.8 L16.4 8 H19.5 A1.5 1.5 0 0 1 21 9.5 V17 A1.5 1.5 0 0 1 19.5 18.5 H4.5 A1.5 1.5 0 0 1 3 17 Z M15.3 13 A3.3 3.3 0 1 1 8.7 13 A3.3 3.3 0 1 1 15.3 13',
    },
  ],
  /**
   * 户型图：一张俯视的平面小图。
   *
   * 外墙一个方框，中间一道隔墙，**隔墙中间断开的一段就是门洞**——
   * 这个缺口是整张图里唯一能让人一眼认出「这是平面图而不是两个方框」的东西，
   * 所以不能省。左下角那一道横隔墙与竖墙交成一个 T，补上「不止一间房」的意思。
   */
  floorplan: [
    { d: 'M4.5 4.5 H19.5 V19.5 H4.5 Z M12 4.5 V10 M12 14 V19.5 M4.5 14 H12' },
  ],
  /** 等轴测网格平面：菱形外框 + 过中心的两条格线 */
  ground: [{ d: 'M12 7 L21 12 L12 17 L3 12 Z M7.5 9.5 L16.5 14.5 M16.5 9.5 L7.5 14.5' }],
  /** 太阳：圆面 + 八道光芒 */
  sun: [
    {
      d: 'M16 12 A4 4 0 1 1 8 12 A4 4 0 1 1 16 12 M18.6 12 H21 M12 18.6 V21 M5.4 12 H3 M12 5.4 V3 M16.7 16.7 L18.4 18.4 M7.3 16.7 L5.6 18.4 M7.3 7.3 L5.6 5.6 M16.7 7.3 L18.4 5.6',
    },
  ],
  /** 物体 + 落在地上的接触阴影 */
  shadow: [
    { d: 'M16.4 9 A4.4 4.4 0 1 1 7.6 9 A4.4 4.4 0 1 1 16.4 9' },
    { d: 'M6 18 A6 1.9 0 1 1 18 18 A6 1.9 0 1 1 6 18', fill: true },
  ],
  /** 时钟 + 左上角的逆时针箭头：回来过的时间 */
  history: [{ d: 'M12 4.2 A8.4 8.4 0 1 1 3.6 12.6 M2 12 L3.6 10 L5.2 12 M12 7.4 V12.6 L15.6 14.7' }],
} satisfies Record<InspectorTab, IconPath[]>

/**
 * 面板上的按钮类字段要触发的动作。
 *
 * 放在 schema 模块而不是组件里：动作本身是「这个面板能做什么」的一部分，
 * 与字段声明写在一起，通读 schema 就能看全面板的全部能力。
 *
 * 全部走 `applyConfig(patch, label)` 而不是直接改字段——
 * 带标签的写入会在历史栈里留下可读的一步，否则只能得到「相机」这种分组名。
 */
const ACTIONS = {
  grabCamera: () => canvasApi.captureCamera?.(),
  resetCamera: () => {
    const { camera } = DEFAULT_SCENE_CONFIG
    useSceneStore().applyConfig(
      { camera: { position: [...camera.position], target: [...camera.target], fov: camera.fov } },
      '重置机位',
    )
  },
  /**
   * 把物体变换恢复成默认值，但不碰模型地址。
   *
   * 实现搬到了 `useModelActions`（中栏那排操作按钮里的「归零」是同一件事）：
   * 两处入口共用同一个函数，历史里也就只有一条一致的标签。
   * `createModelConfig` 这个 import 在本文件别处还有用处，不能跟着一起删。
   */
  resetTransform: () => resetModelTransform(),
  clearHistory: () => useSceneStore().clearHistory(),
  /**
   * 地基只有一个，没有「列表里删掉一行」这条路可走。
   *
   * 不给这个按钮的话，地基就只能被**再拖一个**覆盖掉、永远删不干净——
   * 墙有 Shift+点击、门窗有再点一下、房间有列表里的删除，
   * 唯独地基是个只进不出的东西。写 null 而不是删掉这个键：
   * `FloorplanConfig.foundation` 的类型本来就是 `… | null`，空地基就是 null。
   */
  clearFoundation: () =>
    useSceneStore().applyConfig({ floorplan: { foundation: null } }, '删除地基'),
  /** 事件弹窗自己负责提交，这里只负责把它打开 */
  openEventDialog: () => {
    eventDialogOpen.value = true
  },
} satisfies Record<string, () => void>

/**
 * 字段上的 `action` 能写的名字。
 *
 * 断言成 `Record<string, …>` 是为了让 `InspectorField` 拿字符串下标去查——
 * 它手里只有 schema 给的名字，没有更精确的类型。
 * 精确性由上面那句 `satisfies` 保住：名字写错是编译错误，
 * 而不是点下去之后静默无反应（这一层原本就没有任何运行时兜底）。
 */
export type InspectorActionName = keyof typeof ACTIONS

export const INSPECTOR_ACTIONS: Record<string, () => void> = ACTIONS

/**
 * 「模型属性」页字段的路径。
 *
 * 场景里可以有多个模型，而这一页永远只描述**当前选中的那一个**，
 * 所以路径带下标、且下标只能在读写发生时才知道。做成闭包交给
 * `InspectorField` 每次求值一次，换来的是「点列表换模型 → 下面的字段
 * 自动指向新模型」这件事不需要任何额外的同步代码。
 */
function modelPath(field: string): () => string {
  return () => `models.${useSceneStore().selectedIndex}.${field}`
}

/**
 * 角度字段：配置里存弧度，面板上显示度。
 *
 * 单位换算只在这一层发生——配置文件永远只有一套单位，
 * 导出给别人时不会出现「这个角度到底是度还是弧度」的歧义。
 */
function angleField(
  key: string,
  label: string,
  path: string,
  minDeg: number,
  maxDeg: number,
): FieldDef {
  return {
    key,
    label,
    type: 'slider',
    path,
    min: minDeg,
    max: maxDeg,
    step: 1,
    precision: 0,
    unit: '°',
    read: () => {
      const radians = getPath<number>(useSceneStore().config, path) ?? 0
      return Math.round(MathUtils.radToDeg(radians))
    },
    apply: (value) => {
      setPath(useSceneStore().config, path, MathUtils.degToRad(Number(value)))
    },
  }
}

/**
 * 三分量角度字段：与 angleField 同一套换算，只是作用在向量上。
 *
 * 弧度与度的换算同样只发生在这里，配置里存的永远是弧度——
 * 这样 `new Euler().fromArray(config.models[n].rotation)` 和
 * `new Vector3().fromArray(config.models[n].position)` 是同一个形状。
 */
function vectorAngleField(
  key: string,
  label: string,
  path: FieldPath,
  step: number,
  precision: number,
): FieldDef {
  const toDegrees = () => {
    const radians = getPath<number[]>(useSceneStore().config, resolvePath(path)) ?? [0, 0, 0]
    // 按面板的精度取整，与 angleField 一致：读出来的度就是控件会提交回去的度
    const factor = 10 ** precision
    return radians.map((value) => Math.round(MathUtils.radToDeg(value) * factor) / factor)
  }

  return {
    key,
    label,
    type: 'vector',
    path,
    step,
    precision,
    unit: '°',
    read: toDegrees,
    apply: (value) => {
      const next = value as number[]
      const current = toDegrees()

      /**
       * 三个分量都没变就什么都不写。
       *
       * NumberControl 失焦时会把读到的值原样提交回来，而 VectorControl
       * 提交的是整个三元组——不设这道闸，在 Y 上点一下再点开，
       * 没动过的 X / Z 也会被度转弧度地重写一遍，把误差带进配置。
       */
      if (next.every((degree, index) => degree === current[index])) return

      setPath(
        useSceneStore().config,
        resolvePath(path),
        next.map((degree) => MathUtils.degToRad(Number(degree))),
      )
    },
  }
}

/**
 * 缩放字段：等比锁打开时三轴共用一个值。
 *
 * 锁是「写入策略」，所以实现落在 apply 里而不是控件上——
 * 给 VectorControl 加一个 lock prop 等于让控件认识业务规则。
 *
 * 取同一个值（绝对覆盖）而不是按比例缩放：按比例会在每次拖动上累积漂移
 * （1,2,2 拖到 2 变 2,4,4，再拖到 3 变 3,6,6……），而这是个步进输入，
 * 漂移不可逆。取同值可预期、幂等，也是各家 DCC 里等比锁的语义。
 */
function scaleField(key: string, label: string, path: FieldPath): FieldDef {
  return {
    key,
    label,
    type: 'vector',
    path,
    step: 0.1,
    precision: 2,
    apply: (value) => {
      const current = getPath<number[]>(useSceneStore().config, resolvePath(path)) ?? [1, 1, 1]
      const next = value as number[]

      /**
       * VectorControl 提交的是完整的三元组，apply 收不到「改的是哪一轴」，
       * 只能自己比出来。
       *
       * 一轴都没变就**什么都不写**：失焦会把读到的那份格式化值原样提交回来，
       * 而这时若按锁的语义强行取同一轴的值，一个非等比的三轴
       * （比如导入配置里的 1/2/2）会被一次毫无意图的点击压成 1/1/1。
       * 空操作必须是空操作。
       */
      const axis = ([0, 1, 2] as const).find((index) => next[index] !== current[index])
      if (axis === undefined) return

      const uniform = next[axis]
      setPath(
        useSceneStore().config,
        resolvePath(path),
        uniformScale.value ? [uniform, uniform, uniform] : [...next],
      )
    },
  }
}

/**
 * 有没有地基。
 *
 * 它是整个户型里唯一**可空**的部件（三个数组顶多是空），所以那四个字段
 * 各自写一遍 `config.floorplan.foundation !== null` 纯属重复，也容易写漏一个
 * （漏了的那一个会在 foundation 为 null 时读到 undefined，输入框里是一片空白，
 * 而它写下去的每一次都在配置里凭空造出一个只有 width 的半个地基）。
 */
const hasFoundation = (config: SceneConfig): boolean => config.floorplan.foundation !== null

/**
 * 把墙高（或墙厚）一次改到**全部**墙上。
 *
 * 参考项目那个 `globalWallHeight` 是另一种做法：它只写进 `rooms[].wallHeight`，
 * 导出时又被当成所有墙的高度用——「一份值存在房间上、却当墙的在用」，语义是糊的。
 * 这边直接落在每面墙自己的 `height` 上，于是面板、绘制、渲染读的都是同一个数。
 *
 * 补丁要过一遍 `cloneFloorplanPatch`：`applyConfig` 对数组是整体装入
 * （`applyPatch` 的 `isPlainObject` 显式排除数组），而这里读出来的 `walls`
 * 是从 reactive 配置上取的**代理**，每个 `wall.start` 也是代理。
 * 展开一层 `{...wall}` 只换掉了墙对象，两个端点数组仍然是代理——
 * 逐层拷一遍，写进去的才是纯对象（与 `useFloorplanTool.writeFloorplan` 同一条）。
 */
function setWallSize(patch: { height?: number; thickness?: number }, label: string): void {
  const store = useSceneStore()

  store.applyConfig(
    {
      floorplan: cloneFloorplanPatch({
        walls: store.config.floorplan.walls.map((wall) => ({
          ...wall,
          height: patch.height ?? wall.height,
          thickness: patch.thickness ?? wall.thickness,
        })),
      }),
    },
    label,
  )
}

/** 生成 7 个 schema tab。带上 store 是为了让 read / apply 能直接读写配置 */
export function createInspectorTabs(): InspectorTabDef[] {
  const scene = useSceneStore()
  const camera = () => scene.config.camera

  return [
    // ------------------------------------------------------------------
    {
      key: 'model',
      label: '模型属性',
      icon: NAV_ICONS.model,
      sections: [
        {
          index: '01',
          title: '资源',
          fields: [
            {
              key: 'id',
              label: '模型 ID',
              /*
               * 用 text + readonly 而不是 readonly 类型。
               *
               * readonly 类型把值塞进第 3 列（auto 宽、右对齐），36 位的 uuid
               * 会把第 2 列挤成 0 并溢出面板；而 text 占满第 2 列，
               * 只读态下还能整段选中复制——这正是它唯一的用处。
               */
              type: 'text',
              path: modelPath('id'),
              readonly: true,
            },
            {
              key: 'name',
              label: '模型名称',
              type: 'text',
              path: modelPath('name'),
              placeholder: '留空则用从地址派生的短名',
            },
          ],
        },
        {
          index: '02',
          title: '变换',
          fields: [
            { key: 'position', label: '位置', type: 'vector', path: modelPath('position'), step: 0.1, precision: 2 },
            {
              ...vectorAngleField('rotation', '旋转', modelPath('rotation'), 1, 0),
            },
            {
              ...scaleField('scale', '缩放', modelPath('scale')),
            },
            {
              key: 'uniform',
              label: '等比锁',
              type: 'toggle',
              read: () => uniformScale.value,
              apply: (value) => {
                uniformScale.value = Boolean(value)
              },
              hint: '编辑器偏好，不进配置、不进历史',
            },
            {
              key: 'resetTransform',
              label: '重置变换',
              type: 'action',
              action: 'resetTransform',
              hint: '只重置位置、旋转、缩放，不动模型地址',
            },
          ],
        },
        {
          index: '03',
          title: '显示与拾取',
          fields: [
            { key: 'visible', label: '显示模型', type: 'toggle', path: modelPath('visible') },
            { key: 'wireframe', label: '线框模式', type: 'toggle', path: modelPath('wireframe') },
            {
              /*
               * 这一行原来是个「可点击」开关，现在改成按钮 + 弹窗：
               * 一类事件一个启用位加一段脚本，一个布尔量已经装不下了。
               * 门控因此变成派生的——开着任意一类事件即「可点击」，
               * 全部关掉仍然完全不挂指针监听器、拾取零开销。
               *
               * 读数是**当前选中模型**的。列表为空时用空对象兜底：
               * `activeEventTypes` 是容错的，但它至少得拿到一个对象。
               *
               * 这个字段**必须**带 read：它没有 path，而 getPath 对空路径
               * 返回的是整个 config，第 3 列会渲染成一坨 JSON。
               */
              key: 'events',
              label: '事件绑定',
              type: 'dialog',
              action: 'openEventDialog',
              read: () => `${activeEventTypes(scene.selectedModel ?? {}).length}/5`,
            },
            {
              key: 'modelCastShadow',
              label: '投射阴影',
              type: 'toggle',
              path: modelPath('castShadow'),
              /*
               * 接触阴影是用 scene.overrideMaterial 直接烘焙的，绕开了
               * WebGLShadowMap，而 castShadow 正是后者的判定 —— 在接触阴影下
               * 这个开关拖了没有任何反应，所以直接隐藏，而不是摆一个空开关。
               */
              when: (config) => config.shadow.type === 'map' || config.shadow.type === 'accumulative',
              hint: '还要「阴影」页的全局投射阴影也打开，两者是 AND 关系',
            },
            {
              key: 'modelReceiveShadow',
              label: '接收阴影',
              type: 'toggle',
              path: modelPath('receiveShadow'),
              when: (config) => config.shadow.type === 'map' || config.shadow.type === 'accumulative',
              hint: '改为接触阴影时此开关无效，故隐藏',
            },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------
    {
      key: 'floorplan',
      label: '平面图',
      icon: NAV_ICONS.floorplan,
      sections: [
        {
          index: '01',
          title: '墙体',
          fields: [
            {
              key: 'wallHeight',
              label: '墙高',
              type: 'number',
              min: 1,
              max: 12,
              step: 0.1,
              precision: 2,
              /*
               * 没有 path：这个字段管的是**全部墙**，而 path 只能指到某一面墙上。
               *
               * 读第一面墙：同一份数据只有一处真相，而「改一次全改」的前提就是
               * 各面墙的值本来就是一致的（绘制与面板是唯一的两个写入口）。
               * 导入的配置可能真给出一堆高低不一的墙，那时这里显示的是第一面的值——
               * 一个主动覆盖全部墙的输入框，本来也只能显示一个数。
               */
              read: () => scene.config.floorplan.walls[0]?.height ?? DEFAULT_WALL_HEIGHT,
              apply: (value) => setWallSize({ height: Number(value) }, '修改墙高'),
              when: (config) => config.floorplan.walls.length > 0,
              hint: '一次改掉全部墙；新画的墙也照这个值',
            },
            {
              key: 'wallThickness',
              label: '墙厚',
              type: 'number',
              min: 0.05,
              max: 1,
              step: 0.01,
              precision: 2,
              read: () => scene.config.floorplan.walls[0]?.thickness ?? DEFAULT_WALL_THICKNESS,
              apply: (value) => setWallSize({ thickness: Number(value) }, '修改墙厚'),
              when: (config) => config.floorplan.walls.length > 0,
              hint: '门窗洞口的宽度不受墙厚影响，但门套会随着一起变厚',
            },
            {
              key: 'wallEmpty',
              label: '',
              type: 'note',
              when: (config) => config.floorplan.walls.length === 0,
              hint: '还没有墙。用视口左侧的「画墙」工具在网格上逐点落墙，之后这里能统一调墙高与墙厚。',
            },
          ],
        },
        {
          index: '02',
          title: '地基',
          fields: [
            {
              key: 'foundationWidth',
              label: '宽度',
              type: 'number',
              path: 'floorplan.foundation.width',
              min: 1,
              max: 400,
              step: 0.5,
              precision: 2,
              when: hasFoundation,
            },
            {
              key: 'foundationDepth',
              label: '进深',
              type: 'number',
              path: 'floorplan.foundation.depth',
              min: 1,
              max: 400,
              step: 0.5,
              precision: 2,
              when: hasFoundation,
            },
            /*
             * 中心点而不是最小角。
             *
             * 参考项目那一处是矛盾的：`renderFoundation` 给 x/z 加了半个尺寸
             * （当作最小角），而它自己的 `createEmptyScene` 给 24×15 时又像是
             * 当作中心。这边写死「中心」——画地基时落进去的也是两个对角的中点
             * （`useFloorplanTool.commitFoundation`），面板上填什么、板子就在哪，
             * 不需要心算半个宽度。四个字段的单位都是米。
             */
            {
              key: 'foundationX',
              label: '中心 X',
              type: 'number',
              path: 'floorplan.foundation.x',
              min: -400,
              max: 400,
              step: 0.5,
              precision: 2,
              when: hasFoundation,
            },
            {
              key: 'foundationZ',
              label: '中心 Z',
              type: 'number',
              path: 'floorplan.foundation.z',
              min: -400,
              max: 400,
              step: 0.5,
              precision: 2,
              when: hasFoundation,
            },
            {
              key: 'clearFoundation',
              label: '删除地基',
              type: 'action',
              action: 'clearFoundation',
              when: hasFoundation,
              hint: '尺寸单位一律是米；再拖一个矩形会直接替换掉这一块',
            },
            {
              key: 'foundationEmpty',
              label: '',
              type: 'note',
              when: (config) => config.floorplan.foundation === null,
              hint: '还没有地基。用视口左侧的「地基」工具在网格上拖一个矩形，松手落成一块板。',
            },
          ],
        },
        // 03「房间」不是 schema 驱动的：它是「一行一个房间」的列表 + 行内改名改色，
        // 用专门的组件更清楚（与「操作历史」同一考虑），由 InspectorPanel 接在后面。
      ],
    },

    // ------------------------------------------------------------------
    {
      key: 'camera',
      label: '相机',
      icon: NAV_ICONS.camera,
      sections: [
        {
          index: '01',
          title: '镜头',
          fields: [
            { key: 'fov', label: '视场角', type: 'slider', path: 'camera.fov', min: 15, max: 110, step: 1, precision: 0, unit: '°' },
            { key: 'near', label: '近裁剪', type: 'number', path: 'camera.near', min: 0.01, max: 10, step: 0.01, precision: 2 },
            { key: 'far', label: '远裁剪', type: 'number', path: 'camera.far', min: 10, max: 2000, step: 10, precision: 0 },
          ],
        },
        {
          index: '02',
          title: '机位',
          fields: [
            { key: 'position', label: '位置', type: 'vector', path: 'camera.position', step: 0.1, precision: 2 },
            { key: 'target', label: '注视点', type: 'vector', path: 'camera.target', step: 0.1, precision: 2 },
            {
              key: 'grab',
              label: '抓取视角',
              type: 'action',
              action: 'grabCamera',
              hint: '自动旋转开启时拖动不会回写配置，需要手动抓一次',
            },
            { key: 'resetCamera', label: '重置机位', type: 'action', action: 'resetCamera' },
          ],
        },
        {
          index: '03',
          title: '交互',
          fields: [
            { key: 'autoRotate', label: '自动旋转', type: 'toggle', path: 'camera.autoRotate' },
            {
              key: 'autoRotateSpeed',
              label: '旋转速度',
              type: 'slider',
              path: 'camera.autoRotateSpeed',
              min: -8,
              max: 8,
              step: 0.1,
              precision: 1,
              when: (config) => config.camera.autoRotate,
            },
            { key: 'damping', label: '阻尼惯性', type: 'toggle', path: 'camera.damping' },
            {
              key: 'dampingFactor',
              label: '阻尼系数',
              type: 'slider',
              path: 'camera.dampingFactor',
              min: 0.01,
              max: 0.5,
              step: 0.01,
              precision: 2,
              when: (config) => config.camera.damping,
            },
            { key: 'enableRotate', label: '允许旋转', type: 'toggle', path: 'camera.enableRotate' },
            { key: 'enablePan', label: '允许平移', type: 'toggle', path: 'camera.enablePan' },
            { key: 'enableZoom', label: '允许缩放', type: 'toggle', path: 'camera.enableZoom' },
          ],
        },
        {
          index: '04',
          title: '限制',
          fields: [
            {
              key: 'minDistance',
              label: '最近距离',
              type: 'slider',
              path: 'camera.minDistance',
              min: 0,
              max: 40,
              step: 0.1,
              precision: 1,
              // OrbitControls 会把半径静默夹到 [min, max]，这里同步抬高上限，
              // 否则滑到超出范围时读数会自己弹回去
              apply: (value) => {
                const min = Number(value)
                camera().minDistance = min
                if (camera().maxDistance < min + 0.5) camera().maxDistance = min + 0.5
              },
            },
            {
              key: 'maxDistance',
              label: '最远距离',
              type: 'slider',
              path: 'camera.maxDistance',
              min: 1,
              max: 200,
              step: 1,
              precision: 0,
              apply: (value) => {
                const max = Number(value)
                camera().maxDistance = max
                if (camera().minDistance > max - 0.5) camera().minDistance = Math.max(0, max - 0.5)
              },
            },
            {
              ...angleField('minPolarAngle', '最低仰角', 'camera.minPolarAngle', 0, 180),
              apply: (value) => {
                const radians = MathUtils.degToRad(Number(value))
                camera().minPolarAngle = radians
                if (camera().maxPolarAngle < radians) camera().maxPolarAngle = radians
              },
            },
            {
              ...angleField('maxPolarAngle', '最高俯角', 'camera.maxPolarAngle', 0, 180),
              hint: '90° 表示相机不允许转到地面以下',
              apply: (value) => {
                const radians = MathUtils.degToRad(Number(value))
                camera().maxPolarAngle = radians
                if (camera().minPolarAngle > radians) camera().minPolarAngle = radians
              },
            },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------
    {
      key: 'ground',
      label: '地面',
      icon: NAV_ICONS.ground,
      sections: [
        {
          index: '01',
          title: '显示',
          fields: [
            { key: 'visible', label: '显示网格', type: 'toggle', path: 'ground.visible' },
            {
              key: 'infiniteGrid',
              label: '无限延伸',
              type: 'toggle',
              path: 'ground.infiniteGrid',
              when: (config) => config.ground.visible,
            },
            {
              key: 'followCamera',
              label: '跟随相机',
              type: 'toggle',
              path: 'ground.followCamera',
              when: (config) => config.ground.visible,
            },
            {
              key: 'size',
              label: '平面边长',
              type: 'slider',
              path: 'ground.size',
              min: 4,
              // 上限要盖得住默认值 120（改默认值时要一起看这里）。滑杆与读数只在**编辑时**
              // 夹取值，默认值本身不会被夹——上限调小之后的表现是「把手一直贴在右端、
              // 数字却是超出去的那个，一碰就掉到上限」，比直接夹掉更难看出是配置错了
              max: 120,
              step: 1,
              precision: 0,
              when: (config) => config.ground.visible && !config.ground.infiniteGrid,
            },
          ],
        },
        {
          index: '02',
          title: '网格',
          fields: [
            { key: 'cellSize', label: '单格尺寸', type: 'slider', path: 'ground.cellSize', min: 0.1, max: 5, step: 0.1, precision: 1 },
            { key: 'cellThickness', label: '单格线宽', type: 'slider', path: 'ground.cellThickness', min: 0, max: 3, step: 0.1, precision: 1 },
            { key: 'cellColor', label: '单格颜色', type: 'color', path: 'ground.cellColor' },
            { key: 'sectionSize', label: '主格间距', type: 'slider', path: 'ground.sectionSize', min: 1, max: 20, step: 1, precision: 0 },
            { key: 'sectionThickness', label: '主线宽', type: 'slider', path: 'ground.sectionThickness', min: 0, max: 3, step: 0.1, precision: 1 },
            { key: 'sectionColor', label: '主线颜色', type: 'color', path: 'ground.sectionColor' },
          ],
        },
        {
          index: '03',
          title: '淡出',
          fields: [
            // 上限要盖得住默认值 150，理由见上面「平面边长」
            { key: 'fadeDistance', label: '淡出距离', type: 'slider', path: 'ground.fadeDistance', min: 5, max: 150, step: 1, precision: 0 },
            { key: 'fadeStrength', label: '淡出强度', type: 'slider', path: 'ground.fadeStrength', min: 0, max: 3, step: 0.1, precision: 1 },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------
    {
      key: 'sun',
      label: '日照环境',
      icon: NAV_ICONS.sun,
      sections: [
        {
          index: '01',
          title: '天空',
          fields: [
            {
              key: 'background',
              label: '画布底色',
              type: 'color',
              path: 'background',
              dim: (config) => config.sun.showSky,
              hint: '天空开着时底色会被完全盖住，所以这里灰显',
            },
            { key: 'showSky', label: '程序化天空', type: 'toggle', path: 'sun.showSky' },
            {
              key: 'elevation',
              label: '太阳高度',
              type: 'slider',
              path: 'sun.elevation',
              min: -5,
              max: 90,
              step: 1,
              precision: 0,
              unit: '°',
            },
            {
              key: 'azimuth',
              label: '太阳方位',
              type: 'slider',
              path: 'sun.azimuth',
              min: -180,
              max: 180,
              step: 1,
              precision: 0,
              unit: '°',
            },
            { key: 'turbidity', label: '浑浊度', type: 'slider', path: 'sun.turbidity', min: 1, max: 20, step: 0.1, precision: 1, dim: (config) => !config.sun.showSky },
            { key: 'rayleigh', label: '瑞利散射', type: 'slider', path: 'sun.rayleigh', min: 0, max: 6, step: 0.1, precision: 1, dim: (config) => !config.sun.showSky },
            { key: 'mieCoefficient', label: '米氏系数', type: 'slider', path: 'sun.mieCoefficient', min: 0, max: 0.1, step: 0.001, precision: 3, dim: (config) => !config.sun.showSky },
            { key: 'mieDirectionalG', label: '米氏方向', type: 'slider', path: 'sun.mieDirectionalG', min: 0, max: 1, step: 0.01, precision: 2, dim: (config) => !config.sun.showSky },
            {
              key: 'skyHint',
              label: '',
              type: 'note',
              /*
                这一行**原来只在开着天空时才出现**（`when: showSky`），现在常驻。

                因为上面那两个角度不再跟着天空一起收起来了：它们**无论天空开不开
                都在驱动主光方向**（`SceneContent` 里那盏平行光的朝向就是照它俩推的），
                收起来的时候，用户在「03 场景预设」点一下「黄昏」，画面里光真的斜了，
                面板上却找不到是哪个数在动。
              */
              hint: '天空是一个巨大的背面盒体，会盖住画布背景色；它的材质是模块级单例，全场景只能存在一个。上面的高度角与方位角不止管太阳——主光的方向一直由它俩推导，天空关着时也在用，只是头顶没有那轮太阳可看',
            },
          ],
        },
        {
          index: '02',
          title: '光照',
          fields: [
            { key: 'ambientIntensity', label: '环境光', type: 'slider', path: 'sun.ambientIntensity', min: 0, max: 5, step: 0.05, precision: 2 },
            { key: 'keyIntensity', label: '主光', type: 'slider', path: 'sun.keyIntensity', min: 0, max: 8, step: 0.05, precision: 2 },
            { key: 'fillIntensity', label: '补光', type: 'slider', path: 'sun.fillIntensity', min: 0, max: 5, step: 0.05, precision: 2 },
            {
              key: 'lightHint',
              label: '',
              type: 'note',
              hint: '主光方向由上面的高度角与方位角推导，与天空里的太阳是同一个方向',
            },
          ],
        },
        // 03 的位置是「场景预设」，由 InspectorPanel 挂的 PresetList 自己画
        // （见那个文件：它是自绘的阻塞列表，不是数据驱动的字段，所以不在这里）。
        // 原先这个位置是「环境贴图」下拉框，已经删掉——理由见 DESIGN.md 设计决定 41。
      ],
    },

    // ------------------------------------------------------------------
    {
      key: 'shadow',
      label: '阴影',
      icon: NAV_ICONS.shadow,
      sections: [
        {
          index: '01',
          title: '方式',
          fields: [
            { key: 'enabled', label: '启用阴影', type: 'toggle', path: 'shadow.enabled' },
            {
              key: 'type',
              label: '实现方式',
              type: 'select',
              path: 'shadow.type',
              options: SHADOW_TYPE_OPTIONS,
              when: (config) => config.shadow.enabled,
              hint: '下面只显示当前方式的那一组参数——三种方式各有一套，互不通用',
            },
            /*
             * 全局阴影总闸。这一对原先挂在「模型属性」页里，标签就叫「投射阴影」——
             * 物体级开关进来之后，同名标签会指向两条不同的配置路径，
             * 所以搬到这里并加「全局」前缀，与「模型属性」页里那对区分开。
             */
            {
              key: 'castShadow',
              label: '全局投射阴影',
              type: 'toggle',
              path: 'shadow.castShadow',
              dim: (config) => !config.shadow.enabled,
              hint: '总闸；物体级还要各自打开「投射阴影」才会生效（两者 AND）',
            },
            {
              key: 'receiveShadow',
              label: '全局接收阴影',
              type: 'toggle',
              path: 'shadow.receiveShadow',
              dim: (config) => !config.shadow.enabled,
              hint: '总闸；物体级还要各自打开「接收阴影」才会生效（两者 AND）',
            },
          ],
        },
        {
          /*
            下面三组参数各归一种实现方式，**序号都写 02**：同一时刻只会有
            一组存在（`when` 只管一种 type），所以它永远接着 01 排在第二块。
            给它们编成 02/03/04 会让另外两组消失时留下一个跳号的空位，
            看起来像页面坏了。
          */
          index: '02',
          title: 'Shadow Map',
          open: false,
          /* Shadow Map 那一套只喂给主光，而主光只在 type === 'map' 时投影 */
          when: (config) => config.shadow.enabled && config.shadow.type === 'map',
          fields: [
            {
              key: 'mapSize',
              label: '贴图分辨率',
              type: 'select',
              path: 'shadow.mapSize',
              options: [256, 512, 1024, 2048, 4096].map((size) => ({
                label: String(size),
                value: size,
              })),
            },
            { key: 'bias', label: '偏移', type: 'slider', path: 'shadow.bias', min: -0.005, max: 0, step: 0.0001, precision: 4 },
            { key: 'normalBias', label: '法线偏移', type: 'slider', path: 'shadow.normalBias', min: 0, max: 0.2, step: 0.005, precision: 3 },
            { key: 'mapHint', label: '', type: 'note', hint: '分辨率改动会重建阴影贴图，略有一帧卡顿' },
          ],
        },
        {
          index: '02',
          title: '接触阴影',
          open: false,
          when: (config) => config.shadow.enabled && config.shadow.type === 'contact',
          fields: [
            { key: 'contactOpacity', label: '不透明度', type: 'slider', path: 'shadow.contactOpacity', min: 0, max: 1, step: 0.01, precision: 2 },
            { key: 'contactBlur', label: '模糊', type: 'slider', path: 'shadow.contactBlur', min: 0, max: 8, step: 0.1, precision: 1 },
            { key: 'contactScale', label: '采样范围', type: 'slider', path: 'shadow.contactScale', min: 2, max: 40, step: 0.5, precision: 1 },
            {
              key: 'contactResolution',
              label: '分辨率',
              type: 'select',
              path: 'shadow.contactResolution',
              options: [256, 512, 1024].map((size) => ({ label: String(size), value: size })),
            },
            {
              key: 'contactHint',
              label: '',
              type: 'note',
              when: (config) => config.sun.showSky,
              hint: '天空与接触阴影同开时的表现尚未实测确认：天空盒顶点在 ±45 万单位外，理论上落在接触阴影的裁剪范围之外',
            },
          ],
        },
        {
          index: '02',
          title: '累积阴影',
          open: false,
          when: (config) => config.shadow.enabled && config.shadow.type === 'accumulative',
          fields: [
            { key: 'accFrames', label: '累积帧数', type: 'slider', path: 'shadow.accFrames', min: 10, max: 120, step: 1, precision: 0 },
            { key: 'accOpacity', label: '不透明度', type: 'slider', path: 'shadow.accOpacity', min: 0, max: 1, step: 0.01, precision: 2 },
            { key: 'accScale', label: '采样范围', type: 'slider', path: 'shadow.accScale', min: 2, max: 40, step: 0.5, precision: 1 },
            { key: 'accBlend', label: '混合强度', type: 'slider', path: 'shadow.accBlend', min: 2, max: 60, step: 1, precision: 0 },
            { key: 'accHint', label: '', type: 'note', hint: '累积阴影需要多帧收敛，改动参数后会从头重新累积' },
          ],
        },
      ],
    },

    // 历史面板不是 schema 驱动的：它是列表 + 跳转，用专门的组件更清楚
    { key: 'history', label: '操作历史', icon: NAV_ICONS.history, sections: [] },
  ]
}

/** 模型页的路径带下标：`models.<n>.<字段>` */
const MODEL_INDEX_PATH = /^models\.\d+\./

/**
 * 双击字段回默认值时要取的默认值。
 *
 * 模型页的路径带着下标（`models.3.rotation`），而那个下标是运行时才知道的，
 * 所以要先剥掉它。
 *
 * 剥完之后**不能**再去 `DEFAULT_SCENE_CONFIG` 上按 `models.0.rotation` 查：
 * 默认场景是空的，那条路径现在求值是 undefined，双击会变成把字段清空而不是复位。
 * 模型那几个字段改从工厂取一份新模型来查——所有模型的结构完全一样，
 * 取哪一份的默认值都相同。其余分组照旧在默认配置上查。
 */
export function defaultFor(path: string): unknown {
  if (MODEL_INDEX_PATH.test(path)) {
    return getPath(createModelConfig(), path.replace(MODEL_INDEX_PATH, ''))
  }
  return getPath(DEFAULT_SCENE_CONFIG, path)
}
