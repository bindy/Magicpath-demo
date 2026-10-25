import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadForNode } from './nodeDownload.js'

test('R1 单节点下载：文字下 txt、图形下 SVG、图片无资产返回 null 不伪造', () => {
  const txt = downloadForNode({ id: 't1', type: 'text', title: '总结', content: '先看量' })
  assert.equal(txt.filename, '总结.txt')
  assert.equal(txt.mime, 'text/plain;charset=utf-8')
  assert.equal(txt.content, '先看量')
  const svg = downloadForNode({ id: 's1', type: 'shape', title: '框', shape: 'rectangle', w: 200, h: 120, fill: '#fff7ed', stroke: '#f97316', strokeWidth: 2, lineStyle: 'dashed' })
  assert.equal(svg.filename, '框.svg')
  assert.ok(svg.content.includes('<svg'))
  assert.ok(svg.content.includes('#fff7ed'))
  assert.ok(svg.content.includes('stroke-dasharray="8 6"'))
  const arrow = downloadForNode({ id: 's2', type: 'shape', title: '箭头', shape: 'arrow', w: 200, h: 120, stroke: '#111111', lineStyle: 'solid' })
  assert.ok(arrow.content.includes('marker-end'))
  assert.equal(downloadForNode({ id: 'i1', type: 'image', title: '图' }), null)
})
