import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_SCHEMA_VERSION, exportZip, importAssetRecord, importZipFile,
  listMissingAssets, migrateBoard, parseImportPayload, stripBlobs,
} from './storage.js'
import { applyOps } from './ops.js'
import { cloneBoard } from './boardModel.js'
import { sampleBoard } from './board.js'

test('R3 迁移：旧版/缺失字段补齐、未知字段保留、未来版本不降级', () => {
  const old = { nodes: [], edges: [], customField: 'keep-me' }
  const r = migrateBoard(old)
  assert.equal(r.error, null)
  assert.equal(r.board.schemaVersion, CURRENT_SCHEMA_VERSION)
  assert.equal(r.board.customField, 'keep-me')
  assert.deepEqual(r.board.groups, [])
  assert.deepEqual(r.board.materials, [])
  const future = migrateBoard({ schemaVersion: 99, nodes: [], edges: [] })
  assert.equal(future.error.includes('不降级'), true)
  assert.equal(migrateBoard(null).error, '导入的板子不是对象')
})

test('R3 导出不含 blob、缺失资产检测、导入缺资产整包拒绝不丢节点', () => {
  const board = cloneBoard(sampleBoard)
  board.nodes[1].assetUrl = 'blob:http://fake/123'
  board.nodes[1].assetId = 'asset-1'
  const stripped = stripBlobs(board)
  assert.equal(stripped.nodes[1].assetUrl, undefined)
  assert.equal(stripped.nodes[1].assetId, 'asset-1')
  assert.deepEqual(listMissingAssets(board, []), ['asset-1'])
  assert.deepEqual(listMissingAssets(board, ['asset-1']), [])
  const bad = parseImportPayload({ nodes: [] })
  assert.equal(bad.error, null)
  assert.equal(parseImportPayload('not json').error, '导入文件不是合法 JSON')
  assert.equal(parseImportPayload({}).error, '导入的板子缺少 nodes 数组')
})

test('R3 zip 往返：导出再导入板子一致，缺资产的 zip 被拒绝', async () => {
  const board = cloneBoard(sampleBoard)
  const blob = await exportZip(board)
  assert.ok(blob.size > 0)
  const imported = await importZipFile(blob)
  assert.equal(imported.error, null)
  assert.equal(imported.board.title, board.title)
  assert.equal(imported.board.nodes.length, board.nodes.length)
  // 手工造一个缺资产的 zip：节点有 assetId，但 assets.json 里没有它
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const withAsset = cloneBoard(sampleBoard)
  withAsset.nodes[1].assetId = 'missing-asset-9'
  zip.file('projects.json', JSON.stringify(withAsset))
  zip.file('assets.json', JSON.stringify({ materials: [] }))
  const badBlob = await zip.generateAsync({ type: 'blob' })
  const bad = await importZipFile(badBlob)
  assert.equal(bad.board, null)
  assert.deepEqual(bad.missing, ['missing-asset-9'])
  assert.equal(bad.error.includes('缺失资产'), true)
})

test('R3 ops：去重不重复建节点、失败整批回滚、R1 扩展 ops 全覆盖', () => {
  const board = cloneBoard(sampleBoard)
  const ops = [
    { clientOpId: 'op-1', type: 'add_node', nodeType: 'text', title: 'Agent 建的', position: { x: 10, y: 10 } },
    { clientOpId: 'op-2', type: 'flip_node', id: 'image-1', axis: 'horizontal' },
    { clientOpId: 'op-3', type: 'move_layer', id: 'text-1', direction: 'up' },
    { clientOpId: 'op-4', type: 'create_material', id: 'image-1' },
  ]
  const r = applyOps(board, ops, [])
  assert.equal(r.error, null)
  assert.equal(r.board.nodes.length, board.nodes.length + 1)
  assert.equal(r.board.nodes.find((n) => n.id === 'image-1').flipH, true)
  assert.equal(r.board.materials.length, 1)
  // 重放同一批：全部跳过，不重复建节点
  const replay = applyOps(r.board, ops, r.applied)
  assert.equal(replay.error, null)
  assert.deepEqual(replay.skipped, ['op-1', 'op-2', 'op-3', 'op-4'])
  assert.equal(replay.board.nodes.length, r.board.nodes.length)
  // 失败回滚：第二条删不存在的节点，整批作废，第一条也不生效
  const bad = applyOps(board, [
    { clientOpId: 'b-1', type: 'add_node', nodeType: 'text', title: '不应留下', position: { x: 0, y: 0 } },
    { clientOpId: 'b-2', type: 'delete_node', id: 'no-such-node' },
  ], [])
  assert.equal(bad.error.includes('节点不存在'), true)
  assert.equal(bad.board.nodes.length, board.nodes.length)
  assert.deepEqual(bad.applied, [])
  // 复制粘贴 ops：同批内 copy 后 paste，新节点版本重计、追溯 copiedFrom
  const cp = applyOps(board, [
    { clientOpId: 'c-1', type: 'copy_nodes', ids: ['image-1'] },
    { clientOpId: 'c-2', type: 'paste_nodes' },
  ], [], null)
  assert.equal(cp.error, null)
  assert.equal(cp.board.nodes.length, board.nodes.length + 1)
  const pasted = cp.board.nodes[cp.board.nodes.length - 1]
  assert.equal(pasted.copiedFrom, 'image-1')
  assert.equal(pasted.version, 1)
  // 缺 clientOpId 直接整批拒绝
  assert.equal(applyOps(board, [{ type: 'add_node' }], []).error.includes('clientOpId'), true)
})

test('R3 资产与历史导入：assetId 复用、ready、版本 1；缺失资产明确报错不建节点', () => {
  const board = cloneBoard(sampleBoard)
  const ok = importAssetRecord(board, { id: 'mat-1', type: 'image', title: '旧图', assetId: 'asset-7', prompt: '旧提示' })
  assert.equal(ok.error, null)
  assert.equal(ok.node.assetId, 'asset-7')
  assert.equal(ok.node.status, 'ready')
  assert.equal(ok.node.version, 1)
  assert.equal(ok.board.nodes.length, board.nodes.length + 1)
  const missing = importAssetRecord(board, { id: 'mat-2', type: 'image', title: '无资产图', assetId: null })
  assert.equal(missing.node, null)
  assert.equal(missing.error.includes('资产缺失'), true)
  assert.equal(missing.board.nodes.length, board.nodes.length)
  const textOk = importAssetRecord(board, { id: 'h-1', type: 'text', title: '旧文字', content: '旧内容' })
  assert.equal(textOk.error, null)
  assert.equal(textOk.node.content, '旧内容')
})
