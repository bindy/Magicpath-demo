// boardModel.js — Board 的纯逻辑层（无 React、无 DOM、无存储）。
// 所有 UI 操作和以后的 Agent ops 都先落到这里返回的新 Board，再同步到 React Flow。
// 规则（DESIGN.md v2 第 0、0.6 节）：Board 是事实来源；版本不覆盖；
// 翻转只加标志不重生图；层级只改 nodes 顺序不影响长图 y 顺序；
// 粘贴新 id、位置偏移、版本号重计、追溯记 copiedFrom。

export function cloneBoard(board) {
  return JSON.parse(JSON.stringify(board || { nodes: [], edges: [] }))
}

export function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`
}

const DEFAULT_SIZE = {
  brief: { w: 260, h: 160 },
  image: { w: 260, h: 260 },
  text: { w: 260, h: 160 },
  video: { w: 260, h: 160 },
  shape: { w: 200, h: 120 },
}

export function createNode(board, type, x, y, overrides = {}) {
  const next = cloneBoard(board)
  const size = DEFAULT_SIZE[type] || { w: 260, h: 160 }
  const node = {
    id: overrides.id || newId(type),
    type,
    title: overrides.title || defaultTitle(type),
    x,
    y,
    w: overrides.w || size.w,
    h: overrides.h || size.h,
    version: 1,
    status: overrides.status || 'ready',
    ...overrides,
  }
  // overrides 里的 id/title/w/h/status 已经展开在上面，上面展开顺序保证 overrides 胜出；
  // 但要防止 overrides 把 version 意外带偏：显式重计除外。
  if (overrides.version == null) node.version = 1
  next.nodes = [...(next.nodes || []), node]
  return { board: next, node }
}

function defaultTitle(type) {
  return { brief: '灵感', image: '图片', text: '文字', video: '视频', shape: '图形' }[type] || '节点'
}

export function updateNode(board, id, patch) {
  const next = cloneBoard(board)
  const node = (next.nodes || []).find((n) => n.id === id)
  if (!node) return next
  const { id: _id, type: _type, ...rest } = patch || {}
  Object.assign(node, rest)
  return next
}

export function deleteNode(board, id) {
  const next = cloneBoard(board)
  next.nodes = (next.nodes || []).filter((n) => n.id !== id)
  next.edges = (next.edges || []).filter((e) => e.from !== id && e.to !== id)
  if (Array.isArray(next.groups)) {
    next.groups = next.groups
      .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) }))
      .filter((g) => g.memberIds.length >= 2)
  }
  return next
}

function hasStoryboardPath(board, from, to, visited = new Set()) {
  if (from === to) return true
  if (visited.has(from)) return false
  visited.add(from)
  const edges = (board.edges || []).filter((e) => e.kind === 'storyboard' && e.from === from)
  return edges.some((e) => hasStoryboardPath(board, e.to, to, visited))
}

// 返回 { board, error }，校验失败时 board 原样返回、error 为中文原因。
export function addEdge(board, from, to, kind = 'reference') {
  const nodes = board.nodes || []
  if (!nodes.some((n) => n.id === from) || !nodes.some((n) => n.id === to)) {
    return { board: cloneBoard(board), error: '连线两端节点不存在' }
  }
  if (from === to) return { board: cloneBoard(board), error: '禁止自环' }
  if ((board.edges || []).some((e) => e.from === from && e.to === to && e.kind === kind)) {
    return { board: cloneBoard(board), error: '重复边已存在' }
  }
  if (kind === 'storyboard' && hasStoryboardPath(board, to, from)) {
    return { board: cloneBoard(board), error: 'storyboard 边成环，已拒绝' }
  }
  const next = cloneBoard(board)
  next.edges = [...(next.edges || []), { id: newId('e'), from, to, kind }]
  return { board: next, error: null }
}

export function deleteEdge(board, id) {
  const next = cloneBoard(board)
  next.edges = (next.edges || []).filter((e) => e.id !== id)
  return next
}

// ---- 历史：快照栈，上限 50，拖拽结束才 push 一次由调用方保证 ----
export function pushHistory(past, present) {
  const next = [...past, cloneBoard(present)]
  return next.length > 50 ? next.slice(next.length - 50) : next
}
export function undoHistory(past, present, future) {
  if (!past.length) return { past, present, future, ok: false }
  const prev = past[past.length - 1]
  return { past: past.slice(0, -1), present: cloneBoard(prev), future: [cloneBoard(present), ...future], ok: true }
}
export function redoHistory(past, present, future) {
  if (!future.length) return { past, present, future, ok: false }
  const next = future[0]
  return { past: [...past, cloneBoard(present)], present: cloneBoard(next), future: future.slice(1), ok: true }
}

// ---- 分组：成员列表，不是节点类型；不做嵌套分组 ----
export function groupOf(board, nodeId) {
  return (board.groups || []).find((g) => g.memberIds.includes(nodeId)) || null
}

export function createGroup(board, memberIds) {
  const ids = []
  for (const m of memberIds || []) {
    if (!ids.includes(m) && (board.nodes || []).some((n) => n.id === m)) ids.push(m)
  }
  if (ids.length < 2) return { board: cloneBoard(board), group: null, error: '少于 2 个节点不成组' }
  const next = cloneBoard(board)
  next.groups = (next.groups || [])
    .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => !ids.includes(m)) }))
    .filter((g) => g.memberIds.length >= 2)
  const group = { id: newId('g'), memberIds: ids }
  next.groups.push(group)
  return { board: next, group, error: null }
}

export function ungroup(board, groupId) {
  const next = cloneBoard(board)
  const before = (next.groups || []).length
  next.groups = (next.groups || []).filter((g) => g.id !== groupId)
  return { board: next, ok: (next.groups || []).length !== before }
}

export function moveGroup(board, groupId, dx, dy) {
  const group = (board.groups || []).find((g) => g.id === groupId)
  if (!group) return cloneBoard(board)
  const next = cloneBoard(board)
  for (const node of next.nodes || []) {
    if (group.memberIds.includes(node.id)) {
      node.x += dx
      node.y += dy
    }
  }
  return next
}

// 拖组内任意成员：以拖拽开始时的成员位置为准，拖动节点的新位置算出 delta，
// 其余成员同向移动同一 delta。调用方在 dragStop 时只进一条历史。
export function applyGroupDrag(board, dragStartPositions, draggedId, newX, newY) {
  const group = groupOf(board, draggedId)
  if (!group || !dragStartPositions || !dragStartPositions[draggedId]) {
    return updateNode(board, draggedId, { x: newX, y: newY })
  }
  const start = dragStartPositions[draggedId]
  const dx = newX - start.x
  const dy = newY - start.y
  const next = cloneBoard(board)
  for (const node of next.nodes || []) {
    if (group.memberIds.includes(node.id)) {
      const s = dragStartPositions[node.id]
      if (s) {
        node.x = s.x + dx
        node.y = s.y + dy
      }
    }
  }
  return next
}

export function groupBoundingBox(board, group) {
  const members = (board.nodes || []).filter((n) => group.memberIds.includes(n.id))
  if (!members.length) return null
  const minX = Math.min(...members.map((n) => n.x))
  const minY = Math.min(...members.map((n) => n.y))
  const maxX = Math.max(...members.map((n) => n.x + (n.w || 260)))
  const maxY = Math.max(...members.map((n) => n.y + (n.h || 160)))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, count: members.length }
}

// ---- 剪贴板：内部快照，不走系统剪贴板；粘贴新 id、偏移、版本重计 ----
export function copyNodes(board, ids) {
  const idSet = new Set(ids || [])
  const nodes = (board.nodes || []).filter((n) => idSet.has(n.id)).map((n) => JSON.parse(JSON.stringify(n)))
  const edges = (board.edges || [])
    .filter((e) => idSet.has(e.from) && idSet.has(e.to))
    .map((e) => JSON.parse(JSON.stringify(e)))
  return { nodes, edges }
}

export function pasteClipboard(board, clipboard, offset = { x: 40, y: 40 }) {
  if (!clipboard || !clipboard.nodes?.length) return { board: cloneBoard(board), newIds: [] }
  const next = cloneBoard(board)
  const mapping = new Map()
  const newIds = []
  for (const node of clipboard.nodes) {
    const id = newId(node.type)
    mapping.set(node.id, id)
    newIds.push(id)
    next.nodes.push({
      ...JSON.parse(JSON.stringify(node)),
      id,
      x: node.x + offset.x,
      y: node.y + offset.y,
      version: 1,
      copiedFrom: node.id,
      generation: { ...(node.generation || {}), copiedFrom: node.id },
    })
  }
  for (const edge of clipboard.edges || []) {
    if (mapping.has(edge.from) && mapping.has(edge.to)) {
      next.edges.push({ id: newId('e'), from: mapping.get(edge.from), to: mapping.get(edge.to), kind: edge.kind })
    }
  }
  return { board: next, newIds, mapping }
}

// ---- 翻转与层级 ----
export function flipNode(board, id, axis) {
  const node = (board.nodes || []).find((n) => n.id === id)
  if (!node || (node.type !== 'image' && node.type !== 'shape')) return cloneBoard(board)
  const key = axis === 'vertical' ? 'flipV' : 'flipH'
  return updateNode(board, id, { [key]: !node[key] })
}

export function moveLayer(board, id, direction) {
  const next = cloneBoard(board)
  const idx = (next.nodes || []).findIndex((n) => n.id === id)
  if (idx < 0) return next
  const target = direction === 'up' ? idx + 1 : idx - 1
  if (target < 0 || target >= next.nodes.length) return next
  const tmp = next.nodes[idx]
  next.nodes[idx] = next.nodes[target]
  next.nodes[target] = tmp
  return next
}

// ---- 创建素材：登记，不改节点；assetId 缺失时记 null，R3 导入时按缺失报错 ----
export function createMaterial(board, nodeId) {
  const node = (board.nodes || []).find((n) => n.id === nodeId)
  if (!node) return cloneBoard(board)
  const next = cloneBoard(board)
  next.materials = [...(next.materials || []), {
    id: newId('m'),
    sourceNodeId: node.id,
    assetId: node.assetId || null,
    type: node.type,
    title: node.title,
    prompt: node.prompt || null,
    content: node.content || null,
    model: node.generation?.model || null,
    createdAt: new Date().toISOString(),
  }]
  return next
}

// 长图段顺序：按 y 排序，与 nodes 数组顺序（层级）无关。
export function longImageOrder(board) {
  return [...(board.nodes || [])]
    .filter((n) => n.type !== 'video')
    .sort((a, b) => a.y - b.y)
    .map((n) => n.id)
}
