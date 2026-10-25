import { useCallback, useRef, useState } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { clampZoom, fitViewTarget, MAX_ZOOM, MIN_ZOOM } from './boardAdapter.js'
import { initialFlow, sampleBoard } from './board.js'
import { nodeTypes } from './nodes.jsx'

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialFlow.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlow.edges)
  const { getViewport, setViewport } = useReactFlow()
  const [zoomDisplay, setZoomDisplay] = useState(initialFlow.viewport.zoom)
  const wrapRef = useRef(null)

  const setZoom = useCallback(
    (zoom) => {
      const vp = getViewport()
      setViewport({ ...vp, zoom: clampZoom(zoom) }, { duration: 200 })
    },
    [getViewport, setViewport],
  )

  const fitAll = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setViewport(fitViewTarget(nodes, rect.width, rect.height, 50), { duration: 200 })
  }, [nodes, setViewport])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen?.()
  }, [])

  const zoom = zoomDisplay

  return (
    <div>
      <div className="topbar">
        <strong>{sampleBoard.title}</strong>
        <span>R0：React Flow 适配 + 缩放 + 显示全部元素冒烟</span>
        <button onClick={toggleFullscreen}>全屏查看</button>
      </div>
      <div className="canvas-wrap" ref={wrapRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          defaultViewport={initialFlow.viewport}
          onViewportChange={(vp) => setZoomDisplay(vp.zoom)}
          fitView
        >
          <Background />
        </ReactFlow>
        <div className="zoombar">
          <button onClick={() => setZoom(zoom - 0.1)}>缩小</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(zoom + 0.1)}>放大</button>
          <button onClick={() => setZoom(0.25)}>25%</button>
          <button onClick={() => setZoom(0.5)}>50%</button>
          <button onClick={() => setZoom(1)}>100%</button>
          <button onClick={() => setZoom(2)}>200%</button>
          <button onClick={fitAll}>显示全部元素</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
