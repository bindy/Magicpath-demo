// boardAdapter.js — Board (DESIGN.md 第 4 节) ↔ React Flow 的适配层。
// 这是 R0 唯一的核心逻辑：Board 仍是事实来源，React Flow 状态只是它的视图投影。
// 所有持久化、导出、Agent ops 都先落到 Board，再经这里同步到 React Flow，
// 不要反过来让 React Flow 状态成为唯一真相。

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 4
export const DEFAULT_NODE_WIDTH = 260
export const DEFAULT_NODE_HEIGHT = 160

export function clampZoom(zoom) {
  const z = Number(zoom)
  if (!Number.isFinite(z)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

// Board 节点 -> React Flow 节点。type 直接对应 nodeTypes 的 key，
// brief / image / text / video / shape 五种，见 DESIGN.md v2 第 0.1 节。
export function boardToFlow(board) {
  const nodes = (board.nodes || []).map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    data: { ...node },
    width: node.w || DEFAULT_NODE_WIDTH,
    height: node.h || DEFAULT_NODE_HEIGHT,
    style: { width: node.w || DEFAULT_NODE_WIDTH, height: node.h || DEFAULT_NODE_HEIGHT },
  }))
  const edges = (board.edges || []).map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    data: { kind: edge.kind },
  }))
  const viewport = board.viewport
    ? { x: board.viewport.x, y: board.viewport.y, zoom: clampZoom(board.viewport.scale ?? board.viewport.zoom ?? board.viewport.k ?? 1) }
    : { x: 0, y: 0, zoom: 1 }
  return { nodes, edges, viewport }
}

// React Flow 节点/边 -> Board 节点/边。只回写 Board 字段，丢弃 React Flow 的
// 内部量测字段（measured 等），避免把视图状态写进事实来源。
export function flowToBoard(flowNodes, flowEdges, viewport, baseBoard) {
  const nodes = (flowNodes || []).map((node) => {
    const data = node.data || {}
    return {
      ...data,
      id: node.id,
      type: node.type,
      x: node.position.x,
      y: node.position.y,
      w: node.width || data.w || DEFAULT_NODE_WIDTH,
      h: node.height || data.h || DEFAULT_NODE_HEIGHT,
    }
  })
  const edges = (flowEdges || []).map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    kind: edge.data?.kind || 'reference',
  }))
  return {
    ...(baseBoard || {}),
    nodes,
    edges,
    viewport: viewport
      ? { x: viewport.x, y: viewport.y, k: clampZoom(viewport.zoom) }
      : baseBoard?.viewport,
  }
}

// “显示全部元素”：按节点外接矩形算出能装下全部节点的视口，
// 再按 0.02~4 clamp。返回 React Flow viewport 格式 { x, y, zoom }。
// 公式：zoom = min((容器宽-2*padding)/包围宽, (容器高-2*padding)/包围高)，
// x = 容器中心x - 包围中心x * zoom，y 同理。
export function fitViewTarget(nodes, containerWidth, containerHeight, padding = 50) {
  const list = nodes || []
  if (!list.length || !containerWidth || !containerHeight) {
    return { x: 0, y: 0, zoom: 1 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of list) {
    const x = node.position?.x ?? node.x ?? 0
    const y = node.position?.y ?? node.y ?? 0
    const w = node.width ?? node.w ?? DEFAULT_NODE_WIDTH
    const h = node.height ?? node.h ?? DEFAULT_NODE_HEIGHT
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  const boxW = Math.max(1, maxX - minX)
  const boxH = Math.max(1, maxY - minY)
  const zoom = clampZoom(
    Math.min((containerWidth - padding * 2) / boxW, (containerHeight - padding * 2) / boxH),
  )
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return {
    x: containerWidth / 2 - centerX * zoom,
    y: containerHeight / 2 - centerY * zoom,
    zoom,
  }
}
