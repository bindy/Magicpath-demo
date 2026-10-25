import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addEdge, applyGroupDrag, cloneBoard, copyNodes, createGroup, createMaterial,
  createNode, deleteNode, flipNode, groupBoundingBox, groupOf, longImageOrder,
  moveGroup, moveLayer, pasteClipboard, pushHistory, redoHistory, undoHistory,
  ungroup, updateNode,
} from './boardModel.js'
import { sampleBoard } from './board.js'

function base() {
  const b = cloneBoard(sampleBoard)
  b.groups = []
  b.materials = []
  return b
}

test('R1 节点：创建、改标题内容、删除级联边与分组', () => {
  let b = base()
  const created = createNode(b, 'text', 100, 100, { title: '新文字', content: 'hello' })
  b = created.board
  assert.equal(created.node.version, 1)
  b = updateNode(b, created.node.id, { content: 'hello2' })
  assert.equal(b.nodes.find((n) => n.id === created.node.id).content, 'hello2')
  // 删除 image-1：e1/e2 都应级联删掉
  b = deleteNode(b, 'image-1')
  assert.equal(b.nodes.some((n) => n.id === 'image-1'), false)
  assert.equal(b.edges.some((e) => e.from === 'image-1' || e.to === 'image-1'), false)
})

test('R1 连线校验：自环、重复边、storyboard 成环被拒绝，reference 不限环', () => {
  let b = base()
  assert.equal(addEdge(b, 'brief-1', 'brief-1').error, '禁止自环')
  assert.equal(addEdge(b, 'brief-1', 'image-1', 'reference').error, '重复边已存在')
  let r = addEdge(b, 'brief-1', 'text-1', 'storyboard'); b = r.board; assert.equal(r.error, null)
  r = addEdge(b, 'text-1', 'brief-1', 'storyboard'); assert.equal(r.error, 'storyboard 边成环，已拒绝')
  r = addEdge(b, 'text-1', 'brief-1', 'reference'); assert.equal(r.error, null)
})

test('R1 分组：少于 2 人不成组、成员移出旧组、删节点不足 2 人自动解散、整组移动', () => {
  let b = base()
  assert.equal(createGroup(b, ['brief-1']).group, null)
  let r = createGroup(b, ['brief-1', 'image-1']); b = r.board; assert.ok(r.group)
  assert.equal(groupOf(b, 'brief-1').id, r.group.id)
  r = createGroup(b, ['brief-1', 'text-1']); b = r.board
  assert.equal(groupOf(b, 'brief-1').id, r.group.id)
  assert.equal(b.groups.length, 1, '旧组被移空后应解散，只剩新组')
  b = moveGroup(b, r.group.id, 10, 20)
  assert.equal(b.nodes.find((n) => n.id === 'brief-1').x, 10)
  b = deleteNode(b, 'brief-1')
  assert.equal(b.groups.length, 0, '删后只剩 1 人应自动解散')
})

test('R1 分组拖拽：拖组内成员，其余成员同向移动同一 delta', () => {
  let b = base()
  const r = createGroup(b, ['brief-1', 'text-1']); b = r.board
  const start = { 'brief-1': { x: 0, y: 0 }, 'text-1': { x: 0, y: 220 } }
  b = applyGroupDrag(b, start, 'brief-1', 30, 40)
  assert.deepEqual([b.nodes.find((n) => n.id === 'brief-1').x, b.nodes.find((n) => n.id === 'brief-1').y], [30, 40])
  assert.deepEqual([b.nodes.find((n) => n.id === 'text-1').x, b.nodes.find((n) => n.id === 'text-1').y], [30, 260])
  const bb = groupBoundingBox(b, groupOf(b, 'brief-1'))
  assert.equal(bb.count, 2)
  assert.ok(bb.w > 0 && bb.h > 0)
})

test('R1 历史：push/撤销/重做往返，上限 50', () => {
  let past = []
  let future = []
  let present = base()
  const first = present
  present = createNode(present, 'text', 0, 0).board
  past = pushHistory(past, first)
  let h = undoHistory(past, present, future)
  assert.equal(h.ok, true)
  assert.equal(h.present.nodes.length, first.nodes.length)
  h = redoHistory(h.past, h.present, h.future)
  assert.equal(h.ok, true)
  assert.equal(h.present.nodes.length, first.nodes.length + 1)
  let p = []
  for (let i = 0; i < 60; i++) p = pushHistory(p, base())
  assert.equal(p.length, 50)
  assert.equal(undoHistory([], base(), []).ok, false)
})

test('R1 剪贴：粘贴新 id、偏移 40、版本重计、追溯 copiedFrom、只带组内边', () => {
  let b = base()
  const clip = copyNodes(b, ['brief-1', 'image-1'])
  assert.equal(clip.edges.length, 1, '只带 brief->image 的组内边')
  const pasted = pasteClipboard(b, clip)
  b = pasted.board
  assert.equal(pasted.newIds.length, 2)
  assert.ok(!pasted.newIds.includes('brief-1'))
  const copy = b.nodes.find((n) => n.id === pasted.newIds[0])
  assert.equal(copy.version, 1)
  assert.equal(copy.copiedFrom, 'brief-1')
  assert.equal(copy.x, 40)
  assert.equal(b.edges.filter((e) => pasted.newIds.includes(e.from)).length, 1)
  // 空剪贴板粘贴不改变
  assert.equal(pasteClipboard(b, { nodes: [], edges: [] }).board.nodes.length, b.nodes.length)
})

test('R1 翻转与层级：图片/图形可翻转、文字不变；层级只换顺序不改长图 y 顺序', () => {
  let b = base()
  b = flipNode(b, 'image-1', 'horizontal')
  assert.equal(b.nodes.find((n) => n.id === 'image-1').flipH, true)
  b = flipNode(b, 'image-1', 'horizontal')
  assert.equal(b.nodes.find((n) => n.id === 'image-1').flipH, false)
  const beforeText = cloneBoard(b)
  b = flipNode(b, 'text-1', 'horizontal')
  assert.deepEqual(b, beforeText)
  const orderBefore = longImageOrder(b)
  // text-1 的 y=220 唯一：把它上移一层换 nodes 顺序，长图 y 顺序仍应不变。
  // （brief/image 的 y 都是 0，用它们测会因稳定排序 tie 顺序而误判。）
  b = moveLayer(b, 'text-1', 'up')
  assert.notEqual(b.nodes[2].id, 'text-1')
  assert.deepEqual(longImageOrder(b), orderBefore)
})

test('R1 创建素材：登记不改节点、assetId 缺失记 null', () => {
  let b = base()
  const before = b.nodes.length
  b = createMaterial(b, 'image-1')
  assert.equal(b.nodes.length, before)
  assert.equal(b.materials.length, 1)
  assert.equal(b.materials[0].assetId, null)
  assert.equal(b.materials[0].sourceNodeId, 'image-1')
})
