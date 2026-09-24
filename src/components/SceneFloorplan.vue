<script setup lang="ts">
import { computed } from 'vue'
import SceneFloorplanFoundation from './SceneFloorplanFoundation.vue'
import SceneFloorplanRoom from './SceneFloorplanRoom.vue'
import SceneFloorplanWall from './SceneFloorplanWall.vue'
import SceneFloorplanWallSkin from './SceneFloorplanWallSkin.vue'
import SceneFloorplanOpeningModel from './SceneFloorplanOpeningModel.vue'
import { openingFilledByModel } from '../utils/floorplan'
import type { FloorplanConfig, FloorplanOpening, FloorplanWall } from '../types'

defineOptions({ name: 'TdmSceneFloorplan' })

/**
 * 户型图的顶层分发：地基 → 房间 → 墙。
 *
 * 它自己不做几何计算，只把配置里的三张表铺成对应的组件，外加**按外观地址
 * 分两次组**：墙一次（`styled`），写了外观地址的洞口一次（`openingModels`，
 * 它多一步把洞口的宿主墙找出来配上）。**灰盒子那条路没有包裹 Group**
 * ——每个碎片的 `position` 与世界坐标一致（见 `wallPieces`），
 * 多套一层只会让「场景里哪个物体对应配置里哪一条」变模糊。
 *
 * **带外观的那两组是刻意的例外**：贴面墙那一组里面套了两层组（段一层、砖一层），
 * 洞口那一组也一样（洞口位置与朝向一层、资产的校正量与缩放一层），因为校正量必须在
 * **碎片自己的坐标系**里算（`wallFaceFit` / `wallFaceTiles` 吐的就是局部坐标）。
 * 把这句改掉之前先想清楚：拆了那两层，模型会按世界坐标摆、整体错位，
 * 而且不会报错。
 *
 * **同一条几何只能被画一次。** 有外观的墙只在 `SceneFloorplanWallSkin` 里出现，
 * 有外观的洞口内饰件只在 `SceneFloorplanOpeningModel` 里出现——墙那两条路会按同一个判据
 * 把它们抑制掉。两处判据各写一遍的下场是同一个包围盒上两组共面几何、
 * 逐像素 z-fighting，所以判据只有 `openingFilledByModel` 这一个实现。
 *
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 README「TD 层不使用 Pinia」）。
 *
 * **画到一半的东西不在这里。** 库只渲染「已经落进配置的房子」，
 * 半截墙链、拖拽中的地基矩形是编辑态，走 `SceneViewer` 的 `#scene` 插槽，
 * 由游乐场自己渲染。这条分工线正是「`SceneConfig` 只放可 JSON 往返的数据」
 * 那条约定落在模板上的样子：**能进配置的由库渲染，不能进配置的由编辑器渲染。**
 *
 * 空配置（默认那份：没有地基、没有墙）在这里渲染不出任何东西，
 * 视口里只剩地面与光照，与 `models: []` 的空场景是同一套处理。
 */
const props = defineProps<{
  floorplan: FloorplanConfig
  /**
   * 按**平面图外观**画（2D 正俯视那一档）——墙换成实色、不铺贴面。
   *
   * 为什么这一层需要知道档位：墙的外观有两条路（贴面 / 灰盒子），而它们在
   * 正俯视下**都不好看**——贴面看到的是一条压扁的横切，灰盒子在 2.2 的主光下
   * 过曝到接近纯白。两种都得换，所以判断得发生在**分流之前**，也就是这里。
   *
   * 值由 `SceneContent` 从 `viewModeOf(camera)` 推出来往下传：档位是**从机位
   * 推导**的，而机位只在 `SceneContent` 那一层拿得到（这一层在 TD 层，不读 Pinia）。
   * 给默认值 `false`（= 照 3D 画），所以既有调用方一个字不用改。
   *
   * 判据只有一个来源（`viewModeOf`），不能在这里自己再推一遍：两份实现悄悄
   * 不一致的表现是「按钮亮着 2D、墙却铺着贴面」，看起来只是渲染错了。
   */
  plan?: boolean
}>()

/**
 * 有外观的墙，**按地址分组**。
 *
 * 分组的理由全在 `SceneFloorplanWallSkin.vue` 的文件头（一份 `useGLTF` 解析一次、
 * 一份贴图只上传一次、同一个 `state.scene` 不能交给两个组件）。这里只说分组规则：
 * 按 url 去重，**保持配置里的先后**——第一个出现的地址排在最前面，
 * 于是渲染顺序是可预期的，不随 `Map` 的迭代细节漂。
 *
 * key 用 url（在模板里）：配置每写一次，`cloneFloorplanPatch` 会把 walls 里
 * 每个墙对象换成新对象（它是 `{...wall}`），用 key 兜住之后组件不重挂、
 * 加载器也不会跟着重跑一遍——这是分组方案能成立的关键。
 */
const styled = computed<{ url: string; walls: FloorplanWall[] }[]>(() => {
  const groups: { url: string; walls: FloorplanWall[] }[] = []
  const at = new Map<string, number>()

  for (const wall of props.floorplan.walls) {
    const url = wall.url
    if (!url) continue

    const index = at.get(url)
    if (index === undefined) {
      at.set(url, groups.length)
      groups.push({ url, walls: [wall] })
    } else {
      groups[index].walls.push(wall)
    }
  }

  return groups
})

/**
 * 没写外观的墙：一面一个灰盒子，与改造前完全一样。
 *
 * 它和 `styled` 是**互补**的两半（判据都是 `wall.url` 的真假），所以一面墙
 * 只会在其中一边出现一次。两边都漏掉一面墙的表现是「画了墙但什么都没出现」，
 * 比多画一次显眼得多。
 */
const plain = computed(() => props.floorplan.walls.filter((wall) => !wall.url))

/**
 * 写了外观地址的洞口（门与窗都走这里），**按地址分组**，每组带上它的宿主墙。
 *
 * 分组规则与 `styled` 一字不差（按 url 去重、保持配置里的先后、key 用 url），
 * 理由见那边那段。**多出来的一步是把这个洞口的宿主墙找出来配上**——
 * 洞口自己只有 `hostWallId`，而 `wallPieces()` 要一个真的 `FloorplanWall`
 * 才吐得出世界坐标（那一片填充分片的位置与朝向全从它来）。找一个不存在的宿主墙
 * 在库里是有正常出路的（`removeWall` 会级联删洞口，但手写或旧配置绕得过它，
 * `removeWall` 那段的注释承认了这个前提），所以查不到就**静默跳过**——
 * 与既有渲染路径对孤儿洞口的口径一致。
 *
 * **这一组不认洞口种类**：同一个地址下的门洞与窗洞进同一组、由同一个组件装，
 * 因为两者在几何上是同一件事（切墙 + 把洞里那一件换成资产），差别只有替身碎片
 * （门扇 / 玻璃）与日志里的名词，那两处都在组件里按 `opening.kind` 分岔。
 *
 * 判据用 `openingFilledByModel`（它同时收窄了类型，所以下面那个 `.url`
 * 不是非空断言）：**写在这里的判据与墙那侧抑制用的必须是同一个函数**，
 * 两处各写一遍的后果是「一边画模型一边画构件」或者「两边都不画」。
 */
const openingModels = computed<
  { url: string; openings: { wall: FloorplanWall; opening: FloorplanOpening }[] }[]
>(() => {
  const wallsById = new Map(props.floorplan.walls.map((wall) => [wall.id, wall]))
  const groups: {
    url: string
    openings: { wall: FloorplanWall; opening: FloorplanOpening }[]
  }[] = []
  const at = new Map<string, number>()

  for (const opening of props.floorplan.openings) {
    if (!openingFilledByModel(opening)) continue

    const wall = wallsById.get(opening.hostWallId)
    if (!wall) continue

    const index = at.get(opening.url)
    const slot = { wall, opening }
    if (index === undefined) {
      at.set(opening.url, groups.length)
      groups.push({ url: opening.url, openings: [slot] })
    } else {
      groups[index].openings.push(slot)
    }
  }

  return groups
})
</script>

<template>
  <SceneFloorplanFoundation v-if="floorplan.foundation" :foundation="floorplan.foundation" />

  <!--
    房间与墙的 key 都用各自配置里的 id，不用下标：中间删掉一个时，
    下标会让 Vue 把后面每个节点都当成「变了」而整体重挂一遍。

    墙分两条路：写过外观的按地址分组铺面（`SceneFloorplanWallSkin`），
    没写的照旧一面一个灰盒子。**两条路的判据只有一个**（`wall.url` 是否为空），
    所以不可能同一面墙两边都画——那会是同一个包围盒上的两组共面几何，
    逐像素 z-fighting。
  -->
  <SceneFloorplanRoom v-for="room in floorplan.rooms" :key="room.id" :room="room" />

  <SceneFloorplanWallSkin
    v-for="group in styled"
    :key="group.url"
    :url="group.url"
    :walls="group.walls"
    :openings="floorplan.openings"
    :plan="plan"
  />

  <!--
    洞口传的是**全量**列表，不是按墙滤好的：按 `hostWallId` 挑是
    `wallPieces()` 入口做的事（那里有一段注释解释了为什么滤在那一层）。
  -->
  <SceneFloorplanWall
    v-for="wall in plain"
    :key="wall.id"
    :wall="wall"
    :openings="floorplan.openings"
    :plan="plan"
  />

  <!--
    写了外观地址的洞口：一个地址一个组件，装真的门 / 窗模型。

    **它替换掉的那批碎片不在这里现算**——墙那侧（`SceneFloorplanWall` 与
    `SceneFloorplanWallSkin`）各自按同一判据把「这个洞口自己的框条 / 中竖梃 /
    门扇 / 玻璃」抑制掉，由这个组件接手。判据能从各自的 `props.openings` 推出来，
    所以没有新 prop 要往下传。

    **它也可能什么都不画**（2D 档、加载中、404、资产不达标）：那时它把被抑制掉的
    那批碎片**原样画成盒子**，画面与改造前一致。这条不变量写在
    `SceneFloorplanOpeningModel.vue` 的文件头。
  -->
  <SceneFloorplanOpeningModel
    v-for="group in openingModels"
    :key="group.url"
    :url="group.url"
    :openings="group.openings"
    :plan="plan"
  />
</template>
