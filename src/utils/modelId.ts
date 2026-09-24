/**
 * 模型 id 的生成，以及从地址派生可读短名。
 *
 * 两件事放在一个模块里，是因为它们是一对：id 是随机 uuid（唯一、不可读），
 * 派生短名是可读回退（不唯一、可读），后者补上前者缺的那一半。
 */

/** 内置示例几何体派生不出有意义的名字，用这个中性词 */
const BUILTIN_MODEL_NAME = 'builtin'

/** 拖入的本地文件（blob: / data:）同理 */
const LOCAL_FILE_MODEL_NAME = 'local-file'

/**
 * 生成一个模型 id。
 *
 * 优先走 `crypto.randomUUID()`，它只在安全上下文（https / localhost）里存在；
 * 局域网 http 下没有这个方法，退回一个同样是 v4 形状的字符串——
 * 形状保持一致，宿主不必区分这两种情况。
 *
 * 用随机值而不是从 url 派生：派生值在「同一份地址、两个不同场景」时会撞车，
 * 而 id 的用途恰恰是让宿主分辨「现在这个是哪一个」。
 */
export function createModelId(): string {
  const { crypto } = globalThis
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    // v4 规定第 13 位固定为 4、第 17 位的最高两位固定为 10
    const digit = char === 'x' ? value : (value & 0x3) | 0x8
    return digit.toString(16)
  })
}

/**
 * 把驼峰/下划线/空格统一压成 kebab-case。
 *
 * 分两步处理大写是必要的：`DamagedHelmet` 这种词内驼峰要断开，
 * 而 `HTMLViewer` 这种连续大写要在最后一个大写前断开（否则会变成 `h-t-m-lviewer`）。
 */
function toKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 从模型地址派生一个可读短名。
 *
 * 它是 `model.name` 留空时的默认值：id 换成 uuid 之后不可读，
 * 「刚才点的是哪一个」就只能靠这个名字来认。
 *
 * 库和编辑器共用这一份实现——面板上显示的、事件载荷里带的必须永远一致，
 * 两处各写一遍迟早漂移。
 *
 * 函数名里的 "Id" 是它早期的职责（那时 id 就是从地址派生出来的）。
 * 改名会动到已公开的导出，收益只是好看一点，所以留着。
 *
 * 已知取舍：`DamagedHelmet.glb` 与 `damaged_helmet.glb` 会派生出同一个名字，
 * 同一份地址被追加进场景两次也会重名。这个名字只用来看，
 * 要分辨「是哪一个」请用 `id`（随机 uuid，场景内唯一）——
 * 两者在载荷里是并排给出的，正是为这个分工准备的。
 */
export function deriveModelId(url: string): string {
  const raw = url.trim()
  if (!raw) return BUILTIN_MODEL_NAME
  if (raw.startsWith('blob:') || raw.startsWith('data:')) return LOCAL_FILE_MODEL_NAME

  /**
   * 先切掉 query / hash 再解码。
   * 反过来的话，地址里被转义的 `%3F` 会在解码后变成一个假的查询分隔符，
   * 把后面的路径一并吃掉。
   */
  const withoutQuery = raw.split(/[?#]/)[0] ?? ''

  let decoded = withoutQuery
  try {
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    // 非法转义序列：按原样处理，不值得为它抛错
  }

  const segment = decoded.split('/').pop() ?? ''
  const withoutExtension = segment.replace(/\.[^.]*$/, '')

  // 地址非空却压不出 slug（比如整段都是 `/`），退回一个中性名字
  return toKebab(withoutExtension) || 'model'
}
