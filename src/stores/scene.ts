import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  DEFAULT_SCENE_CONFIG,
  changedGroups,
  cloneConfig,
  cloneModelPatch,
  createModelConfig,
  deepAssign,
} from '../utils/config'
import { createModelId } from '../utils/modelId'
import type { DeepPartial, HistoryEntry, ModelConfig, SceneConfig } from '../types'

/** 历史栈上限，超出后丢弃最早的记录 */
const HISTORY_LIMIT = 50

/**
 * 连续改动的合并窗口。
 * 拖动滑块会在几百毫秒内产生几十次变更，逐次入栈会让历史面板没法用；
 * 静默这么久之后才把这一段改动记成一条。
 */
const COMMIT_DELAY = 400

/**
 * 视图开关的默认值。
 *
 * 取自工厂而不是 `DEFAULT_SCENE_CONFIG.models[0]`：默认场景现在是空的，
 * 那里没有模型可取。工厂本来就是这个问题的正解——它是「一个新模型长什么样」
 * 的唯一一份定义，与默认配置里有没有模型无关。
 */
const DEFAULT_MODEL_VIEW = createModelConfig()

/**
 * 场景状态仓库。
 *
 * store id 带 `tdm-` 前缀：插件可能被安装进已经使用了 Pinia 的宿主应用，
 * 前缀可以避免与宿主自己的 store id 撞名。
 *
 * 结构上分成两半：
 * - `config` 是唯一事实来源，只放「可序列化的场景配置」，导出/导入/历史都以它为载体
 * - `loading` / `progress` / `error` 是运行时状态，与配置无关，不参与历史
 *
 * 「当前选中哪个模型」既不属于上面任何一半，它是**界面状态**：
 * 单独一个 `selectedIndex` ref，不进配置、不进历史、不进导出物。
 * 放进配置的代价是每次在列表里点一下都算一次场景改动（历史里会多出一串
 * 「模型属性」），而且宿主导入一份配置时还得接受「该选中第几个」这种指令。
 *
 * 早先平铺在 store 上的 `modelUrl` / `background` / `autoRotate` / `wireframe` /
 * `showGrid` 保留为可写 computed 委托。这是为了不破坏已经写进 README 的对外 API，
 * 也让 SceneToolbar 无需改动：它们一律指向**当前选中的那个模型**。
 */
export const useSceneStore = defineStore('tdm-scene', () => {
  // ---------- 配置：唯一事实来源 ----------

  const config = reactive<SceneConfig>(cloneConfig(DEFAULT_SCENE_CONFIG))

  /**
   * 补上缺失的模型 id。
   *
   * 默认值里是空串（模块级常量不能写死 uuid，否则所有宿主实例会共享同一个），
   * 所以建立 store、重置配置、还原快照之后都要过一道这里。
   * 只在为空时生成，因此已经带 id 的快照（导出物、撤销目标）不会被改掉。
   */
  function ensureModelIds() {
    for (const model of config.models) {
      /*
       * 用真值判断而不是 `=== ''`：宿主直接 `applyConfig({ models: [...] })`
       * 时，那几个条目很可能连 `id` 这个键都没有，而 `undefined === ''` 是 false，
       * 于是列表里会留下一个没有 id 的模型——`v-for` 的 key 是 undefined、
       * 事件脚本也再找不回它。这里一次把「空串」和「根本没有」都补上。
       */
      if (!model.id) model.id = createModelId()
    }
  }

  ensureModelIds()

  // ---------- 选中项：界面状态 ----------

  /**
   * 当前在属性面板里被编辑的那个模型。越界一律由 clampSelection 收回来。
   *
   * 空场景时它停在 0，而 `config.models[0]` 是 undefined ——
   * 于是 `selectedModel` 为 undefined，这正是「没有东西可编辑」的表达。
   */
  const selectedIndex = ref(0)

  const selectedModel = computed<ModelConfig | undefined>(() => config.models[selectedIndex.value])

  /**
   * 列表长度变化时把下标收回合法区间。
   *
   * 只盯长度即可：下标只可能因为「列表变短」而越界，而变短一定伴随长度变化。
   * 撤销、导入、重置都会整体换掉 `models` 数组（applyPatch 对数组是整体替换），
   * 长度 watch 同样能捕捉到，不必在 restore 里再补一次。
   */
  function clampSelection() {
    const last = config.models.length - 1
    if (selectedIndex.value > last) selectedIndex.value = Math.max(0, last)
    if (selectedIndex.value < 0) selectedIndex.value = 0
  }

  watch(() => config.models.length, clampSelection)

  // ---------- 运行时状态 ----------

  /** 模型是否仍在加载中 */
  const loading = ref(false)
  /** 加载进度，0 ~ 100 */
  const progress = ref(0)
  /** 加载错误信息，null 表示无错误 */
  const error = ref<string | null>(null)

  /** 载入动作开始时的加载态复位，地址为空则直接算作已就绪 */
  function startLoading(pending: boolean) {
    error.value = null
    progress.value = 0
    loading.value = pending
  }

  // ---------- 兼容访问器 ----------

  /**
   * 当前选中模型的地址，空字符串表示它用的是内置示例几何体。
   *
   * 写回时只改地址，不换 id——换 id 是 `setModel` 的职责，
   * 这个访问器只是给工具栏/旧宿主留的一个字段级入口。
   */
  const modelUrl = computed({
    get: () => selectedModel.value?.url ?? '',
    set: (value: string) => {
      const model = selectedModel.value
      if (model) model.url = value
    },
  })

  /** 画布背景色 */
  const background = computed({
    get: () => config.background,
    set: (value: string) => {
      config.background = value
    },
  })

  /** 是否自动旋转视角 */
  const autoRotate = computed({
    get: () => config.camera.autoRotate,
    set: (value: boolean) => {
      config.camera.autoRotate = value
    },
  })

  /** 当前选中模型是否以线框模式渲染 */
  const wireframe = computed({
    get: () => selectedModel.value?.wireframe ?? false,
    set: (value: boolean) => {
      const model = selectedModel.value
      if (model) model.wireframe = value
    },
  })

  /** 是否显示地面网格 */
  const showGrid = computed({
    get: () => config.ground.visible,
    set: (value: boolean) => {
      config.ground.visible = value
    },
  })

  // ---------- 派生状态 ----------

  /** 场景中的模型列表。增删请走 `addModel` / `removeModel`，直接改数组绕过不了历史但不做校验 */
  const models = computed(() => config.models)

  /** 当前选中的模型是否指定了外部地址 */
  const hasModel = computed<boolean>(() => (selectedModel.value?.url ?? '') !== '')
  /** 是否处于异常状态 */
  const hasError = computed<boolean>(() => error.value !== null)
  /** 背景是否透明 */
  const isTransparent = computed<boolean>(() => config.background === 'transparent')

  // ---------- 操作历史 ----------

  let nextHistoryId = 1
  let pendingCommit: ReturnType<typeof setTimeout> | null = null

  const history = ref<HistoryEntry[]>([
    {
      id: 0,
      label: '初始状态',
      at: Date.now(),
      // 从 config 而不是 DEFAULT 拷：config 上已经补好了模型 id，
      // 否则第一次改动的快照里 id 会从 uuid 变成空串
      config: cloneConfig(config),
    },
  ])
  const historyIndex = ref(0)

  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)

  /** 当前历史位置对应的快照，用于判断"有没有真的改变" */
  function currentSnapshot(): SceneConfig {
    return history.value[historyIndex.value].config
  }

  /**
   * 把当前 config 记成一条历史。
   *
   * `forcedLabel` 用于导入配置这类有明确语义的操作；
   * 不传时按变化的顶层分组自动生成标签。
   */
  function commit(forcedLabel?: string) {
    pendingCommit = null

    const snapshot = cloneConfig(config)
    const groups = changedGroups(currentSnapshot(), snapshot)

    // 值与当前历史位置一致（例如撤销之后又手动改了回去），不产生新记录
    if (groups.length === 0 && !forcedLabel) return

    // 撤销到中途又做了新改动 → 丢弃原来的"未来"分支
    if (historyIndex.value < history.value.length - 1) {
      history.value.splice(historyIndex.value + 1)
    }

    history.value.push({
      id: nextHistoryId++,
      label: forcedLabel ?? groups.join(' · '),
      at: Date.now(),
      config: snapshot,
    })

    // 超出上限时丢弃最早的记录，并让索引继续指向末位
    if (history.value.length > HISTORY_LIMIT) history.value.shift()

    historyIndex.value = history.value.length - 1
  }

  /** 把待提交的改动立刻落盘，避免撤销时丢掉刚做的修改 */
  function flushPending() {
    if (!pendingCommit) return
    clearTimeout(pendingCommit)
    commit()
  }

  /**
   * 变更监听刻意不用「recording 标志位」那套写法。
   *
   * 撤销/重做会把 config 原地还原成某个快照，此时
   * `changedGroups(当前快照, config)` 天然为空数组，监听器自己就会跳过。
   * 靠数据本身自洽，比靠一个需要在 nextTick 里复位的布尔量更难写错。
   */
  watch(
    config,
    () => {
      if (changedGroups(currentSnapshot(), config).length > 0) {
        if (pendingCommit) clearTimeout(pendingCommit)
        pendingCommit = setTimeout(commit, COMMIT_DELAY)
      }
    },
    { deep: true },
  )

  /** 原地还原到某个快照，保持 config 的引用不变 */
  function restore(snapshot: SceneConfig) {
    deepAssign(config, cloneConfig(snapshot))
    // 外部来的快照（导入的旧文件、手写的配置）可能没有 id
    ensureModelIds()
  }

  /** 撤销一步 */
  function undo() {
    flushPending()
    if (historyIndex.value <= 0) return
    historyIndex.value -= 1
    restore(currentSnapshot())
  }

  /** 重做一步 */
  function redo() {
    flushPending()
    if (historyIndex.value >= history.value.length - 1) return
    historyIndex.value += 1
    restore(currentSnapshot())
  }

  /** 跳转到历史中的任意一步 */
  function jumpTo(index: number) {
    flushPending()
    if (index < 0 || index >= history.value.length) return
    historyIndex.value = index
    restore(currentSnapshot())
  }

  /** 清空历史，只保留当前状态作为新的起点 */
  function clearHistory() {
    if (pendingCommit) {
      clearTimeout(pendingCommit)
      pendingCommit = null
    }
    history.value = [
      {
        id: nextHistoryId++,
        label: '初始状态',
        at: Date.now(),
        config: cloneConfig(config),
      },
    ]
    historyIndex.value = 0
  }

  // ---------- 配置行为 ----------

  /**
   * 深合并一份配置补丁。
   *
   * 未出现在补丁里的字段保持当前值——导入一份只写了相机的配置，
   * 不该把地面和日照一起清空。
   *
   * 例外是数组：`models` 属于顶层数组，写进补丁就是**整体换掉整张列表**。
   * 只想改其中一个模型请用 `patchModel`。
   */
  function applyConfig(patch: DeepPartial<SceneConfig>, label?: string) {
    deepAssign(config, patch)
    /*
     * 补丁可能整表换掉 `models`（数组是整体替换），新来的条目未必带 id——
     * 手工写的 JSON、别的工具生成的配置都可能是这样。就地补一个，
     * 免得列表里出现一个 key 是 undefined 的行。
     */
    ensureModelIds()
    if (label) {
      if (pendingCommit) clearTimeout(pendingCommit)
      commit(label)
    }
  }

  /**
   * 深合并一份补丁到**某一个**模型上。
   *
   * 它是 `applyConfig({ models: [...] })` 的替代品，存在的理由是后者只能整表替换，
   * 而「把 3 号模型的线框打开」这种操作不该顺带重写另外两个模型（以及它们的 id）。
   *
   * 补丁先过一遍 `cloneModelPatch` 再合并：`deepAssign` 对 patch 里的数组与
   * 嵌套对象是整体装入（别名而非拷贝），宿主给的 reactive 数组一旦被装进配置，
   * 之后它自己变一下就静默改了场景，历史栈里还查无此事。
   *
   * `label` 传了就是一次立即提交（照 `applyConfig` 的语义），
   * 不传则走 400ms 防抖——拖模型位置会产生几十次写入，逐次入栈没法看。
   */
  function patchModel(patch: DeepPartial<ModelConfig>, label?: string, index?: number) {
    const model = config.models[index ?? selectedIndex.value]
    if (!model) return

    deepAssign(model, cloneModelPatch(patch))

    if (label) {
      if (pendingCommit) clearTimeout(pendingCommit)
      commit(label)
    }
  }

  /** 选中某个模型（纯界面状态，不进历史） */
  function selectModel(index: number) {
    if (!config.models[index]) return
    selectedIndex.value = index
  }

  /** 导出当前配置的深拷贝，可直接 JSON 序列化 */
  function exportConfig(): SceneConfig {
    return cloneConfig(config)
  }

  /** 恢复全部配置为默认值 */
  function resetConfig() {
    deepAssign(config, cloneConfig(DEFAULT_SCENE_CONFIG))
    // 默认值里 id 是空串，重新生成一个——重置等于开一个新场景
    ensureModelIds()
  }

  // ---------- 资源与视图行为 ----------

  /**
   * 载入模型并重置加载状态。
   *
   * 默认作用在**当前选中的那个**模型上；空场景（列表里一个都没有）时退化成
   * 追加，否则这个入口会静静地什么都不做。
   *
   * 默认场景就是空的，所以宿主沿用 `model="/chair.glb"` 这种单模型写法时，
   * 首次调用走的正是「追加」这一支——结果与从前一样是「场景里只有一个模型」，
   * 只是这个模型是被追加进去的，而不是去填一个预置好的空条目。
   *
   * 地址真的变了才换 id：换的是另一份资源，宿主理应能靠 id 分辨出来；
   * 而重复提交同一个地址（面板失焦、prop 重放）不该产生新 id。
   */
  function setModel(url: string, index?: number) {
    const target = index ?? selectedIndex.value
    const model = config.models[target]

    if (!model) {
      addModel(url)
      return
    }

    if (url !== model.url) model.id = createModelId()

    model.url = url
    selectedIndex.value = target
    startLoading(url !== '')
  }

  /**
   * 往场景里追加一个模型，并选中它。
   *
   * `url` 留空表示追加一个内置示例几何体——那是一个合法的、可以摆好几个的物体，
   * 不是「没加载出来」。默认场景是空的，所以这是拿到内置几何体的唯一入口
   * （编辑器里对应右栏「场景模型」表头那个「＋ 追加」）。
   */
  function addModel(url = ''): number {
    config.models.push({ ...createModelConfig(), id: createModelId(), url })
    selectedIndex.value = config.models.length - 1
    startLoading(url !== '')
    return selectedIndex.value
  }

  /**
   * 从场景里移除一个模型。
   *
   * `label` 与 `patchModel` 同义：传了就是一次立即提交，历史里记成一步
   * 明确的操作（「删除模型 · 办公桌」），不传则走上面那条 400ms 防抖、
   * 由顶层分组名「模型属性」代劳。
   *
   * `commit` 只放在 `splice` **之后**：带 label 的提交会绕过 commit 里那道
   * 「没有实际变化就不记录」的闸门，摆在前面的话，下标越界这种什么都没发生的
   * 调用也会往历史里塞一条空记录。
   *
   * 删掉中间那个时 `clampSelection` 不会动下标（它只在越界时才收），
   * 于是选中项落到原位置的后一个——这与右栏列表里那个 × 是同一套行为。
   */
  function removeModel(index: number, label?: string) {
    if (!config.models[index]) return
    config.models.splice(index, 1)
    clampSelection()

    if (label) {
      if (pendingCommit) clearTimeout(pendingCommit)
      commit(label)
    }
  }

  /** 卸载指定模型的资源，回到内置示例几何体 */
  function clearModel(index?: number) {
    const target = index ?? selectedIndex.value
    const model = config.models[target]
    if (!model) return

    // 回到内置几何体也是换了一个物体，同样换 id
    if (model.url !== '') model.id = createModelId()

    model.url = ''
    selectedIndex.value = target
    startLoading(false)
  }

  /** 更新加载进度 */
  function setProgress(percentage: number) {
    progress.value = percentage
    loading.value = percentage < 100
  }

  /** 标记加载完成 */
  function markLoaded() {
    progress.value = 100
    loading.value = false
    error.value = null
  }

  /** 标记加载失败 */
  function markFailed(message: string) {
    loading.value = false
    error.value = message
  }

  /**
   * 把视图开关恢复为默认值，模型状态不变。
   *
   * `visible` 也算视图开关：不加它的话，用户一旦把模型隐掉就再没有
   * 任何把它找回来的入口（位置缩放那类物体状态属于 resetConfig 的范畴）。
   *
   * 作用在**全部**模型上：这是一个场景级的「把画面恢复原样」，
   * 只复位选中的那个会让别的模型继续保持在用户改过的状态，与按钮的含义不符。
   */
  function resetView() {
    config.background = DEFAULT_SCENE_CONFIG.background
    config.camera.autoRotate = DEFAULT_SCENE_CONFIG.camera.autoRotate
    for (const model of config.models) {
      model.wireframe = DEFAULT_MODEL_VIEW.wireframe
      model.visible = DEFAULT_MODEL_VIEW.visible
    }
    config.ground.visible = DEFAULT_SCENE_CONFIG.ground.visible
  }

  /** 切换某个布尔视图开关（前两个作用在当前选中的模型上） */
  function toggle(key: 'autoRotate' | 'wireframe' | 'showGrid') {
    if (key === 'autoRotate') autoRotate.value = !autoRotate.value
    else if (key === 'wireframe') wireframe.value = !wireframe.value
    else showGrid.value = !showGrid.value
  }

  return {
    // 配置
    config,
    applyConfig,
    patchModel,
    exportConfig,
    resetConfig,
    // 选中项（界面状态）
    selectedIndex,
    selectedModel,
    models,
    selectModel,
    // 运行时状态
    loading,
    progress,
    error,
    // 兼容访问器
    modelUrl,
    background,
    autoRotate,
    wireframe,
    showGrid,
    // 派生
    hasModel,
    hasError,
    isTransparent,
    // 历史
    history,
    historyIndex,
    canUndo,
    canRedo,
    undo,
    redo,
    jumpTo,
    clearHistory,
    // 行为
    setModel,
    addModel,
    removeModel,
    clearModel,
    setProgress,
    markLoaded,
    markFailed,
    resetView,
    toggle,
  }
})
