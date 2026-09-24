import { MODEL_EVENT_LABELS, useSceneStore } from '../../src'
import type { ModelEventPayload, ModelEventType, ModelConfig } from '../../src'
import { pushEvent } from './useEditorState'

/**
 * 模型事件脚本的执行者。
 *
 * 为什么执行代码这件事落在编辑器而不是库里：`src/` 是会被宿主打进自己应用的发布物，
 * 里面出现 `new Function` 等于替宿主开了一个「配置即代码」的口子——
 * 而配置是可以从别处导入的。这个决定由 smoke 钉成了可执行契约
 * （`dist/index.js` 里不许出现 `new Function`）。
 *
 * 所以库只负责「发事件 + 读 enabled」，跑不跑、怎么跑，由宿主自己决定。
 * 这个文件就是本编辑器那份决定，同时也可以当作宿主自己实现时的参照。
 */

/**
 * 编译缓存。
 *
 * **只放编译成功的**：失败的 code 若是也塞进去，用户每敲一个字符就多一个
 * 永久条目，一段写坏的代码能把这个 Map 撑成文本编辑器的撤销栈。
 * 失败的每次重新编译一次（代价是几微秒），换来的是缓存里全是能跑的。
 */
const compiled = new Map<string, (event: unknown, model: unknown) => void>()

/**
 * 把一段代码文本编译成函数。
 *
 * `new Function` 的最后一个参数是**语句体**，不是函数表达式：
 * 用户若粘一整段 `(event) => { … }` 进来，会得到「Unexpected token '=>'」
 * 这种完全指不到点子上的报错，所以这里把用法写进错误信息。
 *
 * 反过来，返回的函数签名是写死的 `(event, model)`：用户代码能直接用的
 * 就是这两个名字，不需要自己声明形参。这条约定在 README 里也写了一份。
 */
export function compileEventHandler(
  code: string,
): ((event: unknown, model: unknown) => void) | null {
  const cached = compiled.get(code)
  if (cached) return cached

  try {
    const fn = new Function('event', 'model', code) as (
      event: unknown,
      model: unknown,
    ) => void
    compiled.set(code, fn)
    return fn
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushEvent(`事件代码编译失败：${message}（这里要写的是语句体，例如 console.log(event)）`)
    return null
  }
}

/** 把错误压成一行：多行堆栈会把「一条日志一件事」的节奏打乱 */
function oneLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]
}

/**
 * 执行某一类事件的脚本。
 *
 * 由 SceneStage 在收到库发出的 `object*` 事件后调用。报错与「代码为空」
 * 两类提示都走 `pushEvent`，也就是浏览器控制台里带 `[tdm]` 前缀的那些行——
 * 去掉底部事件控制台之后，这里是事件代码出问题时**唯一**的反馈渠道，
 * 所以这些提示一个都不能省。用户自己写的 `console.log` 没有前缀，
 * 与它们并排出现在同一个控制台里，但那是宿主代码的输出。
 *
 * `model` 参数取的是 `exportConfig()` 的深拷快照，而不是 `config.models[n]` 本身：
 * 后者是 reactive 代理，用户代码里一句 `model.events.click.enabled = true`
 * 就会真的写进 store、进历史栈，看起来像幽灵改动。
 * 也因此要在文档里说明：**改 `model` 不影响场景**，要改场景请用 store 的方法。
 *
 * 事件载荷本身不做冻结：它是 pmndrs 的事件对象，`_pointer` / `_ray` 是惰性缓存字段，
 * 冻结会让那些缓存的赋值静默失败，每次访问都重算。
 */
export function runModelEvent(type: ModelEventType, payload: ModelEventPayload): void {
  const scene = useSceneStore()

  /**
   * 按载荷里的 id 找回**发出这个事件的**模型，而不是「此刻属性面板里选中的那个」。
   *
   * 两者在多模型场景下必然会分叉：点一下 A 之后、代码跑起来之前去列表里
   * 切到 B 是完全可以发生的，照着选中项取脚本就会跑错人的代码。
   * 载荷里的 id 由发布事件的那个节点填上（见 SceneModelNode 的 buildPayload），
   * 它才是「这是谁」的权威答案。
   *
   * 顺带地，传进用户代码的 `model` 也是这一个模型的快照，
   * 于是它与同一份载荷里的 `event.id` 永远自洽。
   */
  const snapshot = scene.exportConfig()
  const model = snapshot.models.find((item) => item.id === payload.id)
  const handler = model?.events?.[type]

  if (!handler?.enabled) return

  const code = handler.code.trim()
  if (!code) {
    // 启用但没写代码是一个合法状态（等于空操作），但多半是忘了写，报一声
    pushEvent(`事件「${MODEL_EVENT_LABELS[type]}」已启用但代码为空，未执行任何内容`)
    return
  }

  const fn = compileEventHandler(code)
  if (!fn) return

  const label = MODEL_EVENT_LABELS[type]

  try {
    fn(payload, model as ModelConfig)
  } catch (error) {
    /**
     * 只报错误本身，**不要**把 payload 一起打出来：
     * 它里面的 `object` 是 three 的 Object3D，带着 parent 环，
     * 一序列化就抛异常，而这个异常会从 catch 里再抛出去、连带吞掉后续的点击。
     */
    pushEvent(`事件「${label}」执行出错：${oneLine(error)}`)
  }
}
