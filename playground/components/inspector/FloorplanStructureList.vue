<script setup lang="ts">
import { useSceneStore } from '../../../src'
import type { FloorplanOpening, FloorplanWall } from '../../../src'
import { cloneFloorplanPatch, removeWall, wallLength } from '../../../src'
import { pushEvent } from '../../composables/useEditorState'

defineOptions({ name: 'FloorplanStructureList' })

const scene = useSceneStore()

/**
 * 「平面图」页 03 墙 / 04 门窗：画出来的墙与挂在墙上的洞口，各一行。
 *
 * **两份清单在同一个组件里，因为它们是同一件事的两面。** 洞口不存自己的坐标，
 * 只存 `hostWallId` + 沿墙米数（见设计决定 31），所以删一面墙必须**同时**写
 * `walls` 与 `openings` 两个键。分居两个组件的话，删墙那一处要么够不到另一份清单、
 * 要么两次 `applyConfig`——后者会把一次删除记成两步历史，撤销一次只回来一半。
 * 放在一起，`removeWall` 的返回值正好是一个补丁的完整形状。
 *
 * 它们没有做成 schema 驱动的一节，理由与「操作历史」和房间清单相同：一行里
 * 有三样东西，还要按下标定位配置里的某一条，字段声明那套（一字段一控件、
 * 路径是定长字符串）表达不了。序号 03 / 04 是**手写的**，加一节就要跟着改。
 *
 * 与「模型属性」页不同，这里没有选中态：墙与门窗是并列的对象，不是「当前正在改的那一个」。
 * 因此也不提供改名——它们根本没有名字，`墙 1` 是**数组下标的派生**（不是存进配置的字段）。
 * 这也是为什么删除按钮做成「谁的表就删谁」，而不是先选中再操作。
 */

/** 洞口两种类型的名字。多处要用（行首、日志、标题），写成一张表 */
const OPENING_LABELS = { door: '门', window: '窗' } as const

/**
 * 一个坐标 / 长度在行里的写法：至多两位小数，去掉尾零。
 *
 * 画出来的墙都落在 1 米格上（显示成 `3`），而**导入的配置**可以是
 * `2.4000000000000004` 这种——`toFixed` 截到两位再 `Number` 去掉尾零，
 * 两种都不至于把整行撑长。
 */
function num(value: number): string {
  return String(Number(value.toFixed(2)))
}

/** 墙的中点，`(x, z)`。用中点而不是两个端点：一行放不下两个点，而中点足以在图上认出这一根 */
function midpointOf(wall: FloorplanWall): string {
  return `${num((wall.start[0] + wall.end[0]) / 2)}, ${num((wall.start[1] + wall.end[1]) / 2)}`
}

/**
 * 墙那一行的悬停说明。
 *
 * 比行里那段字多出三样：两个**精确端点**，以及这一面墙自己的**高与厚**。
 * 后者是这个界面里唯一能看到「高厚不一致」的地方——面板 01 那两格改的是全部墙、
 * 读的也是第一面墙的值，导入一份高低不一的配置时它显示不出这件事。
 */
function wallTitle(wall: FloorplanWall, index: number): string {
  const from = `(${num(wall.start[0])}, ${num(wall.start[1])})`
  const to = `(${num(wall.end[0])}, ${num(wall.end[1])})`
  return `墙 ${index + 1}：从 ${from} 到 ${to}，长 ${num(wallLength(wall))} 米，高 ${num(wall.height)} 米，厚 ${num(wall.thickness)} 米`
}

/**
 * 洞口那条「挂在哪面墙上」。
 *
 * 找不到宿主墙是一个**真实会出现**的状态，不是防御性代码：删墙会级联删掉门窗，
 * 可配置是任意 JSON——手写的、别的工具生成的，都可能留下孤儿洞口。
 * 那时老实说「已不存在的墙」，而不是显示成一个空的「挂在 上」。
 *
 * 引用的写法（`墙 2`）与墙清单的行首**逐字一致**，为的是能对上：这是两份清单之间
 * 唯一的指路方式。
 */
function hostLabel(opening: FloorplanOpening): string {
  const index = scene.config.floorplan.walls.findIndex((wall) => wall.id === opening.hostWallId)
  return index < 0 ? '挂在已不存在的墙上' : `挂在 墙 ${index + 1} 上`
}

/** 洞口那一行的悬停说明：把尺寸也写出来（行里只放得下位置） */
function openingTitle(opening: FloorplanOpening): string {
  const label = OPENING_LABELS[opening.kind]
  return `${label}：${hostLabel(opening)}，沿墙 ${num(opening.offset)} 米，宽 ${num(opening.width)} 米、高 ${num(opening.height)} 米`
}

/**
 * 删一面墙，连带挂在它上面的洞口。
 *
 * 两个键写进**同一个补丁**，于是历史上是一步：撤销一次，墙与门窗一起回来。
 * 这是 `removeWall` 存在的意义（它返回的正好是 `{ walls, openings }`），
 * 与视口里 `Shift + 点击` 走的是同一条（`useFloorplanTool.deleteWallAt`）。
 *
 * 标签与那句回执**逐字照抄那份实现**：同一件事不该因为触发路径不同
 * （列表里点 × / 图上 Shift + 点击）而在历史与日志里写成两种样子。
 */
function dropWall(wall: FloorplanWall): void {
  const plan = scene.config.floorplan
  const removed = removeWall(plan.walls, plan.openings, wall.id)
  scene.applyConfig({ floorplan: cloneFloorplanPatch(removed) }, '删除墙体')

  const orphans = plan.openings.length - removed.openings.length
  pushEvent(orphans > 0 ? `已删除一面墙，连带 ${orphans} 个门窗` : '已删除一面墙')
}

/** 删一个洞口。同样照抄视口里「再点一下同一个位置」那一条的标签与回执 */
function dropOpening(opening: FloorplanOpening): void {
  const label = OPENING_LABELS[opening.kind]
  const openings = scene.config.floorplan.openings.filter((item) => item.id !== opening.id)

  scene.applyConfig({ floorplan: cloneFloorplanPatch({ openings }) }, `删除${label}洞`)
  pushEvent(`已删除一个${label}`)
}
</script>

<template>
  <div class="ed-plan">
    <!--
      表头沿用 01/02 两节的排版（编号 + 标题 + 右端读数），不可折叠：
      它是「有哪些」，上面两节是「户型长什么样」，折叠起来会让这几块看起来并列。
    -->
    <div class="ed-plan-head">
      <span class="ed-sec-idx">03</span>
      <span class="ed-sec-title">墙</span>
      <span class="ed-plan-count">{{ scene.config.floorplan.walls.length }}</span>
    </div>

    <div v-if="scene.config.floorplan.walls.length" class="ed-plan-list">
      <!--
        用 wall.id 做 key 而不是下标——与房间清单同一条理由：删除中间一行时，
        下标会让后面每一行的序号错位一格。序号是**算出来的**（下标 + 1），
        所以它跟着行一起移动，不会留下「墙 3 不见了但下面还有墙 3」这种状态。
      -->
      <div v-for="(wall, index) in scene.config.floorplan.walls" :key="wall.id" class="ed-plan-row">
        <span class="ed-plan-idx">墙 {{ index + 1 }}</span>
        <span class="ed-plan-meta" :title="wallTitle(wall, index)">
          中点 ({{ midpointOf(wall) }}) · {{ num(wallLength(wall)) }} 米
        </span>

        <button
          type="button"
          class="ed-plan-drop"
          :title="`删除 墙 ${index + 1}（连带它上面的门窗）`"
          :aria-label="`删除 墙 ${index + 1}`"
          @click="dropWall(wall)"
        >
          ×
        </button>
      </div>
    </div>

    <p v-else class="ed-hint ed-hint--quiet ed-plan-empty">
      还没有墙。用视口左侧的「画墙」工具逐点点击落墙，点回起点闭合。
    </p>
  </div>

  <div class="ed-plan">
    <div class="ed-plan-head">
      <span class="ed-sec-idx">04</span>
      <span class="ed-sec-title">门窗</span>
      <span class="ed-plan-count">{{ scene.config.floorplan.openings.length }}</span>
    </div>

    <div v-if="scene.config.floorplan.openings.length" class="ed-plan-list">
      <!--
        这里按**配置顺序**排，与墙清单一致（都是数组顺序），刻意不按墙分组重排：
        一重排，行首那个位置说明里的「墙 N」就与上面那份清单里的行号对不上了。
      -->
      <div v-for="opening in scene.config.floorplan.openings" :key="opening.id" class="ed-plan-row">
        <span class="ed-plan-idx">{{ OPENING_LABELS[opening.kind] }}</span>
        <span class="ed-plan-meta" :title="openingTitle(opening)">
          {{ hostLabel(opening) }} · 沿墙 {{ num(opening.offset) }} 米
        </span>

        <button
          type="button"
          class="ed-plan-drop"
          :title="`删除这个${OPENING_LABELS[opening.kind]}`"
          :aria-label="`删除这个${OPENING_LABELS[opening.kind]}`"
          @click="dropOpening(opening)"
        >
          ×
        </button>
      </div>
    </div>

    <p v-else class="ed-hint ed-hint--quiet ed-plan-empty">
      还没有门窗。用视口左侧的「门」或「窗」工具点一下墙面，就放下一个洞口。
    </p>
  </div>
</template>
