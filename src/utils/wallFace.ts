import type { FloorplanPiece } from './floorplan'
import type { FloorplanOpeningKind } from '../types'

/**
 * 墙面铺装的算术。
 *
 * 与 `floorplan.ts` 分开一个文件是因为**输入域不同**：那边回答「配置 → 该画哪些盒子」，
 * 完全不认识资产；这里回答「一个盒子 + 一个资产 → 该摆几块、每块摆在哪」，
 * 输入之一是量出来的包围盒。混在一个文件里，两件事各自的文件头注释都说不清。
 *
 * 全是**不依赖 three、不依赖 DOM 的纯函数**（只吃数字、只吐数字），
 * 与 `floorplan.ts` 那组同一性质——所以它能在冒烟测试里不靠浏览器就跑起来，
 * 而这是整个改动里唯一「静态检查盖不到、目视又被资产卡住」的一段
 * （见 DESIGN.md 资产制作要求）。它也是**公开面**：宿主自己画墙时同样需要它。
 *
 * ## 两个出口：平铺与装进洞口
 *
 * 墙体表皮是**平铺**（`wallFaceTiles`：一段墙摆几块整砖的算术写在下面「铺法」里），
 * 洞口那一件是**装一件**（`wallFaceFit`：一件资产摆一次、三轴同一个系数）。两者共用
 * `place()` 那一份算术，差别在块数 `n` **与缩放怎么来**——**绝不能各写一份**，
 * 理由写在 `wallFaceFit` 上。
 *
 * 能不能用也是两份（`wallFaceUnusable` / `openingFaceUnusable`）：第 ③ 条尺寸检查
 * 与那句进日志的人话都是按用途定的——墙要是一个有厚度的盒子，而洞口那一件
 * **不查厚度**（厚度跟着高度等比缩出来，不是资产的性质）。门与窗共用后一个，
 * 只在名词上分岔（「一扇门」/「一扇窗」）——两者的判据一字不差，分成两份只会让
 * 阈值各自漂移。
 *
 * ## 铺法
 *
 * 沿墙长**平铺重复**：段有多长就摆几块整砖，块数取整，余数**均匀摊进每一块**
 * （不裁、也不捅出段外）；高与厚不是重复，是**拉伸**——把资产的整块拉伸到段高 / 墙厚。
 * 「高度拉伸」这条与地板那条「拉伸铺满」是同一件事，但地板的 x/z 两个方向都拉伸
 * 而这里是「一个方向重复 + 两个方向拉伸」：砖与木板有「尺寸」可言，地板是一整张面。
 *
 * 两个**必然的观感代价**（是需求拍板之后的算术结果，不是 bug，写下来免得第一次
 * 验收被当成渲染错）：洞口照旧把墙切段、每段各铺，于是 ① 砖缝在门洞两侧、
 * 过梁上下都**对不齐**；② 过梁与窗下矮墙会被**竖向压缩**——0.7 米高的过梁铺
 * 2.8 米高的资产就是压 4 倍。
 *
 * ## 资产不是「整个 glb 场景」
 *
 * 上面这段算术的输入是**一个包围盒**，而这个盒子怎么量出来的，是这条链上最容易
 * 出错、也最难看出来的一步：`Box3.setFromObject(state.scene)` 量的是**整个 glb
 * 场景**，而 glb 里除了墙本身常常还有建模时的道具——最典型的是那块几十米见方的
 * 背景板（贴地、零厚度）。
 *
 * 一张背景板进来，后果是**量级上的**：量出来的「资产尺寸」变成 80 × 2.8 × 80，
 * 于是 `segL / nativeLen` 恒小于 1（块数永远是 1 块）、`sx = 段长 / 80`、
 * `sz = 墙厚 / 80`。铺出来的墙是**墙正中间一片几十厘米宽、零点几毫米厚的薄片**，
 * 背景板则被压成一条细带趴在墙脚。屏幕上看到的是「铺是铺了，但只有一小块」，
 * 与「压根没铺」完全同形，而且 `wallFaceUnusable` 会放行（三个轴都不小）。
 *
 * 挡它的办法是**逐网格**判「这是实体还是片」（`wallFaceIsSheet`），
 * 量尺寸与渲染都用同一批判据：片既不参与量，也不跟着画。判据只看**厚度**
 * （三轴里最小的那一轴），不看「像不像墙」——实体可以是一根很矮的压顶、
 * 一块很窄的砖（它们本来就在墙的包围盒里，并进去不影响结果），
 * 但**片是面、没有体积**，混进来只会把包围盒撑爆。
 */

/**
 * 一个资产的包围盒，`Box3` 的两个角。
 *
 * 用**两个三元组**而不是 six 个数字的扁平结构，是为了传参时能直接写
 * `{ min: box.min.toArray(), max: box.max.toArray() }`——量出来的东西本来就是这个形状。
 */
export interface WallFaceBounds {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * 在碎片**自己的坐标系**里摆一块砖。
 *
 * 原点在碎片中心：+X 沿墙长、+Y 竖直、+Z 是墙厚——也就是 `FloorplanPiece.size`
 * 三个分量各自的方向。所以调用方只要把碎片的世界位置与朝向打在**外层**的组上，
 * 这一组数字就照抄进内层的组，不用做任何三角函数。
 *
 * 反过来，在**世界坐标**里算块心的做法要把这些局部校正量按墙的朝向再转一次，
 * 多一处手写的三角就多一处能静默镜像错的地方（`wallRotationY` 那个负号尤其）。
 */
export interface WallFaceTile {
  /** 稳定的 v-for key：`<碎片的 key>:<第几块>` */
  key: string
  /** 在碎片自己的坐标系里，这一块该摆在哪 */
  offset: [number, number, number]
  /** 这一块的缩放：X 是「一段摊平后的砖长」，Y/Z 是拉伸到段高 / 墙厚 */
  scale: [number, number, number]
}

/** 资产最短的一边小于这个数就不能当墙铺——见 `wallFaceUnusable` */
const MIN_LEN = 0.05
/** 资产最矮小于这个数不能当墙铺 */
const MIN_HEIGHT = 0.05
/**
 * 资产最薄小于这个数不能当墙铺。
 *
 * 与 `useModelActions.ts` 的 `MIN_FOOTPRINT` 同值，也**不是**理论情况：
 * 库里现有的两块地板都是**零厚度平面**，而「墙壁」这个分类就在「地板」隔壁、
 * 同一张宫格里——选错一次就会命中。不挡的话厚度那一路除出天文数字。
 */
const MIN_DEPTH = 1e-3

/**
 * 一个网格某个轴向薄于这个数（1 毫米）就当作「片」而不是「实体」。
 *
 * 与 `MIN_DEPTH` **同值、同一条道理**，只是判的对象不同：那边判的是**整个资产**
 * （一张有厚度的网格都没有 → 这资产当不了墙），这里判的是**资产里的一个网格**
 * （这一张是墙的一部分，还是搭场景时留下的道具）。
 */
const SHEET_THICKNESS = MIN_DEPTH

/**
 * 一段墙最多铺几块。
 *
 * 照 **draw call** 定的，不是照观感：一个 tile 是资产里每个 mesh 一个 draw call，
 * 32 块已经是「一面墙几百个 draw call」。它同时兜住两种误用——误选一个小摆件当墙
 * （`round(10 / 0.05)` 会是 200），以及段长得离谱时把整栋房子压垮。
 * 撞上这个上限时砖是被**拉长**的（见下面 `tileLen`），不会溢出段外。
 */
const MAX_TILES = 32

/**
 * 包围盒本身是不是坏的——与「拿来干什么」无关的那两条检查。
 *
 * ① 六个数字里有非有限值。这一条同时吃掉了「资产里一个 mesh 都没有」那一种：
 * `Box3.setFromObject` 在空对象上不动 `min`/`max`，于是它们是初始值
 * `+Infinity` / `-Infinity`——两个都不是有限数。分开写一条 `isEmpty()`
 * （`max < min`）是多余的，下面那条② 只在数字全部有限时才可能命中。
 *
 * ② 三轴各自反序：three 认为这种盒子是空的，算出来的尺寸是负数。
 *
 * 两条的措辞都是**照着资产说的**（「模型」而不是「墙」），所以墙与洞口共用一份：
 * 这三句进的是 `console.warn` 的正文，而「是包围盒本身坏了」这个诊断对两种用途
 * 完全一样。分开写两份的代价是两句人话会慢慢漂成两个意思。
 */
function boundsProblem(bounds: WallFaceBounds): string | null {
  const { min, max } = bounds

  for (const value of [...min, ...max]) {
    if (!Number.isFinite(value)) {
      return '模型的包围盒不是有限的（里面一个网格都没有，或者顶点里有 NaN）'
    }
  }

  for (let i = 0; i < 3; i++) {
    if (max[i] < min[i]) return '模型的包围盒是空的'
  }

  return null
}

/**
 * 这个资产能不能用来铺墙。能就返回 `null`，不能就返回**一句人话的原因**。
 *
 * 返回值直接当 `console.warn` 的正文用（调用方那条 warn 是按 url 去重打的），
 * 所以措辞是给用户看的，不是给日志 grep 的——**「当不了墙的一段」这几句是墙专用的**，
 * 门那条链不要图省事复用它，见 `openingFaceUnusable`。
 *
 * ③ 那三条尺寸检查缺一条都会得到 `NaN` 或者天文数字，而 `NaN` 灌进
 * `Object3D.scale` 的后果是**整个物体连同它的所有子节点从画面上消失且不报错**——
 * 排查时会以为是「模型没加载出来」，与真正的加载失败完全同形。
 *
 * 注意**第 4 条检查不在这里**：「`useGLTF` 的 state 还没就绪」是调用方的事
 * （那是异步的，本函数看不到）。调用方在 state 为空时不能调过来问，
 * 得自己先短路。
 */
export function wallFaceUnusable(bounds: WallFaceBounds): string | null {
  const bad = boundsProblem(bounds)
  if (bad) return bad

  const [len, height, depth] = sizeOf(bounds)

  // 三条分开报，是因为「该往哪个方向改」完全不同
  if (len < MIN_LEN) return `模型太窄（${len.toFixed(3)} 米），当不了墙的一段`
  if (height < MIN_HEIGHT) return `模型太矮（${height.toFixed(3)} 米），当不了墙的一段`
  if (depth < MIN_DEPTH) {
    return `模型没有厚度（${depth.toFixed(3)} 米），铺不出墙体——墙的资产要是一个盒子，不是单片`
  }

  return null
}

/**
 * 这个资产能不能装进洞口（当门 / 当窗）。能就返回 `null`，不能就返回**一句人话的原因**。
 *
 * 与 `wallFaceUnusable` 是**两份**，尽管前两条检查一模一样：差别全在第 ③ 条与
 * 措辞上，而两者都不能省。
 *
 * **它不查厚度。** 装进洞口那一件的厚度是**跟着高度等比缩出来的**（见 `wallFaceFit`），
 * 不是资产的性质——0.9 × 2.1 × 0.02 的一片门扇、1.2 × 1.2 × 0.02 的一片玻璃，
 * 装进 0.18 米厚的墙里都是完全正常的用法，而 `MIN_DEPTH` 会拿墙的标准
 * （「要是一个盒子」）把它们整片拒掉。其实**进到这里的盒子必然是有厚度的**：
 * 调用方先过 `wallFaceIsSheet` 逐网格筛片，一片实体都没有的资产在那一层就被拦下了
 * （那条报的是「没有一块有厚度的网格」，比这里的「太薄」更准）。所以本函数少这一条
 * 不是放宽，是不重复报同一个问题。
 *
 * **门与窗共用这一个函数**，只在名词上分岔（「一扇门」/「一扇窗」）：两者的判据
 * 一字不差——都是「一件资产装进一个洞口」，阈值自然也该是同一个。分成两份的代价是
 * 两个数会各自漂移，而漂移的表现只是「换个种类就突然装得上了」，不报错。
 *
 * **措辞是给用户看的**：它会原样进 `console.warn`，说成「当不了墙的一段」会把
 * 下一个人指去查墙那条链。
 */
export function openingFaceUnusable(
  bounds: WallFaceBounds,
  kind: FloorplanOpeningKind,
): string | null {
  const bad = boundsProblem(bounds)
  if (bad) return bad

  const [len, height] = sizeOf(bounds)
  const what = kind === 'door' ? '一扇门' : '一扇窗'

  if (len < MIN_LEN) return `模型太窄（${len.toFixed(3)} 米），当不了${what}`
  if (height < MIN_HEIGHT) return `模型太矮（${height.toFixed(3)} 米），当不了${what}`

  return null
}

/**
 * 装进洞口之后横着比洞口宽多少倍，就不再当成「一件洞口资产」来提醒。
 *
 * 定在 3 而不是 2：2 倍**不一定是错**。洞口尺寸跟着料走之后这一档少见了
 * （清单里把 `width` 写对，装完就是一比一，比值恒为 1），但仍然有两条正当的路
 * 会落在 2 倍附近：清单里**没写** `width` 时退回默认档（门 0.9 米、窗 1.2 米），
 * 而资产是一扇 1.8 米的双开门；以及故意开小洞配大件（多出来的部分嵌进墙里，
 * 看起来就是门套装在洞口上）。真正的病灶（资产里混进了整个房间）量出来是 9 倍
 * 以上，与这两档之间留得开。门与窗共用这个数，理由同 `openingFaceUnusable`。
 */
const OPENING_OVERSIZE_RATIO = 3

/**
 * 装进去之后**横着撑得太开**时给一句人话，正常就返回 `null`。
 *
 * 这是资产的一道**体检提示，不是一道门槛**：它一个数都不改，只在控制台说一句话
 * （`SceneFloorplanOpeningModel.vue` 的 `notice` 把它接进既有的那条 warn）。
 *
 * ## 为什么值得有这一条
 *
 * 一次实测量出来的：一份从场景里导出的 glb 除了整樘门，还带着地面与三面墙
 * （节点名就叫「地面」「墙-左」「远端墙」）。那几面墙每一面都有 4~12 厘米厚，
 * 而 `wallFaceIsSheet` 的门槛是 1 毫米——**一片都不会被筛掉**，于是
 * `measured` 量出来是 14 × 3.42 × 17.12 米。等比缩放照这个尺寸缩，
 * 「没有变形」这句话是成立的，可整个房间都被搬进了 0.9 米的洞口，
 * 而屏幕上只是一个说不出哪里不对的画面、控制台一个字都没有。
 *
 * 有了这一条，那句话就变成「量出来 14.00 × 3.42 米……」，**asset 里混进了道具**
 * 从猜变成了读。这是本文件里**唯一**一条不改变摆放结果、只说话的导出函数。
 *
 * ## 为什么是警告而不是回退
 *
 * `openingFaceUnusable` 那一条判的是「根本摆不了」，所以退回程序构件；撑得开
 * 不等于用不了，一扇大尺度的门装进小洞口是完全正常的用法。真要在这里回退，
 * 阈值就成了「多宽的资产不算门」的产品决定，而那不是算术能回答的问题。
 *
 * 只看**沿墙长**那一轴：竖直那一轴被等比缩放精确映射到洞高，量不出东西来；
 * 厚度那一轴比的是碎片自己的原生厚度（门扇 `LEAF_THICKNESS` 4.5 厘米、
 * 玻璃 `GLASS_THICKNESS` 2 厘米），一件带门套的资产本来就有十几厘米厚，
 * 拿它当尺子会把正常资产全报出来。
 */
export function openingFaceOversized(
  piece: FloorplanPiece,
  bounds: WallFaceBounds,
  kind: FloorplanOpeningKind,
): string | null {
  const [segL, segH] = piece.size
  const [nativeLen, nativeHeight] = sizeOf(bounds)

  const scale = safeRatio(segH, nativeHeight)
  const drawn = nativeLen * scale
  if (drawn <= segL * OPENING_OVERSIZE_RATIO) return null

  const noun = kind === 'door' ? '门' : '窗'

  return (
    `量出来是 ${nativeLen.toFixed(2)} × ${nativeHeight.toFixed(2)} 米` +
    `（高按洞口等比缩 ${scale.toFixed(3)} 倍），装进 ${segL.toFixed(2)} 米宽的洞口之后横着有 ` +
    `${drawn.toFixed(2)} 米、比洞口宽 ${(drawn / segL).toFixed(1)} 倍——` +
    `多半是导出的 glb 里混进了${noun}以外的道具（地面、墙面、踢脚线），请只导出整樘${noun}`
  )
}

/**
 * 这个网格是「墙体的一部分」（一个有厚度的实体），还是一张「片」。
 *
 * 调用方在**量尺寸之前**用它筛一遍：片不参与合并包围盒，也不该跟着渲染。
 * 为什么不筛的后果全在文件头那段「资产不是整个 glb 场景」里，这里只说三条实现上的话：
 *
 * ① **判据是「最小的那一轴够不够厚」，不是「三轴都够大」。** 一个 4 米长、
 * 3 厘米厚的压顶线条是实体，去掉它会让量出来的墙矮一截；而一张 80 × 0 × 80 的
 * 背景板是片，留下它会把比例尺拉爆。两者的区别只在「有没有体积」，不在「大不大」。
 *
 * ② **退化输入不需要特判，两个方向都落在正确的一侧**：一个顶点都没有的空网格，
 * `Box3` 不动它的初值 `±Infinity`，算出来是 `-Infinity`，小于阈值 → 判成片、丢掉
 * （它本来也画不出东西）；而顶点里含 `NaN` 的网格算出来是 `NaN`，与阈值比较恒为
 * `false` → 判成实体留下，于是合并出来的包围盒也是 `NaN`，
 * 交给 `wallFaceUnusable` 的第 ① 条拦下、整面墙退回灰盒子——那是对的，
 * 这种资产本来就该拒绝，而不是悄悄少画一块。
 *
 * ③ 判的是**世界坐标系**里的盒子（`Box3.setFromObject` 的口径）。旋转与缩放都不会
 * 改变「某轴近乎 0」这件事，所以本函数在**克隆出来的那份**上重跑一次会得到同样的
 * 答案——渲染端正是靠这一条把同一批判据用在两处。
 */
export function wallFaceIsSheet(bounds: WallFaceBounds): boolean {
  return Math.min(...sizeOf(bounds)) < SHEET_THICKNESS
}

/** 包围盒三个方向的尺寸 */
function sizeOf(bounds: WallFaceBounds): [number, number, number] {
  return [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ]
}

/**
 * 一段墙该摆几块、每块摆在哪、缩放到多少。
 *
 * **调用方要先过 `wallFaceUnusable`**：本函数假定包围盒是好的，不做重复检查。
 * 但它仍然对「某一轴退化到近乎 0」做了兜底（那一轴的缩放保持 1 而不是除法），
 * 因为这是**公开函数**，宿主完全可能不检查就直接调。
 *
 * `piece` 用 `role === 'wall'` 的那些碎片：门窗框 / 玻璃 / 门扇**不铺**，
 * 它们照旧走灰盒子（`SceneFloorplanWallBox.vue`）。本函数对此不作判断——
 * 「哪些碎片该铺」是渲染层的事，这里只回答「给我一段实体，怎么铺」。
 */
export function wallFaceTiles(piece: FloorplanPiece, bounds: WallFaceBounds): WallFaceTile[] {
  const nativeLen = sizeOf(bounds)[0]
  const segL = piece.size[0]

  /*
    块数：**四舍五入**，不是向上取整。

    `ceil` 要么需要一套裁切机制（`clippingPlanes` 还要开画布级的
    `renderer.localClippingEnabled`，会波及宿主所有材质），要么把最后一块压扁——
    两者都比「每块差一点点」糟。`round` 的偏差是双向的、最坏 ±50%，
    而且在 1.2 / 2.4 这两个**最常见的洞口尺寸**上明显优于 `ceil`
    （1.2 米配 1 米砖：round 得 1 块、每块 1.2 米；ceil 得 2 块、每块 0.6 米）。

    真正让偏差消失的是**资产而不是取整规则**：墙的端点被 `snap()` 吸在 1 米整格上，
    段长绝大多数是整数米，资产的长做成 1.0 米时 `segL / nativeLen` 恒为整数。
    非整段只剩洞口切出来的那几种（本来就 < 1.2 米）。这条写在资产制作要求里。
  */
  const n = Math.min(MAX_TILES, Math.max(1, Math.round(segL / nativeLen)))

  return place(piece, bounds, n, false)
}

/**
 * 一件资产**装进**一片给定体积：与 `wallFaceTiles` 是同一份算术，块数恒为 1，
 * 三轴**等比**缩放。
 *
 * 给的是洞口那条链（门与窗）：一件资产摆进一个洞口，**没有「沿墙长平铺」这回事**
 * （一扇门、一樘窗都只有一件）。它与平铺共用 `place()` 不是省几行字，而是
 * **绝不能各写一份**——那一段里最容易漏的是「乘完缩放要把包围盒中心减掉」
 * （`layFloorModel` 踩过同一个坑），漏掉的表现是模型整体偏出去半个身位、不报错。
 *
 * ## 等比，而不是三轴各自拉满
 *
 * 三轴共用**同一个**系数，由「段高 ÷ 资产高」定：资产高正好顶满洞口，宽与厚跟着
 * 资产自身的比例走，**永远不会被挤扁**。
 *
 * 这条是量出来的教训，不是审美：初版让三轴各自拉满洞口，只要资产的宽高比不等于
 * 洞口的宽高比就必然变形——一套按 0.9 × 2.1 建的门放进 1.2 × 2.1 的洞口，
 * 宽度会被压掉四分之一，用户看到的正是「门被挤扁了，不是模型原来的宽度」。
 *
 * 等比还有一条好处：资产高**恰好**等于洞口高时（照洞口尺寸建模的资产），
 * 缩放系数就是 1，整个模型一个顶点都不动。
 *
 * 代价是**洞口那一轴可能填不满**：比洞口宽的部分嵌进墙里、被墙面挡住
 * （看起来就是门套装在洞口上），比洞口窄时两侧露一条缝。两者都如实反映资产的
 * 比例，而不是把资产扭成洞口的比例——**宁可留缝，不要变形**。
 *
 * 宽度与厚度**都不夹取**（不会为了「塞进墙里」把 Z 压到墙厚）：夹取就是又一次
 * 非等比变形，只是换了根轴。真要做，那是一套独立的「裁切」机制
 * （`clippingPlanes` 还要开画布级的 `renderer.localClippingEnabled`），
 * 不是这里加一个 `min`。
 */
export function wallFaceFit(piece: FloorplanPiece, bounds: WallFaceBounds): WallFaceTile {
  return place(piece, bounds, 1, true)[0]
}

/**
 * 在**碎片自己的坐标系**里摆 `n` 块。块长由段长均分（`segL / n`），
 * 于是首块的左边缘与末块的右边缘正好落在段的两端，中间不裁不叠。
 *
 * 调用方负责算 `n`：平铺那条链按段长与资产长度四舍五入，装进洞口那条恒为 1。
 *
 * `uniform` 说的是**缩放怎么来**，两个出口各是其中一种：
 *
 * - `false`——**逐轴**：沿墙长按块长摊、高按段高、厚按段厚。平铺用的就是它，
 *   每一块都铺满格心，砖之间的图案才接得上。
 * - `true`——**三轴同一个系数**，由「段高 ÷ 资产高」定（见 `wallFaceFit` 那段：
 *   为什么洞口那一件必须是这一种）。此时 `n` 只影响块心，实际调用方恒传 1。
 *
 * 做成**必填**而不是带默认值的可选参数：漏传时的两种表现（资产被挤扁 / 砖缝对不上）
 * 都不报错、都得靠眼睛发现，而必填让它在编译期就红。
 */
function place(
  piece: FloorplanPiece,
  bounds: WallFaceBounds,
  n: number,
  uniform: boolean,
): WallFaceTile[] {
  const [segL, segH, segD] = piece.size
  const [nativeLen, nativeHeight, nativeDepth] = sizeOf(bounds)
  const [minX, minY, minZ] = bounds.min

  /*
    余数**均匀摊进每一块**：段长除以块数，而不是用资产的原始长度。
    撞上 MAX_TILES 时这里自然变成「把每块拉长」，而不是溢出去。
  */
  const tileLen = segL / n

  /*
    缩放可以退化成 1 的写法：除出来的不是有限数就**保持 1**。

    绝不除出 `Infinity` / `NaN` 灌进 scale——那是「整个墙从画面上消失且不报错」。
    退化时的表现是这一面墙看着不对（砖的间距与砖长对不上），比静默消失好诊断得多。
    正常路径上这一条永远不触发：`wallFaceUnusable` 已经把三轴的下限挡在前面了。

    等比那一支里 `sx` / `sz` **照抄 `sy`**，不是各算一遍——三轴共用同一个系数
    正是「不变形」的全部含义，分头算就会在某一轴上悄悄退出等比。
  */
  const sy = safeRatio(segH, nativeHeight)
  const sx = uniform ? sy : safeRatio(tileLen, nativeLen)
  const sz = uniform ? sy : safeRatio(segD, nativeDepth)

  /*
    包围盒是**相对模型自己原点**量的，乘完缩放要把中心减掉，脚印中心才落回原点。

    `useModelActions.ts` 的 `layFloorModel` 已经踩过同一个坑（那里是减
    `((min + max) / 2) * scale`），两处注释互相点名：**任何一处「量完包围盒再缩放」
    的地方都有这一步**，漏掉的表现是模型整体偏出去半个身位，不报错。

    y 那一路是**底面对齐**而不是中心对齐：给的是底面的落点，所以只跟 `min.y` 有关。
    两者在 `sy` 精确映射时等价（`wallFaceFit` 那一边三轴都取 `sy`，三个轴都是精确
    映射，所以它那里也等价），但底面对齐在将来给 `sy` 加夹取
    （比如「砖不能超过一段墙的高度」）时仍然对。真加了夹取，要把 `wallFaceFit`
    也换成同一条口径——那时两者不再等价。
  */
  const centerX = ((minX + bounds.max[0]) / 2) * sx
  const centerZ = ((minZ + bounds.max[2]) / 2) * sz

  const tiles: WallFaceTile[] = []
  for (let i = 0; i < n; i++) {
    tiles.push({
      key: `${piece.key}:${i}`,
      offset: [
        // 段在自己的坐标系里跨 [-segL/2, +segL/2]，第 i 块的中心落在均分的格心上
        -segL / 2 + tileLen * (i + 0.5) - centerX,
        -segH / 2 - minY * sy,
        -centerZ,
      ],
      scale: [sx, sy, sz],
    })
  }
  return tiles
}

/** 两个正数相除；除不出有限数（分母退化、结果为 0）时保持 1 */
function safeRatio(numerator: number, denominator: number): number {
  const ratio = numerator / denominator
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}
