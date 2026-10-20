<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useTresContext } from '@tresjs/core'
import { Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import type { CameraConfig, FloorplanConfig, FloorplanPoint } from '../types'
import {
  WALK_EYE_HEIGHT,
  WALK_LOOK_SENSITIVITY,
  WALK_MAX_PITCH,
  WALK_RADIUS,
  WALK_SPEED,
  WALK_SPRINT,
  collectWalkObstacles,
  resolveWalkPosition,
} from '../utils/walk'
import type { WalkObstacle } from '../utils/walk'

/**
 * 第一人称漫游的控制器：接管相机、键盘移动、鼠标看方向、墙体碰撞。
 *
 * **它只在 `walking` 为真时动手**，关掉时把相机与轨道控制原样还回去。
 * 之所以要一整块独立的控制器、而不是给 `OrbitControls` 配几个参数：
 * 轨道控制的前提是「永远看着 target」，而第一人称的前提正好相反——
 * 相机自己就是视点，方向由视线决定、位置由脚步决定。两者不是同一套约束，
 * 挤进同一个控制器里只会让 damping、极角夹取这些规则互相打架。
 *
 * 相机的位置与朝向**不写回配置**：走路是观察方式，不是场景改动
 * （`useWalkMode.ts` 的文件头有完整理由）。退出时按**当时的配置**还原，
 * 所以漫游中途在右栏改了机位，退出来看到的是改完之后的那一份。
 *
 * 这一层在 `TresCanvas` 内部，所以能用 `useTresContext()` 拿到活的相机、
 * 渲染器与轨道控制实例；编辑器的其余部分离它隔着三层组件，不该为此多出
 * 一组 props。真正需要传下来的只有「开没开、从哪开始、场景长什么样」三件事。
 */
defineOptions({ name: 'TdmSceneWalkControls' })

const props = defineProps<{
  active: boolean
  spawn: FloorplanPoint | null
  /** 配置里的机位：退出时按它还原 */
  camera: CameraConfig
  /** 碰撞用的户型几何 */
  floorplan: FloorplanConfig
}>()

const { camera: tresCamera, renderer, controls } = useTresContext()

/**
 * 轨道控制的运行时形状。
 *
 * `@tresjs/core` 的 `TresControl` 只声明了 `enabled`，而这里还要回写 `target`
 * 并调一次 `update()`——那是 OrbitControls 才有的成员。写成结构类型而不是
 * 从 cientos 里 import 一个实现类型：本组件只关心这三个成员，
 * 换一个「也是 OrbitControls 形状」的控件照样成立。
 */
interface OrbitLike {
  enabled: boolean
  target?: Vector3
  update?: () => void
}

/** 移动键。用 `event.code` 而不是 `event.key`：与键盘布局、输入法、大小写都无关 */
const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

/**
 * 加速键。它**不在 `MOVE_KEYS` 里**，但必须同样记进 `pressed`。
 *
 * 早先只在 `step()` 里读 `pressed.has('ShiftLeft')`，而按下 Shift 时
 * `onKeyDown` 只把 `MOVE_KEYS` 里的键收进去——于是那个判断永远是假，
 * 加速表现为「按了没反应」，且哪里都不报错。单独一张表而不是并进
 * `MOVE_KEYS`，是因为它**不该 `preventDefault()`**：Shift 本身不滚动页面，
 * 而它作为修饰键还可能被浏览器 / 输入法用来组合其他键。
 */
const SPRINT_KEYS = new Set(['ShiftLeft', 'ShiftRight'])

let currentCamera: PerspectiveCamera | null = null
let canvasEl: HTMLCanvasElement | null = null
let obstacles: WalkObstacle[] = []

/** 视线：绕竖直轴的偏航与上下看的俯仰（弧度） */
let yaw = 0
let pitch = 0

const pressed = new Set<string>()
let dragging = false
let raf = 0
let lastTime = 0

/** 还原机位时复用，避免每次退出都新建一只 Vector3 */
const restoreTarget = new Vector3()

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 初始朝向：面朝地基中心（没有地基时面朝原点）。
 *
 * 不固定成「永远朝 -Z」：从平面图右侧落到屋里的人，面朝北多半正对着一面墙；
 * 面朝房子中间至少能看到房间内部。落点正好在中心时没有方向可言，取 0（朝 -Z）。
 *
 * 推导：three 的相机在偏航 0 时看向 -Z，绕 Y 转 θ 之后前向是
 * `(-sinθ, 0, -cosθ)`。要让它对准 `(dx, dz)`，解出 θ = atan2(-dx, -dz)。
 */
function faceCenter(x: number, z: number): number {
  const foundation = props.floorplan.foundation
  const cx = foundation ? foundation.x : 0
  const cz = foundation ? foundation.z : 0
  const dx = cx - x
  const dz = cz - z
  if (Math.hypot(dx, dz) < 1e-3) return 0
  return Math.atan2(-dx, -dz)
}

function applyRotation(): void {
  if (!currentCamera) return
  currentCamera.rotation.order = 'YXZ'
  currentCamera.rotation.set(pitch, yaw, 0)
}

function requestLock(): void {
  if (!canvasEl || document.pointerLockElement === canvasEl) return
  try {
    /*
      有的浏览器返回 Promise，有的返回 undefined，统一按「成功与否都不影响漫游」
      处理：锁不上就退回「按住左键拖拽看方向」，HUD 上写着这件事。
    */
    const result = canvasEl.requestPointerLock() as unknown
    if (result instanceof Promise) result.catch(() => {})
  } catch {
    /* 浏览器拒绝锁指针时什么都不做 */
  }
}

function onCanvasPointerDown(event: PointerEvent): void {
  if (!currentCamera || event.button !== 0) return
  dragging = true
  requestLock()
}

function onWindowPointerUp(): void {
  dragging = false
}

function onMouseMove(event: MouseEvent): void {
  if (!currentCamera) return

  const locked = document.pointerLockElement === canvasEl
  // 没锁指针时只有按住左键才转视角——否则鼠标扫过画面就转头，像失控
  if (!locked && !dragging) return

  yaw -= event.movementX * WALK_LOOK_SENSITIVITY
  pitch -= event.movementY * WALK_LOOK_SENSITIVITY
  pitch = clamp(pitch, -WALK_MAX_PITCH, WALK_MAX_PITCH)
  applyRotation()
}

function onKeyDown(event: KeyboardEvent): void {
  if (!currentCamera) return

  const target = event.target as HTMLElement | null
  const typing =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  if (typing) return

  if (SPRINT_KEYS.has(event.code)) {
    pressed.add(event.code)
    return
  }

  if (MOVE_KEYS.has(event.code)) {
    pressed.add(event.code)
    // 方向键默认会滚页面；左右键在部分浏览器里还有前进 / 后退
    event.preventDefault()
  }
}

function onKeyUp(event: KeyboardEvent): void {
  pressed.delete(event.code)
}

function onWindowBlur(): void {
  // 切走标签页时按过的键再也收不到 keyup，不清掉就会一直往前走
  pressed.clear()
  dragging = false
}

function isDown(...codes: string[]): boolean {
  return codes.some((code) => pressed.has(code))
}

/**
 * 一帧：先按视线算出位移，再交给碰撞算术把位置推回墙外。
 *
 * 时间步长封顶 0.1 秒：切回标签页、掉帧、断点之后 `now - lastTime` 可能是几秒，
 * 不封顶的话一帧能穿到墙的另一侧（碰撞只做「推出」，不做连续检测）。
 */
function step(now: number): void {
  raf = 0
  const camera = currentCamera
  if (!camera) return

  const dt = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, 0.1)
  lastTime = now

  const forward = (isDown('KeyW', 'ArrowUp') ? 1 : 0) - (isDown('KeyS', 'ArrowDown') ? 1 : 0)
  const strafe = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0)

  if (forward !== 0 || strafe !== 0) {
    // 斜着走不能比直着走快：先把 (forward, strafe) 归一化
    const length = Math.hypot(forward, strafe)
    const sprint = isDown('ShiftLeft', 'ShiftRight') ? WALK_SPRINT : 1
    const distance = (WALK_SPEED * sprint * dt) / length

    /*
      前向 = (-sin yaw, -cos yaw)，右向 = (cos yaw, -sin yaw)。
      与 `applyRotation` 用的是同一个偏航角，所以「往前走」永远是视线正前方。
    */
    const dx = (forward * -Math.sin(yaw) + strafe * Math.cos(yaw)) * distance
    const dz = (forward * -Math.cos(yaw) + strafe * -Math.sin(yaw)) * distance

    const [x, z] = resolveWalkPosition(
      camera.position.x + dx,
      camera.position.z + dz,
      obstacles,
      WALK_RADIUS,
    )
    camera.position.set(x, WALK_EYE_HEIGHT, z)
  }

  raf = requestAnimationFrame(step)
}

function begin(camera: PerspectiveCamera): void {
  // 同一只相机重复进入（watch 因为别的源又跑了一次）不重来
  if (currentCamera === camera) return
  end()

  currentCamera = camera
  obstacles = collectWalkObstacles(props.floorplan)

  const spawn = props.spawn ?? [0, 0]
  const [x, z] = resolveWalkPosition(spawn[0], spawn[1], obstacles, WALK_RADIUS)

  camera.position.set(x, WALK_EYE_HEIGHT, z)
  yaw = faceCenter(x, z)
  pitch = 0
  applyRotation()

  // 轨道控制让位：它的 update() 每帧都会把相机按 target 摆回去
  const orbit = controls.value as OrbitLike | null
  if (orbit) orbit.enabled = false

  canvasEl = renderer.instance?.domElement ?? null
  canvasEl?.addEventListener('pointerdown', onCanvasPointerDown)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)

  lastTime = 0
  raf = requestAnimationFrame(step)

  /*
    进入漫游的那一下本身就在用户手势里（在平面图上按下 / 松开），
    所以顺手试着锁一次指针。被拒绝也不影响：拖拽看方向是同一套灵敏度。
  */
  requestLock()
}

/**
 * 退出：摘掉监听、放开指针、把相机与轨道控制还原成配置里的样子。
 *
 * 还原顺序不能换：**先写相机位置、再写 target、最后 update()**。
 * `OrbitControls.update()` 是拿「相机当前位置 − target」反算球坐标的，
 * 相机还停在 1.6 米高的眼位时就 update，会因为低于 `minDistance` 被推回去，
 * 结果与配置里那份机位差出好几米——看起来像「退出漫游后视角乱跳」。
 */
function end(): void {
  if (raf !== 0) cancelAnimationFrame(raf)
  raf = 0
  lastTime = 0
  pressed.clear()
  dragging = false

  if (canvasEl) {
    canvasEl.removeEventListener('pointerdown', onCanvasPointerDown)
    if (document.pointerLockElement === canvasEl) document.exitPointerLock()
  }
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onWindowBlur)

  const camera = currentCamera
  currentCamera = null
  canvasEl = null
  obstacles = []
  if (!camera) return

  camera.position.fromArray(props.camera.position)

  const orbit = controls.value as OrbitLike | null
  if (orbit) {
    orbit.enabled = true
    orbit.target?.fromArray(props.camera.target)
    orbit.update?.()
    return
  }

  // 控件还没就位时的兜底：至少让相机看回配置里的注视点
  restoreTarget.fromArray(props.camera.target)
  camera.lookAt(restoreTarget)
}

watch(
  [() => props.active, () => tresCamera.activeCamera.value],
  ([active, camera]) => {
    if (active && camera) begin(camera as PerspectiveCamera)
    else end()
  },
  { immediate: true, flush: 'post' },
)

/**
 * 漫游期间户型被改动时重取一次挡路的那组墙。
 *
 * 改户型本来不该发生（漫游时右栏还在、撤销也还能按），但**它会发生**：
 * 撤销一步、在面板里拖一下墙高、删掉一面墙，都不需要退出漫游。
 * 不重取的话碰撞用的还是进来那一刻的几何——人能从一面已经不存在的墙里穿过去，
 * 也会被一面已经挪走的墙凭空挡住。`deep` 是必要的：墙与洞口都是被打补丁的对象，
 * 引用常常不变。
 */
watch(
  () => props.floorplan,
  () => {
    if (currentCamera) obstacles = collectWalkObstacles(props.floorplan)
  },
  { deep: true },
)

onUnmounted(end)
</script>

<template>
  <!--
    控制器不画任何东西。这里保留一个空组，是为了让组件有一个合法的 3D 子节点：
    TresCanvas 的子组件列表就是场景图，没有节点的组件在某些版本里会被当成
    「不是 3D 子节点」而挂到别处；空组没有任何开销。
  -->
  <TresGroup />
</template>
