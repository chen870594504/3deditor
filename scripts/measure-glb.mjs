/*
  离线量一份 glb 的包围盒，并把结果按模型清单要的格式打出来。

  用法：
    node scripts/measure-glb.mjs <本地文件 | http(s) 地址> [...更多个]

  为什么有这个脚本：`playground/utils/modelList.ts` 里门窗那两类的 `width` /
  `height` 是**这件洞口要开多大**，写小了窗两侧被墙吞掉、写大了两侧露缝，
  两种都不报错（`DOOR` 那一段写了完整的两种表现）。而「量一下资产有多宽」
  以前只能靠把模型拖进 Blender 或者目测——用户报过的「窗户大小不对，
  没有根据模型大小显示」就是这么来的。

  量法的口径与渲染端 `SceneFloorplanOpeningModel.vue` 的 `measured` 对齐：
    - 逐网格算包围盒，**最小那一轴 < 1 毫米的片丢掉**（`wallFaceIsSheet` 的门槛）；
    - 留下来的取并集。

  差别是这里用 accessor 的 `min` / `max`（glTF 规范要求 POSITION 必须带它）
  而不是逐顶点，所以是「局部 AABB 的 8 个角经节点矩阵变换后再取 AABB」——
  对纯平移 / 等比缩放是精确的，对旋转是保守的（略微偏大）。门窗资产基本没有
  斜着摆的子节点，够用；真要精确到顶点，那是渲染端跑起来之后的事。

  **它不联网也能用**：给本地文件名就直接读盘。
*/

import { readFileSync } from 'node:fs'

/** 片 vs 实体的门槛，与 `src/utils/wallFace.ts` 的 `wallFaceIsSheet` 同一个数 */
const SHEET_THRESHOLD = 0.001

/** 清单里那两个数保留三位（毫米），再细没有意义，也会让注释难读 */
const round3 = (value) => Math.round(value * 1000) / 1000

async function readSource(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
  }
  return readFileSync(source)
}

/** 从 glb 里取出 JSON chunk。glTF 的二进制容器就是「12 字节头 + 若干块」 */
function readJsonChunk(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 glb（magic 不对）')

  let offset = 12
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset)
    const type = buf.readUInt32LE(offset + 4)
    const body = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) return JSON.parse(body.toString('utf8'))
    offset += 8 + length
  }
  throw new Error('glb 里没有 JSON chunk')
}

/** 列主序的 mat4。glTF 的 `node.matrix` 与下面 `trs` 的输出都是这个排法 */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** 列主序下算 `a * b` */
function multiply(a, b) {
  const out = new Array(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** 一个节点的局部矩阵：写了 `matrix` 就用它，否则由 TRS 拼 */
function trs(node) {
  if (node.matrix) return node.matrix

  const t = node.translation ?? [0, 0, 0]
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const s = node.scale ?? [1, 1, 1]

  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2

  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]
}

function apply(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ]
}

/** 量一份 glTF：返回保留 / 丢掉的网格，以及并集包围盒 */
function measure(gltf) {
  const kept = []
  const dropped = []

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]

  function visit(index, parent, namePath) {
    const node = gltf.nodes[index]
    const world = multiply(parent, trs(node))
    const here = `${namePath}/${node.name ?? `#${index}`}`

    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION]
        if (!accessor?.min || !accessor?.max) continue

        const local = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
        for (let corner = 0; corner < 8; corner++) {
          const transformed = apply(world, [
            corner & 1 ? accessor.max[0] : accessor.min[0],
            corner & 2 ? accessor.max[1] : accessor.min[1],
            corner & 4 ? accessor.max[2] : accessor.min[2],
          ])
          for (let axis = 0; axis < 3; axis++) {
            local[axis] = Math.min(local[axis], transformed[axis])
            local[axis + 3] = Math.max(local[axis + 3], transformed[axis])
          }
        }

        const size = [0, 1, 2].map((axis) => local[axis + 3] - local[axis])
        const meshName = gltf.meshes[node.mesh].name ?? ''
        const label = `${here}[${meshName}] ${size.map((v) => v.toFixed(4)).join(' × ')}`

        // 与 `wallFaceIsSheet` 同一个门槛：最小那一轴 < 1 毫米就是片
        if (Math.min(...size) < SHEET_THRESHOLD) {
          dropped.push(label)
          continue
        }

        kept.push(label)
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], local[axis])
          max[axis] = Math.max(max[axis], local[axis + 3])
        }
      }
    }

    for (const child of node.children ?? []) visit(child, world, here)
  }

  const scene = gltf.scenes[gltf.scene ?? 0]
  for (const root of scene.nodes) visit(root, IDENTITY, '')

  const hasSolid = kept.length > 0
  return {
    kept,
    dropped,
    hasSolid,
    size: hasSolid ? [0, 1, 2].map((axis) => max[axis] - min[axis]) : null,
  }
}

/** 节点树。量出来对不上时，靠它看出「多出来的是哪一块」 */
function printTree(gltf) {
  const walk = (index, depth) => {
    const node = gltf.nodes[index]
    const mesh = node.mesh !== undefined ? '  [mesh]' : ''
    console.log(`${'  '.repeat(depth)}${node.name ?? `#${index}`}${mesh}`)
    for (const child of node.children ?? []) walk(child, depth + 1)
  }

  console.log('  节点树：')
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, 2)
}

async function main() {
  const sources = process.argv.slice(2)
  if (!sources.length) {
    console.error('用法：node scripts/measure-glb.mjs <本地文件 | http(s) 地址> [...]')
    process.exit(1)
  }

  let failed = false

  for (const source of sources) {
    console.log(`\n── ${source}`)
    let gltf
    let result

    try {
      gltf = readJsonChunk(await readSource(source))
      result = measure(gltf)
    } catch (error) {
      failed = true
      console.log(`   量不了：${error.message}`)
      continue
    }

    if (!result.hasSolid) {
      failed = true
      console.log('   一块实体都不剩（全是最小轴 < 1 毫米的片），当不了门窗资产')
      continue
    }

    const [width, height, depth] = result.size
    console.log(
      `   宽(X) ${width.toFixed(4)}  高(Y) ${height.toFixed(4)}  厚(Z) ${depth.toFixed(4)}`,
    )
    console.log(`   → ${'{'} width: ${round3(width)}, height: ${round3(height)} ${'}'}`)
    console.log(`   实体网格 ${result.kept.length} 块，丢弃的片 ${result.dropped.length} 块`)

    printTree(gltf)
    if (result.dropped.length) {
      console.log('  丢弃的片（不参与量尺寸，摆的时候也会被摘掉）：')
      for (const line of result.dropped) console.log(`   ${line}`)
    }
  }

  if (failed) process.exitCode = 1
}

await main()
