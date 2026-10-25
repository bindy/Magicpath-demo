import { boardToFlow } from './boardAdapter.js'

// R0 示例板子：只用来冒烟，不代表生产数据。字段按 DESIGN.md 第 4 节。
export const sampleBoard = {
  schemaVersion: 1,
  id: 'r0-sample',
  title: 'R0 示例画布',
  createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
  nodes: [
    { id: 'brief-1', type: 'brief', title: '灵感骨架', content: '开盘 15 分钟到底该看什么？', x: 0, y: 0, w: 260, h: 160, version: 1, status: 'ready' },
    { id: 'image-1', type: 'image', title: '生成图', prompt: '紫粉渐变图标', x: 320, y: 0, w: 260, h: 260, version: 1, status: 'ready' },
    { id: 'text-1', type: 'text', title: '总结', content: '先看量，再看价，最后看结构。', x: 0, y: 220, w: 260, h: 160, version: 1, status: 'ready' },
    { id: 'shape-1', type: 'shape', title: '标注框', shape: 'rectangle', fill: '#fff7ed', stroke: '#f97316', strokeWidth: 2, lineStyle: 'solid', x: 320, y: 320, w: 200, h: 120, version: 1, status: 'ready' },
  ],
  edges: [
    { id: 'e1', from: 'brief-1', to: 'image-1', kind: 'reference' },
    { id: 'e2', from: 'image-1', to: 'text-1', kind: 'branch' },
  ],
  viewport: { x: 20, y: 20, k: 0.9 },
}

export const initialFlow = boardToFlow(sampleBoard)
