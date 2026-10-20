<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useSceneStore } from '../stores/scene'
import { viewModeOf } from '../utils/viewMode'
import type { FloorplanPoint } from '../types'
import {
  armWalkPlacement,
  cancelWalkPlacement,
  previewWalkAt,
  startWalkAt,
  walkArmed,
  walkHint,
  walking,
  stopWalk,
} from '../composables/useWalkMode'

/**
 * 第一人称漫游的入口（人形按钮）、待落点提示与漫游 HUD。
 *
 * **它由 `SceneCanvas` 渲染**，所以编辑态、只读画布、编辑器预览看到的是同一枚：
 * 漫游不再只是编辑器的能力（见 DESIGN.md 设计决定 70）。这与视角胶囊
 * （设计决定 69）同一条分层理由——「换一种方式看当前场景」是宿主通用的事，
 * 纯画布也该有；而它改不到任何场景数据，`config` / 历史 / 导出物里都没有它的位置。
 *
 * 入口只在 **2D** 里出现：3D 里拖出的落点要先经过一次相机飞行，飞行途中
 * `groundPointAt` 用的还是旧机位，同一块屏幕坐标会指向别处——松手之后人出现
 * 在离指针很远的位置。而漫游本来就是「在平面图上挑个位置进去」。
 *
 * 落点换算走 `resolvePoint`（由 `SceneCanvas` 传入它自己的 `groundPointAt`）：
 * 本组件不碰 three、也不碰 TresCanvas 的上下文，纯 DOM 这一层只负责手势。
 * 「这一下有没有落在画面里」用 `.tdm-root` 的矩形判，与编辑器原先判
 * `.tdm-viewport` 是同一块区域（后者是前者的内容盒）。
 */
defineOptions({ name: 'TdmSceneWalkEntry' })

const props = withDefaults(
  defineProps<{
    /** 客户端坐标 → 地面上的点；落不到地面时返回 `null` */
    resolvePoint: (clientX: number, clientY: number) => FloorplanPoint | null
    /**
     * 入口显不显示（公开面 `showViewSwitch` 的那一档）。
     *
     * 只挡入口按钮：HUD 与 Esc 监听**不跟着收**——漫游中途宿主把这一档关掉时，
     * 屋里的人仍然要有一个看得见的出口（以及 Esc），不能连 HUD 一起消失。
     */
    showEntry?: boolean
  }>(),
  { showEntry: true },
)

const scene = useSceneStore()

const viewMode = computed(() => viewModeOf(scene.config.camera))

/**
 * 按钮的拖动落点。
 *
 * 交互是「按下按钮 → 拖到平面图上 → 松开」，所以按下之后要给按钮**指针捕获**：
 * 不捕获的话指针一离开按钮，后续的 move / up 就全落到视口上，按钮这一侧
 * 收不到松手，人也就永远走不进去。
 *
 * `moved` 是「这一次到底拖没拖」的记录，阈值与点击 / 拖拽的常用分界同一量级。
 * 没有它的话，单纯点一下按钮（按下的位置也在视口矩形里）会被判成
 * 「在按钮底下那个点松开」——人凭空出现在按钮背后，而用户以为只是点了一下。
 * 点一下的正确语义是**进入待落点**：提示行会接着说要干什么。
 */
interface WalkPress {
  x: number
  y: number
  moved: boolean
}

let walkPress: WalkPress | null = null
const WALK_DRAG_THRESHOLD = 6

/**
 * 指针位置 → 地面上的点，**并且要求落在画布矩形里**。
 *
 * 只在画布内取点，是因为拖动会越过边缘（松在右栏、松在宿主页面上），
 * 而 `groundPointAt` 对画布外的坐标照样会给出一个交点——那是射线延伸出去的
 * 位置，不是用户指的地方。松在画布外就该当作「这次没落下」。
 */
function walkPointOf(event: PointerEvent): FloorplanPoint | null {
  const el = (event.currentTarget as HTMLElement | null)?.closest('.tdm-root')
  if (!el) return null

  const rect = el.getBoundingClientRect()
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    return null
  }

  return props.resolvePoint(event.clientX, event.clientY)
}

function onButtonDown(event: PointerEvent): void {
  if (event.button !== 0) return
  // 按住拖动时别顺手选中按钮上的文字
  event.preventDefault()

  /*
    按钮只在 2D 里渲染，这里仍然按配置再判一次。

    判据是**配置推导出来的**（`viewModeOf`），按下这一刻它可能已经翻成 3D
    ——比如右栏刚把机位拖回斜视、画面还没重绘。不在 2D 时不接住这一次拖动：
    3D 里的落点要经过一次机位过渡，途中 `groundPointAt` 用的是还在飞的相机，
    同一块屏幕坐标落在中途会指向完全不同的地方。让用户切回 2D 再拖一次，
    换来的是「落点永远与看到的一致」。
  */
  if (viewMode.value !== '2d') {
    cancelWalkPlacement()
    return
  }

  walkPress = { x: event.clientX, y: event.clientY, moved: false }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  armWalkPlacement()
}

/**
 * 键盘 Enter / Space 触发的 click，与指针那条路共用这枚按钮。
 *
 * 指针路径在 `pointerdown` 里就已经进入待落点；拖拽落点松手时浏览器还会
 * 补一个 click，那时已经在漫游里了——不拦的话它会重新把 `walkArmed` 置真，
 * 退出漫游后视口还挂着十字准星，再点一下平面图又会莫名进屋子。
 */
function onButtonClick(): void {
  if (walking.value) return
  armWalkPlacement()
}

function onButtonMove(event: PointerEvent): void {
  const press = walkPress
  if (!press || !walkArmed.value) return

  if (!press.moved) {
    press.moved =
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > WALK_DRAG_THRESHOLD
    if (!press.moved) return
  }

  previewWalkAt(walkPointOf(event))
}

function onButtonUp(event: PointerEvent): void {
  const press = walkPress
  walkPress = null

  const el = event.currentTarget as HTMLElement
  if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)

  // 没拖动过：这次只是「进入待落点」，等用户直接点平面图
  if (!press || !press.moved) return

  const point = walkPointOf(event)
  if (point) startWalkAt(point)
}

function onButtonCancel(event: PointerEvent): void {
  walkPress = null
  const el = event.currentTarget as HTMLElement
  if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  cancelWalkPlacement()
}

/**
 * 纯画布这一路的 Esc。
 *
 * 编辑态由 `useEditorShortcuts` 管（那里 Esc 还排着预览、事件弹窗、绘制工具
 * 几条优先级），可纯画布**没有那一层**——不在这里补一条，宿主页面里进去就走不出来，
 * 只能去点 HUD 上那枚按钮。两条同时存在时只是幂等：都给 `stopWalk` 打一次，
 * 第二次因为 `walking` 已是假直接返回。
 *
 * 监听的挂 / 摘跟着组件走。这一层**总是**由 `SceneCanvas` 挂上（不随
 * `showViewSwitch` 装卸）：否则漫游中途宿主关掉那一档，Esc 会跟着入口一起消失。
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (walking.value) {
    stopWalk()
    return
  }
  if (walkArmed.value) cancelWalkPlacement()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <!--
    人形入口：落在视角胶囊的正下方。

    **只在 2D 里渲染**（理由见文件头）。**不并进胶囊**：胶囊里每一格都是
    「此刻在看哪个档」的状态，这枚是「按住我，把我放到平面图上」的一次拖拽；
    并排成一格会读成第三个档位——单击切过去，然后呢？所以它单独浮着、只画人形不写字。

    `v-if` 里的 `!walking` 让它在漫游中让位给底部 HUD——此刻没有「再放一个人」的意思。
  -->
  <button
    v-if="showEntry && viewMode === '2d' && !walking"
    type="button"
    class="tdm-walk-btn"
    :class="{ 'tdm-walk-btn--on': walkArmed }"
    :aria-pressed="walkArmed"
    aria-label="第一人称行走"
    title="第一人称行走：按住拖到平面图上松开，就从那里开始走"
    @pointerdown="onButtonDown"
    @pointermove="onButtonMove"
    @pointerup="onButtonUp"
    @pointercancel="onButtonCancel"
    @click="onButtonClick"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="4.6" r="2.4" />
      <path d="M12 7.6v6.2M8 21l4-7.2 4 7.2M7.2 10.4 12 8.4l4.8 2" />
    </svg>
  </button>

  <!--
    待落点的提示行：视口底部居中。
    它同样是一个「按下去之后画面没有立刻变化」的交互，发现路径只有这一行。
    编辑态里绘制工具自己的提示行与它互斥（`EditorStage` 那边让位给这一条）。
  -->
  <p v-if="walkHint" class="tdm-draw-hint">
    {{ walkHint }}
  </p>

  <!--
    漫游中的操作说明。

    第一人称没有可见的控制器，三条操作（走、看、退）在画面上都没有落点，
    不说就只能靠猜；而 `pointerlock` 还有一条单独的坑——锁定之后光标消失，
    第一次遇到的人常常以为页面卡住了。所以在锁定入口写清「点击画面锁定鼠标」。

    容器不吃指针事件（漫游时整块画布都在等鼠标），只有退出按钮例外。
  -->
  <div v-if="walking" class="tdm-walk-hud" role="status">
    <span class="tdm-walk-hud-text">
      WASD / 方向键移动 · 鼠标转视角（点击画面锁定指针） · Shift 加速 · Esc 退出
    </span>
    <button type="button" class="tdm-walk-exit" @click="stopWalk">退出漫游</button>
  </div>
</template>
