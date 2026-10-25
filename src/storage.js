// storage.js — R3 存储的纯逻辑层（无 React、无 DOM、无 IndexedDB）。
// IndexedDB（经 localforage）与 zip（经 JSZip）只在 UI 层调用这里的纯函数，
// 所以迁移、校验、缺失资产检测都能在 Node 单测里跑。
// 规则（DESIGN.md 第 11 节、第 0.6 节）：
// - schemaVersion 只增不降：缺失或旧版本升到当前版，未来版本不降级、明确报错。
// - 未知字段原样保留：迁移只补缺失字段，不删用户数据。
// - 快照/导出不含 blob：assetUrl 只在当前会话有效，导出时剥掉，只留 assetId；
//   zip 里只有 projects.json（板子）+ assets.json（资产元数据），不重复存 blob。
// - 缺失资产明确报错、不静默丢节点：导入时缺资产就整包拒绝，不删节点。

import JSZip from 'jszip'
import { cloneBoard, createNode } from './boardModel.js'

export const CURRENT_SCHEMA_VERSION = 1
export const STORAGE_KEY = 'magicpath-board-v1'

export function migrateBoard(board) {
  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    return { board: null, error: '导入的板子不是对象' }
  }
  const next = cloneBoard(board)
  const v = next.schemaVersion
  if (v != null && v > CURRENT_SCHEMA_VERSION) {
    return { board: cloneBoard(board), error: `板子版本 ${v} 高于当前原型 ${CURRENT_SCHEMA_VERSION}，不降级` }
  }
  next.schemaVersion = CURRENT_SCHEMA_VERSION
  if (!Array.isArray(next.nodes)) next.nodes = []
  if (!Array.isArray(next.edges)) next.edges = []
  if (!Array.isArray(next.groups)) next.groups = []
  if (!Array.isArray(next.materials)) next.materials = []
  if (!next.viewport || typeof next.viewport !== 'object') next.viewport = { x: 0, y: 0, k: 1 }
  if (next.title == null) next.title = '未命名画布'
  // 未知字段：cloneBoard 已原样保留，这里不删。
  return { board: next, error: null }
}

export function stripBlobs(board) {
  const next = cloneBoard(board)
  for (const node of next.nodes || []) delete node.assetUrl
  return next
}

export function listMissingAssets(board, availableAssetIds = []) {
  const available = new Set(availableAssetIds.filter((id) => id != null))
  const missing = new Set()
  for (const node of board.nodes || []) {
    if (node.assetId != null && !available.has(node.assetId)) missing.add(node.assetId)
  }
  for (const material of board.materials || []) {
    if (material.assetId != null && !available.has(material.assetId)) missing.add(material.assetId)
  }
  return [...missing]
}

// 导入校验：先校验格式与版本，再校验缺失资产；任一失败都返回 board=null，
// 调用方不得把节点静默丢弃后提交。
export function parseImportPayload(payload) {
  let raw = payload
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return { board: null, missing: [], error: '导入文件不是合法 JSON' } }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) {
    return { board: null, missing: [], error: '导入的板子缺少 nodes 数组' }
  }
  const { board, error } = migrateBoard(raw)
  if (error || !board) return { board: null, missing: [], error: error || '迁移失败' }
  return { board, missing: [], error: null }
}

export async function exportZip(board) {
  const { board: migrated } = migrateBoard(board)
  const stripped = stripBlobs(migrated)
  const zip = new JSZip()
  zip.file('projects.json', JSON.stringify(stripped, null, 2))
  zip.file('assets.json', JSON.stringify({ materials: stripped.materials || [] }, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

// file：浏览器 File/Blob。返回 { board, missing, error }，missing 非空时 board=null。
export async function importZipFile(file) {
  let zip
  try { zip = await JSZip.loadAsync(file) } catch { return { board: null, missing: [], error: '不是合法 zip 包' } }
  const projectsFile = zip.file('projects.json')
  if (!projectsFile) return { board: null, missing: [], error: 'zip 里没有 projects.json' }
  const text = await projectsFile.async('string')
  const parsed = parseImportPayload(text)
  if (parsed.error || !parsed.board) return parsed
  let available = []
  const assetsFile = zip.file('assets.json')
  if (assetsFile) {
    try {
      const assets = JSON.parse(await assetsFile.async('string'))
      available = (assets.materials || []).map((m) => m.assetId).filter((id) => id != null)
    } catch { /* assets.json 坏了就按无资产算，缺失检测会报出来 */ }
  }
  const missing = listMissingAssets(parsed.board, available)
  if (missing.length) {
    return { board: null, missing, error: `缺失资产：${missing.join('、')}，未导入任何节点` }
  }
  return { board: parsed.board, missing: [], error: null }
}

// ---- 资产与历史导入 ----
// record 来自资产页签（materials）或历史页签（本板 ready 节点）。
// 图片/视频记录必须有 assetId（或 assetUrl）才算有资产，否则明确报错、不建节点；
// 文字/图形/简报不需要资产。新建节点：assetId 复用、状态 ready、版本从 1 计，
// 不覆盖原记录、不改原画布。
export function importAssetRecord(board, record, position = { x: 400, y: 300 }) {
  if (!record || !record.type) return { board: cloneBoard(board), node: null, error: '导入记录缺少类型' }
  const needsAsset = record.type === 'image' || record.type === 'video'
  if (needsAsset && record.assetId == null && record.assetUrl == null) {
    return { board: cloneBoard(board), node: null, error: `资产缺失：${record.title || record.id || '该记录'} 没有 assetId，无法导入` }
  }
  const { board: next, node } = createNode(board, record.type, position.x, position.y, {
    title: record.title || '导入节点',
    prompt: record.prompt || undefined,
    content: record.content || undefined,
    assetId: record.assetId != null ? record.assetId : undefined,
    assetUrl: record.assetUrl || undefined,
    status: 'ready',
    version: 1,
    generation: { ...(record.generation || {}), importedFrom: record.id || record.sourceNodeId || null },
  })
  return { board: next, node, error: null }
}
