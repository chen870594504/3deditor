import { deriveModelId } from '../../utils/modelId'
import type { ModelConfig } from '../../types'

/**
 * 模型列表主行显示的名字。
 *
 * 与事件载荷里的 `name` 用的是同一条规则：留空时回退成从地址
 * 派生的短名，因此永远非空。原先是「三处各写一遍迟早对不上」，加上中栏
 * 模型操作胶囊（写历史标签要用它）之后是第四处，所以搬到这里来。
 * （原先这里还点了视口 HUD 的名——那条 HUD 已删，见 DESIGN.md 设计决定 51。）
 *
 * 仍然没有搬进库里（`src/utils/modelId.ts` 里加一个 `modelLabel` 并导出）：
 * 库内部真正需要它的地方只有事件载荷那一处，而把 `deriveModelId` 再包一层
 * 会多出一个公开符号。等哪天库自己也多出一个调用点再说。
 */
export function labelOf(model: ModelConfig): string {
  return model.name || deriveModelId(model.url)
}
