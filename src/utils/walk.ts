import type { FloorplanConfig, FloorplanPoint } from '../types'
import { wallPieces } from './floorplan'

/**
 * 第一人称漫游的**纯算术**：哪些墙体挡路、一个人站在某点时该被推到哪里。
 *
 * 它住在 `src/utils/` 而不是编辑器里，理由与 `floorplan.ts` 那一组相同：
 * 碰撞规则一旦分叉，表现是「明明看着穿过去了 / 明明离墙一米却走不动」，
 * 而这两种都不报错。写成不依赖 three、不依赖 DOM 的纯函数之后，
 * `scripts/smoke.mjs` 才够得着它——真正的指针锁与逐帧移动在 SSR 下一行都跑不到。
 */

/** 眼睛离地高度（米） */
export const WALK_EYE_HEIGHT = 1.6

/**
 * 人的碰撞半径（米）。
 *
 * 0.28 是按「门宽 0.9」倒推的：半门宽 0.45 减去它，两侧各留 0.17 米，
 * 正对着门走能过去、贴着门框走会被轻轻推开。取 0.45 的话门就只剩一条缝，
 * 取 0.15 的话人会半个身子埋进墙里，两个极端看起来都像「碰撞坏了」。
 */
export const WALK_RADIUS = 0.28

/**
 * 行走速度（米/秒）。
 *
 * 现实里的步行约 1.4 m/s，但第一人称在三维场景里按真实速度走会显得很慢
 * （视场角、近距离墙面都会放大这种慢）。3 m/s 是游戏里常见的「走」，
 * 按住 Shift 再乘 `WALK_SPRINT`——两档就够，不必做成可调。
 */
export const WALK_SPEED = 3

/** 按住 Shift 时的倍率 */
export const WALK_SPRINT = 1.8

/**
 * 鼠标灵敏度（弧度 / 屏幕像素）。
 *
 * 0.0022 约等于「鼠标横移 700 像素转 90°」，与常见第一人称游戏同一量级。
 * 它只在这里定义一次：拖拽看与指针锁看走同一条路径，两个灵敏度迟早不一致。
 */
export const WALK_LOOK_SENSITIVITY = 0.0022

/**
 * 抬头 / 低头的极限（弧度）。
 *
 * 85° 而不是 90°：正好到 90° 时相机前向与世界上方向平行，
 * `lookAt` / 欧拉序在那一瞬间会翻面（画面猛地倒过来）。
 */
export const WALK_MAX_PITCH = (85 * Math.PI) / 180

/**
 * 「挡路」判据的竖直范围（米）。
 *
 * 下界取 0.15 而不是 0：地面本来就是 0，门槛留给地板与网格的拾取偏差。
 * 上界是眼睛高度再高一截——人不是一根无限高的柱子，2.1 米以上的过梁
 * 不该拦人。门洞的过梁正好从 2.1 起，于是「门能过去、窗过不去」这条
 * 就落在数据上，而不是写在碰撞代码里：
 * 门的下段高度为 0（`wallPieces` 根本不产那块），窗的下段是窗台矮墙（0.9 高），
 * 两者与这个区间一交就分出来了。
 */
const BODY_BOTTOM = 0.15
const BODY_TOP = WALK_EYE_HEIGHT + 0.15

/**
 * 一块挡路的矩形（**绕 Y 旋转过的盒子**，只看它在水平面上的投影）。
 *
 * 存中心 + 半长 + 半深 + 旋转，而不是存四个角：`wallPieces` 给的本来就是这个形状，
 * 而圆与 OBB 的最近点算法在局部坐标里只有两次夹取，比多边形相交简单得多。
 */
export interface WalkObstacle {
  /** 盒子中心的世界 x / z（米） */
  x: number
  z: number
  /** 与 `wallPieces` 的 `rotationY` 同口径 */
  rotationY: number
  /** 沿墙方向的一半长度（米） */
  halfAlong: number
  /** 垂直墙方向的一半厚度（米） */
  halfDepth: number
}

/**
 * 把户型图里**人能撞上的墙**摊成一组盒子。
 *
 * 直接复用 `wallPieces`，而不是自己按 `walls[].start/end` 再算一遍：
 * 那套切分已经处理了「洞口把墙切开」「窗台下面有矮墙」「洞口互相重叠时裁掉」，
 * 另写一份的下场是碰撞与画面不一致——典型是「门明明开着，人却走不过去」，
 * 或者「窗台明明有半截墙，人却直接穿窗而出」。
 *
 * 只留 `role === 'wall'` 的碎片：门扇 / 窗玻璃 / 框条都不算挡路的几何。
 * 门扇尤其不能算——它是可以打开的构件，而这一版没有开门动画；
 * 把它当墙会让每一扇关着的门都变成死路，比「穿门而过」更不合理。
 */
export function collectWalkObstacles(floorplan: FloorplanConfig): WalkObstacle[] {
  const obstacles: WalkObstacle[] = []

  for (const wall of floorplan.walls) {
    for (const piece of wallPieces(wall, floorplan.openings)) {
      if (piece.role !== 'wall') continue

      const halfUp = piece.size[1] / 2
      const bottom = piece.position[1] - halfUp
      const top = piece.position[1] + halfUp

      // 与人的身体竖直区间不相交：过梁、地基板这类东西不挡路
      if (top <= BODY_BOTTOM || bottom >= BODY_TOP) continue

      obstacles.push({
        x: piece.position[0],
        z: piece.position[2],
        rotationY: piece.rotationY,
        halfAlong: piece.size[0] / 2,
        halfDepth: piece.size[2] / 2,
      })
    }
  }

  return obstacles
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 把一个点推出所有挡路的墙，返回它最终该站的位置。
 *
 * 算法是「圆 vs 绕 Y 旋转的矩形」：把圆心转到盒子局部坐标，夹取到盒子范围里得到
 * 最近点，距离不足半径就沿最近点方向推出去；圆心正好落在盒子里（穿透了）时，
 * 选**穿透最浅**的那一面推出去。**跑两趟**，因为推开一面墙之后可能又碰到了隔壁那面
 * （墙角、门洞两侧），一趟收不住。
 *
 * 推到某个位置之后**不会再重新检查半径**，这是刻意的：调用方每帧都会再调一次，
 * 少量残余重叠下一帧就修正了；而在这里加循环上界只会让极端几何（两条墙缝比人还窄）
 * 变成死循环。
 *
 * `radius` 做成可传的：冒烟要用不同的半径验证「推出去多少」，而默认值就是人。
 */
export function resolveWalkPosition(
  x: number,
  z: number,
  obstacles: readonly WalkObstacle[],
  radius = WALK_RADIUS,
): FloorplanPoint {
  let px = x
  let pz = z

  for (let pass = 0; pass < 2; pass += 1) {
    for (const box of obstacles) {
      const cos = Math.cos(box.rotationY)
      const sin = Math.sin(box.rotationY)

      /*
        世界 → 局部用 R(-θ)。three 的 R(θ) 把局部 (x, z) 映射到
        (x·cosθ + z·sinθ, -x·sinθ + z·cosθ)（与 `floorplan.ts` 的
        `wallRotationY` 配套），所以逆变换正好是
        (x·cosθ - z·sinθ, x·sinθ + z·cosθ)。
      */
      const dx = px - box.x
      const dz = pz - box.z
      const lx = dx * cos - dz * sin
      const lz = dx * sin + dz * cos

      const nearestX = clamp(lx, -box.halfAlong, box.halfAlong)
      const nearestZ = clamp(lz, -box.halfDepth, box.halfDepth)
      const ox = lx - nearestX
      const oz = lz - nearestZ
      const distanceSq = ox * ox + oz * oz

      if (distanceSq >= radius * radius) continue

      let nextX: number
      let nextZ: number

      if (distanceSq > 1e-12) {
        const distance = Math.sqrt(distanceSq)
        const push = radius - distance
        nextX = lx + (ox / distance) * push
        nextZ = lz + (oz / distance) * push
      } else {
        /*
          圆心在盒子里：四条边各自「推出去要挪多远」，取最短的那条。
          并列时按 x 优先——规则必须是确定性的，否则同一点在两次调用里
          可能从不同的边弹出去，画面会抖。
        */
        const toPlusX = box.halfAlong + radius - lx
        const toMinusX = lx + box.halfAlong + radius
        const toPlusZ = box.halfDepth + radius - lz
        const toMinusZ = lz + box.halfDepth + radius

        const candidates: [number, number][] = [
          [toPlusX, 1],
          [toMinusX, 2],
          [toPlusZ, 3],
          [toMinusZ, 4],
        ]

        let side = 1
        let best = toPlusX
        for (const [amount, id] of candidates) {
          if (amount < best) {
            best = amount
            side = id
          }
        }

        nextX = lx
        nextZ = lz
        if (side === 1) nextX = box.halfAlong + radius
        else if (side === 2) nextX = -box.halfAlong - radius
        else if (side === 3) nextZ = box.halfDepth + radius
        else nextZ = -box.halfDepth - radius
      }

      // 局部 → 世界，用 R(θ) 的正向映射
      px = box.x + nextX * cos + nextZ * sin
      pz = box.z - nextX * sin + nextZ * cos
    }
  }

  return [px, pz]
}
