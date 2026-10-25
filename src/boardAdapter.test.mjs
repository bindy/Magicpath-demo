import test from 'node:test'
import assert from 'node:assert/strict'
import { boardToFlow, clampZoom, fitViewTarget, flowToBoard, MAX_ZOOM, MIN_ZOOM } from './boardAdapter.js'
import { sampleBoard } from './board.js'

test('缩放 clamp：不超出 0.02 ~ 4', () => {
  assert.equal(MIN_ZOOM, 0.02)
  assert.equal(MAX_ZOOM, 4)
  assert.equal(clampZoom(0.001), 0.02)
  assert.equal(clampZoom(100), 4)
  assert.equal(clampZoom(1.5), 1.5)
})

test('Board ↔ React Flow 往返：节点、边、视口不丢', () => {
  const flow = boardToFlow(sampleBoard)
  assert.equal(flow.nodes.length, 4)
  assert.equal(flow.edges.length, 2)
  assert.equal(flow.viewport.zoom, 0.9)
  const back = flowToBoard(flow.nodes, flow.edges, flow.viewport, sampleBoard)
  assert.equal(back.nodes.length, 4)
  assert.equal(back.viewport.k, 0.9)
  const image = back.nodes.find((n) => n.id === 'image-1')
  assert.equal(image.type, 'image')
  assert.equal(image.x, 320)
  assert.equal(image.prompt, '紫粉渐变图标')
  const shape = back.nodes.find((n) => n.id === 'shape-1')
  assert.equal(shape.shape, 'rectangle')
  assert.equal(shape.fill, '#fff7ed')
  const edge = back.edges.find((e) => e.id === 'e1')
  assert.equal(edge.from, 'brief-1')
  assert.equal(edge.to, 'image-1')
  assert.equal(edge.kind, 'reference')
})

test('显示全部元素：小板子放大到容器，缩放不超上限', () => {
  const flow = boardToFlow(sampleBoard)
  const vp = fitViewTarget(flow.nodes, 800, 600, 50)
  assert.ok(vp.zoom > 0.9 && vp.zoom <= 4, `zoom=${vp.zoom}`)
  assert.ok(Number.isFinite(vp.x) && Number.isFinite(vp.y))
})

test('显示全部元素：大板子缩小到容器，缩放不低于下限', () => {
  const big = {
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, width: 5000, height: 5000 },
      { id: 'b', position: { x: 5000, y: 5000 }, width: 5000, height: 5000 },
    ],
  }
  const vp = fitViewTarget(big.nodes, 800, 600, 50)
  assert.ok(vp.zoom >= 0.02 && vp.zoom < 1, `zoom=${vp.zoom}`)
})

test('显示全部元素：空节点不崩', () => {
  assert.deepEqual(fitViewTarget([], 800, 600), { x: 0, y: 0, zoom: 1 })
})
