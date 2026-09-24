import type { DeepPartial, FloorplanConfig, FloorplanPoint, ModelConfig, SceneConfig } from '../types'

/**
 * 造一份全新的模型配置。
 *
 * 写成工厂而不是常量，是因为它要被摆进数组、也要被 `addModel` 反复取用：
 * 模块级共享的同一个对象被 `applyPatch` 的别名分支装进配置之后，
 * 改其中一个模型会连带改掉所有引用它的地方。
 *
 * `id` 是空串而不是现生成的 uuid：默认值里不能有随机量，否则这个模块每被
 * 求值一次就产生一组不同的默认配置，`cloneConfig(DEFAULT_SCENE_CONFIG)`
 * 也就不再是「同一份默认值」。id 由 store 建立时统一补齐（ensureModelIds）。
 */
export function createModelConfig(): ModelConfig {
  return {
    id: '',
    url: '',
    draco: false,
    wireframe: false,

    name: '',
    position: [0, 0, 0],
    /** 与 camera.minPolarAngle 一致，单位是弧度 */
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    castShadow: true,
    receiveShadow: true,
    /**
     * 默认 5 类事件全部关闭。
     * 只要启用任意一类，指针每在画布上移动一下就有一条 raycast 落在模型上，
     * 而绝大多数宿主并不需要指针事件。
     *
     * 五个值**必须各写一份字面量**，不能抽成一个常量再引用五次：
     * `deepAssign` 在目标缺 key 时会直接把源对象装进去（别名而非拷贝），
     * 共享同一个对象会让改一个事件连带改掉另外四个。
     */
    events: {
      click: { enabled: false, code: '' },
      dblclick: { enabled: false, code: '' },
      pointerenter: { enabled: false, code: '' },
      pointerleave: { enabled: false, code: '' },
      contextmenu: { enabled: false, code: '' },
    },
  }
}

/**
 * 造一份空的户型图配置。
 *
 * 写成工厂而不是把字面量直接摆进 `DEFAULT_SCENE_CONFIG`，理由与
 * `createModelConfig` 完全一样：默认值会被反复取用，而**模块级共享的同一个对象**
 * 一旦被 `applyPatch` 的别名分支装进某份配置，改一个宿主会连带改掉另一个。
 * 这里的三条数组与它们将来的元素都必须是新对象。
 *
 * 内容是空的（没有地基、没有墙）——「造一栋房子」是一个明确的动作，
 * 不该由默认值白送，与 `models: []` 同一条约定。
 */
export function createFloorplanConfig(): FloorplanConfig {
  return {
    foundation: null,
    walls: [],
    openings: [],
    rooms: [],
  }
}

/**
 * 把一份户型图补丁里会被 `applyPatch` 别名出去的部分先拷一份。
 *
 * 与 `cloneModelPatch` 是同一条理由、同一类受害者，只是层次更深一层：
 * `applyPatch` 的 `isPlainObject` **显式排除了数组**，所以任何数组都是
 * `target[key] = value` 整体装入。宿主的 `walls` 数组一旦成了配置里的那一份，
 * 之后它就地 push 一下就是静默改场景、历史栈里还查无此事。
 *
 * **必须逐层拷，不能只拷顶层那三个数组**：每面墙的 `start` / `end`、
 * 每个房间的 `polygon`、每个多边形的每个点，全都是会被别名出去的数组。
 * 只拷一层的话，宿主改一个端点坐标照样能静默改掉场景。
 */
export function cloneFloorplanPatch(patch: DeepPartial<FloorplanConfig>): DeepPartial<FloorplanConfig> {
  const next: DeepPartial<FloorplanConfig> = { ...patch }

  if (patch.foundation) next.foundation = { ...patch.foundation }

  /*
   * 三个数组都按 `DeepPartial` 的数组规则处理：整体替换、元素是**完整对象**
   * （`types.ts` 那条注释写明了不做逐元素合并）。所以这里每个元素直接铺开、
   * 只把里面嵌套的坐标数组换成新数组。
   *
   * `Array.isArray` 那层判断防的是**无类型宿主**（JS 调用方）传进来一个
   * 没有 `start` 的墙——那时值原样留着 `undefined`，`applyPatch` 会跳过这个键，
   * 而不是在这里抛「undefined is not iterable」。
   */
  if (Array.isArray(patch.walls)) {
    next.walls = patch.walls.map((wall) => ({
      ...wall,
      start: (Array.isArray(wall.start) ? [...wall.start] : wall.start) as FloorplanPoint,
      end: (Array.isArray(wall.end) ? [...wall.end] : wall.end) as FloorplanPoint,
    }))
  }

  if (Array.isArray(patch.openings)) {
    next.openings = patch.openings.map((opening) => ({ ...opening }))
  }

  if (Array.isArray(patch.rooms)) {
    next.rooms = patch.rooms.map((room) => ({
      ...room,
      polygon: (Array.isArray(room.polygon)
        ? room.polygon.map((point) => (Array.isArray(point) ? ([...point] as FloorplanPoint) : point))
        : room.polygon) as FloorplanPoint[],
    }))
  }

  return next
}

/**
 * 全插件唯一的默认值来源。
 *
 * 之前这些数字散落在 store 的 VIEW_DEFAULTS 和 SceneContent 的模块级常量里，
 * 现在收敛到一处：导入配置、重置、以及新增字段时都只需要改这里。
 */
export const DEFAULT_SCENE_CONFIG: SceneConfig = {
  background: '#0b1020',

  /**
   * 默认是**空场景**。
   *
   * 早先这里放了一个 `url` 为空的条目（渲染成内置示例几何体），理由是
   * 「空视口只有网格线，分不清是没有模型还是加载失败 / 地址写错了」。
   * 但那个几何体是宿主从来没要求过的：它会跟着每一份默认配置进导出物、
   * 进宿主页面，而「加载失败」现在由 store 的 `error` 明说，两件事不再混在一起。
   *
   * 空场景的表达力由界面承担：视口只渲染地面与光照，`selectedModel` 是
   * `undefined`，编辑器的「场景模型」有一段空态提示。想要那个占位物体，
   * 调一次 `addModel()`——它是一个明确的动作，不该是默认值。
   */
  models: [],

  /**
   * 户型图默认是**空的一份**（没有地基、没有墙），理由与 `models: []` 同源。
   *
   * 走工厂而不是字面量：这份对象会被反复取用，而**每一层**都必须是新对象
   * （见 `createFloorplanConfig` 的注释）。`models` 恰恰因为默认值是空数组
   * 而天然没有这个顾虑，户型图有嵌套对象，会。
   */
  floorplan: createFloorplanConfig(),

  camera: {
    position: [4, 3, 6],
    target: [0, 0, 0],
    fov: 45,
    near: 0.1,
    far: 200,
    autoRotate: false,
    autoRotateSpeed: 1.2,
    damping: true,
    dampingFactor: 0.06,
    minDistance: 1.5,
    /**
     * 拉远的上限。与地面的 `size` / `fadeDistance` 是一组数（那两处的注释解释了
     * 为什么是 120 / 150）：退到 110 上下，整块地平面就都在取景里了。
     *
     * 这个数还有一个下游：编辑器的 2D 俯视档进来时站的高度是 110
     * （`playground/composables/useViewMode.ts` 的 `TOP_DISTANCE`）。它必须**高于**
     * 那个高度——低于就会被 OrbitControls 悄悄夹回来（按下去像是没生效），
     * 持平则俯视里只能往里缩、往外一滚就顶在上限上不动。150 留出 40 的余量，
     * 刚好够滚到「整块 120 见方的地都进画面」（那需要 145）。两个数是一对，
     * 改一个要看另一个。
     */
    maxDistance: 150,
    minPolarAngle: 0,
    /** 限制相机不能翻到地面以下，避免用户转到网格背面 */
    maxPolarAngle: Math.PI / 2,
    enablePan: true,
    enableZoom: true,
    /** 默认允许旋转：三个权限全开才是「随便看」的常态，收窄是宿主的主动选择 */
    enableRotate: true,
  },

  ground: {
    visible: true,
    /**
     * 平面边长，与 `fadeDistance` 按同一个倍率放缩（24 → 120、30 → 150 都是 ×5）——
     * 两个数一起变，网格线的浓淡从中心到边缘的过渡比例才不会跟着改，
     * 变大的只是「这块地有多大」。
     */
    size: 120,
    cellSize: 0.6,
    cellThickness: 0.5,
    cellColor: '#1e293b',
    sectionSize: 5,
    sectionThickness: 1,
    sectionColor: '#334155',
    infiniteGrid: false,
    /**
     * 淡出的**终点**（不是起点）：alpha 正比于 `1 - 平面内水平距离 / fadeDistance`，
     * 距离量的是「相机在网格平面上的投影点」到该片元，所以 150 是「离那儿 150 处彻底看不见」。
     *
     * 边长 120 的一半对角线是 85：相机在原点附近取景时，整块地都还在淡出过程中、
     * 边缘不至于被切掉，而那一段过渡摊在 85/150 的范围里，是渐变而不是一道明显的圈。
     * 相机拉到最远（`maxDistance`）并贴着地平线看时，最远的那个角会淡到完全看不见——
     * 那正是这个参数该做的事，不是被裁掉了。
     */
    fadeDistance: 150,
    fadeStrength: 1,
    followCamera: false,
  },

  sun: {
    /**
     * 默认关闭天空。
     * Sky 是程序化生成的（不产生网络请求），但它会盖住背景色，
     * 默认开启等于悄悄改变既有宿主应用的观感。
     */
    showSky: false,
    /**
     * 48° / 45° 与改造前硬编码的主光位置 (5, 8, 5) 是同一个方向，
     * 这样把主光改为由太阳角度推导之后，默认观感不变。
     */
    elevation: 48,
    azimuth: 45,
    turbidity: 3.4,
    rayleigh: 3,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.7,
    ambientIntensity: 1.8,
    keyIntensity: 2.2,
    fillIntensity: 0.7,
    environment: '',
    /**
     * 默认没有天空盒。
     *
     * 与 `showSky: false` / `environment: ''` 是同一条：它是**宿主自己的资产**
     * （六个 jpg 的地址写死在配置里），默认给一个就等于让每一个宿主应用
     * 都去拉六个它没要过的贴图。
     */
    skybox: null,
  },

  shadow: {
    /** 默认关闭，与 three 的 renderer.shadowMap.enabled 默认值保持一致 */
    enabled: false,
    type: 'contact',
    castShadow: true,
    receiveShadow: true,

    mapSize: 1024,
    bias: -0.0005,
    normalBias: 0.02,

    contactOpacity: 0.55,
    contactBlur: 2.4,
    contactScale: 12,
    contactResolution: 512,

    accFrames: 40,
    accOpacity: 0.9,
    accScale: 12,
    accBlend: 30,
  },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 深拷贝配置。
 *
 * 刻意不用 structuredClone：入参可能是 Vue 的 reactive 代理，
 * 而配置里只有数字/字符串/布尔/数组，JSON 往返既精确又对代理安全。
 */
export function cloneConfig(config: SceneConfig): SceneConfig {
  return JSON.parse(JSON.stringify(config)) as SceneConfig
}

function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    const value = patch[key]
    // undefined 表示"本次不改这一项"，而不是"把它清空"
    if (value === undefined) continue

    const current = target[key]
    if (isPlainObject(value) && isPlainObject(current)) applyPatch(current, value)
    else target[key] = value
  }
}

/**
 * 原地深合并。
 *
 * 「原地」是硬性要求：撤销/重做与导入配置都依赖 `config` 这个 reactive 对象的
 * 引用保持不变，否则 watch 会丢失目标，历史栈也就无从触发。
 */
export function deepAssign<T extends object>(target: T, patch: DeepPartial<T>): T {
  applyPatch(
    target as unknown as Record<string, unknown>,
    patch as unknown as Record<string, unknown>,
  )
  return target
}

/**
 * 把一份模型补丁里会被 `applyPatch` 别名出去的部分先拷一份。
 *
 * `applyPatch` 只有在「目标里已经有同名 plain object」时才递归，
 * 否则 `target[key] = value` 直接把宿主的对象/数组装进配置。两个受害者：
 *
 * - `position` / `rotation` / `scale`：宿主那个 reactive 数组一旦成了
 *   `config.models[n].position`，它就地变一下就是静默改场景。
 * - `repeat`：同一个道理，只是它是个二元组（u, v），不进上面那个循环。
 * - `events`：补丁经过深合并时，只有目标里已存在的那几层才会被递归；
 *   宿主传一份全新的 `events` 就等于把整棵对象树交了出去——而它的危害更大，
 *   它不是一个数字数组，是「配置即代码」的那半边。
 *
 * 注意拷的是**逐一保留**而不是按 5 个已知类型裁剪：宿主多写了一个未知类型时
 * 应当原样传下去（库按 `MODEL_EVENT_TYPES` 取用，多出来的不会生效，但也不会丢），
 * 这里的职责只是断开别名。
 *
 * ## 字符串字段不用进这里，数组字段必须进
 *
 * `name` / `url` / `partsJson` 这些**字符串型**字段一个都不在上面那几个 key 里，
 * 这是对的、不是漏了：`applyPatch` 的别名分支交出去的是**值**，
 * 而字符串是不可变的标量——配置里那一格拿到 `"..."`，与宿主手里那个变量
 * 再无关系，之后谁也改不动谁。
 *
 * **往 `ModelConfig` 里加一个数组或对象型字段时（`partsJson` 就是最容易让人
 * 误会的那一个：名字叫 json、内容是数组），必须回这里加一支。** 漏了的症状与
 * `position` 那段写的一模一样，而且是**静默**的：宿主那份数据还在自己手里，
 * 以为改它不影响场景，实际上改的就是场景。
 */
export function cloneModelPatch(patch: DeepPartial<ModelConfig>): DeepPartial<ModelConfig> {
  const next = { ...patch }

  for (const key of ['position', 'rotation', 'scale'] as const) {
    const value = patch[key]
    if (Array.isArray(value)) next[key] = [...value] as [number, number, number]
  }

  const repeat = patch.repeat
  if (Array.isArray(repeat)) next.repeat = [...repeat] as [number, number]

  const events = patch.events
  if (events && typeof events === 'object') {
    next.events = Object.fromEntries(
      Object.entries(events).map(([type, handler]) => [
        type,
        handler && typeof handler === 'object' ? { ...handler } : handler,
      ]),
    ) as DeepPartial<ModelConfig>['events']
  }

  return next
}

/** 顶层分组的中文名，用于生成历史记录标签 */
const GROUP_LABELS: Record<keyof SceneConfig, string> = {
  background: '背景',
  models: '模型属性',
  floorplan: '平面图',
  camera: '相机',
  ground: '地面',
  sun: '日照环境',
  shadow: '阴影',
}

/**
 * 比对两份配置，返回发生变化的分组中文名。
 * 历史面板用它把一次改动描述成「相机」「地面」这样的标签。
 */
export function changedGroups(before: SceneConfig, after: SceneConfig): string[] {
  return (Object.keys(GROUP_LABELS) as (keyof SceneConfig)[])
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => GROUP_LABELS[key])
}

/**
 * 把旧版配置里的单模型字段折成列表。
 *
 * 早先的配置写的是 `config.model`——**一个对象**。直接丢给 `applyConfig`
 * 的后果不是报错而是「什么都不发生」：`models` 不在补丁里，于是沿用当前场景
 * 的模型，而 `model` 这个键会被原样装进配置——用户看到的是「载入成功，但模型没变」，
 * 没有任何一处会告诉他这份数据有问题。
 *
 * 只认真正的旧形状（有 `model`、没有 `models`），新配置原样返回。
 *
 * 放在 `src/` 而不是编辑器的导入路径里，是因为消费它的有两处、而它们分属两层：
 * `SceneViewer` 的 `loadSceneData`（宿主用自己存的配置初始化）与编辑器的
 * `importFile`（导入 `.3deditor.json`）。两边各写一份、又悄悄不一致，
 * 正是那类不报错的 bug。
 */
export function migrateConfig(raw: DeepPartial<SceneConfig>): DeepPartial<SceneConfig> {
  const legacy = (raw as { model?: unknown }).model
  if (Array.isArray(raw.models) || !legacy || typeof legacy !== 'object') return raw

  const { model, ...rest } = raw as DeepPartial<SceneConfig> & { model: ModelConfig }
  return { ...rest, models: [model] }
}
