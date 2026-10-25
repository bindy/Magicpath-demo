// imageEdit.js — 图片节点内部编辑的纯逻辑层（无 React、无 DOM）。
// 思路直接迁自 v1 src/image-text.js（本项目自己的代码），不是豆包代码。
// 两层都是“百分比定位”：文字层和涂抹蒙版层都只存相对图片框的百分比，
// 节点宽度变了、长图导出放大了，相对位置不变；改层不触发重生图。

export function clampPercent(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 50
  return Math.min(100, Math.max(0, n))
}

export function clampBrushSize(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 10
  return Math.min(50, Math.max(5, n))
}

// ---- 图内文字层 ----
export function createTextLayer(overrides = {}) {
  return {
    id: overrides.id || `t_${Math.random().toString(36).slice(2, 8)}`,
    text: overrides.text != null ? String(overrides.text) : '新文字',
    x: clampPercent(overrides.x != null ? overrides.x : 50),
    y: clampPercent(overrides.y != null ? overrides.y : 50),
    fontSize: overrides.fontSize != null ? Number(overrides.fontSize) : 20,
    color: overrides.color || '#ffffff',
    bold: !!overrides.bold,
    align: overrides.align || 'center',
  }
}

export function ensureImageTextLayers(node, fallbackText) {
  if (!node.imageTexts || !node.imageTexts.length) {
    node.imageTexts = [createTextLayer({ text: fallbackText || node.title || '', bold: true })]
  }
  return node.imageTexts
}

export function addTextLayer(node, overrides = {}) {
  if (!node.imageTexts) node.imageTexts = []
  const layer = createTextLayer(overrides)
  node.imageTexts.push(layer)
  return layer
}

export function updateTextLayer(node, id, patch = {}) {
  const layer = (node.imageTexts || []).find((l) => l.id === id)
  if (!layer) return null
  if (patch.text != null) layer.text = String(patch.text)
  if (patch.x != null) layer.x = clampPercent(patch.x)
  if (patch.y != null) layer.y = clampPercent(patch.y)
  if (patch.fontSize != null) layer.fontSize = Number(patch.fontSize)
  if (patch.color != null) layer.color = patch.color
  if (patch.bold != null) layer.bold = !!patch.bold
  if (patch.align != null) layer.align = patch.align
  return layer
}

export function removeTextLayer(node, id) {
  if (!node.imageTexts) return
  node.imageTexts = node.imageTexts.filter((l) => l.id !== id)
}

// ---- 涂抹蒙版层 ----
// 一个区域 = 图片框内的一个百分比矩形。笔大小（brushSize，百分比，5~50）
// 是新建区域的默认边长；区域建好后仍可单独改 x/y/w/h。
// 上限 10 个（豆包侧“最多可添加 10 个编辑区域”，本方案照此限）。
export const MAX_MASK_REGIONS = 10

export function createMaskRegion(overrides = {}) {
  const brush = clampBrushSize(overrides.brushSize != null ? overrides.brushSize : 10)
  const w = clampPercent(overrides.w != null ? overrides.w : brush)
  const h = clampPercent(overrides.h != null ? overrides.h : brush)
  return {
    id: overrides.id || `m_${Math.random().toString(36).slice(2, 8)}`,
    x: clampPercent(overrides.x != null ? overrides.x : 50 - w / 2),
    y: clampPercent(overrides.y != null ? overrides.y : 50 - h / 2),
    w,
    h,
    brushSize: brush,
  }
}

export function regionFromPoint(xPercent, yPercent, brushSize) {
  const brush = clampBrushSize(brushSize)
  return createMaskRegion({ x: xPercent - brush / 2, y: yPercent - brush / 2, w: brush, h: brush, brushSize: brush })
}

export function addMaskRegion(node, overrides = {}) {
  if (!node.maskRegions) node.maskRegions = []
  if (node.maskRegions.length >= MAX_MASK_REGIONS) return { region: null, error: '最多可添加 10 个编辑区域' }
  const region = createMaskRegion(overrides)
  node.maskRegions.push(region)
  return { region, error: null }
}

export function updateMaskRegion(node, id, patch = {}) {
  const region = (node.maskRegions || []).find((r) => r.id === id)
  if (!region) return null
  if (patch.x != null) region.x = clampPercent(patch.x)
  if (patch.y != null) region.y = clampPercent(patch.y)
  if (patch.w != null) region.w = clampPercent(patch.w)
  if (patch.h != null) region.h = clampPercent(patch.h)
  if (patch.brushSize != null) region.brushSize = clampBrushSize(patch.brushSize)
  return region
}

export function removeMaskRegion(node, id) {
  if (!node.maskRegions) return
  node.maskRegions = node.maskRegions.filter((r) => r.id !== id)
}

// ---- 改图提交：走 edit 边生成新版本，来源版本不变 ----
// 注意：这里只建“待生成”的占位节点，不假装已生成。真实改图服务未接通，
// 新节点 status=generating、generation.action 记录动作，来源节点原样不动。
function cloneBoard(board) {
  return JSON.parse(JSON.stringify(board))
}

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
}

export function createEditNode(board, sourceId, action, prompt = '') {
  const source = (board.nodes || []).find((n) => n.id === sourceId)
  if (!source) return { board: cloneBoard(board), node: null, error: '来源节点不存在' }
  if (source.type !== 'image') return { board: cloneBoard(board), node: null, error: '改图只对图片节点做' }
  const next = cloneBoard(board)
  const src = next.nodes.find((n) => n.id === sourceId)
  const node = {
    ...JSON.parse(JSON.stringify(source)),
    id: newId('image'),
    x: source.x + 320,
    y: source.y,
    version: source.version + 1,
    status: 'generating',
    prompt: prompt || source.prompt || '',
    assetId: null,
    assetUrl: null,
    generation: {
      ...(source.generation || {}),
      parentIds: [source.id],
      action,
      taskId: null,
    },
  }
  next.nodes.push(node)
  next.edges.push({ id: newId('e'), from: source.id, to: node.id, kind: 'edit' })
  // 来源节点在 next 里仍是旧版本、旧图层、旧蒙版，不动。
  void src
  return { board: next, node, error: null }
}
