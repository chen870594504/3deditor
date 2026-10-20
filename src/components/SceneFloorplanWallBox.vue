<script setup lang="ts">
import { computed } from 'vue'
import { Euler, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { FloorplanPieceRole } from '../utils/floorplan'
import { registerFloorplanNode } from '../utils/floorplanPick'
import type { FloorplanPickTarget } from '../types'

defineOptions({ name: 'TdmSceneFloorplanWallBox' })

/**
 * 户型图里的**一个**实心盒子。
 *
 * 「一面墙该切成哪些盒子」全在 `wallPieces()` 里算好，这边只负责把其中一个
 * 按 role 取一份材质、摆进模板。它自己**不做任何算术**——这是这一族的约定，
 * 出处见 `floorplan.ts` 里 `FloorplanPiece` 那段注释。唯一的例外是 `planWall`
 * 那个判断，它算的是**样式**（这一块在平面图里该是什么颜色），不是位置或尺寸。
 *
 * 为什么从 `SceneFloorplanWall.vue` 里拆出来：`PALETTE` 从此只有这一个持有者，
 * 而消费者有两个——**没有外观的整面墙**（`SceneFloorplanWall.vue` 一层层铺它），
 * 与**有外观时剩下的那些构件**（`SceneFloorplanWallSkin.vue` 在贴面之外补门窗框、
 * 玻璃、门扇）。拆之前这两条路要各抄一份调色板与材质写法。
 *
 * `plan` 那一路（2D 正俯视换成平面图外观）同样落在这里，理由与上面一样：
 * 它改的还是「这个盒子长什么样」，两条消费者都要跟着变——贴面那一版在 2D 档
 * 压根不铺贴面，剩下的构件还是走这个盒子。
 */
const props = defineProps<{
  /** 盒子中心的**世界坐标**。调用方给 `Vector3` 实例，理由见 `SceneModelNode.vue:74-76` */
  position: Vector3
  /** 绕 y 轴的朝向。同样给实例，不给数组 */
  rotation: Euler
  /** `[沿墙长, 竖直高, 垂直墙厚]`。这里会原样喂给 `TresBoxGeometry` 的 `args` */
  size: [number, number, number]
  /** 取哪一份材质 */
  role: FloorplanPieceRole
  /**
   * 这一块点下去算选中谁。**必填**：三个调用点（灰墙、贴面墙的补件、洞口模型
   * 退化时那批构件）一个都不能漏，漏了的表现是「这一块点不中」而不是编译错误
   * ——所以这里不给可选默认值。
   *
   * 判据在 `pickTargetOfPiece`（`openingId` 有就是洞口，没有就是墙），
   * 组件自己不猜。
   */
  pick: FloorplanPickTarget
  /**
   * 按**平面图外观**（2D 正俯视那一档）画，而不是按 3D 的材质画。
   *
   * 只有 `wall` 这一个 role 会因此改变，见下面 `planWall` 那段。
   */
  plan?: boolean
  /**
   * **墙身**的不透明度（0–1）。**只作用于 `role === 'wall'`**。
   *
   * 门窗框 / 玻璃 / 门扇刻意不受它影响，两个理由：
   * ① 玻璃在调色板里已经是 0.26，再乘一次 0.3 会淡到几乎看不见——用户拖的是
   *    「墙」，不是「窗玻璃」；② 门窗是独立的实体，墙透明时它们跟着一起消失，
   *    会让人以为门窗被删掉了。
   *
   * 值来自 `floorplan.wallOpacity`（全局量，见 `types.ts` 那条注释）。
   * 缺省按 1 处理；导入的配置把它写坏成 2 或 -1 时在这里夹回 0–1——
   * 面板的滑杆保证了正常路径，但配置是宿主自己也能写的。
   */
  opacity?: number
  /**
   * 是否投射 / 接收阴影（只有 Shadow Map 方式为真，判据在 `SceneContent`）。
   *
   * 这两个标记对 `MeshBasicMaterial`（2D 档的实色墙）里「接收」那一半不起作用
   * ——Basic 材质不参与光照——但「投射」那一半照常：深度图渲的是几何，
   * 不看材质。所以 2D 档开 `map` 时墙依然会投出影子，这是可接受的：
   * 那一档本来就是俯视看影子往哪边落。
   */
  castShadow?: boolean
  receiveShadow?: boolean
}>()

/**
 * 每种碎片长什么样。
 *
 * 写成一张按 role 索引的表，而不是模板里一条 v-if 链：`wallPieces` 产出的
 * role 一共五种，加一种就是加一行；而 v-if 链在加 role 时会**静默漏掉**
 * 新角色（落到最后的 else 分支上，看起来是一块颜色不对的墙）。
 *
 * 玻璃刻意**不用 `transmission`**：three 0.186 上它会拉一张离屏传输贴图，
 * 代价与「一块窗玻璃」完全不匹配，还多挂一个 `renderer.transmissionResolutionScale`
 * 这类新字段。半透明 `opacity` 的观感差别肉眼很难分辨，代价差一个量级。
 */
const PALETTE: Record<FloorplanPieceRole, {
  color: string
  roughness: number
  metalness: number
  opacity?: number
}> = {
  wall: { color: '#e2e8f0', roughness: 0.92, metalness: 0.02 },
  // 门窗套：深一号的石板灰，与墙拉开对比才看得出「这里有个洞」
  frame: { color: '#64748b', roughness: 0.6, metalness: 0.1 },
  glass: { color: '#bae6fd', roughness: 0.08, metalness: 0, opacity: 0.26 },
  // 门扇：浅橡木色
  leaf: { color: '#b08d57', roughness: 0.7, metalness: 0.02 },
  slab: { color: '#cbd5e1', roughness: 0.95, metalness: 0.02 },
}

/**
 * 平面图那一档的墙体色。
 *
 * **平面图里墙要「实」**：那一档的相机在正上方（编辑器进来时是 110 米高，
 * 见 `useViewMode` 的 `TOP_DISTANCE`），墙的侧面完全看不见，看到的只有顶面；
 * 而顶面上摊的是贴图的**一条横切**（`wall1` 这块 4 × 2.8 × 0.2 的墙板，
 * 顶面的 v 跨度只有 0.067 —— 两厘米出头的纹理铺满 4 米长，压成一道色带）。
 * 于是在那一档里，贴图既看不出是什么、又吃掉一次采样，不如换成实色。
 *
 * 颜色要同时躲开三样东西，这是它取这个值的全部理由：
 *
 * - **地基板**（`SceneFloorplanFoundation.vue` 的 `#94a3b8`，一块浅灰的板）
 *   —— 要明显更暗，墙才从楼板里跳出来；
 * - **网格线**（`#1e293b` / `#334155`）—— 要不与线同色，否则墙会被读成一根主分隔线；
 * - **背景**（默认 `#0b1020`）—— 要明显更亮，没铺地基的地方墙也得看得见。
 *
 * `#475569` 正好落在这三者中间。
 */
const PLAN_WALL = '#475569'

/**
 * 平面图那一档的**过梁**色。
 *
 * 判据只有一个：**底面离地**。`wallPieces` 只给「洞口上下的补墙」产出底面离地的
 * `wall` 碎片——窗台下的矮墙底面是 0，过梁的底面在洞口顶（门 2.1 米、窗 2.1 米），
 * 于是「抬在空中的那一块」就是过梁。
 *
 * 为什么必须单给它一支颜色：**正上方看到的洞口就是过梁的顶面**。框、玻璃、门扇
 * 都比墙薄（`frameDepth = 厚度 × 比例`、玻璃 0.02、门扇 0.045），全都躲在过梁底下。
 * 过梁若与墙同色，门窗在平面图里**整个消失**——一个画好的房子在俯视图里看不出
 * 哪里有门、哪里有窗。给它一支浅色，洞口就成了一道亮口，这正是平面图画门窗的办法。
 *
 * 这条判断放在这里、而不是去 `wallPieces` 里给过梁单独一个 role（类型里那个
 * 从没被用过的 `slab` 看着正像是为此预留的），是因为铺贴面那条路只认
 * `role === 'wall'` 的碎片：改了 role，过梁在 3D 里就不再铺墙资产的贴图了。
 * 一行判断换掉一处 3D 行为，不划算。
 */
const PLAN_LINTEL = '#cbd5e1'

/**
 * 平面图外观下这一块该用哪支颜色；`null` 表示**照 3D 那一套画**。
 *
 * 只有 `wall` 会拿到非 `null`，其余四种构件（框 / 玻璃 / 门扇 / `slab`）
 * 照旧——它们从正上方都被过梁盖住，改它们等于改看不见的东西。
 *
 * 这里算的是**样式**（这一块长什么样），不是几何：位置与尺寸仍然是
 * `wallPieces` 算好的，组件照旧不做任何几何算术。
 */
const planWall = computed<string | null>(() => {
  if (!props.plan || props.role !== 'wall') return null

  const bottom = props.position.y - props.size[1] / 2
  return bottom > 1e-6 ? PLAN_LINTEL : PLAN_WALL
})

/**
 * 这一块最终的不透明度。
 *
 * 墙身吃 `opacity`，其余角色照旧吃调色板（玻璃那一项是 0.26，是本文件里唯一
 * 半透明的构件）。夹取只做在墙身这一支：调色板是自己的常量，不需要防；
 * 而 `opacity` 来自配置，宿主可以写进任何数。
 */
const materialOpacity = computed(() => {
  if (props.role === 'wall') {
    const value = props.opacity ?? 1
    return Math.min(1, Math.max(0, value))
  }

  return PALETTE[props.role].opacity ?? 1
})

/**
 * 是否走透明队列。
 *
 * 墙身按「不透明度小于 1」判，其余角色照旧按调色板里有没有写 `opacity` 判。
 * 玻璃那条因此完全不受墙的滑杆影响——两条判据分开写，而不是
 * `opacity < 1 || PALETTE...` 混成一句。
 */
const materialTransparent = computed(() =>
  props.role === 'wall'
    ? materialOpacity.value < 1
    : PALETTE[props.role].opacity !== undefined,
)

/**
 * 半透明的墙**不写深度**。
 *
 * 写了的话，近处那面墙会先把自己的深度写进缓冲，于是透过它本应看到的那面远墙
 * 在深度测试里整片失败——画面上不是「两堵半透明的墙叠在一起」，而是近墙背后
 * 一片空白，看起来像远墙凭空消失了。这正是 `SceneGround` / `SceneFloorplanDraft`
 * 那两处写 `depth-write=false` 的同一个理由。
 *
 * 只对墙身开口：玻璃维持改造前的行为（透明、但仍写深度），那是既有观感，
 * 这一轮不顺手改它。
 */
const materialDepthWrite = computed(
  () => !(props.role === 'wall' && materialTransparent.value),
)

/**
 * 根 mesh 的函数 ref：挂载时把它登记进户型点选簿。
 *
 * 入参是 TresJS 建的那只裸 mesh，照 `SceneModelNode.vue:128-133` 的先例。
 * **不能用字符串 ref + watch**：登记要与拿到对象同步发生，而 `ScenePicker`
 * 的命中判据随时可能跑；晚一拍的表现是「刚渲染出来的墙要再点一次才选得中」。
 *
 * 只在拿到对象时登记（卸载时入参是 `null`）。WeakMap 会让条目随对象回收，
 * 不需要反登记。同一块砖的 key 不会换身份，所以 `pick` 变了也不需要重登——
 * 真正会换的是「这条配置被删掉、另一个 id 顶上同一个 key」，而 key 本身带着
 * 洞口 id / 墙内位置，那种情况会换一个组件实例。
 */
function onMeshRef(element: unknown) {
  const mesh = (element ?? null) as Object3D | null
  if (mesh) registerFloorplanNode(mesh, props.pick)
}
</script>

<template>
  <TresMesh
    :ref="onMeshRef"
    :position="position"
    :rotation="rotation"
    :cast-shadow="castShadow"
    :receive-shadow="receiveShadow"
  >
    <TresBoxGeometry :args="size" />
    <!--
      平面图那一档：`MeshBasicMaterial` 是**不受光**的，颜色就是屏幕上那个颜色。

      这一档不能用 `MeshStandardMaterial` 加深颜色糊弄过去：主光 2.2 + 环境光 1.8
      （`DEFAULT_SCENE_CONFIG.light`）下，正对相机的顶面会被顶到接近纯白，
      任何深色都会被提亮到看不出差别——调色板上的数值在这一档里没有意义。
      先例是 `SceneFloorplanDraft.vue` 那道琥珀色的草稿条，用的也是 Basic。
    -->
    <TresMeshBasicMaterial
      v-if="planWall"
      :color="planWall"
      :opacity="materialOpacity"
      :transparent="materialTransparent"
      :depth-write="materialDepthWrite"
    />
    <TresMeshStandardMaterial
      v-else
      :color="PALETTE[role].color"
      :roughness="PALETTE[role].roughness"
      :metalness="PALETTE[role].metalness"
      :opacity="materialOpacity"
      :transparent="materialTransparent"
      :depth-write="materialDepthWrite"
    />
  </TresMesh>
</template>
