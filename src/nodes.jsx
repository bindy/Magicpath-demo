import { Handle, Position } from '@xyflow/react'

function Card({ data }) {
  return (
    <div className="node-card">
      <h4>{data.title}</h4>
      <p>{data.content || data.prompt || ''}</p>
      {data.status === 'generating' && <p>生成中占位（未接生成服务）</p>}
    </div>
  )
}

function BaseNode({ data, selected, children }) {
  return (
    <div
      style={{
        width: '100%', height: '100%',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: 2, borderRadius: 8,
      }}
    >
      <Handle type="target" position={Position.Left} />
      {children}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function BriefNode({ data, selected }) {
  return (
    <BaseNode data={data} selected={selected}>
      <Card data={data} />
    </BaseNode>
  )
}

export function ImageNode({ data, selected }) {
  // 翻转只加 CSS 变换，不重生图；变换只作用在卡片上，锚点位置不动。
  const transform = `scaleX(${data.flipH ? -1 : 1}) scaleY(${data.flipV ? -1 : 1})`
  return (
    <BaseNode data={data} selected={selected}>
      <div className="node-card" style={{ position: 'relative', background: 'linear-gradient(135deg,#c084fc,#f472b6)', transform }}>
        <h4>{data.title}</h4>
        <p>{data.prompt || '图片节点'}</p>
        {data.status === 'generating' && <p>生成中占位（未接生成服务）</p>}
        {(data.maskRegions || []).map((region) => (
          <div key={region.id} style={{ position: 'absolute', left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%`, background: 'rgba(37,99,235,0.35)', border: '1px dashed #2563eb', pointerEvents: 'none' }} />
        ))}
        {(data.imageTexts || []).map((layer) => (
          <span key={layer.id} style={{ position: 'absolute', left: `${layer.x}%`, top: `${layer.y}%`, transform: 'translate(-50%,-50%)', fontSize: layer.fontSize, color: layer.color, fontWeight: layer.bold ? 'bold' : 'normal', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{layer.text}</span>
        ))}
      </div>
    </BaseNode>
  )
}

export function TextNode({ data, selected }) {
  return (
    <BaseNode data={data} selected={selected}>
      <Card data={data} />
    </BaseNode>
  )
}

export function VideoNode({ data, selected }) {
  return (
    <BaseNode data={data} selected={selected}>
      <Card data={data} />
    </BaseNode>
  )
}

export function ShapeNode({ data, selected }) {
  const isLine = data.shape === 'line' || data.shape === 'arrow'
  if (isLine) {
    // 水平翻转：交换线段两端，箭头方向随之反转；垂直翻转对水平线无视觉变化。
    const x1 = data.flipH ? 190 : 10
    const x2 = data.flipH ? 10 : 190
    return (
      <BaseNode data={data} selected={selected}>
        <svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="none">
          <line
            x1={x1}
            y1="60"
            x2={x2}
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
    <BaseNode data={data} selected={selected}>
      <div
        className="shape-box"
        style={{
          background: data.fill || 'transparent',
          border: `${data.strokeWidth || 2}px solid ${data.stroke || '#111'}`,
          borderRadius: data.shape === 'ellipse' ? '50%' : 8,
          transform: `scaleX(${data.flipH ? -1 : 1}) scaleY(${data.flipV ? -1 : 1})`,
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
