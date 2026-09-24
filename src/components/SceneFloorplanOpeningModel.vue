<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useGLTF } from '@tresjs/cientos'
import { Box3, Euler, Vector3 } from 'three'
import type { Mesh, Object3D } from 'three'
import SceneFloorplanWallBox from './SceneFloorplanWallBox.vue'
import { wallPieces } from '../utils/floorplan'
import type { FloorplanPiece, FloorplanPieceRole } from '../utils/floorplan'
import {
  openingFaceOversized,
  openingFaceUnusable,
  wallFaceFit,
  wallFaceIsSheet,
} from '../utils/wallFace'
import type { WallFaceBounds } from '../utils/wallFace'
import type { FloorplanOpening, FloorplanOpeningKind, FloorplanWall } from '../types'

defineOptions({ name: 'TdmSceneFloorplanOpeningModel' })

/**
 * 一个外观地址的**全部洞口**（门与窗）：一份加载器，装到每一个写了这个地址的洞口上。
 *
 * 「一个地址一个组件」这条与 `SceneFloorplanWallSkin.vue` 完全同源，那边的文件头
 * 有完整的三条理由（`useLoader` 每次调用都 `new Loader()`、`three.Cache` 从未打开、
 * 同一个 `state.scene` 绝不能交给两个组件），这里不重复。**新增一条它没有的**：
 *
 * **同一个地址不能既当墙皮又当洞口那一件。** 两条链各自按 url 分组，若某个 url
 * 同时出现在 `wall.url` 与 `opening.url` 上，就会各加载一份；而 `useLoader` 卸载时会
 * `disposeObject3D(state.scene)`，先卸载的那一份会把另一份正在用的几何体释放掉
 * （表现是模型突然变黑或消失）。**这是用法上的约束，不是代码里的检查**——
 * 库里不会有人把一块砖填进洞口，但自建配置的人可能，所以写在这里。
 *
 * ## 门与窗走的是同一条链
 *
 * 两者在几何上是**同一件事**：洞口的墙被切开、洞里那一件换成一件真资产。
 * 差别只有**两处**，都在下面的 `fillRole` 与 `noun` 里：
 *
 * - **替身碎片不同**——门填的是门扇（`role: 'leaf'`，4.5 厘米厚），
 *   窗填的是玻璃（`role: 'glass'`，2 厘米厚）。两者都带着洞宽、洞高、世界位置与
 *   墙的朝向，所以「取位置」这一步对两者是同一句话（见 `layout`）。
 * - **人话里的名词不同**——「门模型」/「窗模型」、「一扇门」/「一扇窗」。
 *
 * 尺寸检查与摆放算术**一个字都不分岔**（`openingFaceUnusable` / `wallFaceFit`），
 * 因为判据本来就是「一件资产装进一个洞口」，与那件事是门还是窗无关。
 *
 * ## 这一组与墙那一组的**唯一不变量**
 *
 * 「有外观地址的洞口，它那套内饰件（框条 / 中竖梃 / 门扇 / 玻璃）在整个场景里
 * **只被画一次**」。墙那侧（`SceneFloorplanWall` 与 `SceneFloorplanWallSkin`）
 * 无条件抑制，本组件**无条件接手它抑制掉的那一批**：装得上就装模型，装不上
 * （加载中 / 404 / 资产不达标 / 2D 档）就把那批碎片原样画成盒子。
 *
 * 两边判的**不是同一件事**：墙侧只能按「这个洞口有没有地址」判（它拿不到本组件的
 * 加载状态），而本组件还要多判一层「资产到底能不能用」。两者一旦错位，得到的是
 * 「两边都画」（z-fighting）或者「两边都不画」（洞口空着，过梁还亮着）。
 * 所以**退化那一路必须画的是被打掉的那批碎片本身**，不能是别的东西。
 *
 * ## 尺寸：按高度等比装进洞口
 *
 * 摆法取 `wallPieces` 吐出来的**那一件填充分片**（门扇或玻璃）：它带着洞宽、洞高、
 * 世界位置与朝向，于是本组件一行几何算术都不用写。缩放的算术在 `wallFaceFit`
 * （与墙皮平铺共用 `place()`），量尺寸的口径在下面 `measured`。
 *
 * 那一步是**三轴同一个系数**（由「洞高 ÷ 资产高」定），所以资产高顶满洞口，
 * 宽与厚跟着资产自身的比例走，**不会被挤扁**。比洞口宽的部分嵌进墙里被墙面挡住，
 * 比洞口窄时两侧露一条缝——都比把资产扭成洞口的比例好。照洞口尺寸建的资产
 * （高 2.1 的门、高 1.2 的窗）缩放系数正好是 1，一个顶点都不动。
 * 完整理由写在 `wallFaceFit` 上。
 */
const props = defineProps<{
  /** 这一个地址。同址的门洞与窗洞全在这一组里 */
  url: string
  /**
   * 这个地址的每一个洞口，**连同它的宿主墙**。
   *
   * 宿主墙是分组时由 `SceneFloorplan` 从 `hostWallId` 查出来配上的——本组件拿不到
   * 全量 `walls`（那会让「配置里哪一条对应场景里哪一个物体」变模糊），而
   * `wallPieces()` 要一个 `FloorplanWall` 才吐得出世界坐标。
   *
   * **查不到宿主墙的洞口不会出现在这里**（孤儿洞口，导入的配置可能有），
   * 与既有渲染路径一样静默跳过：`removeWall` 会级联删洞口，但手写或旧版本的
   * 配置绕得过它，而那种洞口在画面上本来就无处可画。
   */
  openings: { wall: FloorplanWall; opening: FloorplanOpening }[]
  /**
   * 按平面图外观（2D 正俯视）画——**整组关掉模型，回到程序构件**。
   *
   * 与贴面墙那一档同一个做法（那边是 `if (props.plan) return null`），理由也一样：
   * 2D 档下贴图既看不出是什么、又白吃一次采样，而这里的模型比贴图更糟——
   * 从正上方看到的是一块被拉扁的顶面。**组件仍然挂载**，只是不摆东西：
   * 在父级写 `v-if="!plan"` 会让切回 3D 时重新拉一遍 glb，
   * 而这里只是重建 clone。
   */
  plan?: boolean
}>()

/*
  `draco` 写死 false，与墙那条链同一个理由：这边没有 DRACOLoader，传 true 只会让
  加载静默失败，表现是「门永远灰着」。资产要求里因此明写了不要 Draco 压缩。
*/
const { state } = useGLTF(props.url, { draco: false })

/**
 * 这个洞口里那一件填充物是哪个碎片——门是门扇，窗是玻璃。
 *
 * 这一份对应关系**只存在于 `floorplan.ts` 与这里两处**（那边写入、这边读出），
 * 而它不能各写一份：写的是 `leaf`、读的是 `glass` 时，表现为「墙那侧把内饰件抑制掉了、
 * 这里又找不到替身」，洞口整个空着——不报错，只是房子上多了一个洞。
 */
function fillRole(kind: FloorplanOpeningKind): FloorplanPieceRole {
  return kind === 'door' ? 'leaf' : 'glass'
}

/**
 * 人话里的名词。门与窗在这条链上唯一的另一处分岔。
 *
 * 一条日志里的名词取**这一组的第一个洞口**：同一个地址既当门又当窗是用法上的怪事
 * （同一件资产在两个用途上尺寸要求相同，但看起来会很奇怪），而尺寸检查的结论对
 * 整组是一致的（阈值相同、只有名词不同），所以取第一个不会说错事实。
 */
const noun = computed(() => (props.openings[0]?.opening.kind === 'window' ? '窗' : '门'))

/** `Box3` → `WallFaceBounds`：只是换个形状，好喂给 `wallFace.ts` 那几个纯函数 */
function boundsOf(box: Box3): WallFaceBounds {
  return { min: box.min.toArray(), max: box.max.toArray() }
}

/**
 * 资产里**算数的那部分**量出来的尺寸。`null` 表示还没加载完，或者一张实体都没有。
 *
 * 口径与 `SceneFloorplanWallSkin.vue` 的 `measured` 一字不差，包括那两处最容易
 * 出错的地方：`updateMatrixWorld(true)` 必须先刷一遍（`Box3.expandByObject`
 * 只更新自己、不更新祖先，逐网格量时父节点的 `matrixWorld` 可能还是单位矩阵），
 * 以及**逐网格判片**（一块 80 × 0 × 80 的背景板进来，量出来的门是 80 米宽，
 * 除出来是一张肉眼看不见的薄片，而且不报错）。
 *
 * 「一片门扇 / 一片玻璃是薄片、不该被筛掉」这个担心不成立：判据是**最小那一轴
 * < 1 毫米**（`wallFaceIsSheet`），而门扇是 0.045 米厚、玻璃是 0.02 米厚。
 * 会被筛掉的只有零厚度的面——那种资产装上去本来就是一张单面片（背面看不见），
 * 不是这里的取舍。
 */
const measured = computed<WallFaceBounds | null>(() => {
  const scene = state.value?.scene
  if (!scene) return null

  scene.updateMatrixWorld(true)

  const solid = new Box3()
  let hasSolid = false

  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return

    const box = new Box3().setFromObject(mesh)
    if (wallFaceIsSheet(boundsOf(box))) return

    solid.union(box)
    hasSolid = true
  })

  return hasSolid ? { min: solid.min.toArray(), max: solid.max.toArray() } : null
})

/**
 * 资产不能用的原因，能用就是 `null`；加载还没完成时也是 `null`。
 *
 * 用 `openingFaceUnusable` 而不是 `wallFaceUnusable`：后者的第 ③ 条里有一条
 * 「模型没有厚度，铺不出墙体——墙的资产要是一个盒子」，那是墙的标准，而洞口里
 * 那一件的厚度本来就是拉伸出来的。这一句会**原样进 `console.warn`**，
 * 拿墙的话去说门或窗的问题会把下一个人指去查错的链。
 */
const problem = computed(() => {
  const asset = measured.value
  if (!asset) return null
  return openingFaceUnusable(asset, props.openings[0]?.opening.kind ?? 'door')
})

/**
 * 资产**装进去之后横着撑得太开**，`null` 表示没什么可说的。
 *
 * 判据是 `openingFaceOversized`（那边有完整理由），这里只负责把每一个洞口都过一遍：
 * 缩放是按每个洞口的碎片各算一次，所以同一份资产在一扇宽门里撑得开、在窄门里
 * 更撑得开——取**第一个报出来的**就够（同一份资产同一批洞口，说的是同一件事）。
 *
 * 每个洞口传**它自己的 kind**：一组里混着门与窗时，那句话里的名词才是对的。
 *
 * 再看一遍 `wallPieces` 而不是从 `layout` 里顺手带出来：`layout` 是 computed，
 * 往里写状态就是副作用的来源（`boxes` 本来也是重算一遍的，这里同一套口径）。
 * 用的是纯函数，代价是一面墙一次的算术。
 *
 * `plan` 那一档不看：那时摆的根本不是这个模型（走 `boxes` 那条路），
 * 报一句「装进去之后」的话是在说一件没发生的事。资产没量出来时同理——
 * 那种情况下 `notice` 上半段已经有更准的话了。
 */
const oversized = computed(() => {
  const asset = measured.value
  if (!asset || problem.value || props.plan) return null

  for (const { wall, opening } of props.openings) {
    const fill = wallPieces(wall, [opening]).find(
      (piece) => piece.role === fillRole(opening.kind) && piece.openingId === opening.id,
    )
    if (!fill) continue

    const text = openingFaceOversized(fill, asset, opening.kind)
    if (text) return text
  }

  return null
})

/**
 * 一条值得说说的事，`null` 表示没什么可说的。
 *
 * 与 `SceneFloorplanWallSkin.vue` 的 `notice` 同一套（那边有完整理由），三种：
 * ① **致命**——资产用不了，洞口退回程序构件，屏幕上是「灰」的四种原因之一
 *   （加载中 / 404 / 不达标 / 全是片），不打日志就完全同形；② **非致命**——
 *   资产里有零厚度的片被丢掉了，量出来的尺寸与用户心里那个对不上；
 *   ③ **非致命**——资产量出来比一个洞口大得多（多半混进了地面墙面），
 *   摆法没错但画面上说不清哪里不对。
 *
 * 加载失败（404 / CORS / draco）**不在这里报**：three 的 `FileLoader` 自己会打。
 */
const notice = computed(() => {
  const asset = measured.value
  if (!asset) {
    return state.value?.scene
      ? `${noun.value}模型「${props.url}」里没有一块有厚度的网格（全是背景板、地面这类扁平片），装不了${noun.value}。${noun.value}洞按程序构件画。`
      : null
  }

  if (problem.value) {
    return `${noun.value}模型「${props.url}」用不了——${problem.value}。${noun.value}洞按程序构件画。`
  }

  if (oversized.value) {
    return `${noun.value}模型「${props.url}」${oversized.value}。${noun.value}照常装上，但那一份多半不是一扇${noun.value}——请检查资产的导出范围。`
  }

  return null
})

/**
 * 已经打过的日志。去重粒度是**这一条日志本身**（消息里含地址），不是地址。
 *
 * 挂在模块上而不是组件上：组件是**按 url 挂载**的，用户删掉最后一个这种洞口、
 * 过一会儿再放一个，就是一个新实例——实例内的标志位会把同一条日志再打一遍。
 * 这套照抄 `SceneFloorplanWallSkin.vue` 的先例。
 */
const WARNED = new Set<string>()

watchEffect(() => {
  const text = notice.value
  if (!text || WARNED.has(text)) return
  WARNED.add(text)
  console.warn(`3dmaker: ${text}`)
})

/**
 * 一件要克隆的资产：**把零厚度的片摘掉之后**的那份。
 *
 * 摘的是克隆，不是 `state.scene` 自己——后者是加载器持有的对象，在上面做标记
 * 会变成跨组件的地雷（同一份 state 谁都可能再拿去用）。判据与 `measured` 是
 * 同一个函数，所以「算进尺寸的」与「画出来的」永远是同一批网格。
 *
 * 与 `SceneFloorplanWallSkin.tileObject` 是同一段代码，**仍然分开写**：那边挂在
 * 「一块砖」上、这边挂在「一个洞口」上，两处的卸载时机与数量都不同，将来要各自调整
 * （比如洞口要投影、砖不要）时不必先把这个函数拆开。真到第三处时再抽，不是现在。
 */
function openingObject(scene: Object3D): Object3D {
  const clone = scene.clone()
  clone.updateMatrixWorld(true)

  const sheets: Object3D[] = []
  clone.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.isMesh && wallFaceIsSheet(boundsOf(new Box3().setFromObject(mesh)))) {
      sheets.push(object)
    }
  })

  // 先收集再删：`removeFromParent()` 会改 `children`，边遍历边删会跳过节点
  for (const sheet of sheets) sheet.removeFromParent()
  return clone
}

/** 一件摆好的资产：位置与朝向打在**外层**组上，校正量与缩放打在**内层**组上 */
interface OpeningNode {
  /** v-for 的 key。用洞口 id，不用下标——中间删掉一个时下标会让后面每个都重挂 */
  key: string
  position: Vector3
  rotation: Euler
  /** 在内层组自己的坐标系里，资产该摆在哪 */
  offset: Vector3
  scale: Vector3
  object: Object3D
}

/**
 * 每个洞口那一件该摆在哪、放大到多少。
 *
 * 取 `wallPieces(wall, [opening])` 里**这个洞口自己的填充分片**（门扇 / 玻璃）当
 * **洞口的替身**：它带着洞宽、洞高、世界位置与墙的朝向，于是这里一行三角函数
 * 都不用写（`wallPieces` 那条链已经有完整的注释解释这套坐标约定）。
 * 窗洞的替身在竖直方向是**抬起来**的（窗台高度进了碎片的位置），而这里只读
 * 碎片给的数、不自己算高度——这也是「取替身」比「按洞口参数自己摆」可靠的地方。
 *
 * **两层组一层都不能省**，与 `SceneFloorplanWallSkin.vue` 同一个道理：
 * 量出来的包围盒**包含资产根节点自身的变换**，所以缩放必须打在 clone 的**外面**
 * ——直接去改 clone 根的 `position` / `scale`，会在「资产的根带非单位变换」时
 * 算错且不报错。而 `offset` 又必须与 `scale` 在**同一层**里（组的 scale 只作用到
 * 子节点、不缩自己的 position），所以是「外层位置朝向 + 内层校正缩放」两层。
 *
 * `plan` 那一档直接返回 `null`：整组回到程序构件。**这一句必须在克隆之前**，
 * 否则每次切档就是每个洞口一次深拷贝（贴面那边有同样的注释，理由一字不差）。
 */
const layout = computed<OpeningNode[] | null>(() => {
  if (props.plan) return null

  const scene = state.value?.scene
  const asset = measured.value
  if (!scene || !asset || problem.value) return null

  const nodes: OpeningNode[] = []

  for (const { wall, opening } of props.openings) {
    const fill = wallPieces(wall, [opening]).find(
      (piece: FloorplanPiece) =>
        piece.role === fillRole(opening.kind) && piece.openingId === opening.id,
    )
    // 宿主墙对不上（孤儿洞口）或洞口已经被裁掉：这一件无处可摆，跳过
    if (!fill) continue

    const fit = wallFaceFit(fill, asset)
    nodes.push({
      key: opening.id,
      position: new Vector3(...fill.position),
      rotation: new Euler(0, fill.rotationY, 0),
      offset: new Vector3(...fit.offset),
      scale: new Vector3(...fit.scale),
      object: openingObject(scene),
    })
  }

  return nodes
})

/**
 * 装不上时画的那批碎片：这个洞口自己的框条 / 中竖梃 / 门扇 / 玻璃。
 *
 * **取的是 `wallPieces` 的原样输出**，不是这里另造一套：墙那侧抑制掉的正是这一批
 * （按 `openingId` 对得上），所以两边画的永远是同一批几何，观感与改造前完全一致。
 * 同一次 `wallPieces` 调用里还带着这面墙的墙段，那些由墙组件负责，这里按
 * `openingId` 滤掉——多画一遍就是 z-fighting。
 *
 * `plan` 那一档走的也是这一路（`layout` 为 `null`），于是 2D 里看到的是盒子而不是
 * 一块压扁的模型，与 2D 档的墙一致。
 */
const boxes = computed(() =>
  props.openings.flatMap(({ wall, opening }) =>
    wallPieces(wall, [opening])
      .filter((piece) => piece.openingId === opening.id)
      .map((piece) => ({
        key: piece.key,
        position: new Vector3(...piece.position),
        rotation: new Euler(0, piece.rotationY, 0),
        size: piece.size,
        role: piece.role as FloorplanPieceRole,
      })),
  ),
)
</script>

<template>
  <!--
    两条路**二选一**，与墙那两条路是同一条约定：同一个包围盒上两组共面几何会
    逐像素 z-fighting（DESIGN.md 设计决定 32 / 33 都记着这一条）。
  -->
  <template v-if="layout">
    <TresGroup
      v-for="node in layout"
      :key="node.key"
      :position="node.position"
      :rotation="node.rotation"
    >
      <TresGroup :position="node.offset" :scale="node.scale">
        <!--
          不设 cast-shadow / receive-shadow：与墙那侧完全一致（今天户型图这一支
          一处都没有），`<primitive>` 不做遍历，clone 进来的网格保持 glTF 默认的
          `castShadow = false`。**顺带记一笔**：真要让洞口那一件投影，只改这里的
          castShadow 不够——户型图不在 `SceneContent` 的烘焙 key 里，深度图不会重烘，
          影子永远缺。
        -->
        <primitive :object="node.object" />
      </TresGroup>
    </TresGroup>
  </template>

  <template v-else>
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
</template>
