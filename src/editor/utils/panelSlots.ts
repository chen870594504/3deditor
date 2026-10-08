/**
 * 宿主面板页的插槽名怎么拼——**这条规则只写在这里一处**。
 *
 * 它是一条**公开契约**（`EditorPanelTab.key` 的注释里、README 的扩展那一节里
 * 都照着这两行说话），而它同时要被五处用到：`SceneViewer` 与 `SceneEditor` 各转发
 * 一次（`panelSlotNames`），左右两个面板各拼一次自己的那个（两个前缀常量）。
 *
 * 不共享的代价是**静默**的：拼错一个连字符不报错，宿主的整块面板会一个字都不显示
 * ——一个没有被提供的插槽是合法的空插槽，Vue 不会因此警告一句。
 */
export const SIDE_TAB_PREFIX = 'side-tab-'

export const INSPECTOR_TAB_PREFIX = 'inspector-tab-'

/**
 * 从 `$slots` 里挑出以某个前缀开头的那些名字。
 *
 * 用途是**转发**：宿主把内容写在 `<SceneViewer>` 上，而真正渲染它的是面板，
 * 中间隔着 `SceneEditor` 这一层。插槽不会自己往下走，所以要按名字挑出来、
 * 再用动态插槽名转发一层（写在那两个组件的模板里）。
 *
 * ## 为什么读 `$slots` 是非得在渲染期调这个函数的原因
 *
 * `slots` 是**父组件重渲染时才被换掉的普通对象**，在 computed 里读它不建立依赖：
 * 父组件后来才写上一个插槽，那个 computed 不会重算，转发出去的仍是一份旧名单。
 * 所以调用点一律写在模板里（`SidePanel.vue` 的 `railButtons` 是同一件事的另一处
 * 落点，那里有更完整的说明）。
 *
 * 参数取宽类型而不是 `Slots`：模板里传进来的就是 `$slots` 本身，
 * 而这里只需要键名，不碰任何值。
 */
export function panelSlotNames(slots: Record<string, unknown>, prefix: string): string[] {
  return Object.keys(slots).filter((name) => name.startsWith(prefix))
}
