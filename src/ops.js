// ops.js — Agent ops 的纯逻辑层（无 React、无 DOM）。
// 规则（DESIGN.md 第 8 节、第 0.6 节）：
// - 每批 ops 原子应用：任一 op 失败，整批回滚，board 原样返回，已用 clientOpId 不变。
// - clientOpId 去重：已用过的 id 直接跳过（不重复建节点），不算失败。
// - 写操作走确认条：这里只做应用，确认拦截在 UI 层（准备 -> 确认条 -> 确认后才调 applyOps）。
// - 覆盖 R1 扩展 ops：copy_nodes、paste_nodes、flip_node、move_layer、create_material。

import {
  addEdge, cloneBoard, copyNodes, createMaterial, createNode, deleteEdge,
  deleteNode, flipNode, moveLayer, pasteClipboard, updateNode,
} from './boardModel.js'

function fail(board, applied, clipboard, error) {
  return { board: cloneBoard(board), applied: [...applied], skipped: [], clipboard, error }
}

// ops：数组，每项 { clientOpId, type, ... }。appliedClientOpIds：已用过的 id 列表。
// clipboard：传入的剪贴板快照（copy_nodes 会更新它，paste_nodes 用它），返回时一并带回。
export function applyOps(board, ops, appliedClientOpIds = [], clipboard = null) {
  if (!Array.isArray(ops)) return fail(board, appliedClientOpIds, clipboard, 'ops 不是数组')
  const applied = [...appliedClientOpIds]
  const appliedSet = new Set(applied)
  const skipped = []
  let next = cloneBoard(board)
  let nextClipboard = clipboard

  for (const op of ops) {
    if (!op || !op.clientOpId) return fail(board, appliedClientOpIds, clipboard, 'op 缺少 clientOpId，已整批回滚')
    if (appliedSet.has(op.clientOpId)) { skipped.push(op.clientOpId); continue }
    const before = cloneBoard(next)
    try {
      switch (op.type) {
        case 'add_node': {
          const r = createNode(next, op.nodeType, op.position?.x ?? 0, op.position?.y ?? 0, {
            ...(op.id ? { id: op.id } : {}),
            title: op.title,
            ...(op.metadata || {}),
          })
          next = r.board
          break
        }
        case 'update_node': {
          if (!next.nodes.some((n) => n.id === op.id)) throw new Error(`节点不存在：${op.id}`)
          next = updateNode(next, op.id, op.patch || {})
          break
        }
        case 'delete_node': {
          if (!next.nodes.some((n) => n.id === op.id)) throw new Error(`节点不存在：${op.id}`)
          next = deleteNode(next, op.id)
          break
        }
        case 'add_edge': {
          const r = addEdge(next, op.from, op.to, op.kind || 'reference')
          if (r.error) throw new Error(r.error)
          next = r.board
          break
        }
        case 'delete_edge': {
          if (!next.edges.some((e) => e.id === op.id)) throw new Error(`边不存在：${op.id}`)
          next = deleteEdge(next, op.id)
          break
        }
        case 'copy_nodes': {
          nextClipboard = copyNodes(next, op.ids || [])
          break
        }
        case 'paste_nodes': {
          if (!nextClipboard || !nextClipboard.nodes?.length) throw new Error('剪贴板为空，无法粘贴')
          const r = pasteClipboard(next, nextClipboard, op.offset || { x: 40, y: 40 })
          next = r.board
          break
        }
        case 'flip_node': {
          const node = next.nodes.find((n) => n.id === op.id)
          if (!node) throw new Error(`节点不存在：${op.id}`)
          if (node.type !== 'image' && node.type !== 'shape') throw new Error(`只有图片/图形可翻转：${op.id}`)
          next = flipNode(next, op.id, op.axis || 'horizontal')
          break
        }
        case 'move_layer': {
          if (!next.nodes.some((n) => n.id === op.id)) throw new Error(`节点不存在：${op.id}`)
          next = moveLayer(next, op.id, op.direction || 'up')
          break
        }
        case 'create_material': {
          if (!next.nodes.some((n) => n.id === op.id)) throw new Error(`节点不存在：${op.id}`)
          next = createMaterial(next, op.id)
          break
        }
        default:
          throw new Error(`未知 op 类型：${op.type}`)
      }
    } catch (e) {
      void before
      return fail(board, appliedClientOpIds, clipboard, e.message || 'op 执行失败，已整批回滚')
    }
    applied.push(op.clientOpId)
    appliedSet.add(op.clientOpId)
  }
  return { board: next, applied, skipped, clipboard: nextClipboard, error: null }
}
