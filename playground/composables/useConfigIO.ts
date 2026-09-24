import { computed, ref } from 'vue'
import { activeEventTypes, migrateConfig, useSceneStore } from '../../src'
import type { DeepPartial, SceneConfig } from '../../src'
import { canvasApi, pushEvent, sceneName } from './useEditorState'

/** 配置文件的格式版本，用于将来做向后兼容 */
const CONFIG_VERSION = 1

/** 导出到磁盘的文件形状 */
export interface SceneFile {
  version: number
  name: string
  exportedAt: string
  config: SceneConfig
}

/**
 * Pinia 的 store 必须在 app.use(createPinia()) 之后才能取。
 * 这个模块会被 App.vue 间接引入，模块求值时机早于 main.ts 的函数体，
 * 所以这里做成惰性单例而不是在模块顶层直接取。
 */
let sceneRef: ReturnType<typeof useSceneStore> | null = null
function scene() {
  return (sceneRef ??= useSceneStore())
}

/** 最后一次保存时的配置快照。null 表示本次会话还没有保存过 */
const savedJson = ref<string | null>(null)
const savedAt = ref<number | null>(null)

/** 是否存在未保存的改动 */
const dirty = computed(
  () => savedJson.value !== null && JSON.stringify(scene().config) !== savedJson.value,
)

/** 是否曾经保存过（用来区分「从未保存」和「已保存且无改动」） */
const everSaved = computed(() => savedAt.value !== null)

/** 顶栏保存圆点的 title 与旁边那行小字读它 */
const savedLabel = computed(() =>
  savedAt.value
    ? new Date(savedAt.value).toLocaleTimeString('zh-CN', { hour12: false })
    : '未保存',
)

function snapshot() {
  const json = JSON.stringify(scene().config)
  savedJson.value = json
  savedAt.value = Date.now()
  return json
}

/** 组装一份可写盘的文件内容 */
function buildFile(): SceneFile {
  return {
    version: CONFIG_VERSION,
    name: sceneName.value,
    exportedAt: new Date().toISOString(),
    config: scene().exportConfig(),
  }
}

/** 触发浏览器下载 */
function download(file: SceneFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${file.name || 'scene'}.3deditor.json`
  anchor.click()
  // 立刻回收：下载已经开始，blob URL 不再需要
  URL.revokeObjectURL(url)
  return anchor.download
}

/** 导出当前配置为 .3deditor.json 文件 */
function exportFile() {
  const filename = download(buildFile())
  pushEvent(`已导出配置 → ${filename}`)
}

/**
 * 数一数这份配置里有几段「已启用而且真的写了代码」的事件脚本。
 *
 * 用的是库里那个唯一的门控谓词，所以这里的计数与画布上真正会挂监听器的
 * 集合必然一致——否则这句警告迟早会与实际行为对不上。
 *
 * 只数带代码的：开了启用位但代码框是空的等于空操作，报了反而像狼来了。
 * 多模型下逐模型累加：警告说的是「这份文件里有几段会跑的代码」，
 * 那是整份文件的性质，与用户此刻选中了哪一个模型无关。
 */
function countArmedEvents(config: DeepPartial<SceneConfig>): number {
  const models = config.models
  if (!Array.isArray(models)) return 0

  return models.reduce((total, model) => {
    if (!model) return total
    const armed = activeEventTypes(model).filter(
      (type) => (model.events?.[type]?.code ?? '').trim() !== '',
    ).length
    return total + armed
  }, 0)
}

/**
 * 从文件导入配置。
 *
 * 只做浅校验：确认是对象、带 config 字段、版本号不超过当前版本。
 * 更细的字段校验交给 deepAssign——它天然会忽略配置里没有的键，
 * 缺失的键则保持当前值，所以一份残缺的文件不会把场景打坏。
 *
 * 写入用带 label 的 `applyConfig`，与库的 `loadSceneData` 刻意不同：
 * 导入是编辑器里的一次动作，误导入应当能 ⌘Z 退回；而 `loadSceneData`
 * 是宿主初始化场景，语义上要清空撤销栈。两者不该合成一条路。
 */
async function importFile(file: File) {
  try {
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)

    if (typeof parsed !== 'object' || parsed === null) throw new Error('不是合法的 JSON 对象')

    const candidate = parsed as Partial<SceneFile>

    // 兼容两种写法：带外壳的导出文件，以及直接一份裸 config
    const raw = candidate.config ?? (parsed as DeepPartial<SceneConfig>)

    if (typeof raw !== 'object' || raw === null) throw new Error('缺少 config 字段')

    if (typeof candidate.version === 'number' && candidate.version > CONFIG_VERSION) {
      throw new Error(`配置版本 ${candidate.version} 高于当前支持的 ${CONFIG_VERSION}`)
    }

    const config = migrateConfig(raw)

    const armed = countArmedEvents(config)

    scene().applyConfig(config, '导入配置')
    if (candidate.name) sceneName.value = candidate.name

    pushEvent(`已导入配置 ← ${file.name}`)

    /**
     * 单独报一条警告：事件脚本是这份配置里唯一会被**执行**的东西，
     * 而它来自一个刚下载下来的文件。
     *
     * 做成 window.confirm 会更醒目，但那会打断编辑器的整体观感；
     * 去掉底部事件控制台之后它落进浏览器控制台，醒目程度是不如从前那条
     * 「就在视口下方、导入那一刻显示在最上面」的横幅的。可以接受的原因是
     * 它并非唯一的信号：启用了几类事件在视口 HUD 的 `EVT n/5` 和右栏的
     * 「事件绑定」那一行上一直看得见，`⚠` 前缀也还在。
     * 这是个取舍：不拦你，但把话说出来。
     */
    if (armed > 0) {
      pushEvent(`⚠ 这份配置含 ${armed} 段事件代码，点击模型时会被执行；可在「模型属性 → 事件绑定」里查看`)
    }

    return true
  } catch (error) {
    pushEvent(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * 顶栏那个「保存」按钮，以及 ⌘S。
 *
 * 编辑器自己**不落盘**——原先写 localStorage 的那套已经整段去掉。场景存到哪儿
 * 是宿主的决定（后端、文件、还是别的地方），编辑器插件的第一个消费者不替它做主。
 * 所以这里的全部动作就是「把场景数据取出来」：取完打一条日志，在真实宿主里，
 * 这一步之后接的是它自己的接口。
 *
 * 数据经 `canvasApi` 转调 `SceneViewer` 的公开方法，而不是直接读 store：
 * 让这条路径尽量贴住宿主的真实用法，接口设计错了才会在这里就暴露出来。
 *
 * 末尾那次 `snapshot()` 是给顶栏那颗圆点用的。圆点的三态（灰 / 琥珀 / 绿）
 * 完全寄生在 `snapshot()` 上，而它原先只被「保存到草稿」「恢复草稿」两处调用，
 * 那两个函数已随 localStorage 一起删掉。不在这里补一下，圆点会永远停在灰色。
 * 它的含义因此是「自上次把数据交给宿主以来有没有改动」。
 */
function saveScene() {
  const data = canvasApi.getSceneData?.()
  if (!data) return false

  pushEvent(`已取到场景数据（${data.models.length} 个模型），交给宿主保存`)
  snapshot()
  return true
}

export function useConfigIO() {
  return {
    dirty,
    everSaved,
    savedLabel,
    exportFile,
    importFile,
    saveScene,
  }
}
