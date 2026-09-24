<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useTresContext } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import { Plane, Raycaster, Spherical, Vector2, Vector3 } from 'three'
import type { Object3D, PerspectiveCamera, Vector3 as Vector3Type } from 'three'
import SceneFloorplan from './SceneFloorplan.vue'
import SceneGround from './SceneGround.vue'
import SceneModelNode from './SceneModelNode.vue'
import SceneShadows from './SceneShadows.vue'
import SceneSkybox from './SceneSkybox.vue'
import SceneSun from './SceneSun.vue'
import { viewModeOf } from '../utils/viewMode'
import type {
  CameraChangePayload,
  CameraConfig,
  FloorplanConfig,
  GroundConfig,
  ModelBounds,
  ModelConfig,
  ObjectClickPayload,
  ShadowConfig,
  SunConfig,
} from '../types'

defineOptions({ name: 'TdmSceneContent' })

/**
 * 这一层位于 TresCanvas 内部。
 * 所有状态都由 SceneViewer 以 props 传入，这里不访问 Pinia，
 * 让 3D 层保持纯函数式、可单独测试，也避免依赖 TresCanvas 内部的注入链。
 *
 * 模型的渲染与拾取下放给了 SceneModelNode（每个模型一个），这里只剩
 * 相机、光照、地面、阴影这些**场景级**的东西，以及一个跨模型共享的阴影烘焙。
 */
const props = defineProps<{
  models: ModelConfig[]
  floorplan: FloorplanConfig
  camera: CameraConfig
  ground: GroundConfig
  sun: SunConfig
  shadow: ShadowConfig
  /** 机位过渡时长（毫秒），0 表示瞬移。见下面「机位过渡」一节 */
  cameraTransition: number
}>()

const emit = defineEmits<{
  (e: 'loaded'): void
  (e: 'progress', percentage: number): void
  (e: 'error', message: string): void
  (e: 'cameraChange', payload: CameraChangePayload): void
  (e: 'objectClick', payload: ObjectClickPayload): void
  (e: 'objectDblclick', payload: ObjectClickPayload): void
  (e: 'objectPointerEnter', payload: ObjectClickPayload): void
  (e: 'objectPointerLeave', payload: ObjectClickPayload): void
  (e: 'objectContextMenu', payload: ObjectClickPayload): void
}>()

// ---------- 相机 ----------

/**
 * three 对象的模板 ref 一律用 `shallowRef` + **同名**的模板 ref 属性，
 * 绝不用 `useTemplateRef`。
 *
 * `useTemplateRef` 返回的是 `readonly(shallowRef(null))`（Vue 3.5 为了防住
 * 「宿主往模板 ref 上赋值」而加的壳），而 **readonly 是深层的**：读 `.value`
 * 拿到的不是那只 three 对象，而是它的只读代理，连内部的 `Vector3`、`_listeners`
 * 也一并被包住。后果按严重程度排：
 *
 * 1. `group.addEventListener(...)` 直接抛 TypeError——three 的实现是
 *    `this._listeners = {}` 起手，赋值被 readonly 吞掉后紧接着读它的属性。
 *    表现为「事件一个都绑不上」，而不是慢或不准。
 * 2. `camera.position.fromArray(...)`、`light.shadow.map = null` 这类写入
 *    被静默丢弃（dev 下附一条 `Set operation on key ... failed: target is readonly`），
 *    功能整个不生效却不报错。
 *
 * `shallowRef` 不做任何包装，`.value` 就是 TresJS 创建的那只裸对象。
 * 名字必须与模板上的 `ref="xxx"` 逐字相同——字符串 ref 是按 setup 绑定名解析的。
 */
const tdmCamera = shallowRef<PerspectiveCamera | null>(null)

/** cientos 的 OrbitControls 通过 expose 暴露底层 three 实例 */
const tdmControls = shallowRef<{
  instance: { target: Vector3Type; update: () => void }
} | null>(null)

/**
 * 只在创建时使用一次的初始值。
 *
 * 为什么相机与注视点不走响应式绑定：`@change` 在 autoRotate 或阻尼开启时
 * 每帧都发，而 OrbitControls 又会在 update() 里写回 camera.position。
 * 如果位置是 props 绑定，Vue 每次重渲染都可能把它按配置再覆盖一遍，
 * 表现就是「拖不动」或者松手后被弹回。
 *
 * 这里用一个引用恒定的数组让它们在创建时各落地一次，
 * 之后所有变更都由下面的 syncCamera 命令式写入——
 * 只有配置真的变了才动相机，拖动期间配置不变，两者不会互相打架。
 *
 * 引用恒定是关键：Vue 的 props diff 用 Object.is 比较，
 * 换成每次渲染新建的数组字面量就会变成「每帧重置相机」。
 *
 * 用 Vector3 而不是数组：TresJS 的全局组件类型把 position 这类 prop
 * 标注为严格的 THREE 对象，数组只在运行时可用、类型上不接受。
 */
const initialCameraPosition = new Vector3(...props.camera.position)
const initialCameraTarget = new Vector3(...props.camera.target)

/**
 * 用字符串做变更键，而不是直接把数组交给 watch。
 *
 * `config.camera.position` 是 reactive 代理，引用恒定，
 * 直接 watch 它永远只会触发一次；展开成新数组又会在每次求值时都判定为「变了」。
 * 拼成字符串后既能感知到元素级改动，也能量到整组替换。
 */
const cameraPoseKey = computed(
  () => `${props.camera.position.join()}|${props.camera.target.join()}`,
)

/**
 * 现在这一档算不算 2D 正俯视 —— 户型图的墙按它换外观。
 *
 * **判据住在库里**（`viewModeOf`，与编辑器那枚 2D/3D 按钮用的是同一个函数）。
 * 这里算、不往上要一个 prop，是因为机位本来就在这一层：档位是**从机位推导**的
 * （没有独立的布尔量，见 `useViewMode.ts` 的文件头），多一个 prop 就是多一个
 * 可能与机位对不上的真相。
 *
 * 只吃 `props.camera` 这一个依赖，所以它与 `cameraPoseKey` 同步更新；
 * 切档时的过渡动画（下面「机位过渡」那节）会让它在飞行途中翻一次档，
 * 翻的那一下墙从贴面直接变成实色——这是有意的，档位就该跟着机位走，
 * 而不是等动画落地才认账（否则会出现「画面已经俯视、墙还铺着贴面」的半途状态）。
 */
const planView = computed(() => viewModeOf(props.camera) === '2d')

/**
 * 把一对机位写进相机与轨道控制。
 *
 * 末尾的 update() 是必要的：target 变了但相机没动时，
 * 只有 controls.update() 才会重新让相机朝向新的注视点。
 * 代价是超出 min/maxDistance、min/maxPolarAngle 的值会被静默夹回，
 * 编辑器侧的输入控件需要自己带上同样的约束。
 *
 * 收两只 Vector3 而不是两个数组，是因为飞行每帧都要写一次：
 * 走数组就得每帧再建两个。暂存对象一律由调用方持有，这里只读不存。
 */
function writePose(position: Vector3Type, target: Vector3Type) {
  const camera = tdmCamera.value
  if (!camera) return
  camera.position.copy(position)

  const controls = tdmControls.value?.instance
  if (!controls) return
  controls.target.copy(target)
  controls.update()
}

/**
 * 配置里那一对机位写进相机之前的暂存。
 *
 * 复用一个对象而不是每次现建：飞行每帧都要走一次，每帧两个 Vector3
 * 是纯垃圾。
 */
const configPosition = new Vector3()
const configTarget = new Vector3()

/**
 * 把配置里的机位**原样**写进相机。
 *
 * 它是瞬移的全部实现，也是飞行的收口：飞行中途每帧写的是插值出来的机位，
 * 只有落地那一帧回到这里、用配置里的原值再写一遍——球坐标往返带着
 * 1e-16 量级的浮点误差，而「停下来之后相机与配置逐位相同」
 * 是别处依赖的性质（`captureCamera` 的去重、面板读数、2D 那次两次写入）。
 */
function applyConfigPose() {
  writePose(
    configPosition.fromArray(props.camera.position),
    configTarget.fromArray(props.camera.target),
  )
}

// ---------- 机位过渡 ----------

/**
 * 机位改动时相机是滑过去还是瞬移。
 *
 * **飞行不改配置。** 配置在点下去那一刻就已经是终点，动的只有相机：
 * 于是按钮高亮、右栏读数、历史记录立刻都是终点的样子，只有画面在后面追。
 * 反过来做——把插值中途的机位逐帧写进配置——「2D」那一段要飞到快结束才亮起来，
 * 而一份在飞行途中导出的配置会停在半路的机位上。
 *
 * 参数化用**球坐标**（半径 / 极角 / 方位角），不是位置线性插值：
 * 约束（min/max distance、min/max polar）在球坐标里是一组单坐标区间，
 * 两端都在区间里时整条路径都在区间里；线性插值会「抄近路」——两个半径相同的
 * 点连成直线后离球心更近，飞到一半撞上 minDistance，画面上是中途卡一下。
 */

/** 起点与终点贴得比这还近就当作没动 */
const FLIGHT_EPSILON = 1e-3

/**
 * 「贴到极点上了」的判据。
 *
 * 方位角是绕竖直轴的转角，机位落在竖直轴上时它没有意义——转多少度都是同一点。
 * 取 1e-3 弧度（0.057°）是因为真正贴极的只有两种情况：配置里写死的正上方
 * （`sin` 恰好是 0），以及 `Spherical.makeSafe()` 夹出来的 1e-6 量级偏移；
 * 而 0.057° 在任何场景里都与「正上方」看不出区别。
 */
const POLE_EPSILON = 1e-3

/** 把角度折进 (-π, π]，两个方位角之间因此自然走短弧 */
function shortenAngle(angle: number) {
  const turn = Math.PI * 2
  return (((angle + Math.PI) % turn) + turn) % turn - Math.PI
}

/**
 * 用户是否要求减少动效。
 *
 * 在**起飞前**问一次，而不是在 setup 里存成一个常量：库会被 `renderToString`
 * 渲染一遍（冒烟测试就是这么跑的），那时候没有 window。
 */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** 一次飞行。全是数字与几只 Vector3，不引用任何响应式对象 */
interface Flight {
  fromRadius: number
  fromPhi: number
  fromTheta: number
  toRadius: number
  toPhi: number
  /** 终点的方位角 = fromTheta + thetaDelta，增量已经取过短弧 */
  thetaDelta: number
  fromTarget: Vector3Type
  toTarget: Vector3Type
  startedAt: number
  duration: number
}

let flight: Flight | null = null
let flightFrame = 0

const fromSpherical = new Spherical()
const toSpherical = new Spherical()
const flightOffset = new Vector3()
const flightFromTarget = new Vector3()
const flightToTarget = new Vector3()
const flightTarget = new Vector3()

function stopFlight() {
  if (flightFrame !== 0) cancelAnimationFrame(flightFrame)
  flightFrame = 0
  flight = null
}

/**
 * 一帧。位置与注视点各自插值，再合成回世界坐标。
 *
 * 缓动用 smoothstep（两端导数为零）：线性起步与急停看起来都像「弹」了一下。
 * 进度由 rAF 给的时间戳算，不自己累加——掉帧时按真实时长推进，
 * 整段过渡的墙钟时间因此恒定。
 */
function stepFlight(now: number) {
  const current = flight
  if (!current) return

  const progress = Math.min(Math.max((now - current.startedAt) / current.duration, 0), 1)
  const eased = progress * progress * (3 - 2 * progress)

  flightTarget.lerpVectors(current.fromTarget, current.toTarget, eased)

  flightOffset
    .setFromSphericalCoords(
      current.fromRadius + (current.toRadius - current.fromRadius) * eased,
      current.fromPhi + (current.toPhi - current.fromPhi) * eased,
      current.fromTheta + current.thetaDelta * eased,
    )
    .add(flightTarget)

  writePose(flightOffset, flightTarget)

  if (progress < 1) {
    flightFrame = requestAnimationFrame(stepFlight)
    return
  }

  stopFlight()
  applyConfigPose()
}

/**
 * 把球坐标夹进配置自己那几条约束里。
 *
 * 算式与 `OrbitControls.update()` 里那三句逐字一致（极角夹、`makeSafe`、半径夹），
 * 为的是「夹完的东西」与「update() 会认为合法的东西」一字不差。
 *
 * **为什么要在起飞前夹一次，而不是让每帧的 update() 去夹。** 约束在球坐标里
 * 是一组单坐标区间：两端都夹进区间之后，半径与极角各自在两个合法值之间走，
 * 整条路径就都在区间里，`update()` 因此一次都拧不动我们写下去的机位。
 * 不夹的后果是**路径的形状变了**——插值中超限的那段会被逐帧夹回边界。
 * 具体场景只有一条，但从 2D 回 3D 必然撞上：2D 那一步把「最低仰角」按到了 0，
 * 回来时它是跟机位**同一次写入**还原的，于是起点在正上方（极角 0）、
 * 终点在地平线上 30°、下限却已经是 45°。不夹时前 60% 的插值都在下限以下、
 * 一律被按在 45° 上：半径与注视点照常走（相机平移着靠近），
 * 唯独抬头那一段被压到最后三分之一，看起来是先平着滑过去、再猛地立起来。
 * 夹一次，抬头就摊在整段过渡里，与另外两个坐标同步。
 *
 * 代价是起点可能不是相机**此刻**的位置——被夹掉的正是它违反约束的那一段，
 * 所以第一帧会跳一下。这一跳不夹也在（那一帧本来就非法、会被 `update()` 夹回来），
 * 两者的差别只在**之后**那一段是摊开的还是挤在一头的。
 */
function clampToLimits(spherical: Spherical) {
  const { minPolarAngle, maxPolarAngle, minDistance, maxDistance } = props.camera
  spherical.phi = Math.max(minPolarAngle, Math.min(maxPolarAngle, spherical.phi))
  spherical.makeSafe()
  spherical.radius = Math.max(minDistance, Math.min(maxDistance, spherical.radius))
}

/**
 * 试一次起飞，返回 false 表示这一趟该瞬移。
 *
 * 起点取的是**活的机位**而不是上一次写进去的机位，这一条很关键：
 * 连着改两次自然是两段首尾相接的飞行（而不是从头再飞一遍），
 * 飞行途中撤销、或者面板里手填一个数，也不会先跳回去再飞过来。
 */
function armFlight(camera: PerspectiveCamera, controls: { target: Vector3Type }) {
  const duration = props.cameraTransition
  if (!(duration > 0) || prefersReducedMotion()) return false

  configPosition.fromArray(props.camera.position)
  configTarget.fromArray(props.camera.target)

  /*
   * 起点即终点就不飞。
   * 拖动视角松手后的回写走的正是这一条（库把活的机位原样写回配置），
   * 不挡的话，在轴上按一下没拖动也会换来 450ms 的无效飞行。
   */
  const epsilonSquared = FLIGHT_EPSILON * FLIGHT_EPSILON
  if (
    camera.position.distanceToSquared(configPosition) < epsilonSquared &&
    controls.target.distanceToSquared(configTarget) < epsilonSquared
  ) {
    return false
  }

  // 起点：活的机位相对活的注视点
  fromSpherical.setFromVector3(flightOffset.copy(camera.position).sub(controls.target))
  // 机位与注视点重合时方向没有意义（面板里手填出一对相同的数就会遇到）
  if (fromSpherical.radius < 1e-6) return false

  // 终点：配置里的机位相对配置里的注视点
  toSpherical.setFromVector3(flightOffset.copy(configPosition).sub(configTarget))

  const fromAtPole = Math.abs(Math.sin(fromSpherical.phi)) < POLE_EPSILON
  const toAtPole = Math.abs(Math.sin(toSpherical.phi)) < POLE_EPSILON

  let fromTheta = fromSpherical.theta
  let thetaDelta = 0

  if (fromAtPole || toAtPole) {
    /*
     * 贴极那一端的方位角没有意义，就取**不贴极那一段**的方位角，让整段飞行
     * 待在一个竖直平面里；两端都贴极时取起点的（等价于不转）。
     *
     * 不做这一步的后果很具体：2D 档的机位是正上方，那里的偏移是 (0, d, 0)，
     * `atan2(0, 0)` 给出 0——于是从 -Z 一侧进 2D 时方位角会「走短弧」从 π 转到 0，
     * 画面上是一边下降一边水平转 180°，地平线跟着打转。
     */
    fromTheta = toAtPole ? fromSpherical.theta : toSpherical.theta
  } else {
    thetaDelta = shortenAngle(toSpherical.theta - fromSpherical.theta)
  }

  /*
   * 夹在极点判定**之后**：贴极时方位角取的是另一端的方位角（见上），
   * 而夹取会把「贴极」这件事本身抹掉——下限 45° 一夹，正上方就成了 45°，
   * `sin(phi)` 也不再接近 0。顺序反了的话，从正上方回 3D 会走成
   * 「一边升起一边水平转 180°」，正是上面那段要避免的画面。
   */
  clampToLimits(fromSpherical)
  clampToLimits(toSpherical)

  flightFromTarget.copy(controls.target)
  flightToTarget.copy(configTarget)

  flight = {
    fromRadius: fromSpherical.radius,
    fromPhi: fromSpherical.phi,
    fromTheta,
    toRadius: toSpherical.radius,
    toPhi: toSpherical.phi,
    thetaDelta,
    fromTarget: flightFromTarget,
    toTarget: flightToTarget,
    startedAt: performance.now(),
    duration,
  }

  flightFrame = requestAnimationFrame(stepFlight)
  return true
}

/**
 * 把配置写进相机与轨道控制：能飞就飞，不能飞就瞬移。
 *
 * **每次写入都从这里重新起飞**，起点是当前活的机位，所以两次改动之间
 * 不会出现「先跳到上一次的终点、再从那里飞」这种多余的位移。
 */
function syncCamera() {
  stopFlight()

  const camera = tdmCamera.value
  const controls = tdmControls.value?.instance
  if (camera && controls && armFlight(camera, controls)) return

  applyConfigPose()
}

watch([tdmCamera, tdmControls, cameraPoseKey], syncCamera, { immediate: true })

/**
 * 用户开始操作视角（按下指针、滚一格滚轮都会走到这里）。
 *
 * 有飞行在跑时**不是取消它，而是让它立刻落地**。
 *
 * 停在半路会留下一个谁都不认的机位：配置说的是终点、画面上是半路，
 * 而紧接着那次 `@end` 还会把半路这个机位写回配置——点一下 2D 却停在了半路，
 * 历史里还多一条。滚一格滚轮就会走到这条路上：three-stdlib 的 `onMouseWheel`
 * 是无条件派发 start / end 的，点击也一样。
 *
 * 落地之后再把手交给用户，拖拽从终点开始：动作要么没发生、要么走完。
 */
function onControlsStart() {
  if (!flight) return
  stopFlight()
  applyConfigPose()
}

/**
 * 只在拖动结束时读回，不用 @change。
 *
 * autoRotate 或阻尼开启时 @change 每帧都发，跟着它回写会让面板数字持续跳动，
 * 而且 update() 会把半径和极角夹到合法区间，读数会来回抖。
 */
/**
 * 读出当前机位。
 *
 * 拖动结束（`@end`）时自动回写配置，但自动旋转开着的时候相机一直在动、
 * 永远不会 `end`，所以还需要一个能主动取一次的入口。
 * 暴露成方法而不是持续同步：每帧回写会让面板上的数字一直跳。
 *
 * 它**不**参与下面那一道去重：调用它的是用户显式点的一次动作
 * （右栏的「抓取当前视角」），哪怕机位与上一次一样，也该照做并留下记录。
 */
function captureCamera(): CameraChangePayload | null {
  const camera = tdmCamera.value
  if (!camera) return null

  const target = tdmControls.value?.instance.target

  return {
    position: camera.position.toArray() as [number, number, number],
    target: target
      ? (target.toArray() as [number, number, number])
      : ([...props.camera.target] as [number, number, number]),
  }
}

/**
 * 上一次真的发出去的机位键，用来挡掉「拖动结束但其实没动」的那些 end。
 * 初值是空串，而键永远形如 `a,b,c|d,e,f`，所以第一次一定发得出去。
 */
let lastEmittedPose = ''

/**
 * 机位键：与上面的 `cameraPoseKey` 同一种写法。
 * `[x, y, z]` 是 reactive 数组、引用恒定，展开成字符串才比得出元素级改动。
 */
function poseKey(pose: CameraChangePayload): string {
  return `${pose.position.join()}|${pose.target.join()}`
}

function onControlsEnd() {
  const pose = captureCamera()
  if (!pose) return

  /**
   * 机位与上一次发出的完全一样时不再发。
   *
   * OrbitControls 的 `onPointerUp` 是**无条件**派发 end 的（three-stdlib 的
   * OrbitControls 里 `scope.dispatchEvent(endEvent)`，不看这一次按下到底动没动），
   * 于是在画布上随便点一下都会走到这里一次。机位没变时回写是空 diff
   * （历史栈不受影响），但宿主收到事件就会打一行「视角已更新」——
   * 点击变成高频动作之后，那行噪音会盖掉真正的操作回执。
   *
   * 去重只加在这一条路径上：下面暴露出去的 `captureCamera()` 是用户
   * 显式点的一次动作（右栏的「抓取当前视角」），照旧无条件回写与派发。
   */
  const key = poseKey(pose)
  if (key === lastEmittedPose) return
  lastEmittedPose = key

  emit('cameraChange', pose)
}

// ---------- 模型测量 ----------

/** 一个模型节点对外提供的能力：量一次尺寸，以及把它那只包裹组交出来 */
interface ModelNodeHandle {
  measure: () => ModelBounds | null
  /** 组还没挂上（或已卸载）时是 null */
  group: Object3D | null
}

/**
 * 「一个模型节点能提供什么」这件事的能力形状。
 *
 * 用结构化判据（有没有 measure 这个方法）而不是 `instanceof`：
 * `ComponentPublicInstance` 的静态类型里并没有 `measure` 这个成员，
 * 类型收窄只能靠这里的类型谓词自己完成。
 *
 * `group` 是节点里那只包裹组，给画布级的选中视觉（包围框 / 变换手柄）用，
 * 与 `measure` 同一条来路——都出自 SceneModelNode 那一个 `defineExpose`。
 */
function isMeasurer(value: unknown): value is ModelNodeHandle {
  return typeof (value as { measure?: unknown } | null)?.measure === 'function'
}

/**
 * 按模型 id 索引的测量句柄。
 *
 * 为什么不走「`scene.getObjectByName(model.id)`」那条更短的路：那等于把
 * 「哪个 three 对象是哪个模型」这件事编码进 `name` 字符串，而 `name` 是
 * three 的公共可写字段，宿主通过 `#scene` 插槽塞进来的任何东西都能设置它。
 * 用 id 做键，这份对应关系只有一份来源。
 *
 * 用 `shallowRef` 装 Map、每次换一个新 Map，是为了让「谁能测量、谁还不一定」
 * 这件事**可被追踪**：调用方常要拿它算一个 `computed`（例如「模型还没就位时
 * 那颗按钮该是灰的」），而原地 `set` 一个普通 Map 不会触发任何重算——
 * 那个 computed 会一直停在挂载前那次求值的 false 上，按钮永远点不动，
 * 而且只在「内置示例几何体」这条不加载资源的路径上才露出来。
 * 代价只是节点增删时拷一份小表。
 */
const measurers = shallowRef(new Map<string, ModelNodeHandle>())

/**
 * 函数 ref 的落点。
 *
 * 这里**只能存句柄，绝不能顺手量一次**：函数 ref 是渲染期间**同步**调用的，
 * 而子组件自己那句 `ref="modelGroup"` 走的是 post-render 队列任务——
 * 此刻 `modelGroup.value` 还是 null，量出来必然是 null。
 *
 * 传进来 null 表示节点卸载，删掉即可。函数 ref 每次渲染都是新身份，
 * patch 尾部会无条件再调一次（传的是同一个实例），所以下面按「同一只句柄就跳过」
 * 挡了一道——语义上是幂等的，但**不能靠无条件重建 Map 来实现幂等**，理由见那里；
 * 而列表重排走的是 move 分支，不触发 unmount。
 */
function registerNode(id: string, el: Element | ComponentPublicInstance | null): void {
  const current = measurers.value
  const previous = current.get(id)

  /**
   * 表没变就**不写**。
   *
   * 这不是省一次拷贝，而是唯一挡住渲染自循环的东西：函数 ref 在**每次渲染末尾**
   * 都会被再调一次（`bindNode` 每次渲染返回新函数，patch 里先以 null 调旧的、
   * 再以同一个实例调新的），于是「照原样重建一只新 Map 再赋回去」会让所有读这张表
   * 的 computed 每次渲染都被判脏——而其中就有 `ModelActions` 那颗「贴地 / 聚焦
   * 可不可点」的 computed。它一脏就重渲染，重渲染又走一遍函数 ref……在一次 flush 里
   * 转够 100 圈，Vue 就抛 `Maximum recursive updates exceeded in component
   * <ModelActions>`，开发期还会被 Vite 当成运行时错误弹出一层**盖住整张画布**的浮层——
   * 表现正是「点画布没反应」。
   *
   * 判据取「同一只句柄」：`isMeasurer` 的落点就是组件实例，同一个模型的实例在整个
   * 生命周期里是同一只，重新渲染不会换；真换了实例（改 url / 重新挂载）自然不等。
   */
  if (isMeasurer(el)) {
    if (previous === el) return
    const next = new Map(current)
    next.set(id, el)
    measurers.value = next
    return
  }

  if (!current.has(id)) return
  const next = new Map(current)
  next.delete(id)
  measurers.value = next
}

/**
 * 模板里只写 `:ref="bindNode(model.id)"`，箭头函数留在 TS 这一侧。
 *
 * 模板表达式里写不出参数的类型标注，`strict` 下 `el` 会退化成隐式 any——
 * 而这只在 vue-tsc 里报错、vite 跑得起来，很容易漏掉。
 * 同时也不能写成内联箭头：那样每次渲染都是新函数，虽然能用，但没有任何好处。
 */
function bindNode(id: string) {
  return (el: Element | ComponentPublicInstance | null) => registerNode(id, el)
}

/**
 * 量指定模型的世界包围盒，量不了时返回 null。
 *
 * 暴露成「按 id 取一次」而不是把测量结果做成响应式状态：包围盒只在几何与变换
 * 变化时才变，而变换每拖一下都在变，做成状态等于每次拖动都要遍历整棵子树。
 * 由调用方在自己需要的那一刻取一次，代价最清楚。
 *
 * 读的是 `measurers` 这只 shallowRef 的当前值，因此调用方若在 computed 里调它，
 * 「节点挂上 / 卸下」会被记成依赖——这正是上面那段注释要的效果。
 */
function measureModel(id: string): ModelBounds | null {
  return measurers.value.get(id)?.measure() ?? null
}

/**
 * 取某个模型的包裹组（three 对象），取不到时返回 null。
 *
 * 给画布级的选中视觉用：包围框要有一个物体可贴，变换手柄要有一个物体可拖。
 * 与 `measure` 恰好相反——那条路交出一份**算好的数字**，这条交出一只**活的对象**，
 * 因为手柄要直接改它的 `position` / `rotation` / `scale`。
 *
 * 与 `measureModel` 一样读的是 `measurers` 这只 shallowRef 的当前值，所以在
 * `computed` 里调它就能把「节点挂上 / 卸下」记成依赖——调用方正是这么用的。
 *
 * 这里返回的是 three 的**裸对象**（包裹组是 TresJS 创建的，没有经过任何响应式包装），
 * 外面可以放心地直接改它的变换。
 */
function modelObjectOf(id: string): Object3D | null {
  return measurers.value.get(id)?.group ?? null
}

// ---------- 屏幕坐标 → 地面坐标 ----------

/**
 * 取 `camera` / `renderer` 是**这个组件成为第二个 `useTresContext` 消费者**的原因。
 *
 * 做这件事需要两样东西：当前生效的相机，以及画布元素的 `getBoundingClientRect()`。
 * 两者都只有TresCanvas 内部拿得到——`ScenePicker.vue` 先走了一步，这里是第二处。
 * （README 里那句「全仓库唯一的 useTresContext 消费者」要跟着改。）
 *
 * 为什么不自己 `document.querySelector('canvas')`：一个页面上可能挂着多个
 * 画布（宿主自己的 + 我们的），那样会量到错的那个，而且错得**不报错**——
 * 射线落在地上会整体偏移一个画布的位置。
 */
const { camera: tresCamera, renderer } = useTresContext()

/**
 * 一套复用的射线工具，不每次调用新建。
 *
 * `groundPointAt` 会被指针每移动一下调一次（画墙时的橡皮筋就靠它），
 * 每次新建三个对象是纯粹的垃圾。三者都是无状态的中间量，跨次复用没有副作用。
 */
const groundRaycaster = new Raycaster()
const groundPointer = new Vector2()
const groundHit = new Vector3()

/**
 * 地面平面：`y = 0`，法线朝上。
 *
 * 平面图的一切都长在这个平面上（`FloorplanPoint` 的 y 恒为 0），
 * 所以「指针落在地面的哪一点」就是它与这条射线的交点。
 */
const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0)

/**
 * 把屏幕坐标换算成地面平面上的 `[x, z]`，落不到时返回 `null`。
 *
 * 库在这一层只回答「这一点对应地面的哪个位置」这一个问题，**不发事件、
 * 不认识绘制工具、也不知道户型图**：怎么用（画墙？拉地基？什么都不做）
 * 是编辑器的事，与 `measureModel` 是同一条分界线。
 *
 * 三处返回 `null` 都是真实会发生的，一律让调用方自己决定怎么办：
 * 相机或画布还没就绪、画布还没尺寸（隐藏中的视口）、
 * 以及**视线与地面平行**（贴着地平线看时，射线永远碰不到地面）。
 * 最后一条尤其不能回退成「取射线上某个点」——那会画出一道飞到天边的墙。
 *
 * 不设 `near` / `far`：那两个只参与 `intersectObject` 的物体过滤，
 * 而这里走的是 `Ray.intersectPlane`，与它们无关。
 * （`ScenePicker` 那边要设，是因为它做的是真的物体射线检测。）
 */
function groundPointAt(clientX: number, clientY: number): [number, number] | null {
  const activeCamera = tresCamera.activeCamera.value
  const canvas = renderer.instance?.domElement
  if (!activeCamera || !canvas) return null

  /*
   * 自己算 NDC，公式与 `ScenePicker.vue` 那一份**逐字相同**——两者一旦漂移，
   * 表现是「点在画布上是准的，落到地上就偏了」，而且很难看出是哪里偏。
   * 用 CSS 像素（`getBoundingClientRect()`），不乘 `devicePixelRatio`。
   */
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null

  groundPointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )

  groundRaycaster.setFromCamera(groundPointer, activeCamera)

  // intersectPlane 在「射线与平面平行」和「交点在射线反向」两种情况下都返回 null
  const hit = groundRaycaster.ray.intersectPlane(GROUND_PLANE, groundHit)
  if (!hit) return null

  return [hit.x, hit.z]
}

defineExpose({ captureCamera, measureModel, modelObjectOf, groundPointAt })

// ---------- 阴影烘焙 ----------

/**
 * 阴影烘焙令牌。
 *
 * ContactShadows 与 AccumulativeShadows 都是「烘一次就不再更新」的，
 * 而它们在挂载的第一帧就开始烘焙，那时 glTF 还没加载完——
 * 深度图里空空如也，阴影会永久缺失。几何一变化就换个 key 重新挂载即可。
 *
 * 多个模型共用这一个令牌：它们是烘在同一张深度图上的，
 * 任何一个动了都得整张重烘，拆成逐模型重烘反而会互相覆盖。
 */
const bakeRevision = ref(0)

/**
 * 变换类改动的烘焙防抖。
 *
 * 拖一次位置会产生几十次配置变更，每次都换 key 就会每帧重挂载一次阴影：
 * 接触阴影是每帧一遍 512² 离屏渲染加两趟模糊，累积阴影更糟——
 * 它那 40 帧的累积会被每帧清零，拖动期间永远收敛不了，看起来全程是噪点。
 * 等手停下来再烘一次即可。
 */
const BAKE_DEBOUNCE_MS = 200
let bakeTimer: ReturnType<typeof setTimeout> | null = null

function scheduleBake() {
  if (bakeTimer !== null) clearTimeout(bakeTimer)
  bakeTimer = setTimeout(() => {
    bakeTimer = null
    bakeRevision.value += 1
  }, BAKE_DEBOUNCE_MS)
}

onUnmounted(() => {
  if (bakeTimer !== null) clearTimeout(bakeTimer)
  // 卸载后相机对象就没了，让飞行自己停在原地，别再往后排帧
  stopFlight()
})

/**
 * 全体模型的变更键：影响阴影的字段拼成一条字符串。
 *
 * 与相机机位键同理——`config.models` 是 reactive 代理、引用恒定，
 * 直接 watch 它只会触发一次；而每个模型的 `position` 又是同样的情况。
 * 展开成字符串是最省事也最准的写法，顺带把「数组长度变了」也覆盖进来
 * （增删模型同样要重烘）。
 */
const bakeKey = computed(() =>
  props.models
    .map((model) =>
      [
        model.url,
        /*
          `partsJson` 与 `url` 是**两个**几何体来源，都要进这条键：换一段 JSON
          就是换一件几何体（形状、件数、大小全都可能变），不重烘的话接触阴影与
          累积阴影里留着的是**旧形状**的影子——一个已经变成圆桌的东西底下
          还压着椅子的四条腿。长度可能很大，但这条串只在变更时算一次，
          且它本来就是「变了就重烘」，不参与任何查找。
        */
        model.partsJson,
        model.draco,
        model.visible,
        model.castShadow,
        model.position.join(),
        model.rotation.join(),
        model.scale.join(),
      ].join(','),
    )
    .join('|'),
)

watch([bakeKey, () => props.shadow.type, () => props.shadow.castShadow], scheduleBake)

function onModelLoaded() {
  /**
   * 模型就位的同一个 flush 里，SceneModel 才刚把 castShadow 写到各个 mesh 上。
   * 等一拍再重新烘焙，保证深度图里已经有模型——这条不能走防抖，
   * 载入完成是个明确的一次性事件，晚 200ms 出影子是白白让人等。
   */
  nextTick(() => {
    bakeRevision.value += 1
  })
  emit('loaded')
}

// ---------- 阴影开关 ----------

/**
 * 只有原生 shadow map 这一种方式走主光的投影，
 * 接触阴影与累积阴影各自渲染，主光再投影就会叠出第二层影子。
 */
const keyCastShadow = computed(
  () => props.shadow.enabled && props.shadow.type === 'map' && props.shadow.castShadow,
)

/**
 * 模型自己的阴影开关是叠加在全局之上的第二道闸。
 *
 * 全局那两个字段表达的是「这个场景要不要阴影」，物体级表达的是
 * 「这个模型参不参与」，两层同时成立才真的开启，所以是 AND。
 *
 * 写成逐模型取值的函数而不是一个 computed：判据是全局的、被 AND 的那一项
 * 是每个模型自己的，合成一个布尔量在只有一个模型时应付得来，
 * 多模型下就必须回到「谁是谁」这个问题上。
 */
function castShadowOf(model: ModelConfig): boolean {
  return props.shadow.enabled && props.shadow.castShadow && model.castShadow
}

function receiveShadowOf(model: ModelConfig): boolean {
  return props.shadow.enabled && props.shadow.receiveShadow && model.receiveShadow
}
</script>

<template>
  <TresPerspectiveCamera
    ref="tdmCamera"
    :position="initialCameraPosition"
    :fov="camera.fov"
    :near="camera.near"
    :far="camera.far"
  />

  <!--
    make-default 是给变换手柄用的，不是给别的地方看的。

    cientos 的 TransformControls 在拖动开始时会去把轨道控制禁用掉
    （`controls.value.enabled = !dragging`），而那个 `controls` 只在
    OrbitControls 传了 makeDefault 时才被赋值——不传的话它是 null，
    那一句就是空转，于是拖手柄的时候相机会跟着一起转。
    这一条在 cientos 的 useOrbitLikeControls 里写死，绕不开（除非自己监听
    dragging 去禁用，那等于把这件事做两遍）。

    反过来，光禁用也在 pointerdown 之后来得及：three-stdlib 的 OrbitControls
    在 onPointerMove 里第一句就是 `if (enabled === false) return`，
    所以这一次拖拽里相机一步都不会动。

    本组件只有一个 OrbitControls，不会因此改变谁的默认控件。
  -->
  <OrbitControls
    ref="tdmControls"
    make-default
    :target="initialCameraTarget"
    :auto-rotate="camera.autoRotate"
    :auto-rotate-speed="camera.autoRotateSpeed"
    :enable-damping="camera.damping"
    :damping-factor="camera.dampingFactor"
    :min-distance="camera.minDistance"
    :max-distance="camera.maxDistance"
    :min-polar-angle="camera.minPolarAngle"
    :max-polar-angle="camera.maxPolarAngle"
    :enable-pan="camera.enablePan"
    :enable-zoom="camera.enableZoom"
    :enable-rotate="camera.enableRotate"
    @start="onControlsStart"
    @end="onControlsEnd"
  />

  <SceneSun
    :show-sky="sun.showSky"
    :elevation="sun.elevation"
    :azimuth="sun.azimuth"
    :turbidity="sun.turbidity"
    :rayleigh="sun.rayleigh"
    :mie-coefficient="sun.mieCoefficient"
    :mie-directional-g="sun.mieDirectionalG"
    :ambient-intensity="sun.ambientIntensity"
    :key-intensity="sun.keyIntensity"
    :fill-intensity="sun.fillIntensity"
    :environment="sun.environment"
    :has-skybox="sun.skybox !== null"
    :cast-shadow="keyCastShadow"
    :shadow-map-size="shadow.mapSize"
    :shadow-bias="shadow.bias"
    :shadow-normal-bias="shadow.normalBias"
  />

  <!--
    天空盒与 `<SceneSun>` 是**兄弟而不是父子**：它一个 3D 对象都不渲染，
    产物是 `scene` 上的 background / environment 两个字段，
    放在谁的里面都不改变这个事实。与 `SceneSun` 相邻是因为它俩是这一版里
    唯二会写 `scene.environment` 的东西——两者互斥的规则写在 `SceneSun` 的模板上。
  -->
  <SceneSkybox :skybox="sun.skybox" />

  <SceneGround
    :visible="ground.visible"
    :size="ground.size"
    :cell-size="ground.cellSize"
    :cell-thickness="ground.cellThickness"
    :cell-color="ground.cellColor"
    :section-size="ground.sectionSize"
    :section-thickness="ground.sectionThickness"
    :section-color="ground.sectionColor"
    :infinite-grid="ground.infiniteGrid"
    :fade-distance="ground.fadeDistance"
    :fade-strength="ground.fadeStrength"
    :follow-camera="ground.followCamera"
  />

  <!--
    户型图：地基 / 房间 / 墙。

    摆在 `SceneGround` 之后，是为了让「先地面、后房子」的先后关系一眼看得出
    ——three 对不透明物体的排序本来就不看声明顺序，所以这一条纯属可读性。
    但**半透明的房间色块与玻璃确实是透明物体**，它们的顺序由 three 按距离排，
    声明顺序在那里同样不起作用，不必为它调整位置。

    空配置渲染不出任何东西（v-for 空转、foundation 为 null），
    与 `models: []` 的空场景是同一套处理。
  -->
  <SceneFloorplan :floorplan="floorplan" :plan="planView" />

  <SceneShadows
    v-if="shadow.enabled"
    :type="shadow.type"
    :revision="bakeRevision"
    :contact-opacity="shadow.contactOpacity"
    :contact-blur="shadow.contactBlur"
    :contact-scale="shadow.contactScale"
    :contact-resolution="shadow.contactResolution"
    :acc-frames="shadow.accFrames"
    :acc-opacity="shadow.accOpacity"
    :acc-scale="shadow.accScale"
    :acc-blend="shadow.accBlend"
  />

  <!--
    模型：每个一条，平铺成同级的一组包裹组。

    key 用 model.id 而不是下标：增删中间某个模型时，下标会让 Vue 把后面
    每个节点都当成「变了」而整体重挂一遍——那等于把所有 glTF 重新加载一次。
    id 在换地址时才变，正好就是「这个节点确实换成了另一个物体」的时机。

    空数组时这一块渲染不出任何东西，视口里只剩地面与光照，是合法的空场景。
  -->
  <SceneModelNode
    v-for="model in models"
    :key="model.id"
    :ref="bindNode(model.id)"
    :model="model"
    :cast-shadow="castShadowOf(model)"
    :receive-shadow="receiveShadowOf(model)"
    @loaded="onModelLoaded"
    @progress="emit('progress', $event)"
    @error="emit('error', $event)"
    @object-click="emit('objectClick', $event)"
    @object-dblclick="emit('objectDblclick', $event)"
    @object-pointer-enter="emit('objectPointerEnter', $event)"
    @object-pointer-leave="emit('objectPointerLeave', $event)"
    @object-context-menu="emit('objectContextMenu', $event)"
  />
</template>
