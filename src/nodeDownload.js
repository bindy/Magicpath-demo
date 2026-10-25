// nodeDownload.js — 单节点下载的纯内容生成（无 DOM、无 Blob）。
// UI 层只负责把这里返回的 { filename, mime, content } 写成文件。
// text/brief 下纯文本；shape 下 SVG；image/video 没有真实资产时返回 null，
// UI 不得伪造一张图来下载。

function escapeXml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function dasharray(lineStyle) {
  if (lineStyle === 'dashed') return '8 6'
  if (lineStyle === 'dotted') return '2 6'
  if (lineStyle === 'dash-dot') return '8 4 2 4'
  return null
}

function shapeSvg(node) {
  const w = node.w || 200
  const h = node.h || 120
  const fill = node.fill || 'none'
  const stroke = node.stroke || '#111111'
  const sw = node.strokeWidth || 2
  const dash = dasharray(node.lineStyle)
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
  if (node.shape === 'ellipse') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - sw}" ry="${h / 2 - sw}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}"${dashAttr}/></svg>`
  }
  if (node.shape === 'line' || node.shape === 'arrow') {
    const marker = node.shape === 'arrow'
      ? `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${escapeXml(stroke)}"/></marker></defs>`
      : ''
    const markerAttr = node.shape === 'arrow' ? ' marker-end="url(#arrowhead)"' : ''
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${marker}<line x1="10" y1="${h / 2}" x2="${w - 10}" y2="${h / 2}" stroke="${escapeXml(stroke)}" stroke-width="${sw}"${dashAttr}${markerAttr}/></svg>`
  }
  // 默认矩形
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${sw}"${dashAttr}/></svg>`
}

export function downloadForNode(node) {
  if (!node) return null
  if (node.type === 'text' || node.type === 'brief') {
    return {
      filename: `${(node.title || node.id).replace(/[\\/:*?"<>|]/g, '_')}.txt`,
      mime: 'text/plain;charset=utf-8',
      content: node.content || node.title || '',
    }
  }
  if (node.type === 'shape') {
    return {
      filename: `${(node.title || node.id).replace(/[\\/:*?"<>|]/g, '_')}.svg`,
      mime: 'image/svg+xml;charset=utf-8',
      content: shapeSvg(node),
    }
  }
  // image/video：只有真实 assetUrl 时 UI 才走浏览器下载，纯逻辑层不伪造。
  return null
}
