/**
 * 打包产物冒烟测试：pnpm build 之后运行 `pnpm smoke`。
 *
 * 直接加载 dist/index.js（不经过打包器），在真实 Vue 应用里安装插件并渲染，
 * 覆盖几个「构建成功但装上就废」的坑：
 *   1. 入口漏引样式表 → 产物里没有任何组件样式，宿主项目里是一片裸 DOM
 *   2. 手写样式里混进全局选择器（html / body / *）→ 污染宿主应用的样式
 *   3. 库构建扫进了 playground → 发布产物里混入开发期样式
 *   4. Pinia 未复用宿主实例 → 同一页面出现两份插件状态
 *   5. 配置是引用而非拷贝 → DEFAULT_SCENE_CONFIG 被第一个宿主实例改脏
 *   6. 分组 prop 的 watcher 注册顺序反了 → 兼容用的扁平 environment 被覆盖
 *
 * 这里只验证到「组件树能渲染 + 配置能读写 + 样式产物正确」，
 * WebGL 实际出图、阴影是否真的落到地面上，依赖浏览器，
 * 仍需在真实项目里用 pnpm dev 目视确认。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp, defineComponent, h, toRaw } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createThreeDMaker, DEFAULT_SCENE_CONFIG, SceneViewer, deriveModelId, useSceneStore } from '../dist/index.js'
import { MAX_COUNT, MAX_PARTS, parseModelParts, placeModelParts } from '../dist/index.js'
import {
  CELL_SIZE,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  cloneFloorplanPatch,
  createFloorplanConfig,
  openingFaceOversized,
  openingFaceUnusable,
  dropOpeningFills,
  findEnclosedArea,
  findNearestWall,
  openingFilledByModel,
  openingFreeGap,
  openingMagnetOffset,
  openingOverlaps,
  openingRejectReason,
  pointAlongWall,
  pointInPolygon,
  polygonCenter,
  removeWall,
  resolveOpeningDrag,
  viewModeOf,
  wallFaceFit,
  wallFaceIsSheet,
  wallFaceTiles,
  wallFaceUnusable,
  wallLength,
  wallPieces,
  wallRotationY,
} from '../dist/index.js'

const results = []

function check(name, fn) {
  try {
    results.push({ ok: true, name, detail: fn() })
  } catch (error) {
    results.push({ ok: false, name, detail: error.message })
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// ---------- 1. 导出面 ----------

check('具名导出齐全', () => {
  assert(typeof createThreeDMaker === 'function', 'createThreeDMaker 不是函数')
  assert(typeof useSceneStore === 'function', 'useSceneStore 不是函数')
  assert(SceneViewer, 'SceneViewer 缺失')
  return 'createThreeDMaker / useSceneStore / SceneViewer 均存在'
})

// ---------- 2. 插件安装 ----------

const hostApp = createSSRApp({ render: () => h('div') })
hostApp.use(createPinia())

check('install 可调用', () => {
  createThreeDMaker().install(hostApp)
  return '未抛错'
})

check('全局组件已注册', () => {
  assert(hostApp.component('TdmSceneViewer'), 'TdmSceneViewer 未注册')
  assert(hostApp.component('TdmSceneToolbar'), 'TdmSceneToolbar 未注册')
  return 'TdmSceneViewer / TdmSceneToolbar 已注册'
})

check('复用宿主已有的 Pinia', () => {
  const pinia = hostApp.config.globalProperties.$pinia
  assert(pinia, '未检测到宿主 $pinia')
  return '插件未自行创建第二个实例'
})

check('宿主没有 Pinia 时也能安装', () => {
  const bareApp = createSSRApp({ render: () => h('div') })
  createThreeDMaker().install(bareApp)
  assert(bareApp.config.globalProperties.$pinia, '未补建 Pinia 实例')
  return '已自动补建内部实例'
})

// ---------- 3. 真实渲染 ----------

const HostPage = defineComponent({
  setup() {
    const scene = useSceneStore()
    scene.setModel('/demo.glb')
    scene.markLoaded()
    return () =>
      h('main', [
        h('span', { class: 'store-id' }, scene.$id),
        h(SceneViewer, { height: '200px' }),
      ])
  },
})

const pageApp = createSSRApp(HostPage)
pageApp.use(createPinia())
pageApp.use(createThreeDMaker())

let html = ''
try {
  html = await renderToString(pageApp)
  results.push({ ok: true, name: '渲染整棵组件树', detail: `输出 ${html.length} 字符` })
} catch (error) {
  results.push({ ok: false, name: '渲染整棵组件树', detail: error.message })
}

check('store id 带插件前缀', () => {
  assert(html.includes('tdm-scene'), `输出中未找到 tdm-scene：${html.slice(0, 200)}`)
  return '找到 tdm-scene，不会与宿主 store 撞名'
})

check('渲染出插件根节点与工具栏', () => {
  assert(html.includes('tdm-root'), '缺少 .tdm-root')
  assert(html.includes('tdm-toolbar'), '缺少 .tdm-toolbar')
  assert(html.includes('自动旋转'), '缺少工具栏按钮文案')
  return '.tdm-root + .tdm-toolbar + 按钮文案齐全'
})

// ---------- 4. 样式产物 ----------

const css = readFileSync(fileURLToPath(new URL('../dist/style.css', import.meta.url)), 'utf8')

check('样式产物包含组件用到的作用域类', () => {
  const needed = [
    'tdm-toolbar',
    'tdm-toolbar-btn',
    'tdm-toolbar-sep',
    'tdm-loading',
    'tdm-progress',
    'tdm-progress-bar',
    'tdm-error',
  ]
  const missing = needed.filter((name) => !css.includes(`.${name}`))
  assert(missing.length === 0, `缺少样式类：${missing.join(', ')}`)
  return `${needed.length} 个关键样式类齐全`
})

check('作用域约束样式存在', () => {
  assert(css.includes('.tdm-root'), '缺少 .tdm-root 作用域')
  assert(css.includes('.tdm-toolbar button.is-active'), '缺少工具栏激活态样式')
  return '.tdm-root 与激活态样式均存在'
})

check('未泄漏全局 reset（preflight 必须关闭）', () => {
  const leaked = [/^\s*html\s*[,{]/m, /^\s*body\s*[,{]/m, /^\s*\*\s*[,{]/m]
  const hit = leaked.find((pattern) => pattern.test(css))
  assert(!hit, `发现全局选择器 ${hit}，会污染宿主应用样式`)
  return '无 html / body / * 全局选择器'
})

check('未混入 playground 样式', () => {
  const leaked = [
    // 历史上 playground 用过的原子类。库现在不用任何原子 CSS 引擎了，
    // 这三条留着是廉价的保险：万一将来又引入一个，产物会立刻暴露。
    'min-w-80',
    'slate-950',
    'font-mono',
    // playground 的编辑器视觉令牌（editor.scss 里的琥珀信号色与墨阶）
    '--signal',
    '#ff9d2e',
    '--ink-300',
  ]
  const hit = leaked.filter((name) => css.includes(name))
  assert(hit.length === 0, `混入了开发期样式：${hit.join(', ')}`)
  return '产物中只有 src 的样式'
})

// ---------- 5. 配置模型与历史栈 ----------

/**
 * 这些断言必须在真实的 Pinia 里跑。
 * store 是 setup-store，`config` 是 reactive、历史栈是 ref，
 * 脱离 Pinia 直接调用拿不到可用的实例。
 */
setActivePinia(createPinia())

check('SceneConfig 默认值字段齐全', () => {
  const config = useSceneStore().config

  const groups = {
    camera: ['position', 'target', 'fov', 'near', 'far', 'autoRotate', 'minPolarAngle'],
    ground: ['visible', 'size', 'cellSize', 'cellColor', 'infiniteGrid', 'fadeDistance'],
    sun: ['showSky', 'elevation', 'azimuth', 'turbidity', 'ambientIntensity', 'environment', 'skybox'],
    shadow: ['enabled', 'type', 'castShadow', 'mapSize', 'contactOpacity', 'accFrames'],
    floorplan: ['foundation', 'walls', 'openings', 'rooms'],
  }

  for (const [group, keys] of Object.entries(groups)) {
    assert(config[group], `缺少分组 ${group}`)
    const missing = keys.filter((key) => config[group][key] === undefined)
    assert(missing.length === 0, `${group} 缺少字段：${missing.join(', ')}`)
  }

  assert(config.camera.position.length === 3, 'camera.position 不是三元组')
  assert(typeof config.background === 'string', 'background 不是字符串')

  /*
    模型是一份列表而不是单个对象——「一个场景摆多个模型」正是这一版的能力。
    默认是**空数组**：不再预置那个 url 为空的条目（它渲染成内置示例几何体）。
    模型的字段齐全性由下面「追加出来的模型带全套默认字段」那一条守着。
  */
  assert(Array.isArray(config.models), `models 不是数组：${typeof config.models}`)
  assert(
    config.models.length === 0,
    `默认场景应当是空的，实际有 ${config.models.length} 个模型`,
  )

  /*
    平面图默认也是空的，理由与 models 同源：默认值里出现东西，它会跟着每一份
    默认配置进导出物、进宿主页面，而「造一栋房子」是一个明确的动作。
    这一条同时守着一件不那么显眼的事——`createFloorplanConfig()` 是**工厂**，
    不是共享的字面量：`foundation` 是 null 而另外三个是数组，
    整份对象被反复取用时每一层都必须是新对象。
  */
  assert(config.floorplan.foundation === null, '默认地基不是 null')
  for (const key of ['walls', 'openings', 'rooms']) {
    assert(Array.isArray(config.floorplan[key]), `floorplan.${key} 不是数组`)
    assert(config.floorplan[key].length === 0, `默认 floorplan.${key} 应当是空的`)
  }

  return '5 个分组 + background + 空的 models / floorplan 全部就位'
})

/**
 * 把每个模型的 id 抹平之后再比较整份配置。
 *
 * `models[n].id` 是建立 store 时现生成的 uuid，而 DEFAULT_SCENE_CONFIG 里是空串
 * （模块级常量写死 uuid 会让所有宿主实例共享同一个），
 * 所以全量 JSON 比对必须排除它，否则永远不相等。
 *
 * 只抹 id 这一项，其余字段一律原样参与比较：多模型之后配置里多了 `models`
 * 这层数组，若在这里图省事把 `models` 整个跳过，「列表里的模型被改坏了」
 * 就再也测不出来了。
 */
function comparable(config) {
  return JSON.stringify({
    ...config,
    models: config.models.map((model) => ({ ...model, id: '' })),
  })
}

/**
 * 让场景里正好有一个（默认值的）模型，并把它返回。
 *
 * 默认场景是空的，而下面不少用例断言的是物体级字段，需要场景里真的有东西。
 * 从前这个前提是默认值白送的（`DEFAULT_SCENE_CONFIG.models` 里预置了一条），
 * 现在由用例自己建——顺带让每条用例都不再依赖「上一条留下了什么」。
 */
function withModel(url = '') {
  const scene = useSceneStore()
  scene.resetConfig()
  scene.addModel(url)
  return scene
}

check('store 是默认配置的深拷贝', () => {
  const config = useSceneStore().config
  assert(
    comparable(config) === comparable(DEFAULT_SCENE_CONFIG),
    '初始 config 与 DEFAULT_SCENE_CONFIG 不一致',
  )
  // 改一处不影响常量本身，否则第二个宿主实例会拿到被污染的默认值
  config.camera.fov = 99
  assert(DEFAULT_SCENE_CONFIG.camera.fov === 45, 'DEFAULT_SCENE_CONFIG 被 store 污染')
  config.camera.fov = 45
  return '初始值一致（模型 id 除外，它是现生成的），且常量未被 store 修改'
})

check('新模型的字段齐全性', () => {
  /*
    这一段原先挂在上面那条「默认值字段齐全」上，查的是
    `DEFAULT_SCENE_CONFIG.models[0]`。默认场景改成空的之后，默认配置里
    根本没有模型可查——要查就得自己造一个，而 `addModel()` 正是生产代码里
    造模型的那条路径，比查一个常量更贴近实际。
  */
  const scene = useSceneStore()
  const model = scene.config.models[scene.addModel()]

  const modelKeys = [
    'id',
    'url',
    'draco',
    'wireframe',
    'name',
    'position',
    'rotation',
    'scale',
    'visible',
    'castShadow',
    'receiveShadow',
    'events',
  ]
  const missing = modelKeys.filter((key) => model[key] === undefined)
  assert(missing.length === 0, `新模型缺少字段：${missing.join(', ')}`)

  // 物体级三元组必须是「长度为 3 的数组」：它们会被原样交给
  // new Vector3().fromArray() / new Euler().fromArray()，长度不对是静默出错
  for (const key of ['position', 'rotation', 'scale']) {
    const value = model[key]
    assert(Array.isArray(value) && value.length === 3, `model.${key} 不是三元组：${value}`)
    assert(value.every((n) => typeof n === 'number'), `model.${key} 含非数字分量`)
  }
  assert(
    JSON.stringify(model.scale) === '[1,1,1]',
    `model.scale 默认值不是 [1,1,1]：${JSON.stringify(model.scale)}`,
  )
  assert(
    JSON.stringify(model.rotation) === '[0,0,0]',
    `model.rotation 默认值不是 [0,0,0]：${JSON.stringify(model.rotation)}`,
  )

  // 拾取有每帧 raycast 的开销，宿主没要就不该有。事件全关 = 完全不挂指针监听器
  const eventTypes = ['click', 'dblclick', 'pointerenter', 'pointerleave', 'contextmenu']
  for (const type of eventTypes) {
    const handler = model.events?.[type]
    assert(handler, `model.events.${type} 缺失`)
    assert(handler.enabled === false, `model.events.${type}.enabled 默认不是 false`)
    assert(handler.code === '', `model.events.${type}.code 默认不是空串`)
  }
  assert(typeof model.id === 'string', 'model.id 不是字符串')

  /*
   * 5 份 events 必须是 5 个互不相同的对象。
   *
   * `deepAssign` 在目标缺这个键时会**直接把宿主的对象装进配置**（别名，不拷贝），
   * 所以 `createModelConfig()` 里若写成共享一个常量，改一个事件的 enabled
   * 会连带改掉另外四个——而且是静默的。
   */
  assert(
    new Set(eventTypes.map((type) => model.events[type])).size === eventTypes.length,
    '5 类事件共用同一个对象，存在别名',
  )

  // 工厂必须是工厂：两个模型之间也不能共用引用，否则改 B 的线框 A 也跟着变
  const second = scene.config.models[scene.addModel('/second.glb')]
  assert(second.events.click !== model.events.click, '两个模型共用同一个事件对象，存在别名')
  assert(second.position !== model.position, '两个模型共用同一个坐标数组，存在别名')
  assert(second.events.click !== second.events.dblclick, '5 类事件共用同一个对象，存在别名')

  return '全套字段 + 物体级三元组 + 5 类事件就位，且引用两两独立'
})

check('applyConfig 深合并且不清空未提及的分支', () => {
  const scene = useSceneStore()
  const before = {
    groundColor: scene.config.ground.cellColor,
    sunElevation: scene.config.sun.elevation,
  }

  scene.applyConfig({ camera: { fov: 60 } })

  assert(scene.config.camera.fov === 60, 'fov 未写入')
  assert(scene.config.camera.near === 0.1, '同分组的其他字段被清掉了')
  assert(scene.config.ground.cellColor === before.groundColor, '未提及的分组被改动')
  assert(scene.config.sun.elevation === before.sunElevation, '未提及的分组被改动')
  return '只改目标字段，其余分支原样保留'
})

check('applyConfig 忽略 undefined（表示"本次不改"）', () => {
  const scene = useSceneStore()
  scene.applyConfig({ camera: { fov: 45, near: undefined } })
  assert(scene.config.camera.near === 0.1, 'undefined 被当成"清空"写进去了')
  return 'undefined 被跳过'
})

check('exportConfig 往返幂等', () => {
  const scene = useSceneStore()
  const exported = scene.exportConfig()
  const json = JSON.stringify(exported)

  scene.applyConfig(exported)
  assert(JSON.stringify(scene.config) === json, 'applyConfig(exportConfig()) 改动了配置')
  assert(exported !== scene.config, 'exportConfig 返回的是同一个引用，不是拷贝')

  // 导出物必须能直接 JSON 序列化——它会被写进 .3deditor.json
  assert(JSON.parse(json).camera.fov === 45, '导出物无法往返 JSON')
  return '导出 → 导入不改变任何字段'
})

check('undo / redo 能还原与前进', () => {
  const scene = useSceneStore()
  const baseline = scene.config.camera.fov

  scene.applyConfig({ camera: { fov: 22 } }, '测试 · 改视场角')
  const changed = scene.config.camera.fov
  assert(changed === 22, `fov 未写入，仍是 ${changed}`)
  assert(scene.canUndo, 'canUndo 为假，历史没记上')

  scene.undo()
  assert(scene.config.camera.fov === baseline, `undo 后 fov 是 ${scene.config.camera.fov}`)
  assert(scene.canRedo, 'undo 后 canRedo 为假')

  scene.redo()
  assert(scene.config.camera.fov === 22, `redo 后 fov 是 ${scene.config.camera.fov}`)
  return `${baseline} → 22 → ${baseline} → 22`
})

check('resetConfig 恢复默认值', () => {
  const scene = useSceneStore()
  scene.resetConfig()
  assert(comparable(scene.config) === comparable(DEFAULT_SCENE_CONFIG), 'resetConfig 后与默认值不一致')
  /*
    默认场景是空的，所以「重置」现在是一次彻底的清场：不只是字段回默认值，
    模型也一个不剩。从前这里顺带断言「模型 id 换了新的」——那条路径
    （ensureModelIds 给列表里的模型补 id）现在归下面 5c 一节管。
  */
  assert(scene.config.models.length === 0, `重置后还剩 ${scene.config.models.length} 个模型`)
  return '全部分组回到默认值，场景回到空的'
})

check('clearModel 复位加载状态', () => {
  const scene = useSceneStore()
  scene.setModel('/demo.glb')
  assert(scene.loading === true, 'setModel 未进入加载态')

  scene.markFailed('模拟失败')
  assert(scene.hasError === true, 'markFailed 未置错误态')

  scene.clearModel()
  assert(scene.config.models[0].url === '', 'clearModel 未清空 url')
  assert(scene.hasError === false, 'clearModel 未清错误态')
  assert(scene.loading === false, 'clearModel 未退出加载态')
  return 'url / loading / error 三者同步复位'
})

// ---------- 5b. 物体级：名称回退派生与三元组写入 ----------

check('deriveModelId 表驱动', () => {
  const cases = [
    ['', 'builtin'],
    ['DamagedHelmet.glb', 'damaged-helmet'],
    ['models/v2/chair.gltf?v=2', 'chair'],
    ['blob:http://localhost:5173/8f3a-1c', 'local-file'],
    ['data:model/gltf-binary;base64,AAAA', 'local-file'],
    ['Damaged%20Helmet.glb', 'damaged-helmet'],
    ['https://cdn.example.com/assets/Robot_Arm.glb#v2', 'robot-arm'],
  ]

  for (const [input, expected] of cases) {
    const actual = deriveModelId(input)
    assert(actual === expected, `deriveModelId(${JSON.stringify(input)}) = ${actual}，应为 ${expected}`)
  }
  // 哨兵值而不是空串：它是 model.name 留空时的回退值，
  // 而事件载荷里的 name 承诺非空，回退出空串会让这个承诺失效
  assert(deriveModelId('') !== '', '空地址应当回落到哨兵值而不是空串')
  return `${cases.length} 组输入全部命中`
})

check('三元组是整体替换而不是逐项合并', () => {
  const scene = useSceneStore()
  scene.patchModel({ position: [1, 2, 3] })
  assert(
    JSON.stringify(scene.config.models[0].position) === '[1,2,3]',
    `写入后是 ${JSON.stringify(scene.config.models[0].position)}`,
  )

  // 换一个短一点的数组，验证不会残留上一次的分量
  scene.patchModel({ position: [7, 8, 9] })
  assert(
    JSON.stringify(scene.config.models[0].position) === '[7,8,9]',
    `二次写入后是 ${JSON.stringify(scene.config.models[0].position)}`,
  )
  assert(scene.config.models[0].rotation[0] === 0, '改 position 波及了 rotation')
  return 'deepAssign 对数组是整体替换，符合预期'
})

check('repeat 深拷进配置、整体替换，且默认值里不存在', () => {
  /*
    贴图重复次数（`ModelConfig.repeat`）不是物体级变换，但它与 `position` / `scale`
    踩的是**同一个坑**、也守**同一条规矩**：它是个数组，而 `applyPatch` 对数组是
    `target[key] = value` 整体装入。于是前面两条断言各查一半——不深拷就是把宿主的
    数组别名进配置（宿主再就地 `repeat[0] = …` 就是静默改场景），整体替换则保证
    换一个短数组时不会残留上一次的分量。

    第三条查的是**它不该有默认值**。`SceneModel` 拿「这个键在不在」当
    「要不要去动模型自带的贴图」的开关，默认值里凭空多一个 `[1, 1]` 会让每个模型
    都被写一遍贴图变换——而资产自带 `KHR_texture_transform` 时，那一份 `repeat`
    就被无声地抹成 1 了。
  */
  const scene = useSceneStore()
  const index = scene.addModel('/tiled.glb')

  assert(
    !('repeat' in scene.models[index]),
    `默认模型带了 repeat：${JSON.stringify(scene.models[index].repeat)}`,
  )

  const hostRepeat = [4, 6]
  scene.patchModel({ repeat: hostRepeat }, '测试 · 平铺', index)

  assert(
    JSON.stringify(scene.models[index].repeat) === '[4,6]',
    `repeat 没写进去：${JSON.stringify(scene.models[index].repeat)}`,
  )
  assert(scene.models[index].repeat !== hostRepeat, '宿主数组被别名进了配置')

  hostRepeat[0] = 99
  assert(
    JSON.stringify(scene.models[index].repeat) === '[4,6]',
    `宿主就地改数组波及了配置：${JSON.stringify(scene.models[index].repeat)}`,
  )

  scene.patchModel({ repeat: [2, 2] }, '测试 · 平铺', index)
  assert(
    JSON.stringify(scene.models[index].repeat) === '[2,2]',
    `二次写入后是 ${JSON.stringify(scene.models[index].repeat)}，没有整体替换`,
  )
  assert(
    JSON.stringify(scene.models[index].scale) === '[1,1,1]',
    '改 repeat 波及了 scale',
  )
  return 'repeat 与物体级三元组同一条规矩，且默认值里没有它'
})

check('天空盒的六个面进出配置都完整，且 null 关得掉', () => {
  /*
    天空盒是 `sun` 上的一个新字段，形状与别处都不一样：
    它是一个**定长元组**（六个地址），而默认是 `null`。

    三条断言各守一件事：
      - 六个面原样进得去、也原样出得来（`exportConfig` 走 JSON 深拷贝，
        顺手把「配置里只放得下可序列化的东西」这条也钉住）；
      - `null` **写得进去**。`applyPatch` 只跳过 `undefined`、不跳过 `null`，
        所以「关掉天空盒」是办得到的——这一条是这个功能有没有退路的全部依据，
        写成空数组或者 `undefined` 都会让它变成一个关不掉的东西；
      - 撤销能把它退回去（天空盒与别的配置项走同一条历史，没有特例）。
  */
  const scene = useSceneStore()
  const faces = [
    'https://cdn.test/skybox/right.jpg',
    'https://cdn.test/skybox/left.jpg',
    'https://cdn.test/skybox/top.jpg',
    'https://cdn.test/skybox/down.jpg',
    'https://cdn.test/skybox/front.jpg',
    'https://cdn.test/skybox/back.jpg',
  ]

  assert(scene.config.sun.skybox === null, `默认不是 null：${JSON.stringify(scene.config.sun.skybox)}`)

  scene.applyConfig({ sun: { skybox: faces, environment: '' } }, '测试 · 应用天空盒')

  assert(
    JSON.stringify(scene.config.sun.skybox) === JSON.stringify(faces),
    `六个面没写进去：${JSON.stringify(scene.config.sun.skybox)}`,
  )
  assert(
    JSON.stringify(scene.exportConfig().sun.skybox) === JSON.stringify(faces),
    '导出的配置里六个面不完整（JSON 往返丢了东西）',
  )

  scene.applyConfig({ sun: { skybox: null } }, '测试 · 关闭天空盒')

  assert(
    scene.config.sun.skybox === null,
    `关掉之后是 ${JSON.stringify(scene.config.sun.skybox)}，null 没写进去`,
  )

  scene.undo()
  assert(
    JSON.stringify(scene.config.sun.skybox) === JSON.stringify(faces),
    `撤销之后是 ${JSON.stringify(scene.config.sun.skybox)}，撤销没把它退回来`,
  )

  // 收回默认，免得后面的检查看见一个开着天空盒的场景
  scene.applyConfig({ sun: { skybox: null } }, '测试 · 收尾')

  return '六个面写进 sun.skybox、null 关得掉、撤销退得回来'
})

check('resetConfig 会把变换一并复位', () => {
  const scene = withModel('/posed.glb')
  scene.patchModel({
    position: [5, 5, 5],
    scale: [2, 2, 2],
    events: { click: { enabled: true, code: "console.log('x')" } },
  })
  // 前置条件：改动确实落进了配置，否则下面「重置后是默认值」可能只是本来就没写进去
  assert(
    JSON.stringify(scene.config.models[0].position) === '[5,5,5]',
    `前置条件不成立，位置是 ${JSON.stringify(scene.config.models[0].position)}`,
  )

  scene.resetConfig()

  /*
    默认场景是空的，所以「复位」现在是一次彻底的清场：模型连同它的变换、
    事件一起消失。这比从前「模型留在原地、只是字段回默认值」更彻底，
    也就把「物体级字段确实属于配置、跟着 resetConfig 走」这件事说得更死。
  */
  assert(scene.config.models.length === 0, `重置后还剩 ${scene.config.models.length} 个模型`)
  assert(
    comparable(scene.config) === comparable(DEFAULT_SCENE_CONFIG),
    '重置后与默认配置不相等（默认值可能被前面的用例改脏了）',
  )

  /*
    重置之后再追加的模型从默认值起算，不带上一轮的任何痕迹——
    「重置」对物体级字段的意义最终落在这一条上。
    事件脚本也是配置的一部分，必须一起清掉，否则「重置全部配置」之后
    点一下模型还会跑上一份场景留下的代码。
  */
  scene.addModel('/posed.glb')
  assert(
    JSON.stringify(scene.config.models[0].position) === '[0,0,0]',
    `新追加的模型带着旧位置：${JSON.stringify(scene.config.models[0].position)}`,
  )
  assert(scene.config.models[0].scale[0] === 1, '新追加的模型 scale 没复位')
  assert(scene.config.models[0].events.click.enabled === false, '新追加的模型事件启用位没复位')
  assert(scene.config.models[0].events.click.code === '', '新追加的模型事件代码没清空')
  return '重置清空场景，新追加的模型从默认值起算'
})

// ---------- 5d. 事件绑定：补丁合并、往返、默认值不被污染 ----------

check('事件的部分补丁不会顺手清掉同一项的另一半', () => {
  const scene = withModel('/events.glb')
  scene.patchModel({ events: { click: { enabled: true } } })
  scene.patchModel({ events: { click: { code: 'console.log(1)' } } })

  assert(
    scene.config.models[0].events.click.enabled === true,
    '只改 code 的那次写入把 enabled 抹掉了',
  )
  assert(scene.config.models[0].events.click.code === 'console.log(1)', 'code 未写入')

  // 只动了 click，另外 4 类必须原封不动——这是 5 个键各自独立的前提
  assert(scene.config.models[0].events.dblclick.enabled === false, '改 click 波及了 dblclick')
  assert(scene.config.models[0].events.contextmenu.code === '', '改 click 波及了 contextmenu')
  return '同一个事件内逐字段合并、5 类事件之间互不影响'
})

check('事件代码能原样导出并写回', () => {
  const scene = withModel('/events.glb')

  // 换行、单双引号、中文、缩进——JSON 往返最容易失真的几样
  const code = [
    '// 单击时看看载荷',
    "console.log('单击', event, model)",
    'if (event.distance > 3) console.log("远", { x: event.point[0] })',
  ].join('\n')

  scene.patchModel({ events: { click: { enabled: true, code } } })

  const exported = scene.exportConfig()
  assert(exported.models[0].events.click.code === code, '导出后代码就失真了')

  // 导出的是深拷贝：改它不该顺着引用回头改掉 store 里的配置
  const copy = scene.exportConfig()
  copy.models[0].events.click.code = '改了'
  assert(scene.config.models[0].events.click.code === code, 'exportConfig 返回的不是深拷贝')

  scene.resetConfig()
  // 重置之后场景是空的，那份代码自然也跟着没了
  assert(scene.config.models.length === 0, '重置后场景不是空的')

  scene.applyConfig(exported)
  assert(scene.config.models[0].events.click.code === code, '导入回来后代码失真')
  assert(scene.config.models[0].events.click.enabled === true, '导入回来后启用位丢失')
  return '换行 / 引号 / 中文都原样通过 JSON 往返'
})

check('新模型的 5 类事件各自是独立对象，默认值常量保持为空', () => {
  /**
   * `createModelConfig()` 是模块级共享的定义，它产出的 5 个键必须各自是
   * 独立对象：共享同一个 { enabled, code } 的话，改一类事件会连带改掉另外四类
   * （deepAssign 遇到目标缺键时是直接装引用），而且是静默的。
   *
   * 从前这里查的是 `DEFAULT_SCENE_CONFIG.models[0].events`。默认场景改成空的
   * 之后，那个常量里已经没有模型了——「常量有没有被改脏」这件事本身也换了性质：
   * 它里面根本没有模型可改，反倒是一条更强的保证。要守的另一半是
   * 「新造出来的模型是不是干净的」。
   */
  const events = withModel().config.models[0].events

  for (const type of ['click', 'dblclick', 'pointerenter', 'pointerleave', 'contextmenu']) {
    assert(events[type].enabled === false, `默认值里 ${type}.enabled 不是 false`)
    assert(events[type].code === '', `默认值里 ${type}.code 不是空串`)
  }
  assert(new Set(Object.values(events)).size === 5, '5 个事件共用同一个对象，改一个会改一片')

  // 上面几条用例都在 store 上写过多轮，这里确认没有穿透回默认值常量本身
  assert(DEFAULT_SCENE_CONFIG.models.length === 0, '默认值常量里凭空多了模型')
  return '新模型的 5 个事件键互不共享，默认值常量保持为空'
})

check('公开契约里有物体级 API', () => {
  const types = readFileSync(fileURLToPath(new URL('../dist/types.d.ts', import.meta.url)), 'utf8')
  const index = readFileSync(fileURLToPath(new URL('../dist/index.d.ts', import.meta.url)), 'utf8')
  const both = `${types}\n${index}`

  /**
   * 这是 CI 里唯一能守住「漏声明 emit」的手段。
   * SceneViewer 的根是单根 <div>，漏声明 objectClick 会让宿主的
   * onObjectClick 静默落成这个 div 上的 DOM 监听器 —— 永不触发、也不报错；
   * 而 SSR 下 TresCanvas 只输出一个 <canvas>，children 根本不渲染，点击链路测不到。
   */
  const needed = [
    // 5 类事件一个都不能少：漏声明的那个会静默失效，而这里是唯一的防线
    'objectClick',
    'objectDblclick',
    'objectPointerEnter',
    'objectPointerLeave',
    'objectContextMenu',
    'ObjectClickPayload',
    'ModelEventHandler',
    'events',
    'deriveModelId',
    'receiveShadow',
    // 画布级点选是第二条通道，同样漏了就没有任何提示
    'modelPick',
    'ModelPickPayload',
    'pickable',
    // 选中视觉与变换手柄：两个 emit 与三个 prop 走的是同一条「漏声明就静默失效」的路
    'modelTransform',
    'modelTransformEnd',
    'ModelTransformPayload',
    'TransformMode',
    'selection',
    'gizmo',
    'gizmoMode',
    // 户型图：配置分组 + 五个子类型（`export type * from './types'` 一并带出）
    'floorplan',
    'FloorplanConfig',
    'FloorplanFoundation',
    'FloorplanWall',
    'FloorplanOpening',
    'FloorplanRoom',
    'FloorplanPoint',
    'FloorplanOpeningKind',
    // 几何引擎：宿主自己画一层楼板、自己做「点到哪面墙」的高亮都要用
    'createFloorplanConfig',
    'cloneFloorplanPatch',
    'wallPieces',
    'FloorplanPiece',
    'FloorplanPieceRole',
    'findEnclosedArea',
    'EnclosedAreaResult',
    'findNearestWall',
    'NearestWallHit',
    'removeWall',
    'pointInPolygon',
    'polygonCenter',
    'wallLength',
    'pointAlongWall',
    'wallRotationY',
    'createFloorplanId',
    'pickRoomColor',
    /*
      墙面铺装的算术。
      它进公开面有两条理由：宿主自己想铺墙就得用它俩；而它是这轮改动里
      **唯一能不靠浏览器跑**的一段——切段、开洞那些早有断言，铺装这一段
      既盖不到静态检查、又要有真资产才能目视，所以列进契约里守住。
    */
    'wallFaceIsSheet',
    'wallFaceTiles',
    'wallFaceUnusable',
    'WallFaceBounds',
    'WallFaceTile',
    /*
      洞口外观的两个函数。

      `openingFilledByModel` 是**两条渲染路共用的唯一判据**（墙那侧按它抑制
      洞口内饰件、洞口那个组件按它接手），`dropOpeningFills` 是那条抑制本身。
      它俩进契约的理由与上面那一组不同：那组是「宿主自己铺墙要用」，
      这组是「少一个导出，宿主就没法自己复现编辑器那条抑制」——
      而判据在库外各写一遍的下场是同一个包围盒上两组共面几何、逐像素 z-fighting。
    */
    'wallFaceFit',
    /*
      `openingFaceUnusable` / `openingFaceOversized` **刻意是「洞口」而不是「门」**：
      同一个函数要能同时说一扇门和一扇窗的话，所以多带一个 `kind` 参数。
      它在契约里排在这儿的理由与上面那组一样——这两个是「资产能不能装进洞口」
      与「装进去之后是不是撑得太开」的**唯一判据**，宿主想自己判断就得有它。
    */
    'openingFaceUnusable',
    'openingFaceOversized',
    'openingFilledByModel',
    'dropOpeningFills',
    /*
      这里**刻不列 `groundPointAt`**：它是 `SceneViewer` 经 `defineExpose`
      交出来的实例方法，而 `.d.ts` 里没有实例方法的形状——`captureCamera` /
      `measureModel` 同样不在这个名单里。列进来只会让这条断言永远红着。
      （要守「它确实交得出去」，正确的位置是别处：类型层面靠 `vite build` 的
      类型检查，行为层面靠宿主调用点。）
    */
    'DEFAULT_WALL_HEIGHT',
    'DEFAULT_WALL_THICKNESS',
    'OPENING_EDGE_GAP',
    /*
      门窗落点的三条规则，加一条判重叠的。

      **这四条是「点选门窗 + 沿墙拖动」那次改动里唯一能不靠浏览器验的部分**：
      拖动本身要走指针事件与画面，静态检查一个字都盖不到；而「磁吸够不够得着
      贴齐位置」「空档为什么返回 null」「步进吸的是移动量还是绝对位置」这三件事
      全是算术，一旦错了的症状都只是「手感不对」，没人看得出是代码错了。
      所以它们放库里、进契约、进断言。

      `openingOverlaps` 是放置那条路本来就有的判据（原先内联在
      `placeOpeningAt` 里），它独立出来的理由就是「让出去多少」与「磁吸算出来
      多少」必须是同一个 1e-9——分开写死的话，改一处漏一处只会让「贴着放」
      时灵时不灵。

      `openingRejectReason` 把「墙太短 / 压着邻居」这两条也收进了库，理由是
      **替换一个洞口的尺寸时要重跑同一份判据**（尺寸跟着新料重开洞），
      两边各写一遍迟早只改一处，症状是「同样一扇窗，放得下、换不上去」。
      文案不在库里（`OpeningRejectReason` 只是两个原因码），说人话留在编辑器，
      与 `findEnclosedArea` 那三个 reason 同一条约定。
    */
    'openingMagnetOffset',
    'openingFreeGap',
    'openingOverlaps',
    'openingRejectReason',
    'resolveOpeningDrag',
    'OpeningGap',
    'OpeningRejectReason',
  ]
  const missing = needed.filter((name) => !both.includes(name))
  assert(missing.length === 0, `类型声明里缺少：${missing.join(', ')}`)
  return `${needed.length} 个公开符号均已声明`
})

check('产物里不含 new Function', () => {
  /**
   * 把「库只发事件、不执行用户代码」从口头约定钉成可执行契约。
   *
   * `events` 里那段 code 是配置的一部分、可以随文件导入，而库是宿主应用
   * 的一部分——库要是在运行时编译它，等于替宿主开了一个「配置即代码」的口子。
   * 执行权留在宿主/编辑器那一侧，所以产物里不该出现任何动态求值。
   */
  const banned = ['new Function', 'eval(', 'setTimeout("', 'setInterval("']
  const hits = []
  for (const file of ['index.js', 'index.cjs']) {
    const code = readFileSync(fileURLToPath(new URL(`../dist/${file}`, import.meta.url)), 'utf8')
    for (const pattern of banned) {
      if (code.includes(pattern)) hits.push(`${file} 含 ${pattern}`)
    }
  }
  assert(hits.length === 0, hits.join('；'))
  return '构建产物里没有动态求值'
})

// ---------- 5b. 模板 ref：three 对象必须用 shallowRef ----------

/** 递归收集 src 下的 .vue 文件（只用于下面那条模板 ref 检查，不关心顺序） */
function listVueFiles(dirUrl) {
  const found = []
  for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl)
    if (entry.isDirectory()) found.push(...listVueFiles(child))
    else if (entry.name.endsWith('.vue')) found.push(child)
  }
  return found
}

check('three 对象的模板 ref 没有走 useTemplateRef', () => {
  /**
   * `useTemplateRef` 返回的是 `readonly(shallowRef(null))`，而 readonly 是**深层**的：
   * 读 `.value` 拿到的不是 TresJS 创建的那只 three 对象，而是它的只读代理，
   * 连内部的 `Vector3`、`_listeners` 也一并被包住。
   *
   * 这个坑最恶劣的地方是它在生产构建里**一声不响**：dev 下还能看到一条
   * `Set operation on key ... failed: target is readonly`，生产里写入被直接丢弃。
   * `group.addEventListener(...)` 更直接——three 从 `this._listeners = {}` 起手，
   * 赋值被吞掉后紧接着读它的属性，抛 TypeError，事件一个都绑不上。
   *
   * 正则只认「ref 挂在 Tres* / OrbitControls 标签上」的写法，
   * DOM 元素与组件实例的模板 ref 不受影响（它们的 target type 不合法，
   * `readonly()` 会原样放行），所以这条不会误伤 playground 里那几处用法。
   */
  const offenders = []
  for (const file of listVueFiles(new URL('../src/', import.meta.url))) {
    const source = readFileSync(fileURLToPath(file), 'utf8')
    /**
     * 只认「真的用了」的写法：`useTemplateRef(...)` 或 `useTemplateRef<T>(...)`。
     * 不能只按标识符判——本仓库 src 的注释里就多次提到这个名字
     * （正是在解释为什么不能用它），那样会把这些文件全部误判成违规。
     */
    if (!/\buseTemplateRef\s*[(<]/.test(source)) continue
    const onThree = [...source.matchAll(/<(Tres[A-Za-z]+|OrbitControls)\b[^>]*?\bref="([^"]*)"/g)]
    if (onThree.length === 0) continue
    const where = file.pathname.split('/src/')[1]
    offenders.push(`${where} 的 ${onThree.map((m) => `<${m[1]} ref="${m[2]}">`).join('、')}`)
  }
  assert(offenders.length === 0, `改用 shallowRef + 同名 ref 属性：${offenders.join('；')}`)
  return 'src 里的 three 模板 ref 全是 shallowRef'
})

// ---------- 5c. 模型 id：随模型更换而重新生成 ----------

/**
 * 前面的用例已经 setModel / clearModel 换过好几轮 id 了，
 * 这一段要的是「刚建立 store 时长什么样」，所以换一块干净的 Pinia 重来。
 * 这里也是最后一段用 `useSceneStore()` 的用例，往后各节都各自建应用。
 */
setActivePinia(createPinia())

/** v4 uuid：版本位固定 4，变体位固定 10xx —— 两条生成路径都必须落在这个形状上 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

check('建立 store 时补上 uuid 形态的模型 id', () => {
  const scene = useSceneStore()
  assert(scene.config.models.length === 0, '默认场景应当是空的')

  /*
    `ensureModelIds` 守的是「配置里的模型一定有 id」。默认场景变成空的之后，
    这条路径只在宿主自己往配置里塞模型时才会走到——所以这里直接塞一份不带 id
    的进去，那正是它要兜住的形状：手工写的 JSON、别的工具生成的配置都不会带 id，
    而列表的 v-for key、事件脚本按 id 找回模型，两件事都依赖它。
  */
  scene.applyConfig({ models: [{ url: '/no-id.glb' }] })

  const id = scene.config.models[0].id
  assert(id, 'model.id 是空的，ensureModelIds 没跑到')
  assert(UUID_V4.test(id), `model.id 不是 v4 uuid：${id}`)
  // 常量是模块级共享的，里面写死 uuid 会让所有宿主实例拿到同一个 id
  assert(DEFAULT_SCENE_CONFIG.models.length === 0, '默认值常量里被写进了模型')
  return id
})

check('换模型时换 id，重复设同一地址不换', () => {
  const scene = useSceneStore()
  const initial = scene.config.models[0].id

  scene.setModel('/a.glb')
  const loaded = scene.config.models[0].id
  assert(loaded !== initial, '换地址后 id 没变')
  assert(UUID_V4.test(loaded), `新 id 不是 v4 uuid：${loaded}`)

  // 面板失焦、prop 重放都会重复提交同一个地址，这时不该产生新 id
  scene.setModel('/a.glb')
  assert(scene.config.models[0].id === loaded, '重复设同一地址换了 id')

  // 回到内置示例几何体也是换了一个物体
  scene.clearModel()
  const cleared = scene.config.models[0].id
  assert(cleared !== loaded, '卸载模型后 id 没变')
  assert(UUID_V4.test(cleared), `卸载后的 id 不是 v4 uuid：${cleared}`)
  return `${initial.slice(0, 8)} → ${loaded.slice(0, 8)} → ${cleared.slice(0, 8)}`
})

check('撤销到换模型之前会连 id 一起还原', () => {
  const scene = useSceneStore()

  /*
   * 用带标签的 applyConfig 来分步，而不是完全靠 setModel + undo：
   * setModel 只改配置，入栈走的是 config watch 的 400ms 防抖，
   * 而那一轮 flush 在这几个同步用例里还没轮到，undo() 里的 flushPending
   * 会扑空——测出来的时序就不是用户实际会遇到的。
   * 带标签的写入是同步提交的，这里要的是「快照里有没有 id」，不是防抖本身。
   */
  scene.applyConfig({ camera: { fov: 40 } }, '测试 · 基线')
  const before = scene.config.models[0].id
  assert(scene.config.models[0].url === '', `基线里 url 应已清空，实际是 "${scene.config.models[0].url}"`)

  scene.setModel('/b.glb')
  assert(scene.config.models[0].id !== before, 'setModel 没换 id')
  scene.applyConfig({ camera: { fov: 41 } }, '测试 · 换模型后')

  scene.undo()
  assert(
    scene.config.models[0].id === before,
    `撤销后 id 是 ${scene.config.models[0].id}，应为 ${before}`,
  )
  assert(scene.config.models[0].url === '', `撤销后 url 是 "${scene.config.models[0].url}"`)
  return 'id 存在配置里，因此历史栈能把它一起带回去'
})

check('applyConfig 携带的 id 原样保留', () => {
  const scene = withModel('/kept-id.glb')
  const exported = scene.exportConfig()
  const id = exported.models[0].id

  // 宿主显式给一个固定 id —— 这是「换模型也保持同一个 id」那条路
  scene.patchModel({ id: 'fixed-id' })
  assert(scene.config.models[0].id === 'fixed-id', `applyConfig 没写入 id：${scene.config.models[0].id}`)

  // 导出 → 导入往返不该换 id，否则宿主存下来的对齐关系会断
  scene.applyConfig(exported)
  assert(scene.config.models[0].id === id, `导出导入往返换了 id：${scene.config.models[0].id}`)
  return 'id 是配置的一部分，快照往返原样保留'
})

// ---------- 5e. 多模型：追加、删除、按条目寻址 ----------

/**
 * 这一段是这一版新增能力的核心契约。
 *
 * 上面所有用例都建立在「场景里正好一个模型」上，它们证明不了「追加第二个
 * 不会把第一个弄坏」。而 `models` 是配置里唯一的数组，`applyPatch` 对数组
 * 又是整体替换——两条特性叠在一起，正是最容易出事的地方。
 *
 * 默认场景是空的，所以这里每条用例都自己把前置条件（「第一个模型」）建出来。
 */
check('addModel 是追加而不是替换', () => {
  const scene = useSceneStore()
  scene.resetConfig()

  // 默认场景是空的，前置条件自己建一个「第一个」
  scene.addModel()
  const firstId = scene.models[0].id
  const index = scene.addModel('/second.glb')

  assert(scene.models.length === 2, `追加后应当有 2 个模型，实际 ${scene.models.length} 个`)
  assert(index === 1, `addModel 返回的下标是 ${index}，应为 1`)
  // 第一个必须原封不动地留着——「追加」的全部意义就在这里
  assert(scene.models[0].id === firstId, '追加把第一个模型换掉了')
  assert(scene.models[0].url === '', '追加改掉了第一个模型的地址')
  assert(scene.models[1].url === '/second.glb', `新模型的地址是 "${scene.models[1].url}"`)
  assert(scene.models[1].id !== firstId, '新模型复用了第一个的 id')
  assert(scene.selectedIndex === 1, `追加后选中项是 ${scene.selectedIndex}，应指向新模型`)
  assert(scene.selectedModel === scene.models[1], 'selectedModel 与 selectedIndex 对不上')
  // 与 setModel 一样，追加一个带地址的模型要顺带进入加载态
  assert(scene.loading === true, '追加带地址的模型没有进入加载态')
  return '两个模型并存，选中项落在新追加的那个上'
})

check('新追加的模型带全套默认字段且引用独立', () => {
  const scene = useSceneStore()
  const model = scene.models[1]

  assert(model.name === '', '新模型带着名字')
  assert(model.visible === true, '新模型不是可见的')
  assert(model.wireframe === false, '新模型默认开了线框')
  assert(model.castShadow === true, '新模型默认不投影')
  assert(
    JSON.stringify(model.position) === '[0,0,0]',
    `新模型的 position 是 ${JSON.stringify(model.position)}`,
  )
  assert(JSON.stringify(model.scale) === '[1,1,1]', '新模型不是单位缩放')
  assert(model.events.click.enabled === false, '新模型带着已启用的事件')
  /*
   * 引用必须全新。共享的话「改 B 的线框，A 也跟着变」——
   * 而 createModelConfig 是工厂正是为了防这一手，这里把它钉住。
   */
  assert(model.events.click !== scene.models[0].events.click, '新旧模型共用了同一个事件对象')
  assert(model.events.click !== model.events.dblclick, '5 类事件共用了同一个对象')
  assert(model.position !== scene.models[0].position, '新旧模型共用了同一个坐标数组')
  return '形状与默认值一致，且与已有模型的引用全部独立'
})

check('selectModel 只在合法下标上生效', () => {
  const scene = useSceneStore()

  scene.selectModel(0)
  assert(scene.selectedIndex === 0, `选中项是 ${scene.selectedIndex}，应为 0`)
  assert(scene.selectedModel === scene.models[0], '切回第一个模型失败')

  // 越界不该把选中项弄成 undefined —— 面板会读它，undefined 等于整页字段失联
  scene.selectModel(9)
  assert(scene.selectedIndex === 0, `越界后选中项变成了 ${scene.selectedIndex}`)
  scene.selectModel(-1)
  assert(scene.selectedIndex === 0, `负下标后选中项变成了 ${scene.selectedIndex}`)
  return '合法下标切换，越界原样不动'
})

check('patchModel 按条目寻址，且不改动别的模型', () => {
  const scene = useSceneStore()

  scene.patchModel({ wireframe: true, name: '第二个' }, '测试 · 改第二个', 1)

  assert(scene.models[1].wireframe === true, 'index 指定的那个没被改到')
  assert(scene.models[0].wireframe === false, '改了 index=1，index=0 也跟着变了')

  // 不传 index 时落到当前选中项上
  scene.selectModel(0)
  scene.patchModel({ name: '第一个' })
  assert(scene.models[0].name === '第一个', '不传 index 时没落到选中项上')
  assert(scene.models[1].name === '第二个', '不传 index 时误伤了别的模型')

  // 越界或不存在的条目：跳过，什么都不写（而不是抛异常或写错人）
  scene.patchModel({ name: '不该出现' }, '测试 · 越界', 9)
  assert(
    scene.models.every((model) => model.name !== '不该出现'),
    '越界 index 竟然写进了某个模型',
  )
  return 'index 优先、缺省落到选中项、越界跳过'
})

check('patchModel 断开宿主对象与配置的别名', () => {
  const scene = useSceneStore()
  const hostPosition = [1, 2, 3]
  const hostEvents = { click: { enabled: true, code: 'console.log(1)' } }

  scene.patchModel({ position: hostPosition, events: hostEvents }, '测试 · 别名', 0)

  assert(
    JSON.stringify(scene.models[0].position) === '[1,2,3]',
    `position 没写进去：${JSON.stringify(scene.models[0].position)}`,
  )
  assert(scene.models[0].events.click.enabled === true, 'events 没写进去')

  // 宿主就地改自己的对象，配置不该跟着动
  hostPosition[0] = 99
  hostEvents.click.enabled = false
  hostEvents.click.code = '改了'
  assert(
    JSON.stringify(scene.models[0].position) === '[1,2,3]',
    `宿主数组被别名进了配置：${JSON.stringify(scene.models[0].position)}`,
  )
  assert(scene.models[0].events.click.enabled === true, '宿主对象被别名进了配置：enabled 被改')
  assert(
    scene.models[0].events.click.code === 'console.log(1)',
    `宿主对象被别名进了配置：code 变成了 "${scene.models[0].events.click.code}"`,
  )
  return 'store 的写入口自己拷贝，宿主与 config 相互独立'
})

check('applyConfig 里的 models 是整体替换而不是逐条合并', () => {
  /**
   * 这是 `models` 与配置里其他分组的**唯一不对称**，也是最容易踩的一条：
   * `applyPatch` 遇到数组走 `target[key] = value`，所以传一段 `models`
   * 进去等于把整张列表换掉，而不是「按下标合并」。
   *
   * 把它写成用例而不是只写进注释，是因为它的失败方式很反直觉——
   * 传 `{ models: [{ url: 'x' }] }` 会得到一个只剩 url、其余字段全丢的模型，
   * 场景照样能渲染（内置几何体兜底），只是配置已经残了。
   *
   * 想只改其中一个模型，用 `patchModel(patch, label, index)`。
   */
  const scene = useSceneStore()
  scene.resetConfig()
  // 两个模型，才能看出「换掉整张列表」把数量也一起换了
  scene.addModel('/first.glb')
  scene.addModel('/second.glb')
  assert(scene.models.length === 2, '前置条件不成立')

  scene.applyConfig({ models: [{ url: '/only.glb' }] })

  assert(scene.models.length === 1, `替换后应当剩 1 个模型，实际 ${scene.models.length} 个`)
  assert(scene.models[0].url === '/only.glb', '替换后的地址不对')
  // 整体替换意味着没写在补丁里的字段也不见了——这正是要提醒的行为
  assert(scene.models[0].events === undefined, '整体替换后竟然还留着旧字段，语义变了')
  /*
   * 但 id 是例外：它会被就地补上。
   * 手工写的 JSON、别的工具生成的配置都可能没带 id，而列表的 `v-for` key、
   * 事件脚本按 id 找回模型这两件事都依赖它——缺了会是一个 key 为 undefined
   * 的行，以及「事件跑的是别人的代码」。
   */
  assert(scene.models[0].id !== '', '补丁里没写 id，store 没有补上')
  assert(UUID_V4.test(scene.models[0].id), `补出来的 id 不是 v4 uuid：${scene.models[0].id}`)
  return 'models 走数组整体替换；逐条改用 patchModel；id 由 store 补齐'
})

check('removeModel 删除条目并把选中项收回界内', () => {
  const scene = useSceneStore()
  scene.resetConfig()
  // 默认场景是空的，前置条件自己建：三个模型，中间那个是内置示例几何体
  scene.addModel()
  scene.addModel('/b.glb')
  scene.addModel('/c.glb')
  assert(scene.models.length === 3, '前置条件不成立')

  // 删中间的：剩下的顺序不能乱
  scene.removeModel(1)
  assert(scene.models.length === 2, `删除后应当剩 2 个，实际 ${scene.models.length} 个`)
  assert(scene.models[0].url === '', '删除打乱了顺序')
  assert(scene.models[1].url === '/c.glb', '删除打乱了顺序')

  // 删掉当前选中项（此时是最后一条）之后，选中项必须收回界内
  scene.selectModel(1)
  scene.removeModel(1)
  assert(scene.models.length === 1, '删除失败')
  assert(scene.selectedIndex === 0, `删到只剩 1 个时选中项是 ${scene.selectedIndex}`)
  assert(scene.selectedModel === scene.models[0], '选中项没有指回唯一的那个模型')

  // 删空：不允许选中项停在 0 却指着一个不存在的东西
  scene.removeModel(0)
  assert(scene.models.length === 0, '空场景构造失败')
  assert(scene.selectedIndex === 0, `空场景下选中项是 ${scene.selectedIndex}`)
  assert(scene.selectedModel === undefined, '空场景下 selectedModel 不是 undefined')

  // 越界删除是个 no-op，不该把列表弄坏
  scene.removeModel(5)
  assert(scene.models.length === 0, '越界删除动了列表')

  // 空场景再追加一个：新模型的 id 必须是现生成的，而不是空串
  scene.addModel()
  assert(scene.models.length === 1, '空场景下追加失败')
  assert(scene.models[0].id !== '', '追加出来的模型 id 是空的')
  assert(UUID_V4.test(scene.models[0].id), `追加出来的模型 id 不是 v4 uuid：${scene.models[0].id}`)
  return '顺序不变、选中项自动收回界内、空场景仍可追加'
})

check('setModel 只影响选中项，不碰其他模型', () => {
  const scene = useSceneStore()
  scene.resetConfig()
  scene.addModel('/first.glb')
  scene.addModel('/other.glb')

  scene.selectModel(0)
  scene.setModel('/selected.glb')

  assert(scene.models[0].url === '/selected.glb', '选中项没被换掉')
  assert(scene.models[1].url === '/other.glb', '换了选中项，别的模型的地址跟着变了')
  return '单模型时代的入口在多模型下语义收窄为「改当前选中的那个」'
})

// ---------- 6. 分组 prop → 配置的桥接 ----------

/**
 * 分组 prop 的 watcher 是立即执行的，所以 SSR 一次就足以验证桥接。
 *
 * 这里守的是一个很容易写错的顺序问题：分组的 sun watcher 必须先于
 * 兼容用的扁平 environment watcher 注册，否则外层整包传进来的 sun
 * 会把环境贴图又覆盖回空字符串。
 */
let bridgeStore = null

/**
 * 宿主传进来的那个数组，故意留在外面。
 * 桥接层必须拷一份再写进配置，否则宿主就地改一下就会静默改动场景，
 * changedGroups 的比对也跟着不可靠。
 */
const hostPosition = [1, 2, 3]

/**
 * 同理，事件绑定也是宿主可能直接传进来的一个嵌套对象。
 *
 * 它比数组更危险：`applyPatch` 遇到目标里没有的键时会**直接把宿主的对象装进去**
 * （别名而不是拷贝），而宿主那个对象不是 reactive——就地改它不会触发深度 watch，
 * changedGroups 也只能等到下一次别的改动顺带比对时才发现。表现就是
 * 「配置被悄悄改了，历史栈里查无此事」。
 */
const hostEvents = { click: { enabled: true, code: 'console.log(1)' } }

/**
 * 户型图的墙，同样是宿主自己的数组——而且**类型上更危险**。
 *
 * `applyPatch` 的 `isPlainObject` 显式排除数组，所以任何数组都是
 * `target[key] = value` 整体装入。而墙比位置三元组深两层：
 * 数组里是对象，对象里还有 `start` / `end` 两个数组。
 * **只拷顶层那一层是不够的**——宿主改一下某个端点坐标照样能静默改掉场景。
 *
 * 刻意用**普通数组**而不是 reactive：宿主真正会遇到的那种「就地改一下」
 * 往往连深度 watch 都不触发（见上面 hostEvents 那段），
 * 所以这条通道只能靠桥接层自己拷贝来断，不能指望响应式系统兜住。
 */
const hostWalls = [
  { id: 'w1', start: [0, 0], end: [4, 0], height: 2.8, thickness: 0.18 },
  { id: 'w2', start: [4, 0], end: [4, 3], height: 2.8, thickness: 0.18 },
]

const BridgePage = defineComponent({
  setup() {
    bridgeStore = useSceneStore()
    return () =>
      h(SceneViewer, {
        height: '200px',
        // 物体级只走 model 分组这条路：再给一对扁平的 cast-shadow prop
        // 无法判断说的是全局总闸还是物体级，会和 shadow.castShadow 打架
        model: { name: '桥接模型', position: hostPosition, wireframe: true, events: hostEvents },
        wireframe: false,
        camera: { fov: 33 },
        sun: { showSky: true, elevation: 12 },
        shadow: { enabled: true, type: 'accumulative' },
        ground: { visible: false, cellSize: 1.5 },
        floorplan: { foundation: { x: 1, z: 2, width: 6, depth: 4 }, walls: hostWalls },
        environment: 'city',
      })
  },
})

const bridgeApp = createSSRApp(BridgePage)
bridgeApp.use(createPinia())
bridgeApp.use(createThreeDMaker())

try {
  await renderToString(bridgeApp)
} catch (error) {
  results.push({ ok: false, name: '渲染分组 prop', detail: error.message })
}

check('分组 prop 写入对应配置分支', () => {
  assert(bridgeStore, '组件未挂载')
  const config = bridgeStore.config

  assert(config.camera.fov === 33, `camera.fov 是 ${config.camera.fov}`)
  assert(config.sun.showSky === true, 'sun.showSky 未写入')
  assert(config.sun.elevation === 12, `sun.elevation 是 ${config.sun.elevation}`)
  assert(config.ground.visible === false, 'ground.visible 未写入')
  assert(config.ground.cellSize === 1.5, `ground.cellSize 是 ${config.ground.cellSize}`)
  assert(config.shadow.enabled === true, 'shadow.enabled 未写入')
  assert(config.shadow.type === 'accumulative', `shadow.type 是 ${config.shadow.type}`)
  assert(config.floorplan.foundation.width === 6, `floorplan.foundation.width 是 ${config.floorplan.foundation.width}`)
  assert(config.floorplan.foundation.z === 2, `floorplan.foundation.z 是 ${config.floorplan.foundation.z}`)
  assert(config.floorplan.walls.length === 2, `floorplan.walls 有 ${config.floorplan.walls.length} 面`)
  return '5 个分组各自的字段都落到位'
})

check('分组 prop 不会清掉同分组的其他字段', () => {
  const config = bridgeStore.config
  assert(config.camera.near === 0.1, `未提及的 camera.near 被改动：${config.camera.near}`)
  assert(config.sun.turbidity === 3.4, `未提及的 sun.turbidity 被改动：${config.sun.turbidity}`)
  return '深合并在 prop 桥接这一层同样生效'
})

check('扁平的 environment prop 与分组 sun 共存', () => {
  // 分组的 sun watcher 先注册且没有 environment 字段，兼容 watcher 再补上，
  // 顺序颠倒的话这里会拿到空字符串
  assert(
    bridgeStore.config.sun.environment === 'city',
    `sun.environment 是 "${bridgeStore.config.sun.environment}"`,
  )
  return '兼容 prop 未被分组 prop 覆盖'
})

check('model 对象形态写入物体级字段', () => {
  const config = bridgeStore.config

  assert(config.models[0].name === '桥接模型', `model.name 是 "${config.models[0].name}"`)
  assert(
    JSON.stringify(config.models[0].position) === '[1,2,3]',
    `model.position 是 ${JSON.stringify(config.models[0].position)}`,
  )
  // 同分组里没提到的字段一个都不能被清掉
  assert(config.models[0].draco === false, `未提及的 model.draco 被改动：${config.models[0].draco}`)
  assert(config.models[0].visible === true, `未提及的 model.visible 被改动：${config.models[0].visible}`)
  assert(config.models[0].receiveShadow === true, '未提及的 model.receiveShadow 被改动')
  return '对象形态落到 config.model，且深合并不清空同组字段'
})

check('model 分组胜过渡平的 wireframe', () => {
  /**
   * 两个 watcher 都是 immediate，会按注册顺序同步跑完，
   * 所以「分组更具体应当胜出」不能靠注册顺序实现，
   * 得让扁平那个自己检查 model 里有没有写这个字段。
   */
  assert(
    bridgeStore.config.models[0].wireframe === true,
    `model.wireframe 是 ${bridgeStore.config.models[0].wireframe}，被扁平的 :wireframe="false" 覆盖了`,
  )
  return '分组写法优先，与 environment / sun.environment 同一规则'
})

check('桥接层不把宿主的数组别名进配置', () => {
  // 宿主就地改自己的数组，配置不该跟着动
  hostPosition[0] = 99
  assert(
    bridgeStore.config.models[0].position[0] === 1,
    `宿主数组被别名进了配置：${JSON.stringify(bridgeStore.config.models[0].position)}`,
  )
  return '写入前拷贝，宿主数组与 config 相互独立'
})

check('桥接层不把宿主的事件对象别名进配置', () => {
  const config = bridgeStore.config

  assert(config.models[0].events.click.enabled === true, 'events 没有写进配置')
  assert(config.models[0].events.click.code === 'console.log(1)', 'events 的代码没有写进配置')
  // 只给了 click 一项，其余 4 类必须是默认值——补丁是逐项写的，不是整体替换
  assert(config.models[0].events.dblclick.enabled === false, '未提及的 dblclick 被改了')

  // 宿主就地改自己的对象，配置不该跟着动（这一条才是本用例的重点）
  hostEvents.click.code = 'console.log(2)'
  hostEvents.click.enabled = false
  assert(
    config.models[0].events.click.code === 'console.log(1)',
    `宿主对象被别名进了配置：code 变成了 "${config.models[0].events.click.code}"`,
  )
  assert(config.models[0].events.click.enabled === true, '宿主对象被别名进了配置：enabled 被改')
  return '嵌套对象逐类型浅拷，宿主与 config 相互独立'
})

// 字符串形态是模型 prop 的老写法，必须继续可用
let stringStore = null

const StringModelPage = defineComponent({
  setup() {
    stringStore = useSceneStore()
    return () => h(SceneViewer, { height: '200px', model: '/demo.glb' })
  },
})

const stringApp = createSSRApp(StringModelPage)
stringApp.use(createPinia())
stringApp.use(createThreeDMaker())

try {
  await renderToString(stringApp)
} catch (error) {
  results.push({ ok: false, name: '渲染字符串 model prop', detail: error.message })
}

/**
 * 户型图的桥接与另外四组有一条实质区别，单独守着。
 *
 * 那四组的补丁全是标量，`applyPatch` 按值装进去就完了；户型图的
 * `walls` / `openings` / `rooms` 是数组，会被**按引用**装进配置。
 * 所以 `SceneViewer` 那个分组桥必须自己过一遍 `cloneFloorplanPatch`
 * ——而 `applyConfig` 自己不克隆（只有 `patchModel` 走 `cloneModelPatch`），
 * 漏了不会有任何报错，只会在宿主某天改了自己那个数组时诡异地生效。
 *
 * 三层都要比：顶层数组、数组里的墙对象、墙对象里的 `start` 端点数组。
 * 只拷顶层的实现能骗过前两条，第三条会露馅。
 */
check('桥接层不把宿主的平面图数组别名进配置', () => {
  const walls = bridgeStore.config.floorplan.walls

  assert(walls !== hostWalls, '顶层 walls 数组被别名了')
  assert(toRaw(walls[0]) !== hostWalls[0], '墙对象被别名了')
  assert(toRaw(walls[0].start) !== hostWalls[0].start, '端点数组被别名了（只拷了一层？）')

  /*
   * 行为上的判据：就地改宿主那一份，配置必须一动不动。
   * 上面三条比的是引用，这一条比的是最终效果——只改端点坐标、
   * 或者只往数组里塞一面新墙，都是宿主真正会做的事。
   */
  const before = JSON.stringify(bridgeStore.config.floorplan)
  hostWalls[0].start[0] = 99
  hostWalls[0].height = 5
  hostWalls.push({ id: 'w3', start: [4, 3], end: [0, 3], height: 2.8, thickness: 0.18 })

  assert(
    JSON.stringify(bridgeStore.config.floorplan) === before,
    '宿主就地改自己的数组，配置跟着变了',
  )

  return '逐层拷贝：顶层数组 / 墙对象 / 端点数组都与宿主断开'
})

check('model 字符串形态仍走 setModel', () => {  assert(stringStore, '组件未挂载')
  assert(stringStore.config.models[0].url === '/demo.glb', `url 是 "${stringStore.config.models[0].url}"`)
  // setModel 的价值就是顺带复位加载状态，这条守的是它没被降级成直接写字段
  assert(stringStore.loading === true, 'setModel 未进入加载态')
  return '扁平字符串与对象形态共用同一个 prop，互不干扰'
})

// ---------- 平面图的几何引擎 ----------

/**
 * 这一节跑的是 `dist/index.js` 里那组**纯函数**：不碰 three、不碰 DOM，
 * 所以能在 Node 里直接跑，也正因如此它是本次改动里唯一被自动化覆盖的部分
 * ——「切墙开洞」「洪水找房间」这些算法在浏览器里出错的形态是
 * 「房子看起来怪怪的」，那种要靠肉眼，而计算本身错到出黑面、负长度、
 * 或者把两个房间串成一个，都能在这里拦下。
 */

const mkWall = (id, start, end, extra = {}) => ({
  id,
  start,
  end,
  height: DEFAULT_WALL_HEIGHT,
  thickness: DEFAULT_WALL_THICKNESS,
  ...extra,
})

/** 一个门洞。0.9 × 2.1 与 `DOOR_WIDTH` / `DOOR_HEIGHT` 一致，落地那一档（`sillHeight` 0） */
const mkDoor = (id, hostWallId, offset, extra = {}) => ({
  id,
  kind: 'door',
  hostWallId,
  offset,
  width: 0.9,
  height: 2.1,
  sillHeight: 0,
  ...extra,
})

/**
 * 一个窗洞。与 `mkDoor` 只差三处，正是「门与窗的差别」在数据上的全部：
 * `kind`、不落地（`sillHeight` 是 `WINDOW_SILL` 0.9）、以及默认档的 1.2 × 1.2
 * （`WINDOW_WIDTH` / `WINDOW_HEIGHT`）。
 *
 * 窗洞的替身碎片是 **`glass`** 而不是 `leaf`——`wallPieces` 按 kind 吐不同的片，
 * 所以下面取碎片时找的是 `role === 'glass'`。
 */
const mkWindow = (id, hostWallId, offset, extra = {}) => ({
  id,
  kind: 'window',
  hostWallId,
  offset,
  width: 1.2,
  height: 1.2,
  sillHeight: 0.9,
  ...extra,
})

/** 把一串拐点连成一圈闭合的墙 */
const mkRing = (points, prefix = 'r') =>
  points.map((point, index) => mkWall(`${prefix}${index}`, point, points[(index + 1) % points.length]))

check('wallLength / pointAlongWall / wallRotationY 是同一套坐标口径', () => {
  assert(wallLength(mkWall('w', [0, 0], [3, 4])) === 5, '勾三股四弦五没算对')
  assert(
    Math.abs(wallRotationY(mkWall('w', [0, 0], [0, 1])) + Math.PI / 2) < 1e-12,
    '沿 +z 的墙应当是 -PI/2',
  )

  const along = mkWall('w', [1, 1], [5, 1])
  const mid = pointAlongWall(along, 2)
  assert(mid[0] === 3 && mid[1] === 1, `沿墙 2 米处应当是 [3,1]，实际 ${JSON.stringify(mid)}`)

  // 零长墙不能算出 NaN——配置是从 JSON 来的，两个端点重合是可能的
  const degenerate = pointAlongWall(mkWall('w', [2, 2], [2, 2]), 1)
  assert(degenerate[0] === 2 && degenerate[1] === 2, '零长墙算出了 NaN')
  return `单位口径一致，${CELL_SIZE} 米一格`
})

check('没有洞口的墙就是一整段', () => {
  const pieces = wallPieces(mkWall('w', [0, 0], [10, 0]), [])
  assert(pieces.length === 1, `应当只有 1 段，实际 ${pieces.length} 段`)
  assert(pieces[0].role === 'wall', `role 是 ${pieces[0].role}`)
  const size = pieces[0].size
  assert(
    size[0] === 10 && size[1] === DEFAULT_WALL_HEIGHT && size[2] === DEFAULT_WALL_THICKNESS,
    `尺寸是 ${JSON.stringify(size)}`,
  )
  return '一整段实心墙'
})

check('门是在墙上真的开了洞，不是贴一片门扇', () => {
  const pieces = wallPieces(mkWall('w', [0, 0], [10, 0]), [mkDoor('d', 'w', 5)])
  const roles = pieces.map((piece) => piece.role)

  /*
    门洞两侧各一段实心墙 + 门洞上方一道过梁 = 3 段 wall；
    4 条门套 + 1 扇门扇。**门下不能有墙**——`sillHeight` 为 0 时下段高度为 0、
    自动消失，这正是「门与窗共用一套切法」的落点。
  */
  assert(roles.filter((role) => role === 'wall').length === 3, `墙段数是 ${roles.filter((r) => r === 'wall').length}`)
  assert(roles.filter((role) => role === 'leaf').length === 1, '门扇不是 1 个')
  assert(roles.filter((role) => role === 'frame').length === 4, '门套不是 4 条')

  const lintel = pieces.find((piece) => piece.key.endsWith('-above'))
  assert(lintel, '没有过梁')
  assert(lintel.size[1] === DEFAULT_WALL_HEIGHT - 2.1, `过梁高是 ${lintel.size[1]}`)
  assert(!pieces.some((piece) => piece.key.endsWith('-below')), '门下不该有矮墙')

  for (const piece of pieces) {
    assert(piece.size.every((value) => value > 0), `${piece.key} 有非正的尺寸 ${JSON.stringify(piece.size)}`)
  }
  return '切出 3 段墙 + 过梁 + 门套 + 门扇，门下没有墙'
})

check('窗有窗台下的矮墙、玻璃与中竖梃', () => {
  const pieces = wallPieces(mkWall('w', [0, 0], [10, 0]), [
    { id: 'v', kind: 'window', hostWallId: 'w', offset: 5, width: 1.2, height: 1.2, sillHeight: 0.9 },
  ])
  const roles = pieces.map((piece) => piece.role)
  assert(roles.filter((role) => role === 'wall').length === 4, '应当是前后两段 + 窗下 + 窗上')
  assert(roles.filter((role) => role === 'glass').length === 1, '玻璃不是 1 块')
  assert(roles.filter((role) => role === 'frame').length === 5, '应当是 4 条框 + 1 根中竖梃')

  const below = pieces.find((piece) => piece.key.endsWith('-below'))
  assert(below && below.size[1] === 0.9, `窗台下的矮墙高应当是 0.9，实际 ${below?.size[1]}`)
  return '窗下 / 窗上两段墙 + 框 + 玻璃'
})

check('洞口比墙高时少一段墙，而不是算出一段负高度', () => {
  const pieces = wallPieces(mkWall('w', [0, 0], [10, 0]), [
    { id: 'v', kind: 'window', hostWallId: 'w', offset: 5, width: 1.2, height: 3, sillHeight: 2 },
  ])
  assert(!pieces.some((piece) => piece.key.endsWith('-above')), '过梁上沿超过墙高，不该有过梁')
  for (const piece of pieces) {
    assert(piece.size[0] > 0 && piece.size[1] > 0, `${piece.key} 尺寸非正`)
  }
  return '夹取到位，没有负长度的盒子（负长度的 BoxGeometry 会变成法线翻转的黑面）'
})

check('重叠洞口被裁掉，探出墙端的洞口被夹回来', () => {
  const overlapping = wallPieces(mkWall('w', [0, 0], [10, 0]), [
    mkDoor('a', 'w', 2),
    mkDoor('b', 'w', 2.2),
  ])
  for (const piece of overlapping) {
    assert(piece.size[0] > 0, `${piece.key} 沿墙长度非正`)
  }

  // 一扇 3 米宽的门装在 1 米长的墙上：两个 0.1 的边距都放不下，必须夹回来
  const oversize = wallPieces(mkWall('w', [0, 0], [1, 0]), [mkDoor('d', 'w', 0.5, { width: 3 })])
  for (const piece of oversize) {
    assert(piece.size[0] > 0 && piece.size[1] > 0, `${piece.key} 尺寸非正`)
  }
  return '配置从别处导入（手写 JSON）时也不会切出负长度'
})

check('只有挂在它自己身上的洞口才被切出来', () => {
  /*
    回归：`placeOpenings` 只看 `offset`、不认识宿主，所以「按 hostWallId 滤」
    必须发生在 `wallPieces` 的入口。漏掉的表现是**每一个门窗都被装到每一面墙上**
    ——门窗数量翻好几倍，而且一声不响。
  */
  const w1 = mkWall('w1', [0, 0], [10, 0])
  const w2 = mkWall('w2', [0, 5], [10, 5])
  const doorOnW1 = mkDoor('d1', 'w1', 3)

  assert(
    wallPieces(w2, [doorOnW1]).length === 1,
    `另一面墙不该被装上 d1，实际切出 ${wallPieces(w2, [doorOnW1]).length} 段`,
  )
  assert(
    wallPieces(w1, [doorOnW1]).length === wallPieces(w1, [doorOnW1, mkDoor('d2', 'w2', 3)]).length,
    '别的墙上的洞口混进来改变了切法',
  )
  return '按 hostWallId 过滤，滤在 wallPieces 入口'
})

check('findNearestWall 给出沿墙米数', () => {
  const hit = findNearestWall([mkWall('w', [0, 0], [10, 0])], [3, 0.2], 0.6)
  assert(hit && hit.wall.id === 'w', '没命中')
  assert(Math.abs(hit.offset - 3) < 1e-9, `沿墙米数是 ${hit.offset}`)
  assert(Math.abs(hit.distance - 0.2) < 1e-9, `距离是 ${hit.distance}`)
  assert(findNearestWall([mkWall('w', [0, 0], [10, 0])], [3, 5], 0.6) === null, '超出阈值应当返回 null')
  return '门窗落点与删墙的命中都靠它'
})

check('洪水找房间：方 / L / U 形都对，凹形不会追歪', () => {
  const square = mkRing([[0, 0], [4, 0], [4, 4], [0, 4]], 's')
  const found = findEnclosedArea(square, [2, 2])
  assert(found.ok, `方房间没找出来：${JSON.stringify(found)}`)
  assert(found.polygon.length === 4, `共线点该被折掉，实际 ${found.polygon.length} 个点`)

  const ell = mkRing([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]], 'l')
  const foundL = findEnclosedArea(ell, [1, 1])
  assert(foundL.ok && foundL.polygon.length === 6, `L 形应当是 6 个角，实际 ${JSON.stringify(foundL)}`)

  /*
    U 形（开口朝上，两条臂各 1 米宽）是最考验串环的形状：
    参考项目那版把起点写死成 `outlineEdges[0]`，凹多边形上会从那一条开始追出
    一个残缺的环或中途放弃。**起手点必须落在臂里**——落在凹槽里是区域外，
    泛洪会正确地越界逃逸（那是 `outrun`，不是 bug）。
  */
  const you = mkRing([[0, 0], [6, 0], [6, 5], [5, 5], [5, 1], [1, 1], [1, 5], [0, 5]], 'u')
  const foundU = findEnclosedArea(you, [0.5, 3])
  assert(foundU.ok, `U 形没找出来：${JSON.stringify(foundU)}`)
  assert(foundU.polygon.length === 8, `U 形应当是 8 个角，实际 ${foundU.polygon.length}`)
  return '方 4 / L 6 / U 8 个角，共线点已折掉'
})

check('没围起来就老实说没围起来，不硬给一个错的多边形', () => {
  const square = mkRing([[0, 0], [4, 0], [4, 4], [0, 4]], 's')

  const outside = findEnclosedArea(square, [10, 10])
  assert(!outside.ok && outside.reason === 'outrun', `点在外面应当是 outrun：${JSON.stringify(outside)}`)

  // 少一面墙 = 漏的，泛洪会跑出去
  const open = findEnclosedArea(square.slice(0, 3), [2, 2])
  assert(!open.ok && open.reason === 'outrun', `缺一面墙应当是 outrun：${JSON.stringify(open)}`)

  /*
    墙体不在 1 米整数格上（手写 JSON、别处生成的斜墙）时必须**诚实拒绝**：
    这套泛洪的前提就是整数格正交。默默算出一个错的环，后果是配置里多一块
    永远删不掉的垃圾色块。
  */
  const slanted = findEnclosedArea([mkWall('a', [0, 0], [4, 4])], [1, 1])
  assert(!slanted.ok && slanted.reason === 'not-on-grid', `斜墙应当是 not-on-grid：${JSON.stringify(slanted)}`)

  const shifted = findEnclosedArea([mkWall('a', [0.5, 0], [4, 0])], [1, 1])
  assert(!shifted.ok && shifted.reason === 'not-on-grid', `半米偏移应当是 not-on-grid：${JSON.stringify(shifted)}`)
  return '三种拒绝路径各自给得出理由'
})

check('带孔的区域被拒绝，而不是只返回其中一条环', () => {
  /*
    3x3 的环带 + 中间一个 1x1 的洞 = **两条**边界环。逐顶点度数校验拦不住它
    （每条环自己都是度数为 2 的简单环），靠的是「走完一个环后的长度
    不等于顶点总数」那一条守卫。

    拒绝而不是硬给一个多边形：ShapeGeometry 在带孔的自接触多边形上会
    三角化出垃圾面片，那是**看得见的错**，比「这个区域形状不支持」更糟。
    （代价是「房间当中有个柱子」这种平面图标记不出来，属于本阶段的取舍。）
  */
  const band = [
    ...mkRing([[0, 0], [3, 0], [3, 3], [0, 3]], 'o'),
    ...mkRing([[1, 1], [1, 2], [2, 2], [2, 1]], 'i'),
  ]
  const found = findEnclosedArea(band, [0.5, 0.5])
  assert(!found.ok && found.reason === 'complex', `带孔区域应当是 complex：${JSON.stringify(found)}`)
  return 'holes → complex，绝不产出自接触多边形'
})

check('相邻两格共一面墙时各是各的房间', () => {
  const both = [
    ...mkRing([[0, 0], [2, 0], [2, 4], [0, 4]], 'a'),
    ...mkRing([[2, 0], [4, 0], [4, 4], [2, 4]], 'b'),
  ]
  const left = findEnclosedArea(both, [1, 2])
  const right = findEnclosedArea(both, [3, 2])

  assert(left.ok && right.ok, `两个房间都该找得出来：${JSON.stringify([left, right])}`)
  assert(JSON.stringify(left.polygon) !== JSON.stringify(right.polygon), '两个房间的多边形不该一样')
  for (const [x] of left.polygon) assert(x <= 2, `左房不该越过共墙，出现 x=${x}`)
  for (const [x] of right.polygon) assert(x >= 2, `右房不该越过共墙，出现 x=${x}`)
  return '共墙把泛洪挡住了，两个房间互不串味'
})

check('pointInPolygon 与 polygonCenter', () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4]]
  assert(pointInPolygon([2, 2], square), '中心点应当判为内部')
  assert(!pointInPolygon([5, 2], square), '外部点被判成了内部')
  assert(!pointInPolygon([2, -1], square), '外部点被判成了内部')

  const center = polygonCenter(square)
  assert(pointInPolygon(center, square), '方形的形心跑到外面了')

  /*
    L 形的形心必须落在**房间里**。用包围盒中心的话会落在缺掉的那个角上
    （[3,3] 附近，是房间外面），房间名就飘到墙外去了。
  */
  const ell = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]
  const ellCenter = polygonCenter(ell)
  assert(pointInPolygon(ellCenter, ell), `L 形的形心跑到房间外面了：${JSON.stringify(ellCenter)}`)

  // 面积为 0 时退回顶点平均，而不是 0/0 变成 NaN
  const flat = polygonCenter([[0, 0], [1, 0], [2, 0]])
  assert(Number.isFinite(flat[0]) && Number.isFinite(flat[1]), '退化多边形的形心算出了 NaN')
  return '点在多边形内 / 形心落在房间内'
})

check('删墙连带删掉挂在上面的门窗', () => {
  const walls = [mkWall('w1', [0, 0], [4, 0]), mkWall('w2', [4, 0], [4, 4])]
  const openings = [
    mkDoor('d', 'w1', 2),
    { id: 'v', kind: 'window', hostWallId: 'w2', offset: 2, width: 1.2, height: 1.2, sillHeight: 0.9 },
  ]
  const left = removeWall(walls, openings, 'w1')

  assert(left.walls.length === 1 && left.walls[0].id === 'w2', '墙没删对')
  assert(left.openings.length === 1 && left.openings[0].id === 'v', '挂在被删墙上的门窗没跟着删')

  /*
    引用是 `hostWallId` 而不是数组下标，所以这里**没有**「删墙之后重映射下标」
    这回事——参考项目用下标当引用，删一面墙要逐个改后面的所有下标。这一条守的
    就是这个差别：剩下的门窗指向的仍然是它原来那面墙。
  */
  assert(left.openings[0].hostWallId === 'w2', '剩下的门窗指错了墙')
  return '级联删除，且引用不因删墙而漂移'
})

check('createFloorplanConfig 每次给的都是新对象', () => {
  const first = createFloorplanConfig()
  const second = createFloorplanConfig()

  assert(first.foundation === null, '默认地基不是 null')
  for (const key of ['walls', 'openings', 'rooms']) {
    assert(first[key] !== second[key], `floorplan.${key} 被两次调用共享了`)
  }

  /*
    与 `createModelConfig` 同一条理由：默认值会被反复取用，而 `applyPatch`
    在目标缺键时是 `target[key] = value`——共享同一个数组的话，
    改一份默认值会连带改掉所有引用它的地方。
  */
  first.walls.push(mkWall('w', [0, 0], [1, 0]))
  assert(second.walls.length === 0, '改一份默认值污染了另一份')
  return '三层数组两两独立'
})

// ---------- 平面图墙面的外观字段 ----------

/**
 * 墙的外观是这一轮新加的字段，而它**没有任何一层负责校验**——
 * `FloorplanWall` 是可选的、`wallPieces()` 完全不认识它、渲染端也只是读它。
 * 所以这里守两件事：它不能被深拷贝丢掉，也不能在「没有外观」的墙上凭空出现。
 */
check('墙的 url 跟着深拷贝与 JSON 往返一起走', () => {
  const url = 'https://example.com/3d-assets/wall/wall1/wall1.glb'
  const patched = cloneFloorplanPatch({ walls: [{ ...mkWall('w', [0, 0], [4, 0]), url }] })

  assert(patched.walls[0].url === url, `深拷贝把 url 弄丢了：${JSON.stringify(patched.walls[0])}`)
  assert('url' in patched.walls[0], 'url 这个键整个不见了')

  /*
    反向的一条同样重要：**没写外观的墙上不该出现这个键**。
    `url: undefined` 与「没有 url」在内存里是两种状态（前者 `'url' in wall` 为真），
    而 JSON 往返会让 `undefined` 那一侧的键消失——于是同一个「没有外观」的墙
    在存盘前后形状不同。写入方因此必须条件展开，这条断言就是替它守门的。
  */
  const plain = cloneFloorplanPatch({ walls: [mkWall('p', [0, 0], [1, 0])] })
  assert(!('url' in plain.walls[0]), '没写外观的墙凭空多出了一个 url 键')

  const round = JSON.parse(JSON.stringify(patched))
  assert(round.walls[0].url === url, 'JSON 往返把 url 弄丢了')

  /*
    顺带守住 `utils/config.ts` 里 `cloneFloorplanPatch` 对墙那一层的写法不被
    改写成逐字段枚举——那种写法今天对，加字段的那天会静默地少拷一个键。
  */
  return 'url 进得去、出得来，没写的时候不出现'
})

// ---------- 视角档位的推导 ----------

/**
 * `viewModeOf` 是这一轮**唯一能自动验证的那条新规则**（墙的平面图外观只是它的
 * 一个消费者，而那部分要真资产 + 浏览器才看得见）。它同时也是「档位」这条约定
 * 的唯一实现——两个调用点（编辑器的 2D/3D 按钮与 `SceneContent` 的 `planView`）
 * 都吃它的结果，所以它错了会同时错两处，而且是往两个不同方向错。
 *
 * 只喂 `position` / `target` 两个字段：这条规则从头到尾只读这两个，
 * 把别的字段补齐只会让「它其实依赖了什么」变得看不清。
 */
check('2D 档是从机位推出来的，边界与退化情形都对', () => {
  const at = (position, target) => viewModeOf({ position, target })
  const ORIGIN = [0, 0, 0]

  // 默认那份机位是斜的，必须是 3D——否则一进来墙就换成实色
  assert(
    at([...DEFAULT_SCENE_CONFIG.camera.position], [...DEFAULT_SCENE_CONFIG.camera.target]) === '3d',
    '默认机位被判成了 2D',
  )

  // 正上方、往正下方看：这一档的定义
  assert(at([0, 110, 0], ORIGIN) === '2d', '原点正上方 110 米没被判成 2D')

  /*
    容差的两侧各测一点。5° 是**容差本身的宽度**（`TOP_TOLERANCE` 那个角），
    这里不 import 它、而是自己按角度造机位：写死一个数就变成了「测试复述实现」，
    而按角度造能把「4.9° 算 2D、5.1° 算 3D」这句话原样验一遍。
    半径取 100，是为了让三个分量都是两位数、看着像真实机位。
  */
  const tilted = (degrees) => {
    const rad = (degrees * Math.PI) / 180
    return at([100 * Math.sin(rad), 100 * Math.cos(rad), 0], ORIGIN)
  }
  assert(tilted(4.9) === '2d', '偏 4.9° 应该还在 2D 里')
  assert(tilted(5.1) === '3d', '偏 5.1° 应该已经掉出 2D')

  /*
    退化与仰视。前两条是**真的会在面板里被手填出来**的：
    把注视点填成与机位同一组数，或在俯视下把 y 改小——除以 0 会得到 NaN，
    而 `NaN < 容差` 是 false，碰巧也落回 3D；这里断言的是「有意」而不是「碰巧」。
  */
  assert(at([0, 0, 0], ORIGIN) === '3d', '机位与注视点重合时应当算 3D')
  assert(at([0, -50, 0], ORIGIN) === '3d', '从下方往上看是仰视，不是 2D')
  assert(at([0, 50, 0], [0, 100, 0]) === '3d', '机位在注视点下方，不是 2D')

  // 正俯视但平移过：仍然算 2D——俯视这一档本来就允许右键平移
  assert(at([30, 80, -12], [30, 0, -12]) === '2d', '平移过的俯视被判成了 3D')

  return '容差两侧、仰视、重合、平移过的俯视都对'
})

// ---------- 墙面铺装的算术 ----------

/**
 * 一块资产的包围盒。默认是**规范的墙资产**：1 米长 × 2.8 米高 × 0.18 米厚
 * （不就是 `CELL_SIZE` / `DEFAULT_WALL_HEIGHT` / `DEFAULT_WALL_THICKNESS`），
 * 也就是资产制作要求里写死的那三个数。
 */
function mkBounds(min = [0, 0, 0], max = [1, DEFAULT_WALL_HEIGHT, DEFAULT_WALL_THICKNESS]) {
  return { min, max }
}

/** 一块砖在某个轴上实际占的那一段（从它自己的包围盒推出来，不看 scale 想当然） */
function spanOf(tile, axis, bounds) {
  return [
    tile.offset[axis] + bounds.min[axis] * tile.scale[axis],
    tile.offset[axis] + bounds.max[axis] * tile.scale[axis],
  ]
}

/** 沿 x 轴（墙长方向）的一条墙，切成一段 */
function mkSegment(length) {
  return wallPieces(mkWall('w', [0, 0], [length, 0]), [])[0]
}

check('沿墙平铺：铺满、不重叠、不留缝', () => {
  const bounds = mkBounds()
  const segment = mkSegment(4)
  const tiles = wallFaceTiles(segment, bounds)

  assert(tiles.length === 4, `4 米段配 1 米资产应当 4 块，实际 ${tiles.length}`)

  /*
    逐块比边界，而不是比「块数对不对」。这条断言把三件事一次盖住：
    首块的左边缘落在段头上、末块的右边缘落在段尾上、相邻两块严丝合缝。
    任何一处「少减了半个身位」或者「余数没摊进去」都会在这里露馅——
    而这三种错在屏幕上看着都只是「砖缝有点歪」，很难靠眼睛发现。
  */
  const half = 4 / 2
  for (let i = 0; i < tiles.length; i++) {
    const [from, to] = spanOf(tiles[i], 0, bounds)
    if (i === 0) assert(Math.abs(from + half) < 1e-12, `首块从左边缘 ${from} 开始，应当是 ${-half}`)
    if (i === tiles.length - 1) {
      assert(Math.abs(to - half) < 1e-12, `末块到右边缘 ${to} 结束，应当是 ${half}`)
    }
    if (i > 0) {
      const [, prevTo] = spanOf(tiles[i - 1], 0, bounds)
      assert(Math.abs(from - prevTo) < 1e-12, `第 ${i} 块与第 ${i - 1} 块之间差了 ${from - prevTo} 米`)
    }
    // 每一块的尺寸都等于摊平后的砖长（不是资产的原生长度）
    const width = to - from
    assert(Math.abs(width - 1) < 1e-12, `第 ${i} 块宽 ${width}，应当是 1`)
  }

  // 高度与厚度是**拉伸**而不是重复：底面对齐段底、厚度居中
  const [bottom, top] = spanOf(tiles[0], 1, bounds)
  assert(Math.abs(bottom + DEFAULT_WALL_HEIGHT / 2) < 1e-12, `砖底在 ${bottom}，应当贴段底`)
  assert(Math.abs(top - DEFAULT_WALL_HEIGHT / 2) < 1e-12, `砖顶在 ${top}，应当贴段顶`)
  const [back, front] = spanOf(tiles[0], 2, bounds)
  assert(
    Math.abs(back + DEFAULT_WALL_THICKNESS / 2) < 1e-12 &&
      Math.abs(front - DEFAULT_WALL_THICKNESS / 2) < 1e-12,
    `砖厚跨 [${back}, ${front}]，应当与墙厚对齐`,
  )
  return '4 米段 → 4 块，首尾与段对齐、块间无缝、高厚各自拉伸到位'
})

check('资产的原点不在包围盒中心时也摆得准', () => {
  /*
    绝大多数 glb 的原点都贴着模型自己的某个角或底面，而不是包围盒中心。
    包围盒是**相对那个原点**量出来的，所以校正量里必须把中心减掉
    （`layFloorModel` 那条链已经踩过一次同一个坑）。
    这条断言用的资产整体偏在 x=2.5 / y=1.8 那一带，漏掉这一步的话
    整段砖会平移出去 2.5 米——而屏幕上只是「砖没铺在墙上」，不报错。
  */
  const bounds = mkBounds([2, 0.4, -0.09], [3, 0.4 + DEFAULT_WALL_HEIGHT, 0.09])
  const tiles = wallFaceTiles(mkSegment(3), bounds)

  assert(tiles.length === 3, `3 米段应当是 3 块，实际 ${tiles.length}`)

  const [from, to] = spanOf(tiles[0], 0, bounds)
  assert(Math.abs(from + 1.5) < 1e-12, `首块从左边缘 ${from} 开始，应当是 -1.5`)
  assert(Math.abs(to + 0.5) < 1e-12, `首块从右边缘 ${to} 结束，应当是 -0.5`)

  const [bottom, top] = spanOf(tiles[0], 1, bounds)
  assert(
    Math.abs(bottom + DEFAULT_WALL_HEIGHT / 2) < 1e-12 && Math.abs(top - DEFAULT_WALL_HEIGHT / 2) < 1e-12,
    `砖的竖直范围是 [${bottom}, ${top}]，应当贴住段`,
  )

  const [back, front] = spanOf(tiles[0], 2, bounds)
  assert(
    Math.abs((back + front) / 2) < 1e-12,
    `砖厚中心在 ${(back + front) / 2}，应当落在墙中心线上`,
  )
  return '偏心的原点被减掉了，砖仍落在段上'
})

check('段长不是整数米时匀着摊，块数永远至少 1', () => {
  // 洞口切出来的段（1.2 / 2.4 米）是最常见的非整米段
  const bounds = mkBounds()
  const two = wallFaceTiles(mkSegment(2.4), bounds)
  assert(two.length === 2, `2.4 米段应当 2 块（每块 1.2），实际 ${two.length}`)
  const width = spanOf(two[0], 0, bounds)
  assert(Math.abs(width[1] - width[0] - 1.2) < 1e-12, `每块宽 ${width[1] - width[0]}，应当是 1.2`)

  /*
    比半块还短的段**不能被取整成 0 块**——那面墙上会凭空少一截。
    `round(0.4 / 1)` 是 0，所以下限那一步不是装饰。
  */
  const tiny = wallFaceTiles(mkSegment(0.4), bounds)
  assert(tiny.length === 1, `0.4 米段应当 1 块，实际 ${tiny.length}`)
  const [from, to] = spanOf(tiny[0], 0, bounds)
  assert(Math.abs(from + 0.2) < 1e-12 && Math.abs(to - 0.2) < 1e-12, '0.4 米段没铺满')

  /*
    长得离谱的段被块数上限截住（一个 tile 是资产里每个 mesh 一个 draw call），
    而**截住之后仍然铺满**——上限只改变块数，不改变覆盖面。
  */
  const long = wallFaceTiles(mkSegment(100), bounds)
  assert(long.length === 32, `100 米段应当被截到 32 块，实际 ${long.length}`)
  const first = spanOf(long[0], 0, bounds)
  const last = spanOf(long[long.length - 1], 0, bounds)
  assert(Math.abs(first[0] + 50) < 1e-12 && Math.abs(last[1] - 50) < 1e-12, '截断之后没铺满')

  for (const tile of [...two, ...tiny, ...long]) {
    for (const value of [...tile.offset, ...tile.scale]) {
      assert(Number.isFinite(value), `算出了非有限数：${value}`)
    }
  }
  return '2.4 米 → 2 块 × 1.2；0.4 米 → 1 块；100 米 → 截到 32 块且仍铺满'
})

check('不能用的资产各给一句人话，而不是算出 NaN', () => {
  /*
    这一组守的是「静默消失」那类故障：NaN 灌进 `Object3D.scale` 的后果是
    整个物体连同子节点从画面上不见、且**不报错**——排查时会以为是没加载出来。
    三种输入对应三种不同的修法，所以三条文案也得分开。
  */
  const empty = wallFaceUnusable({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
  assert(empty, '空包围盒没被挡下')
  assert(empty.includes('NaN'), `空包围盒的文案是「${empty}」，应当点出顶点问题`)

  const nan = wallFaceUnusable({ min: [0, 0, 0], max: [Number.NaN, 1, 1] })
  assert(nan && nan.includes('NaN'), `含 NaN 的包围盒的文案是「${nan}」`)

  // 零厚度：库里现有的两块地板都是零厚度平面，而墙分类就在地板隔壁
  const flat = wallFaceUnusable(mkBounds([0, 0, 0], [1, DEFAULT_WALL_HEIGHT, 0]))
  assert(flat && flat.includes('厚度'), `零厚度的文案是「${flat}」`)

  const narrow = wallFaceUnusable(mkBounds([0, 0, 0], [0.01, DEFAULT_WALL_HEIGHT, 0.18]))
  assert(narrow && narrow.includes('窄'), `太窄的文案是「${narrow}」`)

  const low = wallFaceUnusable(mkBounds([0, 0, 0], [1, 0.01, 0.18]))
  assert(low && low.includes('矮'), `太矮的文案是「${low}」`)

  assert(wallFaceUnusable(mkBounds()) === null, '规范的墙资产被误判成不能用了')

  /*
    兜底那一条：`wallFaceTiles` 是公开函数，宿主完全可能不先问 `wallFaceUnusable`
    就直接调。退化到零的那一轴**保持缩放 1**，绝不除出 Infinity——
    表现是这一面墙看着不对，比静默消失好诊断得多。
  */
  const degenerate = wallFaceTiles(mkSegment(3), mkBounds([0, 0, 0], [1, DEFAULT_WALL_HEIGHT, 0]))
  assert(degenerate.length > 0, '退化输入上一块都没铺出来')
  for (const tile of degenerate) {
    for (const value of [...tile.offset, ...tile.scale]) {
      assert(Number.isFinite(value), `退化输入算出了非有限数：${value}`)
    }
  }
  return '空 / NaN / 太薄 / 太窄 / 太矮 各有一句，规范资产放行'
})

check('建模时的背景板会被认成片，墙的尺寸不会被它带跑', () => {
  /*
    这一条是一次**真实事故**的回归，用的是那件资产的真实数字：
    `wall/wall1/wall1.glb` 里除了墙还有一块 80 × 80 米的背景板（贴地、零厚度，
    建模时用来出图的道具）。当时的量法是 `Box3.setFromObject(state.scene)`
    一把量**整个 glb 场景**，于是「资产尺寸」变成 80 × 2.8 × 80：

      块数 = round(段长 / 80)  →  恒为 1
      sx   = 段长 / 80        →  4 米的墙体被缩成 `段长/20`
      sz   = 墙厚 / 80        →  0.2 米厚的墙变成零点几毫米

    屏幕上看到的是「铺是铺了，但只有一小块」，与「压根没铺」完全同形。
    最要命的是它**不报错**：下面那条断言专门说明为什么。
  */
  const wall = mkBounds([-2, 0, -0.1], [2, 2.8, 0.1]) // 4 × 2.8 × 0.2 的墙体
  const backdrop = mkBounds([-40, -0.002, -40], [40, -0.002, 40]) // 80 × 80，零厚度
  const dirty = mkBounds([-40, -0.002, -40], [40, 2.8, 40]) // 两者并起来的脏盒子

  assert(wallFaceIsSheet(backdrop), '背景板没被认成片')
  assert(!wallFaceIsSheet(wall), '墙体被误判成片')

  /*
    先说清楚**为什么这把筛子是非有不可的**：脏盒子一路畅通——三个轴的尺寸都不小，
    `wallFaceUnusable` 没有任何理由拦它。所以「不筛」不会报错，只会安静地铺错，
    这也正是它能藏那么久的原因。
  */
  assert(wallFaceUnusable(dirty) === null, '脏包围盒本该被放行（这正是必须先筛的理由）')

  // 用脏盒子跑一遍，把「一小块」这个现象钉死
  const dirtyTiles = wallFaceTiles(mkSegment(8), dirty)
  assert(dirtyTiles.length === 1, `脏盒子应当只铺出 1 块，实际 ${dirtyTiles.length}`)
  const dirtyWidth = 4 * dirtyTiles[0].scale[0]
  const dirtyDepth = 0.2 * dirtyTiles[0].scale[2]
  assert(Math.abs(dirtyWidth - 0.4) < 1e-9, `脏盒子把 4 米长的墙体缩成了 ${dirtyWidth} 米，应当是 0.4`)
  assert(dirtyDepth < 0.001, `脏盒子把 0.2 米厚的墙缩成了 ${(dirtyDepth * 1000).toFixed(2)} 毫米`)

  /*
    筛干净之后就正常了。只并「实体」那些格子，与渲染端 `measured` 里的做法一致：
    8 米的墙配 4 米的墙板 → 2 块，首块左边缘落在段头、末块右边缘落在段尾。
  */
  const solids = [wall, backdrop].filter((box) => !wallFaceIsSheet(box))
  assert(solids.length === 1, `实体应当只剩 1 个，实际 ${solids.length}`)
  const merged = { min: solids[0].min, max: solids[0].max }

  const tiles = wallFaceTiles(mkSegment(8), merged)
  assert(tiles.length === 2, `筛过之后 8 米墙配 4 米墙板应当 2 块，实际 ${tiles.length}`)
  const [firstFrom] = spanOf(tiles[0], 0, merged)
  const [, lastTo] = spanOf(tiles[tiles.length - 1], 0, merged)
  assert(Math.abs(firstFrom + 4) < 1e-9, `首块左边缘落在 ${firstFrom}，应当是 -4`)
  assert(Math.abs(lastTo - 4) < 1e-9, `末块右边缘落在 ${lastTo}，应当是 4`)

  /*
    两个退化输入，两个方向都落在正确的一侧：

    - 一个顶点都没有的空网格：`Box3` 不动它的初值 `±Infinity`，判成片、丢掉——它本来
      就画不出东西。
    - 顶点含 `NaN` 的网格**必须留下来**：它得把合并出来的包围盒也变成 `NaN`，
      再由 `wallFaceUnusable` 拒掉整面墙。当成片悄悄丢掉的后果是这种资产被当成
      「一个干净的、只有一半几何的墙」——比拒绝它糟得多。
  */
  assert(
    wallFaceIsSheet({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }),
    '一个顶点都没有的空网格没被当成片',
  )
  assert(
    !wallFaceIsSheet({ min: [0, 0, 0], max: [Number.NaN, 2.8, 0.2] }),
    '含 NaN 的网格被误当成片丢掉了（它会绕过 NaN 守卫）',
  )

  return '背景板被筛掉、脏盒子放行且只铺出 0.4 米宽的一片、筛后 2 块铺满'
})

// ---------- 洞口的外观由模型负责 ----------

/**
 * 这一组守的是「画门时从库里挑一件资产装进洞口」那条链。
 *
 * 它整条都**不靠浏览器**：判据（`openingFilledByModel`）、抑制
 * （`dropOpeningFills`）、算术（`wallFaceFit`）三样都是纯函数，只有
 * 「真的把 .glb 摆上去」（`SceneFloorplanOpeningModel.vue`）与缩略图那两段要目视。
 *
 * 三样里**抑制**这一段最该有断言：它错了的表现是「洞里同时有两套门」
 * （模型的框扇 + 程序生成的框扇叠在同一个包围盒上），逐像素 z-fighting，
 * 而不报任何错。判据错了更隐蔽——把窗也抑制掉，用户看到的是「这扇窗没了」。
 */

const DOOR_URL = 'https://example.com/3d-assets/door/doubleGlassDoor/doubleGlassDoor.glb'

check('一件资产按高度等比装进洞口，不是三轴各自拉满', () => {
  /*
    资产是 1.2 × 2.4 × 0.4，洞口是 0.9 × 2.1（门扇那一片的原生厚度）。

    这个资产刻意**三个轴都不一样长**，宽高比也与洞口完全不同
    （1.2/2.4 = 0.5 对 0.9/2.1 ≈ 0.43），于是「等比」与「三轴各自拉满」
    在这条断言里分得开：拉满时 scale 是 [0.75, 0.875, 0.6] 三个不同的数，
    等比时三轴全是 0.875——按资产自己的比例算出来是 1.05 × 2.1 × 0.35 米。
  */
  const bounds = mkBounds([0, 0, 0], [1.2, 2.4, 0.4])
  const leaf = wallPieces(mkWall('w', [0, 0], [10, 0]), [mkDoor('d', 'w', 5)]).find(
    (piece) => piece.role === 'leaf',
  )
  assert(leaf, '门洞里没有门扇那一片')

  const tile = wallFaceFit(leaf, bounds)

  /*
    ① 三轴**同一个**系数，且由**高度**定：洞高 ÷ 资产高。

    这一条是整个函数的立身之本，也是用户实测反馈的那个 bug 的守门人：
    改回逐轴拉满时 `scale[0]` 会掉到 0.75（1.2 米宽的资产被压进 0.9 米的洞口），
    屏幕上就是「门被挤扁了、不是模型原来的宽度」。
  */
  const expected = leaf.size[1] / 2.4
  for (const axis of [0, 1, 2]) {
    assert(
      Math.abs(tile.scale[axis] - expected) < 1e-12,
      `第 ${axis} 轴的缩放是 ${tile.scale[axis]}，等比应当三轴都是 ${expected}`,
    )
  }

  /*
    ② 三个轴的中心都落在碎片原点上。

    这是这一步最容易漏的地方（`layFloorModel` 踩过同一个坑，`wallFaceFit`
    的注释里点了名）：包围盒是相对模型自己的原点量的，不减掉缩放后的中心，
    整扇门会偏出去半个身位——而屏幕上只是「门没对齐」，不报错。

    这个包围盒**刻意不是以原点为中心的**（min 是 [0,0,0]），所以中心那一条
    真的在验那一步减法：漏掉它，三个轴的中心都会落到半个身位上去。
  */
  for (const axis of [0, 1, 2]) {
    const [from, to] = spanOf(tile, axis, bounds)
    assert(
      Math.abs((from + to) / 2) < 1e-12,
      `第 ${axis} 轴的中心在 ${(from + to) / 2}，应当落在碎片原点上`,
    )
  }

  /*
    ③ 三个轴各自的跨度都等于「资产那一轴 × 那个系数」——也就是**一个都不变形**。

    高度那一轴恰好等于洞口高、宽度那一轴恰好**不等于**洞口宽，这两条要一起验：
    只验「高度顶满」在逐轴拉满时也成立（拉满的定义就是三轴都顶满），
    必须再加上「宽度停在资产自己的比例上」才能把两者分开。
    而宽度这个数正是「洞比资产窄时，多出来的部分嵌进墙里被墙面挡住」的算术形式。
  */
  const native = [1.2, 2.4, 0.4]
  for (const axis of [0, 1, 2]) {
    const [from, to] = spanOf(tile, axis, bounds)
    assert(
      Math.abs(to - from - native[axis] * expected) < 1e-12,
      `第 ${axis} 轴跨 ${to - from} 米，按资产比例应当是 ${native[axis] * expected} 米`,
    )
  }
  const [x0, x1] = spanOf(tile, 0, bounds)
  assert(
    Math.abs(x1 - x0 - leaf.size[0]) > 1e-6,
    `宽度跨 ${x1 - x0} 米、恰好等于洞口宽 ${leaf.size[0]} 米——这是被拉到洞口宽了，也就是「门被挤扁」`,
  )

  /*
    ④ 两个出口**共用同一份 `place()`**，所以这里顺手把这句话钉死。

    两者在**资产比例恰好等于洞口比例**时必然重合（那时三个轴的上限同进同退，
    等比与逐轴算出同一组数），所以拿一个与门扇**同尺寸**的包围盒来比：
    段长 0.9 配资产长 0.9 时 `round(1)` 是 1，两个出口必须逐字段相同（含 key）。

    分成两份实现的那天，这条会红——而那正是「校正量在一处改了、另一处没改」
    的唯一预警。同尺寸那一路还顺带钉住了另一件事：**照洞口建的资产缩放系数是 1**，
    也就是一个顶点都不动（只剩把包围盒中心搬回原点的那一步平移）。
  */
  const exact = mkBounds([0, 0, 0], [leaf.size[0], leaf.size[1], leaf.size[2]])
  const same = wallFaceFit(leaf, exact)
  for (const axis of [0, 1, 2]) {
    assert(
      Math.abs(same.scale[axis] - 1) < 1e-12,
      `照洞口尺寸建的资产第 ${axis} 轴缩放是 ${same.scale[axis]}，本该是 1`,
    )
  }

  const tiled = wallFaceTiles(leaf, exact)
  assert(tiled.length === 1, `0.9 米洞口配 0.9 米资产本该算出 1 块，实际 ${tiled.length}`)
  assert(
    JSON.stringify(tiled[0]) === JSON.stringify(same),
    `两个出口算出的不是同一块：\n平铺 ${JSON.stringify(tiled[0])}\n装进 ${JSON.stringify(same)}`,
  )

  return '三轴同取 0.875（= 2.1 ÷ 2.4），资产按自己的比例摆成 1.05 × 2.1 × 0.35 米、中心归零（宽度不是被拉成洞口那 0.9 米）；同尺寸资产缩放为 1 且与平铺出口逐字段一致'
})

check('不能装进洞口的资产各给一句人话，薄片照收', () => {
  /*
    与墙那一组（`wallFaceUnusable`）**刻意分成两个函数**，因为洞口那一件比墙少一条：
    它的厚度是**跟着高度等比缩出来的**，不是资产的性质。库里能出现「就是一片门扇」
    或「就是一片玻璃」的资产，拿墙那把尺子量它会被判成「没有厚度，当不了墙」——
    把一件合格的资产拒掉。这条断言就是那句「少一条」的守门人。
  */
  const thin = mkBounds([0, 0, 0], [0.9, 2.1, 0])
  assert(wallFaceUnusable(thin) !== null, '零厚度的盒子本该被墙那把尺子拒掉')
  assert(openingFaceUnusable(thin, 'door') === null, '零厚度的门扇被误拒了——厚度是拉伸出来的')

  // 空包围盒（一个顶点都没有的网格会在 three 里量出 ±Infinity）
  const empty = openingFaceUnusable(
    {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    },
    'door',
  )
  assert(empty && empty.includes('NaN'), `空包围盒的文案是「${empty}」，应当点出顶点问题`)
  assert(
    openingFaceUnusable({ min: [0, 0, 0], max: [Number.NaN, 2.1, 0.1] }, 'door')?.includes('NaN'),
    '含 NaN 的包围盒没被挡下',
  )

  // 太窄 / 太矮各一句，措辞是门的话（不是墙那句「当不了墙的一段」）
  const narrow = openingFaceUnusable(mkBounds([0, 0, 0], [0.03, 2.1, 0.1]), 'door')
  assert(narrow && narrow.includes('窄') && narrow.includes('门'), `太窄的文案是「${narrow}」`)
  const low = openingFaceUnusable(mkBounds([0, 0, 0], [0.9, 0.02, 0.1]), 'door')
  assert(low && low.includes('矮') && low.includes('门'), `太矮的文案是「${low}」`)

  /*
    同一把尺子换 `kind` 之后**名词必须跟着换**。这一条守的是「门与窗共用一份实现」
    这句话：同一个函数、同一组阈值，只有名词现取——若哪天门与窗被拆成两个函数
    （或者有人在里面按 `kind` 分岔出两套阈值），门说成窗、窗说成门这种错话
    在屏幕上没有任何别的地方看得出来。
  */
  const narrowWindow = openingFaceUnusable(mkBounds([0, 0, 0], [0.03, 1.2, 0.1]), 'window')
  assert(
    narrowWindow && narrowWindow.includes('窗') && !narrowWindow.includes('门'),
    `窗那把尺子的文案是「${narrowWindow}」，应当只说窗`,
  )
  const lowWindow = openingFaceUnusable(mkBounds([0, 0, 0], [1.2, 0.02, 0.1]), 'window')
  assert(lowWindow && lowWindow.includes('矮') && lowWindow.includes('窗'), `太矮的窗文案是「${lowWindow}」`)
  /*
    窗比门**矮得多**（默认档 1.2 米 vs 2.1 米），所以「合格的一扇窗」必须放行——
    拿门的比例去判窗、或者把阈值写成绝对米数，都会在这里红。
  */
  assert(
    openingFaceUnusable(mkBounds([0, 0, 0], [1.2, 1.2, 0.1]), 'window') === null,
    '规范的一扇窗被误判了',
  )

  // 规范的整樘门放行：照资产制作要求里那两个数建模的那一件
  assert(openingFaceUnusable(mkBounds([0, 0, 0], [0.9, 2.1, 0.18]), 'door') === null, '规范的门资产被误判了')

  return '零厚度放行；空 / NaN / 太窄 / 太矮 各有一句；同一把尺子换 kind 之后名词跟着换（门说门、窗说窗）'
})

check('资产里混进了道具时点一句名，但它照常装上去', () => {
  /*
    这条断言的全部输入都是**实测来的**，不是编的。

    服务器上 `door/doubleGlassDoor/doubleGlassDoor.glb` 里除了整樘门，还带着
    地面（14 × 0.02 × 17）、左右两面墙（各 6.1 × 3.4 × 0.08）与一面远端墙
    （14 × 3.4 × 0.12）——节点名就叫「地面」「墙-左」「远端墙」。那几件每一件都有
    4~12 厘米厚，而 `wallFaceIsSheet` 的门槛是 1 毫米，**一片都不会被筛掉**，
    于是 `measured` 量出来是 14 × 3.42 × 17.12 米。

    等比缩放照这个数缩：2.1 ÷ 3.42 = 0.614，整个房间被搬进 0.9 米的洞口，
    横着有 8.60 米。**摆法本身没错**（比例一点没走样），错的是那份资产，
    而在此之前这件事在屏幕上与控制台里都是静默的。
  */
  const room = mkBounds([-7, -0.02, -10.12], [7, 3.4, 7])
  const leaf = wallPieces(mkWall('w', [0, 0], [10, 0]), [mkDoor('d', 'w', 5)]).find(
    (piece) => piece.role === 'leaf',
  )
  assert(leaf, '门洞里没有门扇那一片')

  const loud = openingFaceOversized(leaf, room, 'door')
  assert(loud, '一个 14 米宽的房间资产被放行了，什么都没说')
  assert(loud.includes('14.00'), `文案里没点出量出来的宽度：「${loud}」`)
  assert(loud.includes('8.60'), `文案里没点出装完之后有多宽：「${loud}」`)
  assert(loud.includes('9.6'), `文案里没点出是洞口的几倍：「${loud}」`)
  assert(loud.includes('整樘门'), `文案没告诉用户该怎么办：「${loud}」`)

  /*
    另一头才是这条断言真正要守住的东西：**正常的门资产不许响**。

    这个门槛最容易改错的方向就是往下调——调狠了，一扇 1.8 米的双开门
    （装进 0.9 米洞口正好是 2 倍，正是「嵌进墙里被墙面挡住」那个正常用法）
    也会被报出来，而那种误报的代价是用户被指去查一份其实没问题的资产。
  */
  assert(
    openingFaceOversized(leaf, mkBounds([-0.9, 0, -0.084], [0.9, 2.1, 0.084]), 'door') === null,
    '一扇 1.8 米的双开门被报成了「混进道具」',
  )
  assert(
    openingFaceOversized(leaf, mkBounds([-1.0, 0, -0.1], [1.0, 2.1, 0.1]), 'door') === null,
    '一扇 2 米宽的门被报成了「混进道具」',
  )
  // 3 倍是**上限那一侧**：2.7 × 2.1（缩放系数是 1，装完正好 2.7 米 = 0.9 的 3 倍）
  // 不响，再宽一点就响——边界落在哪一侧写成两条断言，免得日后有人把 `>` 改成 `>=`
  assert(
    openingFaceOversized(leaf, mkBounds([0, 0, 0], [2.7, 2.1, 0.1]), 'door') === null,
    '正好 3 倍（2.7 米）就被报出来了，门槛应当是「超过 3 倍」',
  )
  assert(
    openingFaceOversized(leaf, mkBounds([0, 0, 0], [2.8, 2.1, 0.1]), 'door') !== null,
    '3.1 倍（2.8 米）没被报出来',
  )

  /*
    换成一扇窗：同一条判据、同一个门槛，只有那句「请只导出整樘X」的名词换掉。
    这一条与上面 `openingFaceUnusable` 的那个名词断言是同一个理由——共用实现里
    按 `kind` 现取的东西，除了这条断言没有别的地方看得出来取错了。
  */
  const windowFill = wallPieces(mkWall('w', [0, 0], [10, 0]), [mkWindow('n', 'w', 5)]).find(
    (piece) => piece.role === 'glass',
  )
  assert(windowFill, '窗洞里没有玻璃那一片')

  const loudWindow = openingFaceOversized(windowFill, room, 'window')
  assert(loudWindow, '窗那一侧把 14 米的房间资产放行了')
  assert(
    loudWindow.includes('整樘窗') && !loudWindow.includes('门'),
    `窗的文案是「${loudWindow}」，名词应当是窗`,
  )

  return '14 米宽的房间资产被点名（14.00 / 8.60 / 9.6 倍都写进文案），1.8 米与 2 米的双开门放行，门槛恰好卡在 3 倍；换成窗时名词跟着换成「整樘窗」'
})

check('洞口的 url 跟着深拷贝与 JSON 往返一起走', () => {
  /*
    与墙那条（`墙的 url 跟着深拷贝与 JSON 往返一起走`）逐字对应的一次：
    洞口的外观同样是**没有任何一层负责校验**的新字段，`cloneFloorplanPatch`
    对洞口是浅拷贝，所以这里守的是「新字段自动往返」这句话确实成立。
  */
  const patched = cloneFloorplanPatch({ openings: [{ ...mkDoor('d', 'w', 3), url: DOOR_URL }] })

  assert(patched.openings[0].url === DOOR_URL, `深拷贝把 url 弄丢了：${JSON.stringify(patched.openings[0])}`)
  assert('url' in patched.openings[0], 'url 这个键整个不见了')

  /*
    反向那条更要紧：**没写外观的洞口上不该出现这个键**。
    渲染端判「这个洞口由模型负责」用的是 `kind` + `url` 两条
    （`openingFilledByModel`），所以一个 `url: undefined` 不是「没有外观」——
    它在内存里让 `'url' in opening` 为真、JSON 往返之后又变假，
    同一个门洞在存盘前后会被判成两种东西。
  */
  const plain = cloneFloorplanPatch({ openings: [mkDoor('p', 'w', 3)] })
  assert(!('url' in plain.openings[0]), '没写外观的洞口凭空多出了一个 url 键')

  const round = JSON.parse(JSON.stringify(patched))
  assert(round.openings[0].url === DOOR_URL, 'JSON 往返把 url 弄丢了')
  assert(openingFilledByModel(round.openings[0]), '往返之后判据认不出它了')
  assert(!openingFilledByModel(plain.openings[0]), '没写外观的洞口被判成由模型负责')

  return 'url 进得去、出得来，没写的时候不出现'
})

check('写没写外观，切出来的碎片一模一样', () => {
  /*
    这条是整套机制的**支点**：墙照旧被 `placeOpenings` 切开。
    抑制的办法不能是「把这些洞口从 `openings` 里滤掉」——那样墙上就没有洞，
    换进来的门模型会被整个埋在实心墙里，而且不报错，只是看不见。

    所以 `wallPieces` 必须**完全不认识** `url`：它只知道「这里要开一个 0.9 米宽的洞」，
    至于洞里摆什么，是渲染层读完 url 之后的事。
  */
  const wall = mkWall('w', [0, 0], [10, 0])
  const bare = wallPieces(wall, [mkDoor('d', 'w', 5)])
  const styled = wallPieces(wall, [mkDoor('d', 'w', 5, { url: DOOR_URL })])

  assert(
    JSON.stringify(bare) === JSON.stringify(styled),
    `同一个洞口写没写外观切出了不同的碎片：\n${JSON.stringify(bare)}\n${JSON.stringify(styled)}`,
  )
  assert(bare.filter((piece) => piece.role === 'wall').length === 3, '门洞两侧 + 过梁应当是 3 段墙')

  /*
    墙这一侧也应同一条契约，而它今天多了一个用途：**换一面墙的墙面模型**
    就是重写那个 `wall.url`（`playground` 里的 `replaceSelectedWall`），
    它凭什么敢只改一个地址、一根几何都不动，依据正是这一条。
    所以这里量的是那条替换路的前提，不是把上面那条抄一遍：
    上面说的是洞口（那条链上还多一层 `dropOpeningFills`），这里说的是墙自己。

    用空洞口列表：要的是「同一面墙、只差一个 url」，洞口那套切段不参与。
  */
  const WALL_URL = 'https://example.com/3d-assets/wall/wall1/wall1.glb'
  const bareWall = wallPieces(mkWall('w2', [0, 0], [10, 0]), [])
  const styledWall = wallPieces({ ...mkWall('w2', [0, 0], [10, 0]), url: WALL_URL }, [])

  assert(
    JSON.stringify(bareWall) === JSON.stringify(styledWall),
    `墙写没写外观切出了不同的碎片：\n${JSON.stringify(bareWall)}\n${JSON.stringify(styledWall)}`,
  )

  return 'url 是画笔的痕迹，不是几何'
})

check('被模型接手的洞口只摘内饰件，墙段与过梁一根不动', () => {
  /*
    同一面墙上两个门洞，只有第一个写了外观。要验的是**摘的边界**：

    - 摘掉的正好是那个洞口自己的框条与门扇（4 + 1 = 5 片）；
    - 过梁（`-above`）与两侧墙段一根不少——洞口照旧被切开；
    - 另一个洞口的构件一片不少；
    - 一个都没写时原样返回（不是「返回空」）。
  */
  const wall = mkWall('w', [0, 0], [10, 0])
  const doors = [mkDoor('d1', 'w', 3, { url: DOOR_URL }), mkDoor('d2', 'w', 7)]
  const pieces = wallPieces(wall, doors)
  const kept = dropOpeningFills(pieces, doors)

  assert(pieces.filter((piece) => piece.openingId === 'd1').length === 5, 'd1 的构件不是 4 框 + 1 扇')
  assert(!kept.some((piece) => piece.openingId === 'd1'), `d1 漏下了 ${JSON.stringify(kept.filter((p) => p.openingId === 'd1'))}`)
  assert(
    kept.filter((piece) => piece.openingId === 'd2').length === 5,
    '另一个没写外观的洞口被连累了',
  )

  // 墙段（role 为 wall，含过梁）总数不变：摘的只有内饰件
  assert(
    kept.filter((piece) => piece.role === 'wall').length ===
      pieces.filter((piece) => piece.role === 'wall').length,
    '墙段被一起摘掉了——那样换进来的门模型会悬在没有洞的墙上',
  )
  assert(kept.some((piece) => piece.key === 'wall-d1-above'), 'd1 的过梁不见了')
  assert(kept.some((piece) => piece.key === 'wall-d1-before'), 'd1 左边的墙段不见了')
  assert(pieces.length - kept.length === 5, `摘掉了 ${pieces.length - kept.length} 片，应当是 5`)

  // 一个洞口都没写外观时**原样返回**：不能把整面墙摘没
  assert(dropOpeningFills(pieces, [mkDoor('d2', 'w', 7)]).length === pieces.length, '没有外观时把碎片摘掉了')

  /*
    窗走**同一条路**，而这一条是「判据不许再带 `kind`」的唯一守门人。

    这个判据原先还有第二半 `kind === 'door'`，理由是「门那条渲染路只找得到门扇
    那一片、窗洞里没有它」——放一个写了地址的窗过去就是「框和玻璃一起消失」。
    现在渲染路按 `opening.kind` 分别取 `leaf` 与 `glass`，于是判据退回本来的含义：
    **外观是不是交给模型了，与洞口的种类无关**。

    所以这里断言的方向与改造前**正好相反**：窗洞写了地址就该被判成由模型负责，
    它的框条、中竖梃、玻璃该被摘掉。谁要是把 `|| opening.kind === 'door'` 那半条
    加回去（那正是「只做门」那版的形状），这条会红——而不是等到用户报
    「窗上装了模型，框和玻璃还叠在上面」。
  */
  const windowed = mkWindow('v', 'w', 5, { url: DOOR_URL })
  assert(openingFilledByModel(windowed), '被写了地址的窗没被判成由模型负责')
  assert(!openingFilledByModel(mkWindow('v2', 'w', 5)), '没写地址的窗被判成由模型负责')

  const windowPieces = wallPieces(wall, [windowed])
  const windowKept = dropOpeningFills(windowPieces, [windowed])
  /*
    窗比门多两片：一是**窗台下面那块矮墙**（`-below`，门的 `bottom` 是 0，
    那块自然为空），二是 1.2 米宽超过了 `MULLION_FROM_WIDTH`（1.05）而多出来的
    **中竖梃**。摘掉的是 4 框 + 1 梃 + 1 玻璃 = 6 片，矮墙与过梁要留着。
  */
  assert(
    windowPieces.filter((piece) => piece.openingId === 'v').length === 6,
    `窗的构件不是 4 框 + 1 梃 + 1 玻璃，实际 ${JSON.stringify(windowPieces.filter((p) => p.openingId === 'v').map((p) => p.key))}`,
  )
  assert(
    windowKept.every((piece) => piece.openingId !== 'v'),
    '窗的框条 / 中竖梃 / 玻璃没被摘干净',
  )
  assert(
    windowKept.some((piece) => piece.key === 'wall-v-below'),
    '窗台下面那块矮墙被一起摘掉了——那是墙，不是窗的构件',
  )
  assert(windowKept.some((piece) => piece.key === 'wall-v-above'), '窗的过梁不见了')
  assert(
    windowPieces.length - windowKept.length === 6,
    `摘掉了 ${windowPieces.length - windowKept.length} 片，应当是 6`,
  )

  return '摘掉 d1 的 4 框 1 扇；墙段、过梁与 d2 的构件一片不少；写了地址的窗同样接手（摘掉 4 框 1 梃 1 玻璃，窗台矮墙与过梁留着）'
})

/*
  ---------- 洞口的落点规则：磁吸邻边、空档夹取 ----------

  这一组是「点选门窗 + 沿墙拖动」那次改动里**唯一能不靠浏览器验的部分**：
  拖动本身要走指针事件与画面，静态检查一个字都盖不到。而这里每一条错了，
  症状都只是「手感不对」——磁吸够不着、贴齐时灵时不灵、拖起来跳——
  没有人能从屏幕上看出是代码错了。
*/

check('磁吸：贴齐位置够得到，够不着就交回格点', () => {
  /*
    一扇 2.5 米的窗。贴齐位置是「邻居 offset + 两个半宽之和」：
    1.0 + 1.25 + 1.25 = 3.5，落在**半米**上——正是 1 米格永远给不出的位置，
    这就是磁吸存在的唯一理由。
  */
  const neighbor = mkWindow('v1', 'w', 1.0, { width: 2.5 })

  assert(
    Math.abs(openingMagnetOffset(3.4, 2.5, [neighbor]) - 3.5) < 1e-9,
    `3.4 附近应当吸到 3.5，实际 ${openingMagnetOffset(3.4, 2.5, [neighbor])}`,
  )
  /*
    够不着就老实给 null，交回调用方那侧的格点。

    **这一条同时守着一个坑**：3.0 正是「同一个手势被 `snap()` 吸到 1 米格之后」
    的样子，而它离贴齐位置差 0.5 米（> 半径 0.35）——所以磁吸的输入**必须是
    未吸格的那个点**（`placeOpeningAt` 的第三个参数），拿 `hit.offset` 当输入
    等于把磁吸关掉，而这两扇 2.5 米的窗正是这么配的。
  */
  assert(openingMagnetOffset(3.0, 2.5, [neighbor]) === null, '3.0 离贴齐位置 0.5 米，不该吸')
  assert(openingMagnetOffset(3.4, 2.5, []) === null, '没有邻居时不该吸到任何地方')

  // 两边都有邻居：取绝对值最近的
  const right = mkWindow('v2', 'w', 6.0, { width: 2.0 })
  // 左邻居给 3.5，右邻居给 6.0 - (1.0 + 1.25) = 3.75
  assert(Math.abs(openingMagnetOffset(3.6, 2.5, [neighbor, right]) - 3.5) < 1e-9, '没取更近的那一个')
  // 正中间（各差 0.125）：并列取较小的 offset，必须是确定性规则
  assert(
    Math.abs(openingMagnetOffset(3.625, 2.5, [neighbor, right]) - 3.5) < 1e-9,
    '并列时没有取较小的那个 offset',
  )

  return '3.4 → 3.5（半米上的贴齐点）；0.5 米外给 null；并列取小'
})

check('空档：只由邻居夹取，两端不缩边距（否则有些洞口根本挪不动）', () => {
  const left = mkWindow('v1', 'w', 1.0, { width: 2.5 })
  const right = mkWindow('v2', 'w', 7.0, { width: 2.5 })

  const gap = openingFreeGap(10, 4.0, 2.5, [left, right])
  assert(gap !== null, '两侧邻居都离得不近，居然说没余量')
  assert(
    Math.abs(gap.from - 3.5) < 1e-9 && Math.abs(gap.to - 4.5) < 1e-9,
    `空档应当是 [3.5, 4.5]，实际 [${gap.from}, ${gap.to}]`,
  )
  /*
    **这一条是整个磁吸能不能用的关键**：空档的左端点必须正好是贴齐位置，
    否则磁吸算出来的目标会被夹走一点点（上一版按 `OPENING_EDGE_GAP` 缩，
    就少了 0.1 米，症状是「贴不上去、手感发黏」）。
  */
  assert(
    Math.abs(openingMagnetOffset(3.4, 2.5, [left]) - gap.from) < 1e-9,
    '磁吸目标落在空档外面——每次磁吸都会被夹走一点',
  )

  // 没有邻居时就是整面墙：两端**不缩边距**，与放置那条路同宽同松
  const open = openingFreeGap(10, 5, 2, [])
  assert(open.from === 0 && open.to === 10, `没有邻居时空档应当是整面墙，实际 [${open.from}, ${open.to}]`)

  // 左右邻居把它夹得比它自己还窄
  const a = mkWindow('a', 'w', 2.0, { width: 2.0 })
  const b = mkWindow('b', 'w', 5.0, { width: 1.2 })
  assert(openingFreeGap(10, 4.0, 2.5, [a, b]) === null, '空档比洞口还窄，居然给出了区间')

  /*
    与邻居重叠的脏数据（导入的手写配置、旧版本文件）：**当前位置不在空档里**。
    这一条不判的话会返回「挪到邻居另一侧」的合法区间，于是一拖就跳、
    而且把一个已存在的重叠悄悄改成另一种重叠。
  */
  assert(
    openingFreeGap(10, 3.0, 2.5, [mkWindow('c', 'w', 3.0, { width: 1.2 })]) === null,
    '与邻居重叠着，居然还能拖',
  )

  return '空档 [3.5, 4.5] 且左端正好是磁吸目标；无邻居时是整面墙；挤不下与重叠都给 null'
})

check('拖动落点：整米步进 → 磁吸 → 夹进空档', () => {
  const roomy = { from: 0, to: 10 }

  // 吸的是**移动量**：origin 1.0 走 1.4 米 → 进位到 1 米 → 2.0
  assert(resolveOpeningDrag(1.0, 2.4, 0.9, [], roomy) === 2.0, '移动量没有按整米取整')
  assert(resolveOpeningDrag(1.0, 2.6, 0.9, [], roomy) === 3.0, '移动量没有按整米取整（进位那侧）')

  /*
    磁吸优先于格点，而且**磁吸算在原始落点上而不是步进之后**。

    步进先算的话，这一步永远够不着：origin 1.0、目标 2.7 步进出来是 3.0，
    而贴齐位置 2.5 与它差 0.5 米 > 0.35 的半径。换句话说把磁吸接在步进后面
    等于把它关掉，且不报错——所以这条断言守的是**两件事一起**。
  */
  const neighbor = mkWindow('v1', 'w', 5.0, { width: 2.5 })
  assert(
    resolveOpeningDrag(1.0, 2.7, 2.5, [neighbor], roomy) === 2.5,
    `2.7 应当吸到半米上的 2.5 而不是格点上的 3.0，实际 ${resolveOpeningDrag(1.0, 2.7, 2.5, [neighbor], roomy)}`,
  )

  // 磁吸给出的位置也照夹：空档右边卡在 3.5 时，2.5 要抬到 3.5
  assert(
    resolveOpeningDrag(1.0, 2.7, 2.5, [neighbor], { from: 3.5, to: 4.5 }) === 3.5,
    '磁吸目标没有照夹',
  )

  /*
    「拖不过邻居」：右侧 2.0 米的窗占着 [3.5, 5.5]，新窗 2.5 米宽，
    空档右端是 4.5 - (1.0 + 1.25) = 2.25。手拖到 5.0 米处，落在 2.25 上。
  */
  const blocker = mkWindow('v2', 'w', 4.5, { width: 2.0 })
  const tight = openingFreeGap(10, 1.0, 2.5, [blocker])
  assert(tight !== null && Math.abs(tight.to - 2.25) < 1e-9, '空档右端算错了')
  assert(
    Math.abs(resolveOpeningDrag(1.0, 5.0, 2.5, [blocker], tight) - 2.25) < 1e-9,
    '拖到邻居身上居然穿过去了',
  )

  return '2.4 → 2.0；2.6 → 3.0；2.7 → 2.5（磁吸赢过格点）；空档之外一律夹回边界'
})

check('贴着放能通过判重叠，靠的是那一颗 1e-9 而不是运气', () => {
  /*
    两扇 0.9 米的门贴着放：贴齐位置是 1.0 + 0.45 + 0.45。

    浮点上 `1.9 - 1.0` 是 0.8999999999999999，**严格小于** 0.9 成立——
    也就是说不让这一颗 eps，判重叠会把磁吸自己刚算出来的位置判成「压上了」，
    用户看到的是「瞄着边线放第二个门，它说此处已有门窗」。
    这条断言把 `openingOverlaps` 的容差与 `openingMagnetOffset` 的贴齐位置
    钉在同一个数上：改一处漏一处，这里就红。
  */
  const neighbor = mkDoor('d1', 'w', 1.0)
  const flush = openingMagnetOffset(1.95, 0.9, [neighbor])
  assert(Math.abs(flush - 1.9) < 1e-9, `贴齐位置应当是 1.9，实际 ${flush}`)

  const distance = Math.abs(neighbor.offset - flush)
  assert(distance < 0.9, '前提取值变了，这条断言要重写')
  assert(!openingOverlaps(flush, 0.9, [neighbor]), '磁吸刚算出来的贴齐位置被自己判成了重叠')

  // 真的压上去（往邻居里挪 1 毫米）仍然要拦
  assert(openingOverlaps(1.9 - 0.001, 0.9, [neighbor]), '真的重叠了却没拦住')

  return '贴齐位置 1.9 通过判重叠；往邻居里挪 1 毫米仍然被拦'
})

check('洞口放不下时给两个原因码，墙上余量那一侧卡在 OPENING_EDGE_GAP 上', () => {
  /*
    0.9 米的门 + 两端各 0.1 米的边距 = 1.1 米：**恰好**放得下的那面墙。
    边界取整是因为边距与门宽都是「用户看不出来的那两个数」——它们改一位，
    这里就该红，而不是表现成「有的墙放得下、有的放不下」。
  */
  assert(openingRejectReason(1.1, 0.55, 0.9, []) === null, '恰好放得下的 1.1 米墙被拒了')
  assert(openingRejectReason(1.099, 0.55, 0.9, []) === 'too-short', '差一毫米的墙居然放行了')
  assert(openingRejectReason(10, 5, 0.9, []) === null, '十米空墙上放一扇门被拒了')

  const crowded = mkWindow('v1', 'w', 5.0, { width: 2.0 })
  /*
    两条**同时**成立时先报墙太短：顺序是定的，换了文案会跟着实现漂且不报错。
    2.6 米的墙要 2.7 米，位置上又压着 5.0 米处那扇 2.0 米的窗。
  */
  assert(
    openingRejectReason(2.6, 3.0, 2.5, [crowded]) === 'too-short',
    '两个原因都成立时没有先报墙太短',
  )
  // 墙够长才轮到判重叠：2.5 米的窗，中心离邻居 0.5 米（要 2.25 米）
  assert(openingRejectReason(10, 4.5, 2.5, [crowded]) === 'overlap', '压着邻居的窗没被拒')

  return '1.1 米整放行、1.099 米拒；两条同时成立时先报墙太短；压着邻居判 overlap'
})

check('替换要用的那道判据与放置同源：贴着放也放行，压上去才拒', () => {
  /*
    `openingRejectReason` 是**替换**一个已存在洞口时唯一会重跑的那道判据
    （尺寸跟着新料重开洞），而它与放置那条路共用同一份实现。这条断言守的是
    「有人把它展开成一句内联的严格比较」这个错法——那样症状是
    「同样一扇窗，放得下、换不上去」，且只在贴着邻居那种位置上出现。

    贴齐位置由 `openingMagnetOffset` 给（与上面那条断言同一个数），
    它在 `openingOverlaps` 那一层要靠一颗 1e-9 才过得去。
  */
  const neighbor = mkDoor('d1', 'w', 1.0)
  const flush = openingMagnetOffset(1.95, 0.9, [neighbor])
  assert(Math.abs(flush - 1.9) < 1e-9, `贴齐位置应当是 1.9，实际 ${flush}`)
  assert(openingRejectReason(10, flush, 0.9, [neighbor]) === null, '贴着放的位置被这一层拒了')
  assert(openingRejectReason(10, 1.9 - 0.001, 0.9, [neighbor]) === 'overlap', '真的重叠了却没拦住')

  /*
    `others` **不含被检的那个洞口自己**，否则它会与自己重叠、判据恒真，
    一个洞口都换不了。这一条拿「把自己也算进去」的样子对照着说清楚：
    包含自己时必然 overlap，不包含时放行。
  */
  const self = mkDoor('d2', 'w', 4.0)
  assert(openingRejectReason(10, 4.0, 0.9, [self]) === 'overlap', '把自己传进来时居然放行了')
  assert(openingRejectReason(10, 4.0, 0.9, []) === null, '不含自己时不该拒')

  return `贴齐位置 ${flush} 放行；往邻居里挪 1 毫米判 overlap；把自己传进去必然 overlap`
})

// ---------- 由 JSON 零件表生成几何体 ----------

check('一张正常的零件表逐件读出来，没写的字段补成 0 与默认值', () => {
  const result = parseModelParts(
    JSON.stringify([
      // 盒子：w / h / d 三边，只有 y 写了位置
      { shape: 'box', w: 0.6, h: 0.08, d: 0.6, y: 0.7, name: '座垫', color: '#3a3a3a', roughness: 0.6 },
      // 圆柱：两个半径 + 高，名字与颜色都没写
      { shape: 'cylinder', rTop: 0.35, rBottom: 0.38, h: 0.05, y: 0.28 },
    ]),
  )

  assert(result.problem === null, `这一份不该有问题，实际「${result.problem}」`)
  assert(result.dropped === 0, `不该剔掉任何一件，实际剔了 ${result.dropped}`)
  assert(result.parts.length === 2, `应当读出来 2 件，实际 ${result.parts.length}`)

  const [seat, base] = result.parts
  assert(seat.shape === 'box' && seat.w === 0.6 && seat.d === 0.6, '盒子的三边没读对')
  assert(seat.x === 0 && seat.z === 0, `没写的 x / z 应当是 0，实际 ${seat.x} / ${seat.z}`)
  assert(seat.color === '#3a3a3a', `颜色应当原样读出来，实际 ${seat.color}`)

  assert(base.shape === 'cylinder' && base.rTop === 0.35 && base.rBottom === 0.38, '圆柱的半径没读对')
  assert(base.count === 1, `没写 count 应当是 1，实际 ${base.count}`)
  assert(base.radius === 0, `没写 radius 应当是 0，实际 ${base.radius}`)
  assert(base.name === '', `没写 name 应当是空串，实际「${base.name}」`)
  assert(base.color === '#cbd5e1', `没写 color 应当是中性的灰，实际 ${base.color}`)
  assert(
    base.metalness === 0 && base.roughness === 0.8,
    `金属度 / 粗糙度的默认值变了：${base.metalness} / ${base.roughness}`,
  )

  return '2 件都读出来；x / z / count / radius / name / color 的缺省值齐备'
})

check('畸形的零件逐件剔掉，参数表里一个非有限数都没有', () => {
  const good = { shape: 'box', w: 1, h: 1, d: 1 }
  const result = parseModelParts(
    JSON.stringify([
      good,
      { shape: 'sphere', w: 1, h: 1, d: 1 }, // 认不出的形状
      // JSON 里没有 NaN，坏数字到手就是 null（或一个字符串），两种都要挡
      { shape: 'box', w: null, h: 1, d: 1 },
      { shape: 'box', w: '1', h: 1, d: 1 },
      { shape: 'box', h: 1, d: 1 }, // 缺 w
      { shape: 'box', w: 1, h: 0, d: 1 }, // 零高度
      { shape: 'box', w: 1, h: 1, d: 1, x: 'abc' },
      { shape: 'box', w: 1, h: 1, d: 1, radius: -0.5 },
      { shape: 'cylinder', rTop: 0.2, rBottom: 0.2, h: -1 }, // 负高度
      { shape: 'cylinder', rTop: 0, rBottom: 0, h: 1 }, // 一条线，没有体积
      { shape: 'box', w: 1, h: 1, d: 1, count: 2.5 }, // count 不是整数
      { shape: 'box', w: 1, h: 1, d: 1, count: MAX_COUNT + 1 }, // count 超上限
      '不是对象',
      null,
      [1, 2],
    ]),
  )

  assert(result.problem === null, `这一份本身是合法 JSON，不该整份拒掉：「${result.problem}」`)
  assert(result.parts.length === 1, `只有第一件是好的，实际读出来 ${result.parts.length} 件`)
  assert(result.dropped === 14, `应当剔掉 14 件，实际 ${result.dropped}`)

  /*
    最要紧的一条：**参数表里不能有 NaN**。
    一个 NaN 顶点会让整块几何整块消失（SceneModelNode 的 measure 上有完整机制），
    而那时画面只是少了个东西，哪里都不报错。
  */
  const placed = placeModelParts(result.parts)
  assert(placed.length === 1, `好的那一件应当展开成 1 件，实际 ${placed.length}`)

  for (const part of placed) {
    for (const value of [...part.position, ...part.rotation, ...part.geometryArgs]) {
      assert(Number.isFinite(value), `参数里出现了非有限数：${value}`)
    }
  }

  return '15 件里读出来 1 件、剔掉 14 件；位置 / 朝向 / 参数表全是有限数'
})

check('count + radius 把零件沿圆周均布，位置与朝向用同一个 θ', () => {
  const result = parseModelParts(
    JSON.stringify([
      // demo.md 里那把椅子的「腿部横撑」：长边是 d、5 份、半径 0.35
      { shape: 'box', w: 0.08, h: 0.04, d: 0.45, y: 0.2, count: 5, radius: 0.35, name: '腿部横撑' },
    ]),
  )
  const placed = placeModelParts(result.parts)
  assert(placed.length === 5, `5 份应当展开成 5 件，实际 ${placed.length}`)

  // 第 0 份落在 +Z 上、不转——这是「起点 +Z」那一半
  const first = placed[0]
  assert(
    Math.abs(first.position[0]) < 1e-12 && Math.abs(first.position[2] - 0.35) < 1e-12,
    `第 0 份应当落在 (0, 0.2, 0.35)，实际 (${first.position.join(', ')})`,
  )
  assert(first.position[1] === 0.2, 'y 是中心高度，应当原样不动')
  assert(first.rotation[1] === 0, `第 0 份不该转，实际 ${first.rotation[1]}`)

  // 第 1 份转到 72°，且位置与朝向用的是**同一个** θ
  const theta = (2 * Math.PI) / 5
  const second = placed[1]
  assert(
    Math.abs(second.rotation[1] - theta) < 1e-12,
    `第 1 份应当绕 Y 转 72°（${theta}），实际 ${second.rotation[1]}`,
  )
  assert(
    Math.abs(second.position[0] - 0.35 * Math.sin(theta)) < 1e-12 &&
      Math.abs(second.position[2] - 0.35 * Math.cos(theta)) < 1e-12,
    `第 1 份应当落在 (${0.35 * Math.sin(theta)}, 0.2, ${0.35 * Math.cos(theta)})，` +
      `实际 (${second.position.join(', ')})`,
  )

  // 盒子的参数表就是 w / h / d，按这个顺序
  assert(
    first.geometryArgs.join() === '0.08,0.04,0.45',
    `盒子的参数表应当是 w,h,d，实际 ${first.geometryArgs.join()}`,
  )

  // 圆柱多一个分段数，且在最后一位；逐份拷过，不是同一个数组
  const cylinders = placeModelParts(
    parseModelParts(
      JSON.stringify([{ shape: 'cylinder', rTop: 0.06, rBottom: 0.07, h: 0.35, count: 2 }]),
    ).parts,
  )
  assert(cylinders.length === 2, `2 份应当展开成 2 件，实际 ${cylinders.length}`)
  assert(
    cylinders[0].geometryArgs.length === 4 &&
      cylinders[0].geometryArgs[0] === 0.06 &&
      cylinders[0].geometryArgs[1] === 0.07 &&
      cylinders[0].geometryArgs[2] === 0.35,
    `圆柱的参数表应当是 rTop,rBottom,h,分段数，实际 ${cylinders[0].geometryArgs.join()}`,
  )
  assert(cylinders[0].geometryArgs !== cylinders[1].geometryArgs, '参数表必须逐份拷，不能共用同一个数组')
  assert(
    cylinders[0].position.join() === '0,0,0' && cylinders[1].position.join() === '0,0,0',
    '没写 radius 就不该挪窝——不写 count 的零件不旋转、原地不动，靠的是同一条约定',
  )

  return '5 份每份 72°；第 0 份在 +Z 上不转，第 1 份位置与朝向同步；盒 3 参 / 柱 4 参'
})

check('整份读不出来时只给一句人话，一件几何体都不给', () => {
  const cases = [
    ['', '空字符串'],
    ['   ', '只有空白'],
    ['{不是 JSON', '不是合法的 JSON'],
    ['"一个字符串"', '顶层是字符串'],
    ['{"shape":"box","w":1,"h":1,"d":1}', '顶层是一个对象而不是数组'],
    ['null', '顶层是 null'],
  ]

  for (const [json, what] of cases) {
    const result = parseModelParts(json)
    assert(result.problem !== null, `${what} 应当整份拒掉，却给出了 ${result.parts.length} 件`)
    assert(result.parts.length === 0, `${what} 不该给出半件几何体，实际 ${result.parts.length} 件`)
    assert(result.dropped === 0, `${what} 是整份的问题，不该记成「剔掉了某几件」`)
    assert(placeModelParts(result.parts).length === 0, `${what} 展开之后应当一件都没有`)
  }

  // 件数超上限也整份拒掉，而不是静默截断——截断出来的画面「差不多是对的」，最难查
  const tooMany = Array.from({ length: MAX_PARTS + 1 }, () => ({ shape: 'box', w: 1, h: 1, d: 1 }))
  const over = parseModelParts(JSON.stringify(tooMany))
  assert(over.problem !== null && over.parts.length === 0, '件数超上限应当整份拒掉')
  assert(
    over.problem.includes(String(MAX_PARTS)),
    `报错里应当写着上限是多少，实际「${over.problem}」`,
  )

  return '6 种整份问题各自一句人话、0 件几何体；超上限也整份拒掉'
})

// ---------- 汇总 ----------
let failed = 0
for (const result of results) {
  if (!result.ok) failed += 1
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`)
}

console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed === 0 ? 0 : 1)
