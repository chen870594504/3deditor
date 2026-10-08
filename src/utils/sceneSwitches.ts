/**
 * 画布上那四个开关的生效规则。
 *
 * `editable` 是**编辑模式总闸**：它不新增任何能力，只改默认值。四个开关各自的
 * prop 仍然原样存在，谁显式传了谁说话；没传的才去看总闸；总闸也没给就落回旧默认。
 * 三级优先级写成一句：
 *
 *     生效值 = 分开关 ?? 总闸 ?? 旧默认
 *
 * 这么排的三条理由都不是风格问题：
 *
 * - **分开关优先**，因为「编辑模式，但不要那条内置工具栏」是真需求——编辑器通常
 *   自己画一条，playground 就是 `:toolbar="false"` 配三个交互开关全开。总闸盖过
 *   分开关，这种组合就没法表达了。
 * - **总闸次之**，因为它本身就是来当默认值的。
 * - **旧默认垫底**，于是 `<SceneViewer />` 一个 prop 都不传时，行为与加这个总闸
 *   之前**逐字一致**。这一行是「加了 `editable` 不会悄悄改掉已发布宿主的行为」的
 *   唯一保证——四个开关的旧默认值见下面的 `DEFAULT_SCENE_SWITCHES`。
 *
 * **为什么要有这个总闸**：宿主想表达「这张画只给人看」时，原先得自己关四个开关，
 * 而**漏关一个不报错**——画面上只是多出一截本不该有的东西（多一条内置工具栏、
 * 点一下模型还会被选中、模型身上多一个拖不动的手柄）。写成 `:editable="false"`
 * 就没有漏的可能：一处开关管一整组。
 *
 * 它进公开面（`index.ts` 导出）的理由与 `viewModeOf` 那类「宿主自己也绕不过去」的
 * 算术略有不同，这里主要是第二条：**它是唯一能被自动化验证的那一份**。
 * 四个开关里有三个（`pickable` / `selection` / `gizmo`）住在 `TresCanvas` 内部，
 * SSR 下 children 根本不渲染，断言写不出来；而这条规则是纯算术、不依赖 three 也不
 * 依赖 DOM，写成函数之后 `scripts/smoke.mjs` 就能把每一条优先级逐一钉住。
 * 宿主那边另有一处用得着它：自绘工具栏时想问「此刻点选到底开没开」，答案就在这里。
 */

/** 规则的三级输入。四个分开关都允许缺省——缺省即「没传」，与 `false` 是两回事。 */
export interface SceneSwitchInput {
  /** 编辑模式总闸，见本文件头部。不传时完全按下面四个分开关来 */
  editable?: boolean
  /** 是否显示内置工具栏 */
  toolbar?: boolean
  /** 是否允许在画布上点选模型 */
  pickable?: boolean
  /** 选中项是否画包围框 */
  selection?: boolean
  /** 是否显示变换手柄 */
  gizmo?: boolean
}

/** 四个开关的生效值。模板与宿主读的都是它，而不是原始 prop */
export interface SceneSwitches {
  toolbar: boolean
  pickable: boolean
  selection: boolean
  gizmo: boolean
}

/**
 * 四个开关的旧默认值——`editable` 出现之前 `SceneViewer` 用的那一组。
 *
 * 冻结是必须的：它是垫在优先级最底下的那份「所有已发布宿主的行为」，被谁就地改一下
 * 等于一次性改掉全部宿主的默认表现，而且不报错。
 *
 * 导出它是因为**改了它就等于改了默认行为**，这种事该被断言守着：冒烟测试直接读这个
 * 常量比对，改错了立刻红，而不是等到有宿主发现工具栏没了。
 */
export const DEFAULT_SCENE_SWITCHES: Readonly<SceneSwitches> = Object.freeze({
  toolbar: true,
  pickable: false,
  selection: false,
  gizmo: false,
})

/**
 * 按「分开关 ?? 总闸 ?? 旧默认」算出四个开关的生效值。
 *
 * 三级都用 `??` 而不是 `||`：`false` 是**有效输入**（「我明确要关掉它」），
 * 用 `||` 写会让 `:editable="true"` 配 `:toolbar="false"` 里的那个 `false` 被跳过，
 * 表现是「关了工具栏，它却还在」。
 */
export function resolveSceneSwitches(input: SceneSwitchInput): SceneSwitches {
  return {
    toolbar: input.toolbar ?? input.editable ?? DEFAULT_SCENE_SWITCHES.toolbar,
    pickable: input.pickable ?? input.editable ?? DEFAULT_SCENE_SWITCHES.pickable,
    selection: input.selection ?? input.editable ?? DEFAULT_SCENE_SWITCHES.selection,
    gizmo: input.gizmo ?? input.editable ?? DEFAULT_SCENE_SWITCHES.gizmo,
  }
}
