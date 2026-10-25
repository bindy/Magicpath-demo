import { Handle, Position } from '@xyflow/react'

function Card({ data }) {
  return (
    <div className="node-card">
      <h4>{data.title}</h4>
      <p>{data.content || data.prompt || ''}</p>
    </div>
  )
}

function BaseNode({ data, children }) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Handle type="target" position={Position.Left} />
      {children}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function BriefNode({ data }) {
  return (
    <BaseNode data={data}>
      <Card data={data} />
    </BaseNode>
  )
}

export function ImageNode({ data }) {
  return (
    <BaseNode data={data}>
      <div className="node-card" style={{ background: 'linear-gradient(135deg,#c084fc,#f472b6)' }}>
        <h4>{data.title}</h4>
        <p>{data.prompt || '图片节点（R0 占位，未接生成）'}</p>
      </div>
    </BaseNode>
  )
}

export function TextNode({ data }) {
  return (
    <BaseNode data={data}>
      <Card data={data} />
    </BaseNode>
  )
}

export function VideoNode({ data }) {
  return (
    <BaseNode data={data}>
      <Card data={data} />
    </BaseNode>
  )
}

export function ShapeNode({ data }) {
  const isLine = data.shape === 'line' || data.shape === 'arrow'
  if (isLine) {
    return (
      <BaseNode data={data}>
        <svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="none">
          <line
            x1="10"
            y1="60"
            x2="190"
            y2="60"
            stroke={data.stroke || '#111'}
            strokeWidth={data.strokeWidth || 2}
            strokeDasharray={
              data.lineStyle === 'dashed' ? '8 6' : data.lineStyle === 'dotted' ? '2 6' : data.lineStyle === 'dash-dot' ? '8 4 2 4' : undefined
            }
            markerEnd={data.shape === 'arrow' ? 'url(#arrowhead)' : undefined}
          />
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill={data.stroke || '#111'} />
            </marker>
          </defs>
        </svg>
      </BaseNode>
    )
  }
  return (
    <BaseNode data={data}>
      <div
        className="shape-box"
        style={{
          background: data.fill || 'transparent',
          border: `${data.strokeWidth || 2}px solid ${data.stroke || '#111'}`,
          borderRadius: data.shape === 'ellipse' ? '50%' : 8,
        }}
      />
    </BaseNode>
  )
}

export const nodeTypes = {
  brief: BriefNode,
  image: ImageNode,
  text: TextNode,
  video: VideoNode,
  shape: ShapeNode,
}
