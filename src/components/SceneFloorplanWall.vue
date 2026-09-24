<script setup lang="ts">
import { computed } from 'vue'
import { Euler, Vector3 } from 'three'
import SceneFloorplanWallBox from './SceneFloorplanWallBox.vue'
import { dropOpeningFills, wallPieces } from '../utils/floorplan'
import type { FloorplanOpening, FloorplanWall } from '../types'

defineOptions({ name: 'TdmSceneFloorplanWall' })

/**
 * 一面**没有外观**的墙：通体灰盒子。
 *
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 DESIGN.md「TD 层不使用 Pinia」）。它自己不算任何几何——
 * 切段、开洞、算世界坐标全在 `wallPieces()` 里，这里只负责把结果摆进模板。
 *
 * 它同时也是**有外观的那种墙退化时的落点**（`SceneFloorplanWallSkin.vue`
 * 在加载中 / 加载失败 / 资产不可用时整面地退回到这里），所以它是「改造前
 * 唯一的那条渲染路径」活着的副本，除了下面那条洞口抑制之外行为一字不变。
 *
 * 唯一的例外是 `plan`（2D 正俯视那一档换成平面图外观）：它在**两条路**上都要
 * 生效，所以这个 prop 在两个组件上都存在、都往 `SceneFloorplanWallBox` 传。
 */
const props = defineProps<{
  wall: FloorplanWall
  /**
   * **全量**洞口列表，不是滤好的。
   *
   * 按 `hostWallId` 挑出挂在这面墙上的那几个是 `wallPieces()` 入口做的事
   * （那里有一段注释解释了为什么滤在那一层而不是交给调用方）。
   * 这边照配置原样传下去即可。
   */
  openings: FloorplanOpening[]
  /**
   * 按平面图外观（2D 正俯视）画。
   *
   * 由 `SceneFloorplan` 从 `viewModeOf(camera)` 推出来往下传：档位是**从机位
   * 推导**的，而相机在 `SceneContent` 那一层，这里（TD 层）不读 Pinia、也拿不到
   * 相机。给出处的完整理由写在 `SceneFloorplanWallBox.vue` 的 `planWall` 那段。
   */
  plan?: boolean
}>()

/**
 * 整面墙的描述数据算成**一个** computed。
 *
 * 模板里只取 `box.position` / `box.size` 这种**稳定引用**，不在模板表达式里
 * 现造数组：TresJS 在 `args` 换引用时会重建几何体（`SceneGround.vue:54-60`
 * 的注释是这条约定的出处），每次渲染新建一个 `[w, h, d]` 就等于每帧重建一次
 * `BoxGeometry`。
 *
 * 位置与旋转写成 `Vector3` / `Euler` 实例而不是数组，照
 * `SceneModelNode.vue:74-76` 的先例：TresJS 的全局组件类型把这两个 prop
 * 标注成严格的 three 对象，数组只在运行时可用、类型上不接受
 * （`SceneContent.vue:97-99` 有完整说明）。每次重算返回新实例也是必要的
 * ——TresJS 按引用比较，原地改同一只会被当成「没变」。
 *
 * 调色板**不在这里**：它随「一个盒子长什么样」一起搬进了
 * `SceneFloorplanWallBox.vue`，那边是它唯一的持有者。
 *
 * ## 洞口内饰件的抑制**在这一层**，判据取自 `props.openings`
 *
 * 写了外观地址的洞口（门与窗都会写）不画它自己那套框条与门扇——那些由装模型的
 * 那一方负责（`SceneFloorplanOpeningModel.vue`），这边再画一遍就是同一个包围盒上两组
 * 共面几何、逐像素 z-fighting。
 *
 * **判据在组件内部算，不由父级传进来**，因为这一层有**三个**上游：没写外观的墙、
 * 贴面墙在资产可用时的补件、以及贴面墙**退化回这里**的那一路
 * （`SceneFloorplanWallSkin.vue` 最后那个 `v-else`，它把全量 openings 原样转过来）。
 * 第三条与门资产的状态毫无关系（墙资产加载中 / 404 / 不达标都会走它），
 * 靠父级传一个标记进来就必须传两处，而漏掉第二处的表现是「某些情况下门洞画了两遍」。
 * 判据能从 `props.openings` 自己推出来，就不该指望调用方记得。
 */
const boxes = computed(() =>
  dropOpeningFills(wallPieces(props.wall, props.openings), props.openings).map((piece) => ({
    key: piece.key,
    position: new Vector3(...piece.position),
    rotation: new Euler(0, piece.rotationY, 0),
    size: piece.size,
    role: piece.role,
  })),
)
</script>

<template>
  <SceneFloorplanWallBox
    v-for="box in boxes"
    :key="box.key"
    :position="box.position"
    :rotation="box.rotation"
    :size="box.size"
    :role="box.role"
    :plan="plan"
  />
</template>
