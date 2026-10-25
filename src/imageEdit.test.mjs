import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addMaskRegion, addTextLayer, clampBrushSize, clampPercent, createEditNode,
  createMaskRegion, ensureImageTextLayers, MAX_MASK_REGIONS, regionFromPoint,
  removeMaskRegion, removeTextLayer, updateMaskRegion, updateTextLayer,
} from './imageEdit.js'
import { cloneBoard } from './boardModel.js'
import { sampleBoard } from './board.js'

function imageNode() {
  return { id: 'img1', type: 'image', title: '图', x: 0, y: 0, w: 260, h: 260, version: 2, status: 'ready', prompt: '原提示' }
}

test('R2 图内文字：百分比 clamp、改层不重生图、删层不留空、已有层不被覆盖', () => {
  const node = imageNode()
  const layer = addTextLayer(node, { text: '你好', x: 150, y: -10, fontSize: 24, color: '#ff0000', bold: true })
  assert.equal(layer.x, 100)
  assert.equal(layer.y, 0)
  assert.equal(node.imageTexts.length, 1)
  updateTextLayer(node, layer.id, { text: '改后', x: 30 })
  assert.equal(node.imageTexts[0].text, '改后')
  assert.equal(node.version, 2, '改层不改版本号、不重生图')
  removeTextLayer(node, layer.id)
  assert.equal(node.imageTexts.length, 0)
  // ensure：已有层不动，没有层才用标题建默认层
  node.imageTexts = [{ id: 't1', text: '旧层', x: 10, y: 10 }]
  ensureImageTextLayers(node, '标题')
  assert.equal(node.imageTexts[0].text, '旧层')
  const empty = imageNode()
  ensureImageTextLayers(empty, '标题')
  assert.equal(empty.imageTexts[0].text, '标题')
  assert.equal(clampPercent('bad'), 50)
})

test('R2 涂抹选区：笔大小 clamp、百分比 clamp、最多 10 区、删区不留空、点转区域', () => {
  assert.equal(MAX_MASK_REGIONS, 10)
  assert.equal(clampBrushSize(1), 5)
  assert.equal(clampBrushSize(999), 50)
  const node = imageNode()
  for (let i = 0; i < 10; i++) {
    const r = addMaskRegion(node, { brushSize: 10 })
    assert.equal(r.error, null)
  }
  assert.equal(node.maskRegions.length, 10)
  const over = addMaskRegion(node, {})
  assert.equal(over.region, null)
  assert.equal(over.error, '最多可添加 10 个编辑区域')
  updateMaskRegion(node, node.maskRegions[0].id, { x: 200, w: 300 })
  assert.equal(node.maskRegions[0].x, 100)
  assert.equal(node.maskRegions[0].w, 100)
  const firstId = node.maskRegions[0].id
  removeMaskRegion(node, firstId)
  assert.equal(node.maskRegions.length, 9)
  assert.equal(node.maskRegions.some((r) => r.id === firstId), false)
  const fromPoint = regionFromPoint(50, 50, 20)
  assert.equal(fromPoint.x, 40)
  assert.equal(fromPoint.y, 40)
  assert.equal(fromPoint.w, 20)
  const centered = createMaskRegion({})
  assert.equal(centered.x, 45)
  assert.equal(centered.y, 45)
})

test('R2 改图提交：走 edit 边、新版本+1、来源不变、非图片节点拒绝', () => {
  const board = cloneBoard(sampleBoard)
  board.groups = []
  const before = JSON.parse(JSON.stringify(board.nodes.find((n) => n.id === 'image-1')))
  const r = createEditNode(board, 'image-1', 'erase', '擦掉左上角')
  assert.equal(r.error, null)
  assert.equal(r.node.version, before.version + 1)
  assert.equal(r.node.status, 'generating')
  assert.equal(r.node.generation.action, 'erase')
  assert.deepEqual(r.node.generation.parentIds, ['image-1'])
  assert.equal(r.board.edges.some((e) => e.from === 'image-1' && e.to === r.node.id && e.kind === 'edit'), true)
  const srcAfter = r.board.nodes.find((n) => n.id === 'image-1')
  assert.deepEqual(srcAfter, before, '来源节点原样不动')
  const bad = createEditNode(board, 'text-1', 'erase')
  assert.equal(bad.node, null)
  assert.equal(bad.error, '改图只对图片节点做')
})
