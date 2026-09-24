<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useGLTF } from '@tresjs/cientos'
import { Box3, Euler, Vector3 } from 'three'
import type { Mesh, Object3D } from 'three'
import SceneFloorplanWall from './SceneFloorplanWall.vue'
import SceneFloorplanWallBox from './SceneFloorplanWallBox.vue'
import { wallPieces, dropOpeningFills } from '../utils/floorplan'
import type { FloorplanPieceRole } from '../utils/floorplan'
import { wallFaceIsSheet, wallFaceTiles, wallFaceUnusable } from '../utils/wallFace'
import type { WallFaceBounds } from '../utils/wallFace'
import type { FloorplanOpening, FloorplanWall } from '../types'

defineOptions({ name: 'TdmSceneFloorplanWallSkin' })

/**
 * 一个外观地址的**全部**墙：一份加载器，平铺到每一面墙的每一段上。
 *
 * ## 为什么是「一个 url 一个组件」，而不是「一面墙一个组件」
 *
 * `@tresjs/core` 的 `useLoader`（`dist/tres.js`）**每次调用都会 `new Loader()` 再
 * `load()`**，而全仓库的 `three.Cache` 从未打开。所以「一面墙一份 `useGLTF`」=
 * 一次完整解析 + 一份**独立的几何与贴图副本**：演示里两面墙看不出问题，
 * 一栋 40 面墙的房子会把同一张贴图上传 40 次、几百 MB 显存。
 * 按 url 分组之后，同一个外观**只加载一次**，`state.scene.clone()` 出来的多块砖
 * 按引用共享 geometry / material（`Object3D.clone()` 就是这么做的），不额外占显存。
 *
 * 还有一条是同源约束而不是性能：`useLoader` 在 `onUnmounted` 里会
 * `disposeObject3D(state.scene)`。**同一个 `state.scene` 绝不能交给两个组件**，
 * 否则先卸载的那个会把另一个正在用的几何体释放掉（表现是模型突然变黑或消失）。
 * 分组恰好让「共用一份 state」与「共用一个组件实例」成为同一件事。
 *
 * 还有第三条让 `clone()` 这条路能成立：TresJS 的 `nodeOps.remove` 对
 * `<primitive>` **默认不 dispose、也不遍历子树**，所以某个 tile 被卸载时，
 * 它与其他 tile 共享的那份 geometry / material 不会被误伤。
 *
 * ## 资产不是「整个 glb 场景」
 *
 * **量尺寸只算有厚度的网格，不算整个场景。** 一开始的写法是
 * 对 `state.scene` 一把 `Box3.setFromObject`，那假定「glb 里只有墙」——
 * 而真实的墙资产常常是**从建模时的场景里导出来的**，里面还有那块几十米见方的
 * 背景板（贴地、零厚度）。
 *
 * 一张背景板进来，后果是量级上的：量出来的「资产尺寸」变成 80 × 2.8 × 80，
 * 于是块数恒为 1、`sx = 段长 / 80`、`sz = 墙厚 / 80`，铺出来的墙是**墙正中间
 * 一片几十厘米宽、零点几毫米厚的薄片**，而背景板被压成一条细带趴在墙脚。
 * 屏幕上看到的是「铺是铺了，但只有一小块」，与「压根没铺」完全同形，
 * 而且 `wallFaceUnusable` 会放行——三个轴的尺寸都不小，它没有理由拦。
 *
 * 所以量尺寸与渲染**共用同一条逐网格的判据**（`wallFaceIsSheet`：某轴薄于 1 毫米
 * 就是片不是实体）：片不参与合并包围盒，也不跟着克隆过去。丢了几张是一条
 * **非致命**的日志（见 `notice`），不是静默行为。
 *
 * 判据只看厚度、不看「像不像墙」，是因为实体可以是一根很矮的压顶、一块很窄的砖
 * ——它们本来就在墙的包围盒里，并进去不影响结果；而片是「面」、没有体积，
 * 混进来只会把包围盒撑爆。完整的推导在 `src/utils/wallFace.ts` 的文件头。
 *
 * ## 退化时整面墙退回灰盒子
 *
 * 加载中、404、资产不达标（零厚度等）、资产里一块实体都没有、以及根本没写 url
 * —— 这几种在屏幕上是**同一个外观**（灰墙）。加载中与失败什么都不做，
 * 只有「资产本身有问题」这两种会打一条日志（见 `notice`），因为它们是仅有的
 * 「用户按提示选了模型、墙却没变、控制台里又什么都没有」的情况。
 *
 * 退化是**整组退回** `<SceneFloorplanWall>`，而不是「坏的那几段换成灰的」：
 * 半灰半贴需要一条额外的组合规则，而那条规则**只在资产坏掉时才被走到**——
 * 只出现在错误路径上的逻辑最容易烂掉。整段复用灰墙则是「改造前的那条路」本身，
 * 有现成的参照物可比。**另外，usable 时绝不能把墙段也交给灰盒子再让砖盖上去**：
 * 两者是同一个包围盒、两组共面，会逐像素 z-fighting。
 *
 * ## 渲染顺序
 *
 * 分组把渲染顺序从「按墙在配置里的先后」变成「按首次出现的外观先后」。
 * 对不透明体无所谓；半透明的玻璃由 three 按相机距离自己排序，不受影响。
 * 这一条写在这里是为了免得被当成 bug。
 *
 * ## 平面图那一档：整组不铺贴面
 *
 * 2D 正俯视下这面墙**一层贴面都不铺**，整组走下面那条 `<SceneFloorplanWall>`
 * 的退回路（换成实色画）。理由不是性能，是那一档根本看不见贴图：
 * 相机在正上方，看到的是墙的顶面，而顶面上摊的是贴图的一条横切
 * （见 `SceneFloorplanWallBox.vue` 里 `PLAN_WALL` 那段算的账）。既然看不见，
 * 那一档就该画成**读得懂的平面图**，而不是花代价去贴一层压在几像素里的纹理。
 *
 * **组件本身仍然挂载着**，只是 `layout` 返回 `null`：这样切回 3D 时那份
 * 18 MB 的 glb 已经解析好、贴图也上传过了，不用重新拉一遍。代价是切档时
 * 那批 clone 会重建一次（`layout` 不再被缓存）——切档是人手点的、很少发生，
 * 而重建本身只是 `Object3D.clone()`，比重新解析 glb 便宜得多。
 *
 * 顺带还躲开一件事：那一档里不会有「贴面与灰盒子共面」的顾虑，
 * 因为贴面那一路压根没有东西被渲染出来。
 */
const props = defineProps<{
  /** 外观模型地址。**一定是非空的**——父组件只把有 url 的墙分到这一组 */
  url: string
  /** 所有用这个外观的墙 */
  walls: FloorplanWall[]
  /** 全量洞口列表。按 `hostWallId` 挑是 `wallPieces()` 入口做的事 */
  openings: FloorplanOpening[]
  /**
   * 按平面图外观（2D 正俯视）画。
   *
   * 由 `SceneFloorplan` 从 `viewModeOf(camera)` 推出来往下传。在这一层的作用是
   * **关掉贴面那一路**，让整组落到下面的退回路上去，原因见文件头那一段。
   */
  plan?: boolean
}>()

/*
  `draco` 写死 false：墙这条链上没有 DRACOLoader，传 true 只会让加载静默失败，
  表现是「墙永远灰着」。资产要求里因此明写了不要 Draco 压缩。
*/
const { state } = useGLTF(props.url, { draco: false })

/**
 * 量一个网格的世界包围盒。
 *
 * **调用方必须先把 `updateMatrixWorld(true)` 刷过一遍**，原因见下面 `measured` 里那段
 * ——`Box3.expandByObject` 只更新「自己」、不更新祖先，所以逐网格量会踩到一个
 * 整场景一把量踩不到的坑。
 */
function meshBox(mesh: Mesh): Box3 {
  return new Box3().setFromObject(mesh)
}

/**
 * `Box3` → `WallFaceBounds`：只是换个形状，好让它能喂给 `wallFace.ts` 里
 * 那几个纯函数（三个都在公开面上，吃的是两个三元组而不是 three 的对象）。
 */
function boundsOf(box: Box3): WallFaceBounds {
  return { min: box.min.toArray(), max: box.max.toArray() }
}

/**
 * 资产里**能当墙体**的那部分量出来的尺寸，外加被丢掉的「片」有几张。
 *
 * `null` 表示**还没加载完**，与「加载完了但一张实体都没有」（`bounds: null`）
 * 是两回事：前者不该打任何日志，后者要打一条「这资产当不了墙」。
 *
 * 量法是**筛一遍再合并**：逐个网格判实体还是片（`wallFaceIsSheet`），
 * 只把实体并进包围盒。整场景一把量会把建模时那块背景板一起量进去，
 * 而那不只是「尺寸偏大」——块数与缩放全部是从这个盒子里除出来的，
 * 偏一个量级的结果是「铺了，但只有一小块」（见文件头）。
 *
 * 还有一条口径要知道：量出来的数**包含祖先节点自身的变换**（根没挂进场景时
 * `matrixWorld` 就等于它的局部矩阵，`expandByObject` 会先更新自己再递归子节点）。
 * 所以下面缩放一律打在 clone 的**外面**（多套一层组），与这里的口径一致——
 * 直接去改 clone 根自己的 `position`/`scale`，会在「资产的根带非单位变换」时
 * 算错**且不报错**。glTF 的 scene 根按规范几乎一定是单位变换，但那一层外壳
 * 让这条不再是个假设，代价是每块多一个 `Object3D`（不产生 draw call）。
 */
const measured = computed<{ bounds: WallFaceBounds | null; sheets: number } | null>(() => {
  const scene = state.value?.scene
  if (!scene) return null

  const solid = new Box3()
  let hasSolid = false
  let sheets = 0

  /*
    刷一遍整棵树的 world 矩阵，**这一步不能省**。

    `Box3.expandByObject` 里是 `object.updateWorldMatrix(false, false)`——第一个参数
    是「要不要先更新祖先」，传的是 false：它拿 `parent.matrixWorld` **当已知量用**，
    只更新自己。整场景一把量没有问题，因为那是从根开始递归、父永远先于子被更新；
    而逐网格量时，一个**非网格的父节点**（Group、Empty）根本不在我们的遍历里，
    它自己的 `matrixWorld` 就可能还是刚加载时的单位矩阵——于是它下面那个网格
    量出来的位置是错的，而错误的样子是「砖整体偏出去半个身位，不报错」。

    资产经常长这样（Blender 导出时常多一层根节点），所以这一行是必需品，
    不是保险。
  */
  scene.updateMatrixWorld(true)

  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return

    const box = meshBox(mesh)
    if (wallFaceIsSheet(boundsOf(box))) {
      sheets++
      return
    }

    solid.union(box)
    hasSolid = true
  })

  return {
    bounds: hasSolid ? { min: solid.min.toArray(), max: solid.max.toArray() } : null,
    sheets,
  }
})

/**
 * 资产不能用的原因，能用就是 `null`；加载还没完成时也是 `null`。
 *
 * 「加载中」在这一层是**没有包围盒**，不是「包围盒为零」——两种状态不能混为一谈，
 * 否则加载中会先打一条资产有问题的 warn，加载完再打一条不一样的。
 *
 * 「一张实体都没有」这一条**必须在这里**，不能留给 `wallFaceUnusable`：
 * 那个函数收到的空盒子是 `±Infinity`，它虽然也能拦下，但报出来的是
 * 「包围盒不是有限的（里面一个网格都没有，或者顶点里有 NaN）」——
 * 而这批资产的实际情况是「全是一堆片」，得说清楚，不然下一个人会去查顶点。
 */
const problem = computed(() => {
  const asset = measured.value
  if (!asset) return null
  if (!asset.bounds) return '这个资产里没有一块有厚度的网格（全是背景板、地面这类扁平片），当不了墙'
  return wallFaceUnusable(asset.bounds)
})

/**
 * 一条值得说说的事，`null` 表示没什么可说的。
 *
 * 两种，**都要说**：
 *
 * ① **致命**（资产用不了，整面墙退回灰盒子）。宿主拿不到这条链上的任何事件通道
 *   （`SceneFloorplan` 只收一个 prop、没有 emit），而「灰」是几种原因的共同外观
 *   （加载中 / 404 / 不达标 / 全是片——「没写 url」那条路根本不到这个组件），
 *   不打印的话它们完全同形，用户唯一的线索是「我按提示选了模型，墙却没变」。
 *
 * ② **非致命**（资产里有片被丢掉了）。这一条是**这一整段代码里最容易让人查半天
 *   的一种行为**：片被丢掉之后，量出来的尺寸与用户心里的「我这个模型多大」
 *   对不上，而屏幕上只有一个「怎么铺成这样」的结果。留一条日志，
 *   下次同一块背景板就变成十秒钟的事，而不是从 glb 里一层层扒。
 *
 * 前缀**不用 `[tdm]`**：那是编辑器日志的前缀，库的日志另起一个。
 *
 * 加载失败（404 / CORS / draco）**不在这里报**：three 的 `FileLoader` 自己会打，
 * 再加一条只会让控制台更难读。
 */
const notice = computed(() => {
  const asset = measured.value
  if (!asset) return null

  if (problem.value) {
    return `墙面外观「${props.url}」用不了——${problem.value}。这面墙按灰盒子画。`
  }

  if (asset.sheets > 0) {
    return (
      `墙面外观「${props.url}」里有 ${asset.sheets} 个没有厚度的网格（背景板 / 地面 / 单面片），` +
      '已忽略：墙只铺有厚度的部分。'
    )
  }

  return null
})

/**
 * 已经打过的日志。
 *
 * 挂在模块上而不是组件上：组件是**按 url 挂载**的，用户删掉最后一面这种墙、
 * 过一会儿又画一面，就是一个新实例——用实例内的标志位会把同一条日志再打一遍。
 *
 * 去重的粒度是**这一条日志本身**（消息里已经含了地址），不是地址：
 * 一个地址先后可能报出上面那两种（先「丢了 N 张片」，用户换了资产后才变成
 * 「用不了」），按地址去重会把后面那条真正要紧的吞掉。
 *
 * **这是 `src/` 里的第一处 console**，是一次先例，理由见 `notice`。
 */
const WARNED = new Set<string>()

watchEffect(() => {
  const text = notice.value
  if (!text || WARNED.has(text)) return
  WARNED.add(text)
  console.warn(`3dmaker: ${text}`)
})

/**
 * 一块砖要克隆的那个对象：**把片摘掉之后**的资产。
 *
 * 摘的是克隆，不是 `state.scene` 自己——后者是加载器持有的对象，
 * 在上面做标记（`visible = false`、改名）会变成一个跨组件的地雷：
 * 同一份 state 谁都可能再拿去用。克隆本来就是每块砖一份，摘在这里没有副作用。
 *
 * 判据与量尺寸时**同一个函数**，所以「算进尺寸的」与「画出来的」永远是同一批网格。
 * 在克隆上重跑一遍是**有意的**，不是因为拿不到原来的结果：`Object3D.clone()`
 * 按序复制子节点，两棵树一一对应，但那个对应关系是 three 的实现细节，
 * 而判据只看「某轴近乎 0」——旋转与缩放都不改变这个结论，在哪棵树上跑都一样。
 *
 * 不用遍历整棵树去删：先收集再删，是因为 `removeFromParent()` 会改 `children`，
 * 边遍历边删会跳过节点。
 */
function tileObject(scene: Object3D): Object3D {
  const clone = scene.clone()

  /*
    与 `measured` 里同一个理由（`expandByObject` 不更新祖先）刷一遍。
    克隆其实继承了对面的 `matrixWorld`（`Object3D.copy` 逐个复制它），所以这一行
    在有 `measured` 先跑过的前提下是冗余的——但它让这个函数**自己成立**，
    不依赖「谁先跑」这种调用顺序上的默契。
  */
  clone.updateMatrixWorld(true)

  const sheets: Object3D[] = []
  clone.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    if (wallFaceIsSheet(boundsOf(meshBox(mesh)))) sheets.push(mesh)
  })
  for (const sheet of sheets) sheet.removeFromParent()

  return clone
}

/** 一个待铺的方块：在碎片自己的坐标系里的位置与缩放，外加要克隆的那个模型 */
interface SkinTile {
  key: string
  offset: Vector3
  scale: Vector3
  object: Object3D
}

/** 墙里的一段：位置与朝向打在**外层**的组上，砖只在它的局部 +X 上排开 */
interface SkinSegment {
  key: string
  origin: Vector3
  rotation: Euler
  tiles: SkinTile[]
}

/** 不铺的那几个构件（门窗框 / 玻璃 / 门扇），照旧走灰盒子 */
interface SkinBox {
  key: string
  position: Vector3
  rotation: Euler
  size: [number, number, number]
  role: FloorplanPieceRole
}

interface SkinWall {
  key: string
  segments: SkinSegment[]
  boxes: SkinBox[]
}

/**
 * 该铺的东西，`null` 表示这一组整体退回灰盒子
 * （平面图那一档 / 加载中 / 失败 / 资产不达标）。
 *
 * 位置与缩放都写成 `Vector3` / `Euler` 实例而不是数组，照 `SceneModelNode.vue`
 * 的先例（TresJS 的全局组件类型把这两个 prop 标注成严格的 three 对象，
 * 数组只在运行时可用、类型上不接受）。
 *
 * **变换只打在组上，绝不去改 clone 根自己的 `position`/`scale`**，理由见
 * 上面 `bounds` 那段。旋转由**外层**组承担，tile 只在组的局部 +X 上排开——
 * 不在世界坐标里算块心，那要把局部校正量按墙的朝向再转一次，
 * 多一处手写的三角就多一处能静默镜像错的地方。
 */
const layout = computed<SkinWall[] | null>(() => {
  /*
    平面图那一档在前：它要在 `measured` 之外单独拦一次，因为下面那些
    `tileObject()` 是**每块砖一次真克隆**，算完再丢掉纯属白花（一栋房子几十面墙，
    一次切档就是几十次深拷贝）。这一条不是省事，是省事里最费事的那一步。
  */
  if (props.plan) return null

  const scene = state.value?.scene
  const asset = measured.value?.bounds
  if (!scene || !asset || problem.value) return null

  return props.walls.map((wall) => {
    /*
      抑制**必须在这里也做一遍**，而且判据要与 `SceneFloorplanWall.vue` 那条
      完全一致（同一个 `dropOpeningFills`）：这一路画的正是「贴面之外的补件」，
      也就是门窗框 / 玻璃 / 门扇这一批。有外观地址的洞口（门与窗都会写）那套构件
      由 `SceneFloorplanOpeningModel.vue` 画，这边再画一遍就是同一个包围盒上两组共面几何。

      退化那条路（下面模板里那个 `v-else`）不用另外处理：它转发给
      `SceneFloorplanWall`，那边自己会按同一判据抑制。
    */
    const pieces = dropOpeningFills(wallPieces(wall, props.openings), props.openings)
    const segments: SkinSegment[] = []
    const boxes: SkinBox[] = []

    for (const piece of pieces) {
      if (piece.role !== 'wall') {
        boxes.push({
          key: piece.key,
          position: new Vector3(...piece.position),
          rotation: new Euler(0, piece.rotationY, 0),
          size: piece.size,
          role: piece.role,
        })
        continue
      }

      segments.push({
        key: piece.key,
        origin: new Vector3(...piece.position),
        rotation: new Euler(0, piece.rotationY, 0),
        tiles: wallFaceTiles(piece, asset).map((tile) => ({
          key: tile.key,
          offset: new Vector3(...tile.offset),
          scale: new Vector3(...tile.scale),
          // clone 出来的多块砖按引用共享 geometry / material（不额外占显存），
          // 而 TresJS 对 <primitive> 不 dispose、不遍历子树，所以谁卸载都不会误伤别人。
          // 不用 SkeletonUtils.clone()：three-stdlib 不在 package.json 里
          // （只是 cientos 的传递依赖），直接 import 就是幽灵依赖——
          // 资产要求里因此写死「静态网格、不带骨骼与动画」。
          object: tileObject(scene),
        })),
      })
    }

    return { key: wall.id, segments, boxes }
  })
})
</script>

<template>
  <template v-if="layout">
    <template v-for="wall in layout" :key="wall.key">
      <!--
        两层组，一层都不能省：
        外层=这一段墙的位置与朝向，内层=这一块砖在段自己坐标系里的位置与缩放。
        缩放打在 clone 根的外面，与包围盒的测量口径一致（见 script 里那段）。
      -->
      <TresGroup
        v-for="segment in wall.segments"
        :key="segment.key"
        :position="segment.origin"
        :rotation="segment.rotation"
      >
        <TresGroup
          v-for="tile in segment.tiles"
          :key="tile.key"
          :position="tile.offset"
          :scale="tile.scale"
        >
          <primitive :object="tile.object" />
        </TresGroup>
      </TresGroup>

      <!--
        门窗构件**不铺**：框、玻璃、门扇照旧走灰盒子那套材质
        （洞口的几何照旧由 `wallPieces()` 切段，见 DESIGN.md 设计决定）。

        **不设 cast-shadow / receive-shadow**：今天墙这一侧一处都没有，
        而 `<primitive>` 不做遍历，clone 进来的网格保持 glTF 默认的
        `castShadow = false`——与灰盒子那条路完全一致，是刻意不动，不是漏了。
      -->
      <SceneFloorplanWallBox
        v-for="box in wall.boxes"
        :key="box.key"
        :position="box.position"
        :rotation="box.rotation"
        :size="box.size"
        :role="box.role"
        :plan="plan"
      />
    </template>
  </template>

  <!-- 整组退回灰墙：平面图那一档、加载中、加载失败、资产不达标，都走这里 -->
  <template v-else>
    <SceneFloorplanWall
      v-for="wall in walls"
      :key="wall.id"
      :wall="wall"
      :openings="openings"
      :plan="plan"
    />
  </template>
</template>
