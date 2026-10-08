# @chen870594504/3deditor

Vue 3 插件：给网页装一块 3D 画布，能摆模型、调相机、画户型图。

## 安装

```bash
pnpm add @chen870594504/3deditor
```

## 快速开始

```ts
import { createApp } from 'vue'
import { createThreeDMaker } from '@chen870594504/3deditor'
import '@chen870594504/3deditor/style.css' // 不能省，省了组件是一堆裸 DOM

createApp(App).use(createThreeDMaker()).mount('#app')
```

```vue
<SceneViewer editable height="100%" />
```

## 核心概念

- **`editable` 一个总闸决定形态**：`true` 是完整编辑器（左栏挑料 ｜ 画布 ｜ 右栏属性），`false` 是只读画布，不传是旧行为。
- **场景数据住在 store 里，组件自己不落盘**：取用 `getSceneData()`，装载用 `loadSceneData()` 或 `initialScene` prop。
- **左栏那五类模型默认就有**：库内置一份素材表；换服务器给 `assetBaseUrl`，换整套目录走插件选项 `assets`。

## 组件属性

| Prop            | 类型                       | 默认值    | 说明                                     |
| --------------- | -------------------------- | --------- | ---------------------------------------- |
| `editable`      | `boolean`                  | —         | 预览 / 编辑总闸                          |
| `height`        | `string \| number`         | `'480px'` | 组件高度，数字按 px                      |
| `autoRotate`    | `boolean`                  | `false`   | 自动旋转视角                             |
| `draco`         | `boolean`                  | `false`   | 模型是否 Draco 压缩（写在当前选中项上）  |
| `initialScene`  | `DeepPartial<SceneConfig>` | —         | 挂载时装载一份场景，只装一次             |
| `sideTabs`      | `EditorPanelTab[]`         | `[]`      | 往左栏导轨末尾追加的页                   |
| `inspectorTabs` | `EditorPanelTab[]`         | `[]`      | 往右栏导轨末尾追加的页                   |
| `assetBaseUrl`  | `string`                   | —         | 只换模型库的根地址，清单不变             |

追加的页正文走具名插槽 `#side-tab-<key>` / `#inspector-tab-<key>`；末尾三个 prop 只在 `editable` 为真时有落点。

## 事件

| 事件                                            | 载荷                    | 说明                              |
| ----------------------------------------------- | ----------------------- | --------------------------------- |
| `loaded`                                        | —                       | 模型加载完成                      |
| `progress`                                      | `percentage`            | 加载进度 0~100                    |
| `error`                                         | `message`               | 加载失败，不中断宿主应用          |
| `cameraChange`                                  | `{ position, target }`  | 拖动结束后回写的机位              |
| `objectClick` / `objectDblclick` / `objectContextMenu` | `ObjectClickPayload` | 单击 / 双击 / 右键模型      |
| `objectPointerEnter` / `objectPointerLeave`     | `ObjectClickPayload`    | 指针进入 / 离开模型               |
| `modelPick`                                     | `ModelPickPayload`      | 点中某个模型（编辑形态自动开）    |
| `modelTransform` / `modelTransformEnd`          | `ModelTransformPayload` | 手柄拖拽中逐帧 / 松手且值确实变了 |

五个 `object*` 由**每个模型自己的** `events.<类型>.enabled` 门控；**库只发事件、从不执行里面的 `code`**，要跑得你自己接。

## 暴露方法

方法挂在组件实例上（`ref` + `InstanceType<typeof SceneViewer>`）：

| 方法                  | 说明                                     |
| --------------------- | ---------------------------------------- |
| `captureCamera()`     | 抓当前机位写回配置                       |
| `measureModel(id)`    | 量模型的世界包围盒，`null` 多半是还在加载 |
| `groundPointAt(x, y)` | 屏幕坐标 → 地面上的 `[x, z]`             |
| `getSceneData()`      | 取一份场景配置深拷贝，交给你的接口       |
| `loadSceneData(data)` | 用一份数据初始化场景（会清空撤销栈）     |
