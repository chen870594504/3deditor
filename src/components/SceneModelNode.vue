<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { TresPointerEvent } from '@tresjs/core'
import { Box3, Euler, Vector3 } from 'three'
import type { Group } from 'three'
import SceneModel from './SceneModel.vue'
import SceneModelParts from './SceneModelParts.vue'
import { deriveModelId } from '../utils/modelId'
import { registerModelNode } from '../utils/modelNodeRegistry'
import { activeEventTypes } from '../utils/eventCode'
import { CLICK_MAX_DRIFT, isClickGesture, trackPress } from '../utils/pointerClick'
import type { PressRecord } from '../utils/pointerClick'
import type { ModelBounds, ModelConfig, ModelEventType, ObjectClickPayload } from '../types'

defineOptions({ name: 'TdmSceneModelNode' })

/**
 * 场景里的**一个**模型：包裹组 + 资源 + 拾取。
 *
 * 为什么拆成独立组件而不是在 SceneContent 里 `v-for` 平铺：
 * 拾取监听器必须挂在包裹组上，而包裹组是 TresJS 创建的裸 three 对象，
 * 要拿到它就得给每个节点一个 ref。`v-for` 里的模板 ref 会变成数组，
 * 还得自己维护「第几项对应哪只组」的映射，并在增删时同步——那正是
 * 「一个模型一份状态」被拆散之后最容易写错的地方。做成组件之后，
 * 每个节点各自持有自己那只组的 `shallowRef`，与单模型时代完全一样。
 *
 * 由此也带来一个副作用是想要的：双击的「上一次点击」记录逐节点独立，
 * 在 A 模型上点两下不会与 B 模型的点击凑成一次双击。
 */
const props = defineProps<{
  model: ModelConfig
  /**
   * 最终的投射阴影开关。
   *
   * 由 SceneContent 算好再传进来：它是「全局阴影总闸 AND 物体级开关」的结果，
   * 而那个 AND 的判据属于场景级配置，重复在每个节点里算会把规则散开。
   */
  castShadow: boolean
  receiveShadow: boolean
}>()

const emit = defineEmits<{
  (e: 'loaded'): void
  (e: 'progress', percentage: number): void
  (e: 'error', message: string): void
  (e: 'objectClick', payload: ObjectClickPayload): void
  (e: 'objectDblclick', payload: ObjectClickPayload): void
  (e: 'objectPointerEnter', payload: ObjectClickPayload): void
  (e: 'objectPointerLeave', payload: ObjectClickPayload): void
  (e: 'objectContextMenu', payload: ObjectClickPayload): void
}>()

/** 内置示例几何体的构造参数（显式元组类型以匹配 TresJS 的 args 签名） */
const FALLBACK_KNOT_ARGS: [number, number, number, number] = [1, 0.32, 220, 32]

/**
 * 内置示例几何体自带的展示倾斜。
 *
 * 刻意不并进 `model.rotation` 的默认值：默认配置必须与 url 无关，
 * 否则换上一个真模型时会带着这 -0.35 / 0.6 的旋转进场。
 * 放在包裹组的内层，于是面板上读 0/0/0 与画面里的倾斜并不矛盾——
 * 那是示例几何体自己的姿态，不是物体变换。
 */
const FALLBACK_TILT = new Euler(-0.35, 0.6, 0)

// ---------- 物体变换 ----------

/**
 * 三个变换都用 Vector3 / Euler 实例而不是数组。
 *
 * 数组字面量每次求值都是新引用，Vue 的 props diff 会认为它一直在变，
 * 于是每次重渲染都往 three 对象上重写一遍；computed 只在依赖的
 * 数组元素真的变化时才重新求值，引用因此保持稳定。
 */
const modelPosition = computed(() => new Vector3().fromArray(props.model.position))
const modelRotation = computed(() => new Euler().fromArray(props.model.rotation))
const modelScale = computed(() => new Vector3().fromArray(props.model.scale))

// ---------- 物体拾取 ----------

/**
 * 包裹组用 `shallowRef`，赋值**只经由函数 ref**（模板上的 `:ref="onGroupRef"`）。
 *
 * 两个坑都在这一个写法里：
 *
 * 1. 不能用 `useTemplateRef`。它返回的是 `readonly(shallowRef(null))`，而 **readonly 是深层的**：
 *    读 `.value` 拿到的是那只 three 对象的只读代理，`addEventListener` 会在
 *    `this._listeners = {}` 处直接抛 TypeError，表现为「事件一个都绑不上」。
 *    详见 SceneContent 里对同一件事的完整说明。
 *
 * 2. 也不能用字符串 ref（`ref="modelGroup"`）+ `watch(modelGroup, …)` 去做「拿到组之后」
 *    要做的事。字符串 ref 由 Vue 在**渲染之后的 post-render 队列**里赋值，实测挂在那次
 *    变更上的 watch 一次都不会被唤起（同一只 ref 的依赖集里已经有订阅者、值也确实写进去了，
 *    回调就是不跑）；而函数 ref 是在打补丁时被**同步**调用的。
 *
 * 后者正是「点画布上的模型没反应」的成因：登记挂在 watch 里，watch 不跑，于是哪个模型
 * 都不在身份登记簿里，画布点选永远查不到人，而且哪里都不报错。
 * 因此**凡是「拿到这只组就立刻要做的事」都写在 `onGroupRef` 里同步做**，不经过任何调度。
 *
 * 它有**两个**读者，都在这只 ref 上取值，因此两处的时序要求一样（都在同步路径上）：
 * `measure()`（贴地 / 聚焦）与外面那层 `SceneContent` 的 `modelObjectOf`——后者把它交给
 * 画布级的选中视觉（包围框与变换手柄），见 `defineExpose`。
 */
const modelGroup = shallowRef<Group | null>(null)

/**
 * 包裹组的函数 ref：Vue 在打补丁时同步调用它，入参是 TresJS 建的那只裸 three 组
 * （卸载时是 null）。
 *
 * 这里做两件必须同步做完的事：
 *
 * - **登记身份**（`registerModelNode`），供画布级的点选 `ScenePicker` 反查「这只组是谁」。
 *   登记**无条件**发生，不看 `enabledEventTypes`、也不看 `visible`：画布点选恰恰要在一个
 *   `events` 全关的模型上也能用（那正是它存在的理由），拿门控去滤它就永远登记不上。
 *
 *   隐藏的模型也要登记。可见性判据只留在 `ScenePicker` 那一侧（它扫命中结果时按 `visible`
 *   跳过），这里再加一道门就是同一件事有两个出处；两处一旦不一致，表现是「隐藏的模型挡住了
 *   它后面那个、自己却又选不中」——既违反直觉又难查。
 *
 *   键是 three 对象，条目随对象回收（WeakMap），不需要在卸载时手动擦除；同一个实例换了地址时
 *   id 会覆盖成新的，也不会留下旧身份。
 *
 * - **同步监听器**（`syncPick`），理由同上一条注释里的第 2 点：只看 watch 的话，一个**挂着就
 *   已启用事件**的模型（例如从保存的配置里恢复）会一个监听器都不挂。
 *
 * 参数类型写成 `unknown` 再收窄：函数 ref 的入参由 Vue 的公开签名决定，不是 `Group`。
 */
function onGroupRef(element: unknown) {
  const group = (element ?? null) as Group | null
  modelGroup.value = group
  if (group) registerModelNode(group, props.model.id)
  syncPick()
}

/**
 * 当前启用的事件类型。空数组即「这个模型不参与拾取」。
 *
 * 它是门控的唯一来源，`attachPick` 与各 handler 都读它，不另设一套挂载条件。
 *
 * 「门控」与「这次交互算不算一次单击」是两回事，别混：门控只服务本文件，
 * 没有第二个使用者，留在计算属性里即可；而单击判据必须跨组件同源
 * （本组件与 ScenePicker 共用 `pointerClick.ts`），所以那边不放在这里。
 */
const enabledEventTypes = computed(() => activeEventTypes(props.model))

function isEnabled(type: ModelEventType): boolean {
  return enabledEventTypes.value.includes(type)
}

/**
 * 事件挂载表的变更键。
 *
 * 不能只盯「有没有启用」这样一个布尔量：从「只开单击」改成「只开双击」时
 * 布尔值不变，watch 不会重跑，挂着的还是旧的监听器组合——双击永远收不到、
 * 单击却在继续发。所以要盯住具体的类型集合。
 *
 * 与相机机位键同理，这里也不能把数组直接交给 watch：
 * `activeEventTypes` 每次都返回新数组，引用永远不等，会变成每次都重挂。
 * 拼成字符串后既能感知到集合变化，引用也稳定。
 */
const pickKey = computed(() => `${enabledEventTypes.value.join(',')}|${props.model.visible}`)

/**
 * 监听器挂在包裹组上，而不是 SceneModel 内部的 gltf.scene 上。
 *
 * 三个理由：包裹组天然是模型所有网格以及内置示例几何体的共同祖先，
 * 一处挂上就全覆盖；它不依赖 useGLTF 的加载时序（重新加载时 state 会短暂归零）；
 * 而且它是 TresJS 直接创建的裸 three 对象，不像 state.scene 那样
 * 只是「目前恰好」是 shallowRef 才没被代理包住。
 *
 * 用命令式挂载而不是模板上的 @pointerdown：TresJS 只 addEventListener、
 * 从不 removeEventListener，写在模板里的内联箭头函数会随着重渲染不断
 * 堆进 _listeners，three 只按函数引用去重，堆进去就摘不掉了。
 *
 * 三个合成事件（单击 / 双击 / 右击）共用同一条按下-抬起链路，只挂一次；
 * 经过与移出是 pmndrs 原生支持的两个事件名，各挂各的。
 */
function attachPick(group: Group) {
  if (isEnabled('click') || isEnabled('dblclick') || isEnabled('contextmenu')) {
    group.addEventListener('pointerdown', onPickDown)
    group.addEventListener('pointerup', onPickUp)
  }
  if (isEnabled('pointerenter')) group.addEventListener('pointerenter', onPointerEnter)
  if (isEnabled('pointerleave')) group.addEventListener('pointerleave', onPointerLeave)
}

/**
 * 一律摘掉全部 4 个，不按当前启用状态挑着摘。
 *
 * `removeEventListener` 对没注册过的监听器是空操作，而摘的时候
 * 配置可能已经变成另一组了（watch 回调里读到的是新值、挂上去的是旧值），
 * 照着新值挑就会漏摘。
 */
function detachPick(group: Group) {
  group.removeEventListener('pointerdown', onPickDown)
  group.removeEventListener('pointerup', onPickUp)
  group.removeEventListener('pointerenter', onPointerEnter)
  group.removeEventListener('pointerleave', onPointerLeave)
}

/**
 * 按下时刻的记录，用来把「点击」从「拖动旋转视角」里分出来。
 *
 * 形状与生成方式都由 `pointerClick.ts` 定义（`PressRecord` / `trackPress`）：
 * 同一条判据 ScenePicker 也要用，两处必须同源。
 */
let pressAt: PressRecord | null = null

/**
 * 上一次成功的单击，用来判双击。
 *
 * 判完就清空，所以三连击只会出一次双击（第二次单击用掉了记录，
 * 第三次找不到上一次，只能重新开始计数）——与 DOM 的行为一致。
 */
let lastClick: { x: number; y: number; time: number } | null = null

/**
 * 两次单击落在这个间隔内才算双击，与 pmndrs 的 dblClickThresholdMs 对齐。
 *
 * 刻意留在本文件、不并进 `pointerClick.ts`：双击是逐节点的语义
 * （见文件开头「双击的『上一次点击』记录逐节点独立」），只有这一个文件用得到。
 */
const DBLCLICK_MAX_GAP_MS = 500

/**
 * 自己合成 click，不用 pmndrs 合成的那个。
 *
 * 它的判定要求按下与抬起命中同一个 object，而 object 是命中的最深层网格：
 * 在多部件的模型上「按在盔体、松手在面罩」是很自然的手势，
 * 这种时候它直接不触发。同样的道理，它也不看位移，
 * 只要按下到抬起短于 300 毫秒就算点击——而快速小幅拖拽转视角正好落在里面。
 * pointerup 是无条件发出的，拿它加自己的阈值反而更简单也更可控。
 *
 * 双击与右击同理，pmndrs 那三个合成事件全在 up() 里、全都带着「同一个 object」
 * 的前提，所以这里三个都自己合成。
 */
function onPickDown(event: TresPointerEvent) {
  pressAt = trackPress(pressAt, event)
}

function onPickUp(event: TresPointerEvent) {
  const press = pressAt
  pressAt = null

  /**
   * 判据整条取自 `pointerClick.ts`，与 ScenePicker 同源：位移、时长两条阈值，
   * 以及「按压期间出现第二个 pointerId」「抬起时 pointerId 对不上」都算在里面，
   * 所以双指缩放 / 平移不会被误判成一次单击。
   *
   * 其中「没有按下记录就一律不抛」是正确的保守判断而不是妥协：
   * 一次真正的点击必然以「按在模型上」开始，所以缺记录只可能意味着
   * 手势是从画布别处划过来、在模型上松手的——那本来就是拖拽。
   *
   * 它也同样适用于右击，所以一并放在分流之前。
   */
  if (!isClickGesture(press, event)) return

  // 中键、侧键等一律不响应，也顺手修掉了旧版「右键也发单击」的问题
  if (event.button === 2) {
    /**
     * 右键要打断双击序列：DOM 的 dblclick 只由左键连续两次构成，
     * 「左键、右键、左键」不该被判成双击。
     */
    lastClick = null
    if (isEnabled('contextmenu')) emit('objectContextMenu', buildPayload('contextmenu', event))
    return
  }
  if (event.button !== 0) return

  /**
   * 时间戳一律取 `event.timeStamp`（原生事件上的那个），不用 `Date.now()`。
   * pmndrs 是批处理投递的：事件先在队列里攒着、在下一帧 RAF 里才被消费，
   * 用处理侧的时钟会在后台标签页恢复后算出几万毫秒的间隔，
   * 于是「两次单击」永远凑不成双击。
   */
  const previous = lastClick
  const isDouble =
    previous !== null &&
    event.timeStamp - previous.time <= DBLCLICK_MAX_GAP_MS &&
    // 两次点击之间也要落在同一小片区域，否则「模型两头各点一下」会误判成双击。
    // 这与「双击不要求命中同一个网格」并不冲突：判的是屏幕位置，不是部件。
    Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= CLICK_MAX_DRIFT

  if (isEnabled('click')) emit('objectClick', buildPayload('click', event))
  if (isDouble) {
    lastClick = null
    if (isEnabled('dblclick')) emit('objectDblclick', buildPayload('dblclick', event))
  } else {
    lastClick = { x: event.clientX, y: event.clientY, time: event.timeStamp }
  }
}

/**
 * 经过 / 移出。
 *
 * 无需自己合成：pmndrs 原生支持这两个事件名。
 * 也不用担心鼠标在模型内部各部件之间移动时狂发——它把上一帧的进入链与新链做差集，
 * 移动前后都还在同一个祖先之下时那条链一个 enter/leave 都不发，
 * 所以「进入模型」而不是「进入某个网格」这个语义是白拿的。
 *
 * 鼠标移出整个画布同样会触发 pointerleave（canvas 的 DOM leave 被转成 pointer.exit()），
 * 不需要额外处理。两个模型挨在一起时，「从 A 滑到 B」会先给 A 发 leave、再给 B 发 enter。
 */
function onPointerEnter(event: TresPointerEvent) {
  emit('objectPointerEnter', buildPayload('pointerenter', event))
}

function onPointerLeave(event: TresPointerEvent) {
  emit('objectPointerLeave', buildPayload('pointerleave', event))
}

/**
 * 5 个 handler 共用的载荷构造。
 *
 * `object` 取 `event.intersection.object` 而不是 `event.object`：
 * 后者的语义随事件类型而变——冒泡路径（按下 / 抬起）里它是命中的最深层网格，
 * 而经过 / 移出的构造函数把包裹组塞了进去。同一个字段在两类事件里指向不同的东西，
 * 宿主拿到手根本没法用。`intersection.object` 两处都是最深层网格，语义统一。
 *
 * 另外它也是非空的那个：经过 / 移出的事件对象上 `intersection` 只会在
 * 「上一帧确实进入过某个对象」时才被用于构造，所以这里不需要兜底判断。
 *
 * `id` 取的是**本节点自己**那个模型的 id —— 事件由哪个模型发出，载荷里就是谁。
 * 宿主据此分辨多模型场景里点到了哪一个，编辑器也靠它去取对应那一段事件代码。
 */
function buildPayload(type: ModelEventType, event: TresPointerEvent): ObjectClickPayload {
  const point = event.point
  return {
    type,
    id: props.model.id,
    /** 与面板上显示的一致：留空时回退成派生短名，载荷里的 name 因此永远非空 */
    name: props.model.name || deriveModelId(props.model.url),
    url: props.model.url,
    point: [point.x, point.y, point.z],
    distance: event.distance,
    object: event.intersection.object,
  }
}

/**
 * 按当前配置把监听器同步到包裹组上：先一律摘掉、再按需挂上。
 *
 * **幂等**——`removeEventListener` 对没注册过的是空操作，重复挂同一对 (type, listener)
 * 也是 three 自己按引用去重的——所以两个入口都可以直接调它，不会挂出重复的监听器：
 *
 * - `onGroupRef`：组刚拿到的那一刻（同步，见 `modelGroup` 的注释）；
 * - 下面那个 watch：配置变了（事件开关、可见性、换了模型）。
 *
 * 为什么必须有第一个入口：`onGroupRef` 的赋值发生在挂载 flush 里，挂在 `modelGroup` 上的
 * watch 不保证能看见那次变更。只留 watch 的话，一个**挂着就已启用事件**的模型（例如从保存的
 * 配置里恢复）会一个监听器都不挂，而哪里都不报错——只是「事件代码永远不执行」。
 *
 * 未启用任何事件、或模型被隐藏时不挂监听器。
 *
 * 隐藏的模型要一并摘掉：three 的射线检测不看 visible，隐藏的对象照样能被点中，
 * 也照样每帧被 raycast。关掉事件必须是真正零开销，而不是让回调早点返回。
 *
 * 代价要说清楚：只要挂了**任意一个**监听器，指针在画布上移动时就会对模型
 * 每帧做一次 raycast，所以 1/5 与 5/5 的开销完全一样，只有 0/5 才是免费的。
 * 多模型场景下这条是逐模型的：一个开了事件的模型就会让整个场景每帧多跑一遍
 * 射线检测（命中谁由 pmndrs 决定，它只把事件派给链条上挂了监听器的对象）。
 */
function syncPick() {
  const group = modelGroup.value
  if (!group) return

  detachPick(group)
  if (!props.model.visible || enabledEventTypes.value.length === 0) return
  attachPick(group)
}

watch(
  [modelGroup, pickKey],
  ([group], _previous, onCleanup) => {
    /**
     * 组刚拿到时 `onGroupRef` 已经同步过一次，这里是同一次同步的第二个入口
     * （幂等，不会挂重）；配置变化则**只有**这一条路会走到。
     */
    syncPick()
    if (!group) return

    onCleanup(() => {
      detachPick(group)
      pressAt = null
      lastClick = null
    })
  },
  { immediate: true },
)

// ---------- 尺寸测量 ----------

/**
 * 量一次这个模型的世界包围盒。
 *
 * 返回值为 null 必须被当成「现在量不了」，而不是「尺寸是零」——两种来源：
 *
 * 1. 包裹组还没挂上，或 glTF 还没加载完。资源加载走 `useAsyncState`（shallow），
 *    加载期间 `state.value` 是 null，而 `SceneModel` 是 `<primitive v-if="state">`，
 *    于是那一刻包裹组底下没有任何网格，Box3 是个空盒。
 * 2. 顶点里含 NaN。这一条**必须单独查**：`isEmpty()` 判的是 `max < min`，
 *    而 NaN 参与的比较恒为 false，一个 NaN 顶点会让括号组一路返回 false，
 *    把 NaN 原样放出去。调用方拿它做 `-min.y` 之类的运算就会得到 -Infinity，
 *    写进配置之后是 JSON 导出变 null、矩阵变 NaN、物体直接不见。
 *
 * **`position.y` 的增量等于世界 y 的增量**，这是返回值能当「离地多高」用的前提，
 * 而它依赖包裹组的父级是场景根（单位矩阵）——TresJS 的父子关系由 Tres 节点
 * 上下文决定，模板里嵌套什么都不会成为包裹组的祖先，`#scene` 插槽的内容
 * 也只是兄弟节点，所以当前场景图下这个前提成立。哪天真有宿主用 useTresContext
 * 给 Scene 本身加了变换，贴地就会永远差一点点，且哪里都不报错。
 *
 * 默认的 `precise = false`（几何体自身包围盒 → 应用 matrixWorld → 求并集）
 * 在旋转过的非盒状几何体上偏**保守**，算出的盒子比真实顶点盒略大，
 * 后果是贴地后略微悬空而不是陷进地面——方向是安全的，不要为「更准」
 * 改成 true：那要逐顶点迭代，大模型上是一次几十万次的循环。
 *
 * 测量**不看** `object.visible`：隐藏的模型照样量得出来，所以「先隐藏、
 * 贴地、再显示」是通的。这是想要的，别当 bug 修。
 */
function measure(): ModelBounds | null {
  const group = modelGroup.value
  if (!group) return null

  const box = new Box3().setFromObject(group)
  const { min, max } = box
  if (box.isEmpty()) return null
  if (!Number.isFinite(min.x) || !Number.isFinite(min.y) || !Number.isFinite(min.z)) return null
  if (!Number.isFinite(max.x) || !Number.isFinite(max.y) || !Number.isFinite(max.z)) return null

  return {
    min: [min.x, min.y, min.z],
    max: [max.x, max.y, max.z],
  }
}

/**
 * 对外只有两件东西：量一次尺寸，以及把包裹组本身交出去。
 *
 * `group` 是给画布级选中视觉（包围框 / 变换手柄）用的。直接暴露这只 `shallowRef`
 * 而不是暴露一个取值函数：暴露出去的代理会**自动解包 ref**，于是外面读到的
 * 就是裸的 three 组，而且读它会正常建立依赖——组一挂上，外面那个 computed 就重算。
 * 包成一个 `() => group.value` 的函数反而会丢掉这份依赖，组挂了外面也不知道。
 *
 * 反过来说，这也是它必须挂在**这一层**的原因：包裹组只在 `onGroupRef` 里出现一次，
 * 谁也别想绕开组件去场景里 `getObjectByName` 找一个 three 对象。
 */
defineExpose({ measure, group: modelGroup })
</script>

<template>
  <!--
    物体变换的包裹层。
    它自己永远渲染，模型与内置示例只在它内部**三选一**——
    如果把 v-if 放在这一层，切换可见性就变成了重新挂载，
    而重新挂载会真的再发一次网络请求去加载 glTF。
    可见性因此只走 :visible。
  -->
  <TresGroup
    :ref="onGroupRef"
    :position="modelPosition"
    :rotation="modelRotation"
    :scale="modelScale"
    :visible="model.visible"
  >
    <SceneModel
      v-if="model.url"
      :key="model.url"
      :path="model.url"
      :wireframe="model.wireframe"
      :draco="model.draco"
      :repeat="model.repeat"
      :cast-shadow="castShadow"
      :receive-shadow="receiveShadow"
      @loaded="emit('loaded')"
      @progress="emit('progress', $event)"
      @error="emit('error', $event)"
    />

    <!--
      由一段 JSON 零件表程序生成的几何体（`ModelConfig.partsJson`）。

      **排在 `url` 之后**：两个几何体来源互斥时以 `url` 为准，顺序就是这条约定的
      全部（理由写在 `ModelConfig.partsJson` 上）。左栏追加时按的是同一个顺序，
      两边一旦不同序，画面与「配置里写的」会各说各话，且哪里都不报错。

      `:key` 是功能必需的：换一段 JSON 就是**换一件东西**，而这里是同一只组件
      换了 props。带 key 让它整个重挂，几何体与材质一起重来；不带 key 就得指望
      TresJS 在 `args` 变化时正确重建每一个几何体（`args` 变了要重建、只是
      重设属性没有意义），那是另一条要赌的路。与上面 `SceneModel` 的 `:key="model.url"`
      是同一个手法、同一个理由。

      它拿不到 `emit('loaded')`：程序生成的几何体是同步出来的，没有加载可言。
      于是「加载中」那个状态不该为它亮起来——`addModel('')` 里已经处理了这件事
      （空地址不点亮加载态），见 `stores/scene.ts`。
    -->
    <SceneModelParts v-else-if="model.partsJson" :key="model.partsJson" :json="model.partsJson"
      :wireframe="model.wireframe" :cast-shadow="castShadow" :receive-shadow="receiveShadow" />

    <!-- 未指定模型时的内置示例，保证组件开箱即用 -->
    <TresGroup v-else :rotation="FALLBACK_TILT">
      <TresMesh :cast-shadow="castShadow" :receive-shadow="receiveShadow">
        <TresTorusKnotGeometry :args="FALLBACK_KNOT_ARGS" />
        <TresMeshStandardMaterial
          color="#5eead4"
          :wireframe="model.wireframe"
          :roughness="0.25"
          :metalness="0.55"
        />
      </TresMesh>
    </TresGroup>
  </TresGroup>
</template>
