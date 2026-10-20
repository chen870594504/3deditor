<script setup lang="ts">
import { computed } from 'vue'
import { DoubleSide, Euler, Shape, Vector3 } from 'three'
import { polygonCenter, roomLabelHeight } from '../utils/floorplan'
import { createLabelTexture, labelTextureAspect } from '../utils/labelTexture'
import type { LabelTextureOptions } from '../utils/labelTexture'
import type { FloorplanRoom } from '../types'

defineOptions({ name: 'TdmSceneFloorplanRoom' })

/**
 * 一个房间：地面色块 + 悬浮的房间名。
 *
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 DESIGN.md「TD 层不使用 Pinia」）。
 *
 * 多边形是「点封闭区域」那一刻算出来的**快照**（见 `FloorplanRoom` 的注释），
 * 之后不随墙变动，所以这里也不需要在墙变化时重算什么。
 */
const props = withDefaults(
  defineProps<{
    room: FloorplanRoom
    /** 全屋最高的墙（米）：3D 档的标签要压过墙顶 */
    wallHeight: number
    /** 2D 正俯视档：标签不跟着抬高，理由见 `LABEL_Y_2D` */
    plan?: boolean
  }>(),
  { plan: false },
)

/**
 * 色块离地面的高度。
 *
 * 要同时躲开两样东西：网格线在 `y = 0`，地基板顶面在 `y = 0.005`。
 * 压在任一层上都分不出谁在前，从正上方（2D 档）看就是一片闪烁。
 * 3.5 厘米在俯视图里完全看不出「浮着」，但足够让深度缓冲分得清。
 *
 * 这个「足够」是有字面依据的，不是估的：2D 档相机在 110 米高，`near = 0.1` /
 * `far = 200` 下深度缓冲在那里约每 7 毫米一个单位（算法见
 * `SceneFloorplanFoundation.vue` 的 `TOP_GAP`），色块离板顶 30 毫米就是
 * 4 个出头的单位。**地基板自己还带 `-2` 个单位的 `polygonOffset`**（它要靠
 * 这个压住网格），扣掉之后这里仍有 2 个单位——这就是不能再往下调的原因。
 */
const FLOOR_Y = 0.035

/**
 * 房间色块的不透明度。
 *
 * 早先是 0.55，房间色是画面上一块明确的「标注」。反馈是「房间不要有地板颜色，
 * 或者透明到 0.1 差不多」——在户型图里，用户的注意力在那几块地面上（地板、
 * 地基纹理、挨着房间摆的家具），半透明的色块压在上面会把它们整片染色；
 * 2D 里尤其明显，几个房间拼起来像一块马赛克贴纸，读不出底下是什么。
 *
 * 取 0.1 而不是 0：完全透明之后，「哪几块地面属于同一个房间」就只剩名字一行字
 * 来承担，相邻房间的边界也看不出层次；0.1 是一层几乎只剩「色相提示」的薄雾，
 * 不遮底下的东西，又还能一眼分出房间。
 *
 * 颜色本身仍由配置里的 `room.color` 决定（右栏色块照旧改得动），这里只改
 * 它铺在地面上的浓度。
 */
const ROOM_FILL_OPACITY = 0.1

/**
 * 2D 档的房间名高度。
 *
 * 2D 是 110 米高的**透视**相机（`useViewMode` 的 `TOP_DISTANCE`），不是正交相机：
 * 世界高度越高，投影到屏幕上离画面中心越远。把标签从 1.4 抬到墙顶（4.5 左右）
 * 会让它相对地面色块产生径向视差——离原点 20 米时约 5–6 px，越远越大，看起来
 * 就是「标签没对准房间」。所以 2D 保持这个高度，只有 3D 抬高（见 `labelY`）。
 */
const LABEL_Y_2D = 1.4

/**
 * 3D 档标签高出墙顶的余量，米。
 *
 * 贴着墙顶时标签会与墙顶压在一个视觉平面上，斜看时分不清哪个是墙、哪个是字；
 * 留 0.6 米让它明确地「浮在上面」。
 */
const LABEL_CLEARANCE = 0.6

/**
 * 标签的世界高度。
 *
 * 3D 档必须压过**最高**的墙。原先固定 1.4 米，而默认墙高是 3.9 米——标签整个
 * 躲在墙里，斜视根本读不到房间名（2D 正俯视才看得见，所以这个缺陷一直没被
 * 2D 的使用路径暴露出来）。
 *
 * `Math.max(..., LABEL_Y_2D)` 是给「墙被改得很矮」的配置留的：墙高 0.5 米时
 * 标签不该低于 1.4 米，否则它会掉进地面色块里、和色块糊成一片。
 */
const labelY = computed(() =>
  props.plan ? LABEL_Y_2D : Math.max(props.wallHeight + LABEL_CLEARANCE, LABEL_Y_2D),
)

/**
 * 3D 档房间名背后的徽标底。
 *
 * 配色是**固定的**，不跟随 `room.color`：那个颜色是用户取色器改的，可能深到
 * 深色字不可读。而标签背后的三样东西明度横跨两端——场景底 `#0b1020`（近黑）、
 * 墙近白、地面 `#334155`（深灰）——所以选「浅底 + 深字 + 中性描边」：浅底压过
 * 深色背景，描边勾出它在浅色墙上的边界。
 *
 * `padding` 比默认的 18 大：徽标是一块面，四周只留 9 像素会显得字顶到边上。
 * 2D 档不传这一份，仍是透明底纯文字（见 `labelMap`）。
 */
const LABEL_BADGE: LabelTextureOptions = {
  color: '#0f172a',
  haloColor: '#f8fafc',
  background: '#f8fafc',
  borderColor: '#64748b',
  borderWidth: 4,
  radius: 20,
  padding: 28,
}

/**
 * 指引线的粗细，米。
 *
 * 直径 4 厘米：10–30 米的视距下大约 2–6 像素，细得像一条标注线；再粗就像柱子。
 */
const GUIDE_RADIUS = 0.02

/**
 * 圆柱的径向分段。4 厘米粗的柱子 8 段已经看不出棱，再多只是白付三角形。
 */
const GUIDE_RADIAL_SEGMENTS = 8

/**
 * 指引线底端的高度，米。
 *
 * 落在色块顶面（`FLOOR_Y`）上方 1 厘米：与色块共面会逐像素抢深度（闪），
 * 而 1 厘米在 3D 视距下看不出来悬空。
 */
const GUIDE_BOTTOM_Y = FLOOR_Y + 0.01

/**
 * 指引线的颜色。
 *
 * 不用 `room.color`：房间色可能同时撞上深色场景底和浅色墙，固定一个中性灰
 * 在三种背景上都立得住。与徽标描边同色，读起来是一套标注。
 */
const GUIDE_COLOR = '#64748b'

/**
 * 3D 档房间名在世界坐标里的高度，米。
 *
 * **标签是固定世界尺寸（`sizeAttenuation: true`），跟着画面里的模型一起放大缩小。**
 * 相机拉远、模型在画面里变小时，标签跟着变小——不会再用一块固定屏幕大小的字
 * 盖住模型。这正是「不要固定大小」那条反馈要的。
 *
 * 0.4 是从**旧观感**折出来的，不是估的。旧写法是 `sizeAttenuation: false` 配
 * `0.06`，而 three 的 sprite 顶点着色器在那条路上会把 scale 乘上标签自己的
 * 相机空间深度（`scale *= -mvPosition.z`）。也就是说，那个「屏幕上的 0.06」
 * 在标签所在深度 d 上等价于**世界高度 `0.06 × d`**：3D 默认机位 `[4, 3, 6]`
 * 看原点，标签在墙顶上方约 4.5 米、房间多半在原点附近，深度约 6.1 米 →
 * `0.06 × 6.1 ≈ 0.37`，取 0.4 米（约 7.9% 画面高度，旧的屏幕比例约 7.2%，
 * 差不到 10%）。
 *
 * **2D 档不用固定值，按房间自己的尺寸算**（`roomLabelHeight`）：2D 里房间是
 * 画面的主体，标签必须与它标注的那块地面同比例，否则同一栋房子里大小房间
 * 总有一边不合适（写死 6.5 米时，4 米见方的卧室被字撑满、30 米的大厅里字小
 * 得像脚注）。3D 档的标签是悬在墙顶的徽标（见 `LABEL_BADGE`），并不贴着
 * 哪一块地面，固定值反而让远近房间的徽标一样大、读起来更整齐。
 */
const LABEL_HEIGHT_3D = 0.4

/**
 * 放平多边形的旋转。
 *
 * 多边形存的是 `[x, z]`，喂给 `Shape` 时第二个分量当**局部 y** 用，
 * 于是需要一个把「局部的 (x, y)」映到「世界的 (x, z)」的旋转。
 *
 * three 的 `makeRotationX(θ)` 是 `y' = cosθ·y − sinθ·z`、`z' = sinθ·y + cosθ·z`，
 * 局部点是 `(x, y, 0)`，代入 `θ = +π/2`（cos 0、sin 1）得到世界 `(x, 0, y)`——
 * 存进去的 z 原样变成世界的 z。用 `−π/2` 的话 z 被取反，整个房间沿 z 镜像、
 * 与墙错开，而且不报任何错。
 *
 * 顺带一个后果：这个旋转把面法线从 `+z` 转到了 `(0, −1, 0)`，也就是**朝下**，
 * 所以材质必须 `DoubleSide`（不靠绕序决定正面）。
 *
 * 写成 `Euler` 而不是数组：TresJS 的全局组件类型把 `rotation` 标注成严格的
 * three 对象（`SceneContent.vue:97-99` 有完整说明）。放在模块作用域是为了
 * **引用恒定**——它一辈子只该是这一只对象，不像位置那样需要重算。
 */
const FLAT_ROTATION = new Euler(Math.PI / 2, 0, 0)

const hasArea = computed(() => props.room.polygon.length >= 3)

/**
 * `ShapeGeometry` 的构造参数。
 *
 * 只有一个元素（`curveSegments` 用默认值）：这里的轮廓全是直线段，
 * 那 12 段细分是给曲线用的，对我们完全不起作用。
 *
 * args 装在一个 computed 里，是为了**引用稳定**——TresJS 在 args 换引用时
 * 会重建几何体（`SceneGround.vue:54-60` 的注释是这条约定的出处）。
 *
 * 顶点用的是**世界坐标**（多边形就是这么存的），所以摆它的网格 x / z 必须是 0，
 * 否则整个房间会被平移两遍——见 `FLOOR_POSITION`。
 */
const geometryArgs = computed<[Shape]>(() => {
  const shape = new Shape()
  props.room.polygon.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z)
    else shape.lineTo(x, z)
  })
  shape.closePath()
  return [shape]
})

/**
 * 色块的位置。
 *
 * **x / z 恒为 0 是刻意的，不是漏填。** 多边形存的就是世界坐标
 * （`findEnclosedArea` 返回的是 `格号 × CELL_SIZE`，见 `floorplan.ts:801-804`），
 * 而 `Shape` 拿它当**几何体的局部坐标**用——两套坐标同源，于是这块面片在网格
 * 坐标系里本来就在正确的位置上，网格一动不动。
 *
 * 这里踩过一脚，写下来免得再犯：最初网格摆的是 `polygonCenter`，
 * 「多边形已是世界坐标」与「网格又平移一次」叠在一起，等于把整个房间
 * **又挪了一个形心矢量**——房间离原点越远偏得越多。而房间名走的是另一条路
 * （世界坐标直接摆 `Sprite`），所以表现出来的正是「色块偏了、字是准的」。
 * 参考项目 `sceneRenderer.js:109-118` 只写 `position.y`，也是同一个道理。
 *
 * 写成模块常量而不是 `computed`：它一辈子只有一个值，不需要跟着配置重算。
 * `Vector3` 而不是数组，照 `SceneModelNode.vue:74-76` 的先例
 * （`SceneContent.vue:97-99` 解释了为什么数组在类型上不接受）。
 */
const FLOOR_POSITION = new Vector3(0, FLOOR_Y, 0)

/**
 * 形心。**只给房间名与指引线用**——色块用的是自己的局部坐标（见 `FLOOR_POSITION`）。
 *
 * 两处共用同一个 x / z：各算一次的话，改 `polygonCenter` 的算法时它们会悄悄错开，
 * 表现是「字在房间中心、线却偏了一点」。
 *
 * 数组而不是 `Vector3`：下面两处要把 x / z 拆开用，各自造新的 `Vector3`
 * （那里需要新实例，理由见 `labelPosition`）。
 */
const labelCenter = computed(() => polygonCenter(props.room.polygon))

/**
 * 标签的位置。
 *
 * 每次重算返回**新实例**是必要的：TresJS 按引用比较，原地改同一只
 * 会被当成「没变」。
 */
const labelPosition = computed(
  () => new Vector3(labelCenter.value[0], labelY.value, labelCenter.value[1]),
)

/**
 * 指引线的几何参数。
 *
 * 写进 computed 是为了**引用稳定**：TresJS 在 args 换引用时会重建几何体
 * （`SceneGround.vue:54-60` 的注释是这条约定的出处），模板里直接写数组字面量
 * 会每次渲染都重建一遍。只有 `labelY` 变（改墙高）时才需要换。
 */
const guideGeometryArgs = computed<[number, number, number, number]>(() => [
  GUIDE_RADIUS,
  GUIDE_RADIUS,
  labelY.value - GUIDE_BOTTOM_Y,
  GUIDE_RADIAL_SEGMENTS,
])

/**
 * 指引线的位置。圆柱以**自身中心**为原点，所以 y 取上下端的中点。
 */
const guidePosition = computed(() => {
  const [x, z] = labelCenter.value
  return new Vector3(x, (GUIDE_BOTTOM_Y + labelY.value) / 2, z)
})

/**
 * 房间名贴图。
 *
 * 没有 DOM 时 `createLabelTexture` 返回 `null`（库会被 `renderToString`
 * 跑一遍，那时没有 document），模板里的 `v-if` 于是整个跳过标签——
 * 少一个房间名，而不是让整棵场景渲染不出来。
 *
 * **2D 档不传 `LABEL_BADGE`**，保持透明底纯文字：正俯视下文字压在房间色块上
 * 本来就清楚，而徽标会盖掉色块、让「这一片是哪个房间」更难读。同理，切档时
 * 两档各用各的贴图（缓存键带了底色那几个字段），不会串。
 */
const labelMap = computed(() =>
  hasArea.value
    ? createLabelTexture(props.room.name, props.plan ? undefined : LABEL_BADGE)
    : null,
)

/**
 * 标签的缩放。
 *
 * **宽度按贴图的实际宽高比算**，否则中英文混排的长短名会被拉成同一个宽度，
 * 字就扁了。
 *
 * 高度是**世界尺寸**，由 `sizeAttenuation` 负责投到屏幕上：2D 档取
 * `roomLabelHeight`（按这个房间自己的窄边算，见那边的注释），3D 档取
 * `LABEL_HEIGHT_3D`。两者都是世界单位，滚轮缩放时跟着模型一起变。
 */
const labelScale = computed(() => {
  const height = props.plan ? roomLabelHeight(props.room.polygon) : LABEL_HEIGHT_3D
  return new Vector3(height * labelTextureAspect(labelMap.value), height, 1)
})
</script>

<template>
  <!--
    地面色块。

    位置只动 y（见 `FLOOR_POSITION`）：多边形的坐标就是世界坐标，x / z 必须留在 0。

    半透明（`ROOM_FILL_OPACITY`）而不是实心：房间是「被标记出来的区域」，透出底下的
    地基与网格才读得出这一层是标注。浓度取到 0.1 的理由写在那个常量上——
    再高就会给地板、地基纹理染上一层整块的色，用户反馈要的就是把它放淡。
    深度写入保持默认的开启——这是一个平铺在地面上的孤立面片，
    关掉只会让它与其它半透明物体排错顺序。

    单独一个 v-if：少于三个点的多边形三角化不出任何东西，
    ShapeGeometry 会给出空几何体或直接报错。
  -->
  <TresMesh v-if="hasArea" :position="FLOOR_POSITION" :rotation="FLAT_ROTATION">
    <TresShapeGeometry :args="geometryArgs" />
    <TresMeshStandardMaterial
      :color="room.color"
      :side="DoubleSide"
      :roughness="0.9"
      :metalness="0"
      :opacity="ROOM_FILL_OPACITY"
      transparent
    />
  </TresMesh>

  <!--
    指引线：从徽标中心垂到房间地面色块上，**只在 3D 档画**。
    2D 是 110 米高的透视相机，竖直的线在正俯视里投影成几个像素的点，
    既读不出「指向地面」又把俯视图弄脏，所以整条不画。

    顶端落在 `labelY`（徽标中心）就行：标签现在有固定的世界下沿
    （`LABEL_HEIGHT_3D / 2`），但贴图四周还带着一圈透明 `padding`——
    停在下沿会在徽标与线之间留一道小缝。停在中心，靠「标签最后绘制」
    把线顶完整盖住，连接处看不出断口。

    渲染顺序是「色块（默认 0）→ 线（1）→ 标签（2）」：
    - 线必须 `transparent` 才能进透明队列；否则不透明队列先画、半透明色块后画，
      线在下方那一段会被洗上一层房间色。
    - 线 `depth-write=false`：圆柱前表面比标签平面更靠近相机，写了深度就会把
      徽标中心那一块挖掉，看起来像线从字中间穿出去。
    - `depth-test` 保持默认：线被墙挡住时要正确消失。

    用细圆柱而不是 cientos 的 `Line2`：5.9.0 里 `LineMaterial.resolution` 的
    watcher 没取 `.value`、永远不触发，屏幕像素线宽失效（见设计决定 55）。
  -->
  <TresMesh v-if="!plan && labelMap" :position="guidePosition" :render-order="1">
    <TresCylinderGeometry :args="guideGeometryArgs" />
    <TresMeshBasicMaterial :color="GUIDE_COLOR" :transparent="true" :depth-write="false" />
  </TresMesh>

  <!--
    房间名。

    用 Sprite 而不是贴在房间地面上的平面：Sprite 永远正对相机，俯视（2D 档，
    也就是这套东西的主场）与斜视（3D 档）下都正着读，不需要为每个机位
    各调一次朝向。

    `size-attenuation` **开着**（显式写出来）：标签是**世界尺寸**，跟着模型一起
    放大缩小——相机拉远、模型在画面里变小时标签也变小，不会盖住模型。
    关掉的话它是屏幕比例、远近一样大，那正是「模型缩小后标签太大」那条反馈。
    两档各自的世界高度：2D 按房间窄边算（`roomLabelHeight`），3D 是
    `LABEL_HEIGHT_3D`（原因在那两段注释里）。

    贴图周围是透明的，所以必须 `transparent`，否则透明区会渲染成黑色。

    `render-order=2` 把它排在指引线（1）之后画：徽标会完整盖住线的顶端，
    两者交汇处不会露出半截圆柱（理由见上面那段）。
  -->
  <TresSprite v-if="labelMap" :position="labelPosition" :scale="labelScale" :render-order="2">
    <TresSpriteMaterial
      :map="labelMap"
      :size-attenuation="true"
      :depth-test="true"
      transparent
    />
  </TresSprite>
</template>
