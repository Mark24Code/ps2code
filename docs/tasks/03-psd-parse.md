# Task 03 — PSD 解析(ag-psd 读取图层树)

## 目标
主进程用 ag-psd 读取 .psd 元信息,产出规范化图层树给渲染进程展示。

## 技术要点
- `readPsd(buffer, { skipCompositeImage: true, skipLayerImageData: true })` 只取结构,快且省内存。
- 递归 `psd.children`:每个节点取 `name`、`hidden`、`left/top/right/bottom`(算宽高)、是否为组(有 `children` 即组)。
- 规范化为共享类型:
```ts
// shared/types.ts
interface PsdLayerNode {
  id: string;          // 路径式稳定 id,如 "0/2/1"
  name: string;
  kind: 'group' | 'layer';
  hidden: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
  width: number;
  height: number;
  children?: PsdLayerNode[];
}
interface PsdMeta {
  width: number; height: number;
  layerCount: number;
  tree: PsdLayerNode[];
}
```
- IPC:`ipcMain.handle('psd:read', (e, psdPath) => PsdMeta)`。

## 缩略图(可选,后续)
- ag-psd 在 Node 渲染缩略图需 canvas 后端(如 `@napi-rs/canvas`)。第一版图层树以文字+尺寸展示即可,缩略图列为增强项。

## 验收
- 对 `design-drafts/a签到.psd` 解析,图层组数量与 backup 记录(约 66 组)量级一致。
- 组/图层区分正确,嵌套层级完整。

## 依赖
- ag-psd
