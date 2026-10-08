import { inject, type InjectionKey } from 'vue'
import type { ModelEventPayload, ModelEventType } from '../types'

/**
 * 编辑器需要**回调宿主**的那几件事。
 *
 * 起这一层的直接原因是 `new Function`：模型事件绑定的代码是**字符串**，
 * 要跑就得编译（见 `playground/composables/useEventRunner.ts`），而编译只能靠
 * `new Function` / `eval`。库自己绝不能碰它——`dist/index.js` 里出现这四个字
 * 就等于替宿主开了一个「配置即代码」的口子，而配置是可以从别处导入的。
 * 冒烟测试把这条钉成了可执行契约（`产物里不含 new Function`）。
 *
 * 于是分工变成：**库只负责发事件、读 `enabled`；跑不跑、怎么跑，宿主自己决定。**
 * 编辑器渲染出事件面板、把用户敲的代码存进配置，但它不执行——真正执行的那一份
 * 由宿主经这个注入交进来。
 *
 * 这条分界在「三栏进库」之前是靠**位置**维持的：执行器住在 `playground/`，
 * 而 `src/index.ts` 的依赖图碰不到它。外壳进库之后位置不再管用（`SceneViewer`
 * 渲染的编辑器够得着一切），必须换成一条**显式的缝**，这就是它。
 *
 * ## 与 `EDITOR_ASSETS_KEY` 同一种做法
 *
 * `provide` / `inject` 而不是模块级常量：这份值来自宿主，在库的模块求值那一刻
 * 还不存在；模块级常量要跟着宿主变就得改成模块级可变状态，那是 SSR 下会串请求
 * 的写法。缺省那份是**空对象**——宿主什么都不给时，编辑器照常渲染、照常存代码，
 * 只是点下去没有任何东西被执行（事件仍会照常发给宿主）。
 */
export interface EditorHooks {
  /**
   * 执行某一个模型事件绑定里的代码。
   *
   * 载荷里的 `id` 是**发出这个事件的那个模型**，不是「此刻选中的那个」——
   * 多模型场景下两者会分叉。库里发事件时填的就是它，宿主照它取代码即可。
   *
   * 不提供时编辑器什么都不做（不发警告、不报错）：不执行用户代码是一个
   * 完全合法的选择，事实上多数宿主都该这么选。
   */
  runEventCode?: (type: ModelEventType, payload: ModelEventPayload) => void
}

/** 注入键。用 Symbol 而不是字符串，避免与宿主自己的 provide 撞名 */
export const EDITOR_HOOKS_KEY: InjectionKey<EditorHooks> = Symbol('tdm-editor-hooks')

/** 宿主什么都没给时的那一份：一个空对象，任何回调都没有 */
export const EMPTY_EDITOR_HOOKS: EditorHooks = Object.freeze({})

/**
 * 取这套回调。**必须在组件 setup 里调用**（`inject` 的前提）。
 *
 * 没人在上层 provide 时退回 `EMPTY_EDITOR_HOOKS` 而不是抛错，与 `useEditorAssets`
 * 同一条理由：编辑器要能在「宿主还没配」的状态下正常渲染。
 */
export function useEditorHooks(): EditorHooks {
  return inject(EDITOR_HOOKS_KEY, EMPTY_EDITOR_HOOKS)
}
