import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  addEdge, applyGroupDrag, cloneBoard, copyNodes, createGroup, createMaterial,
  createNode, deleteEdge, deleteNode, flipNode, groupBoundingBox, groupOf,
  moveLayer, pasteClipboard, pushHistory, redoHistory, undoHistory, ungroup,
  updateNode,
} from './boardModel.js'
import { boardToFlow, clampZoom, fitViewTarget, MAX_ZOOM, MIN_ZOOM } from './boardAdapter.js'
import { downloadForNode } from './nodeDownload.js'
import {
  addMaskRegion, addTextLayer, createEditNode, MAX_MASK_REGIONS,
  regionFromPoint, removeMaskRegion, removeTextLayer, updateMaskRegion, updateTextLayer,
} from './imageEdit.js'
import localforage from 'localforage'
import { exportZip, importAssetRecord, importZipFile, migrateBoard, STORAGE_KEY, stripBlobs } from './storage.js'
import { applyOps } from './ops.js'
import { initialFlow, sampleBoard } from './board.js'
import { nodeTypes } from './nodes.jsx'

function triggerDownload({ filename, mime, content }) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function centerWorld(wrapRef, viewport) {
  const el = wrapRef.current
  if (!el || !viewport) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  return {
    x: (rect.width / 2 - viewport.x) / viewport.zoom,
    y: (rect.height / 2 - viewport.y) / viewport.zoom,
  }
}

function CanvasInner() {
  const [board, setBoard] = useState(() => ({ ...cloneBoard(sampleBoard), groups: [], materials: [] }))
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectedEdgeIds, setSelectedEdgeIds] = useState(new Set())
  const [tool, setTool] = useState('move')
  const [shapePicker, setShapePicker] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [clipboard, setClipboard] = useState(null)
  const [toast, setToast] = useState('')
  const [viewport, setViewportState] = useState(initialFlow.viewport)
  const [closed, setClosed] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(board.title)
  const [editorDraft, setEditorDraft] = useState(null)
  const [brushSize, setBrushSize] = useState(10)
  const [editPrompt, setEditPrompt] = useState('')
  const [storageLoaded, setStorageLoaded] = useState(false)
  const [opsText, setOpsText] = useState('')
  const [pendingOps, setPendingOps] = useState(null)
  const [appliedOpIds, setAppliedOpIds] = useState([])
  const [assetTab, setAssetTab] = useState('assets')
  const zipFileRef = useRef(null)
  const dragStartRef = useRef(null)
  const wrapRef = useRef(null)
  const fileRef = useRef(null)
  const { getViewport, setViewport } = useReactFlow()

  const flow = boardToFlow(board)
  const flowNodes = flow.nodes.map((n) => ({ ...n, selected: selectedIds.has(n.id) }))
  const flowEdges = flow.edges.map((e) => ({ ...e, selected: selectedEdgeIds.has(e.id) }))

  const commit = useCallback((next) => {
    setPast((p) => pushHistory(p, board))
    setBoard(next)
    setFuture([])
  }, [board])

  const undo = useCallback(() => {
    const r = undoHistory(past, board, future)
    if (!r.ok) return
    setPast(r.past); setBoard(r.present); setFuture(r.future)
  }, [past, board, future])

  const redo = useCallback(() => {
    const r = redoHistory(past, board, future)
    if (!r.ok) return
    setPast(r.past); setBoard(r.present); setFuture(r.future)
  }, [past, board, future])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setTool('move'); setContextMenu(null); setShapePicker(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selectedNode = board.nodes.find((n) => selectedIds.has(n.id)) || null

  useEffect(() => {
    // 深拷贝草稿：图内文字层/蒙版层是数组，浅拷贝会直接改动 Board，保存前不得动 Board。
    setEditorDraft(selectedNode ? JSON.parse(JSON.stringify(selectedNode)) : null)
  }, [selectedNode?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const addNodeAtCenter = useCallback((type, overrides = {}) => {
    const c = centerWorld(wrapRef, getViewport())
    const { board: next, node } = createNode(board, type, Math.round(c.x), Math.round(c.y), overrides)
    commit(next)
    setSelectedIds(new Set([node.id]))
    return node
  }, [board, commit, getViewport])

  const setZoom = useCallback((zoom) => {
    const vp = getViewport()
    setViewport({ ...vp, zoom: clampZoom(zoom) }, { duration: 200 })
  }, [getViewport, setViewport])

  const fitAll = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setViewport(fitViewTarget(flowNodes, rect.width, rect.height, 50), { duration: 200 })
  }, [flowNodes, setViewport])

  const onNodesChange = useCallback((changes) => {
    let next = board
    let changed = false
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        next = applyGroupDrag(next, dragStartRef.current?.positions || null, ch.id, ch.position.x, ch.position.y)
        changed = true
      } else if (ch.type === 'select') {
        setSelectedIds((prev) => {
          const s = new Set(prev)
          if (ch.selected) s.add(ch.id); else s.delete(ch.id)
          return s
        })
      }
      // remove 故意忽略：删除走工具条/右键，避免 Delete 键误触。
    }
    if (changed) setBoard(next)
  }, [board])

  const onNodeDragStart = useCallback((_e, node) => {
    const positions = {}
    for (const n of board.nodes) positions[n.id] = { x: n.x, y: n.y }
    dragStartRef.current = { board: cloneBoard(board), positions }
  }, [board])

  const onNodeDragStop = useCallback(() => {
    const start = dragStartRef.current
    dragStartRef.current = null
    if (!start) return
    if (JSON.stringify(start.board.nodes) !== JSON.stringify(board.nodes)) {
      setPast((p) => pushHistory(p, start.board))
      setFuture([])
    }
  }, [board])

  const onConnect = useCallback((params) => {
    const r = addEdge(board, params.source, params.target, 'reference')
    if (r.error) { setToast(r.error); return }
    commit(r.board)
  }, [board, commit])

  const doCopy = useCallback((ids) => {
    setClipboard(copyNodes(board, ids))
    setToast(`已复制 ${ids.length} 个节点（内部剪贴板）`)
  }, [board])

  const doPaste = useCallback(() => {
    if (!clipboard) { setToast('剪贴板为空，先复制节点'); return }
    const r = pasteClipboard(board, clipboard)
    commit(r.board)
    setSelectedIds(new Set(r.newIds))
  }, [board, clipboard, commit])

  const doCut = useCallback((ids) => {
    const clip = copyNodes(board, ids)
    let next = board
    for (const id of ids) next = deleteNode(next, id)
    setClipboard(clip)
    commit(next)
    setSelectedIds(new Set())
  }, [board, commit])

  const doDeleteSelected = useCallback(() => {
    if (!selectedNode) return
    commit(deleteNode(board, selectedNode.id))
    setSelectedIds(new Set())
  }, [board, commit, selectedNode])

  const saveEditor = useCallback(() => {
    if (!editorDraft || !selectedNode) return
    commit(updateNode(board, selectedNode.id, editorDraft))
    setToast('已保存节点（进一条历史）')
  }, [board, commit, editorDraft, selectedNode])

  // 改图提交：先把编辑器草稿落到 Board（不单独进历史），再走 edit 边建新版本节点，
  // 最后整件事只进一条历史。来源节点版本不变；新节点只是占位，未接改图服务。
  const handleEditAction = useCallback((action, useDraft = true) => {
    const source = selectedNode
    if (!source || source.type !== 'image') { setToast('改图只对图片节点做'); return }
    if (action === 'erase') {
      const masks = useDraft ? (editorDraft?.maskRegions || []) : (source.maskRegions || [])
      if (!masks.length) { setToast('消除前先添加涂抹区域'); return }
    }
    let base = board
    if (useDraft && editorDraft) base = updateNode(board, source.id, editorDraft)
    const r = createEditNode(base, source.id, action, editPrompt)
    if (r.error || !r.node) { setToast(r.error || '改图失败'); return }
    commit(r.board)
    setSelectedIds(new Set([r.node.id]))
    setToast(`已创建改图占位节点（${action}，待接改图服务），来源版本不变`)
  }, [board, commit, editPrompt, editorDraft, selectedNode])

  // R3 存储：启动时从 IndexedDB（localforage）恢复，恢复后每次 Board 变化防抖 500ms 写回。
  // 写回的是剥掉 blob URL 的板子（blob 只在当前会话有效，存了也用不了）。
  useEffect(() => {
    let cancelled = false
    localforage.getItem(STORAGE_KEY).then((saved) => {
      if (cancelled || !saved) return
      const { board: migrated, error } = migrateBoard(saved)
      if (error || !migrated) { setToast(`本地存储恢复失败：${error || '未知'}`); return }
      setBoard(migrated); setPast([]); setFuture([]); setToast('已从本地存储恢复画布')
    }).catch(() => setToast('本地存储读取失败，仍用示例板子'))
      .finally(() => { if (!cancelled) setStorageLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!storageLoaded) return
    const t = setTimeout(() => {
      localforage.setItem(STORAGE_KEY, stripBlobs(board)).catch(() => {})
    }, 500)
    return () => clearTimeout(t)
  }, [board, storageLoaded])

  const handleExportZip = async () => {
    try {
      const blob = await exportZip(board)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'magicpath-board.zip'; a.click()
      URL.revokeObjectURL(url)
      setToast('已导出 zip（projects.json + assets.json，不含 blob）')
    } catch { setToast('导出失败') }
  }

  const handleImportZip = async (file) => {
    if (!file) return
    const r = await importZipFile(file)
    if (r.error || !r.board) { setToast(r.error || '导入失败'); return }
    commit(r.board); setSelectedIds(new Set()); setToast('zip 导入成功')
  }

  const prepareOps = () => {
    let parsed
    try { parsed = JSON.parse(opsText) } catch { setToast('ops 不是合法 JSON'); return }
    if (!Array.isArray(parsed) || !parsed.length) { setToast('ops 须是非空数组'); return }
    if (parsed.some((o) => !o || !o.clientOpId || !o.type)) { setToast('每条 op 须有 clientOpId 与 type'); return }
    setPendingOps(parsed)
    setToast(`已准备 ${parsed.length} 条 ops，请在确认条里确认后才执行`)
  }

  const confirmOps = () => {
    if (!pendingOps) return
    const beforeCount = appliedOpIds.length
    const r = applyOps(board, pendingOps, appliedOpIds, clipboard)
    if (r.error) { setToast(`ops 执行失败，已整批回滚：${r.error}`); return }
    commit(r.board); setAppliedOpIds(r.applied); setClipboard(r.clipboard); setPendingOps(null)
    setToast(`ops 已执行，新增应用 ${r.applied.length - beforeCount} 条，跳过 ${r.skipped.length} 条（去重）`)
  }

  const handleImportRecord = (record) => {
    const r = importAssetRecord(board, record, { x: 400, y: 300 })
    if (r.error || !r.node) { setToast(r.error || '导入失败'); return }
    commit(r.board); setSelectedIds(new Set([r.node.id]))
    setToast('已导入为新节点，assetId 复用、状态 ready、版本 1')
  }

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen?.()
  }, [])

  if (closed) {
    return (
      <div className="closed-screen">
        <h3>画布已关闭</h3>
        <p>Board 数据还在内存里，没有丢失。点重新打开恢复。</p>
        <button onClick={() => setClosed(false)}>重新打开</button>
      </div>
    )
  }

  const imageToolbarNode = selectedNode?.type === 'image' ? selectedNode : null
  const imageToolbarPos = imageToolbarNode
    ? {
        left: imageToolbarNode.x * viewport.zoom + viewport.x,
        top: Math.max(0, imageToolbarNode.y * viewport.zoom + viewport.y - 48),
      }
    : null

  return (
    <div className="app-layout">
      <div className="topbar">
        {editingTitle ? (
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => { commit({ ...board, title: titleDraft }); setEditingTitle(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { commit({ ...board, title: titleDraft }); setEditingTitle(false) } }}
            autoFocus
          />
        ) : (
          <strong onDoubleClick={() => { setTitleDraft(board.title); setEditingTitle(true) }} title="双击改名">{board.title}</strong>
        )}
        <span className="topbar-sub">R1：工具条 + 节点 + 分组（Board 为事实来源）</span>
        <button onClick={toggleFullscreen}>全屏查看</button>
        <button onClick={() => setClosed(true)}>关闭</button>
      </div>

      <div className="board-toolbar">
        <span>画板工具条：</span>
        <button onClick={() => addNodeAtCenter('text', { title: '新文字', content: '在这里写文字' })}>加文字</button>
        <button onClick={() => setShapePicker((v) => !v)}>加图形</button>
        {shapePicker && (
          <span className="shape-picker">
            {['rectangle', 'ellipse', 'arrow', 'line'].map((s) => (
              <button key={s} onClick={() => { addNodeAtCenter('shape', { title: '图形', shape: s, fill: '#fff7ed', stroke: '#f97316', strokeWidth: 2, lineStyle: 'solid' }); setShapePicker(false) }}>
                {s === 'rectangle' ? '矩形' : s === 'ellipse' ? '圆形/椭圆' : s === 'arrow' ? '箭头' : '直线'}
              </button>
            ))}
          </span>
        )}
        <button onClick={() => {
          if (selectedIds.size < 2) { setToast('成组需要至少选中 2 个节点（先用框选模式拖框，或 Shift/点选多选）'); return }
          const r = createGroup(board, [...selectedIds])
          if (r.error) setToast(r.error); else { commit(r.board); setToast(`已成组：${r.group.memberIds.length} 个节点`) }
        }}>成组</button>
        <button onClick={() => {
          const g = selectedNode ? groupOf(board, selectedNode.id) : null
          if (!g) { setToast('选中节点不在任何组里'); return }
          commit(ungroup(board, g.id).board); setToast('已解散分组（节点保留）')
        }}>解散分组</button>
        <button disabled={!selectedEdgeIds.size} onClick={() => {
          let next = board
          for (const id of selectedEdgeIds) next = deleteEdge(next, id)
          commit(next); setSelectedEdgeIds(new Set())
        }}>删选中边</button>
      </div>

      <div className="main-row">
        <div className="canvas-wrap" ref={wrapRef}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sn, edges: se }) => {
              setSelectedIds(new Set(sn.map((n) => n.id)))
              setSelectedEdgeIds(new Set(se.map((e) => e.id)))
            }}
            onNodeContextMenu={(e, node) => {
              e.preventDefault()
              setSelectedIds(new Set([node.id]))
              setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
            }}
            onPaneClick={() => { setContextMenu(null) }}
            onViewportChange={(vp) => {
              setViewportState(vp)
              setBoard((prev) => ({ ...prev, viewport: { x: vp.x, y: vp.y, k: vp.zoom } }))
            }}
            nodeTypes={nodeTypes}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            defaultViewport={initialFlow.viewport}
            selectionOnDrag={tool === 'select'}
            panOnDrag={tool !== 'select'}
            fitView
          >
            <Background />
          </ReactFlow>

          {(board.groups || []).map((g) => {
            const bb = groupBoundingBox(board, g)
            if (!bb) return null
            return (
              <div
                key={g.id}
                className="group-box"
                style={{
                  left: bb.x * viewport.zoom + viewport.x,
                  top: bb.y * viewport.zoom + viewport.y,
                  width: bb.w * viewport.zoom,
                  height: bb.h * viewport.zoom,
                }}
              >
                <span>组 · {bb.count} 个节点</span>
              </div>
            )
          })}

          {imageToolbarPos && (
            <div className="image-toolbar" style={{ left: imageToolbarPos.left, top: imageToolbarPos.top }}>
              <button onClick={() => setToast('在右侧“节点设置”里编辑图内文字与涂抹选区')}>编辑</button>
              <button onClick={() => { setToast('分图层只建一个占位节点，未拆出真实图层'); handleEditAction('split_layers', false) }}>分图层</button>
              <button onClick={() => handleEditAction('remove_background', false)}>去背景</button>
              <button onClick={() => handleEditAction('erase', false)}>消除</button>
              <button onClick={() => handleEditAction('outpaint', false)}>扩图</button>
              <button onClick={() => handleEditAction('sharpen', false)}>变清晰</button>
              <button onClick={() => handleEditAction('reference', false)}>引用生成</button>
              <button onClick={() => {
                if (!imageToolbarNode.assetUrl) { setToast('暂无可下载资产：该图片节点没有真实图片（R1 占位节点）'); return }
                const a = document.createElement('a')
                a.href = imageToolbarNode.assetUrl
                a.download = `${imageToolbarNode.title || imageToolbarNode.id}.png`
                a.click()
              }}>下载</button>
            </div>
          )}

          <div className="main-toolbar">
            {[
              ['move', '移动'], ['mark', '标记'], ['select', '框选模式'],
            ].map(([v, label]) => (
              <button key={v} className={tool === v ? 'active' : ''} onClick={() => { setTool(v); if (v === 'mark') setToast('标记工具：R1 仅切换模式，涂鸦绘制未实现') }}>
                {label}
              </button>
            ))}
            <button onClick={() => fileRef.current?.click()}>上传文件</button>
            <input
              ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const isVideo = file.type.startsWith('video/')
                addNodeAtCenter(isVideo ? 'video' : 'image', {
                  title: file.name, assetUrl: URL.createObjectURL(file), status: 'ready',
                  content: undefined,
                })
                setToast('已创建本地上传节点（blob URL 仅当前会话有效，R3 存储时按缺失资产处理）')
                e.target.value = ''
              }}
            />
            <button onClick={() => {
              addNodeAtCenter('image', { title: '待生成图片', prompt: '待接生成服务', status: 'generating', generation: { taskId: null } })
              setToast('已创建图片占位节点，生成服务未接通（R1）')
            }}>图片生成</button>
            <button onClick={() => {
              addNodeAtCenter('video', { title: '待生成视频', prompt: '待接生成服务', status: 'generating', generation: { taskId: null } })
              setToast('已创建视频占位节点，生成服务未接通（R1）')
            }}>视频生成</button>
            <button onClick={() => addNodeAtCenter('text', { title: '新文字', content: '在这里写文字' })}>文字</button>
          </div>

          <div className="zoombar">
            <button disabled={!past.length} onClick={undo}>撤销</button>
            <button disabled={!future.length} onClick={redo}>重做</button>
            <button onClick={() => setZoom(viewport.zoom - 0.1)}>缩小</button>
            <span>{Math.round(viewport.zoom * 100)}%</span>
            <button onClick={() => setZoom(viewport.zoom + 0.1)}>放大</button>
            <button onClick={() => setZoom(0.25)}>25%</button>
            <button onClick={() => setZoom(0.5)}>50%</button>
            <button onClick={() => setZoom(1)}>100%</button>
            <button onClick={() => setZoom(2)}>200%</button>
            <button onClick={fitAll}>显示全部元素</button>
          </div>

          {contextMenu && (() => {
            const node = board.nodes.find((n) => n.id === contextMenu.nodeId)
            if (!node) return null
            return (
              <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
                <button onClick={() => { doCopy([node.id]); setContextMenu(null) }}>复制</button>
                <button onClick={() => { doPaste(); setContextMenu(null) }} disabled={!clipboard}>粘贴</button>
                <button onClick={() => { doCut([node.id]); setContextMenu(null) }}>剪切</button>
                <button onClick={() => { doDeleteSelected(); setContextMenu(null) }}>删除</button>
                <button disabled={node.type !== 'image' && node.type !== 'shape'} onClick={() => { commit(flipNode(board, node.id, 'horizontal')); setContextMenu(null) }}>水平翻转</button>
                <button disabled={node.type !== 'image' && node.type !== 'shape'} onClick={() => { commit(flipNode(board, node.id, 'vertical')); setContextMenu(null) }}>垂直翻转</button>
                <button onClick={() => { commit(moveLayer(board, node.id, 'up')); setContextMenu(null) }}>上移一层</button>
                <button onClick={() => { commit(moveLayer(board, node.id, 'down')); setContextMenu(null) }}>下移一层</button>
                <button onClick={() => { commit(createMaterial(board, node.id)); setContextMenu(null); setToast('已创建素材（进资产历史，R3 可导入）') }}>创建素材</button>
                <button onClick={() => setContextMenu(null)}>关闭菜单</button>
              </div>
            )
          })()}

          {toast && (
            <div className="toast">
              {toast}
              <button onClick={() => setToast('')}>×</button>
            </div>
          )}
        </div>

        <aside className="editor-panel">
          <h3>节点设置</h3>
          {!selectedNode && <p>点一个节点开始编辑；框选模式下拖背景框选，再点“成组”。</p>}
          {selectedNode && editorDraft && (
            <div>
              <label>标题
                <input value={editorDraft.title || ''} onChange={(e) => setEditorDraft({ ...editorDraft, title: e.target.value })} />
              </label>
              {(selectedNode.type === 'text' || selectedNode.type === 'brief') && (
                <label>内容
                  <textarea value={editorDraft.content || ''} onChange={(e) => setEditorDraft({ ...editorDraft, content: e.target.value })} rows={5} />
                </label>
              )}
              {(selectedNode.type === 'image' || selectedNode.type === 'video') && (
                <label>提示词
                  <textarea value={editorDraft.prompt || ''} onChange={(e) => setEditorDraft({ ...editorDraft, prompt: e.target.value })} rows={4} />
                </label>
              )}
              {selectedNode.type === 'shape' && (
                <div>
                  <label>形状
                    <select value={editorDraft.shape || 'rectangle'} onChange={(e) => setEditorDraft({ ...editorDraft, shape: e.target.value })}>
                      <option value="rectangle">矩形</option>
                      <option value="ellipse">圆形/椭圆</option>
                      <option value="arrow">箭头</option>
                      <option value="line">直线</option>
                    </select>
                  </label>
                  <label>填充
                    <input type="color" value={editorDraft.fill || '#fff7ed'} onChange={(e) => setEditorDraft({ ...editorDraft, fill: e.target.value })} />
                  </label>
                  <label>描边颜色
                    <input type="color" value={editorDraft.stroke || '#111111'} onChange={(e) => setEditorDraft({ ...editorDraft, stroke: e.target.value })} />
                  </label>
                  <label>描边宽度
                    <input type="number" min={1} max={20} value={editorDraft.strokeWidth || 2} onChange={(e) => setEditorDraft({ ...editorDraft, strokeWidth: Number(e.target.value) })} />
                  </label>
                  <label>线型
                    <select value={editorDraft.lineStyle || 'solid'} onChange={(e) => setEditorDraft({ ...editorDraft, lineStyle: e.target.value })}>
                      <option value="solid">实线</option>
                      <option value="dashed">虚线</option>
                      <option value="dotted">点线</option>
                      <option value="dash-dot">点划线</option>
                    </select>
                  </label>
                </div>
              )}
              {selectedNode.type === 'image' && editorDraft && (
                <div>
                  <hr />
                  <h4>图内文字层（百分比定位，改层不重生图）</h4>
                  <p>标题/提示词只是节点设置；这里的层才是画在图上的字。</p>
                  {(editorDraft.imageTexts || []).map((layer) => (
                    <div key={layer.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                      <div className="mini-row">
                        <input value={layer.text} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateTextLayer(next, layer.id, { text: e.target.value }); return next })} />
                        <button onClick={() => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); removeTextLayer(next, layer.id); return next })}>删层</button>
                      </div>
                      <div className="mini-row">
                        <label>字号<input type="number" min={8} max={120} value={layer.fontSize} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateTextLayer(next, layer.id, { fontSize: Number(e.target.value) }); return next })} /></label>
                        <label>颜色<input type="color" value={layer.color} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateTextLayer(next, layer.id, { color: e.target.value }); return next })} /></label>
                        <label>加粗<input type="checkbox" checked={!!layer.bold} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateTextLayer(next, layer.id, { bold: e.target.checked }); return next })} /></label>
                      </div>
                      <div className="mini-row">
                        <label>横%<input type="number" min={0} max={100} value={layer.x} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateTextLayer(next, layer.id, { x: Number(e.target.value) }); return next })} /></label>
                        <label>纵%<input type="number" min={0} max={100} value={layer.y} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateTextLayer(next, layer.id, { y: Number(e.target.value) }); return next })} /></label>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); addTextLayer(next, {}); return next })}>加文字层</button>
                  <h4>涂抹选区（百分比蒙版，最多 {MAX_MASK_REGIONS} 个，不改原图）</h4>
                  <p>点下面预览图加一个区域（以笔大小为边长），或直接改百分比。涂抹只在 R2 是面板/预览点选，不是直接在画布图上拖笔刷。</p>
                  <div
                    className="image-preview"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const x = (e.clientX - rect.left) / rect.width * 100
                      const y = (e.clientY - rect.top) / rect.height * 100
                      setEditorDraft((prev) => {
                        const next = JSON.parse(JSON.stringify(prev))
                        const r = addMaskRegion(next, regionFromPoint(x, y, brushSize))
                        if (r.error) setToast(r.error)
                        return next
                      })
                    }}
                  >
                    {(editorDraft.imageTexts || []).map((layer) => (
                      <span key={layer.id} style={{ position: 'absolute', left: `${layer.x}%`, top: `${layer.y}%`, transform: 'translate(-50%,-50%)', fontSize: layer.fontSize, color: layer.color, fontWeight: layer.bold ? 'bold' : 'normal', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{layer.text}</span>
                    ))}
                    {(editorDraft.maskRegions || []).map((region) => (
                      <div key={region.id} style={{ position: 'absolute', left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%`, background: 'rgba(37,99,235,0.35)', border: '1px dashed #2563eb', pointerEvents: 'none' }} />
                    ))}
                  </div>
                  <label>笔大小（%）
                    <input type="number" min={5} max={50} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                  </label>
                  <button onClick={() => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); const r = addMaskRegion(next, {}); if (r.error) setToast(r.error); return next })}>加涂抹区域（居中，{(editorDraft.maskRegions || []).length}/{MAX_MASK_REGIONS}）</button>
                  {(editorDraft.maskRegions || []).map((region) => (
                    <div key={region.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 8, marginTop: 8 }}>
                      <div className="mini-row">
                        <label>横%<input type="number" min={0} max={100} value={region.x} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateMaskRegion(next, region.id, { x: Number(e.target.value) }); return next })} /></label>
                        <label>纵%<input type="number" min={0} max={100} value={region.y} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateMaskRegion(next, region.id, { y: Number(e.target.value) }); return next })} /></label>
                      </div>
                      <div className="mini-row">
                        <label>宽%<input type="number" min={0} max={100} value={region.w} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateMaskRegion(next, region.id, { w: Number(e.target.value) }); return next })} /></label>
                        <label>高%<input type="number" min={0} max={100} value={region.h} onChange={(e) => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); updateMaskRegion(next, region.id, { h: Number(e.target.value) }); return next })} /></label>
                        <button onClick={() => setEditorDraft((prev) => { const next = JSON.parse(JSON.stringify(prev)); removeMaskRegion(next, region.id); return next })}>删区</button>
                      </div>
                    </div>
                  ))}
                  <label>改图提示词
                    <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={2} placeholder="例如：擦掉左上角杂物" />
                  </label>
                  <div className="editor-actions">
                    <button onClick={() => handleEditAction('split_layers')}>分图层（占位）</button>
                    <button onClick={() => handleEditAction('remove_background')}>去背景（占位）</button>
                    <button onClick={() => handleEditAction('erase')}>消除（用涂抹区，占位）</button>
                    <button onClick={() => handleEditAction('outpaint')}>扩图（占位）</button>
                    <button onClick={() => handleEditAction('sharpen')}>变清晰（占位）</button>
                    <button onClick={() => handleEditAction('reference')}>引用生成（占位）</button>
                  </div>
                  <p>提交后走 edit 边生成新版本节点，来源版本不变；新节点只是占位，未接改图服务。</p>
                </div>
              )}
              <div className="editor-actions">
                <button onClick={saveEditor}>保存（进历史）</button>
                <button onClick={doDeleteSelected}>删除节点</button>
                {(selectedNode.type === 'text' || selectedNode.type === 'shape' || selectedNode.type === 'brief') && (
                  <button onClick={() => {
                    const d = downloadForNode(selectedNode)
                    if (d) triggerDownload(d)
                  }}>单独下载</button>
                )}
              </div>
              <p className="editor-meta">
                类型：{selectedNode.type} · 版本：{selectedNode.version} · 状态：{selectedNode.status}
                {selectedNode.copiedFrom ? ` · 复制自：${selectedNode.copiedFrom}` : ''}
                {selectedNode.flipH ? ' · 已水平翻转' : ''}{selectedNode.flipV ? ' · 已垂直翻转' : ''}
              </p>
            </div>
          )}
          <hr />
          <p>工具说明：移动为默认；框选模式下拖背景框选（此时平移关闭），Esc 回移动；生成按钮在 R1 只建占位节点，不假装已生成；标记工具在 R1 仅切换模式。</p>
          <p>Board 节点数：{board.nodes.length} · 边数：{board.edges.length} · 组数：{(board.groups || []).length} · 素材数：{(board.materials || []).length}</p>
          <hr />
          <h4>存储与导入（R3）</h4>
          <p>本地存储：{storageLoaded ? '已启用 IndexedDB（localforage），Board 变化后防抖写回' : '正在读取本地存储…'}</p>
          <div className="editor-actions">
            <button onClick={handleExportZip}>导出 zip</button>
            <button onClick={() => zipFileRef.current?.click()}>导入 zip</button>
            <input ref={zipFileRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={(e) => { handleImportZip(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          <p>zip = projects.json + assets.json（元数据，不含 blob）；缺失资产整包拒绝、不静默丢节点。</p>
          <hr />
          <h4>Agent ops（R3：写操作走确认条）</h4>
          <p>把 ops JSON 粘进来，点“准备”只列出待执行项，不会直接改板子；确认条里点“确认执行”才应用。重复 clientOpId 会去重跳过，任一 op 失败整批回滚。</p>
          <textarea value={opsText} onChange={(e) => setOpsText(e.target.value)} rows={4} placeholder='[{"clientOpId":"op-1","type":"add_node","nodeType":"text","title":"Agent 建的","position":{"x":10,"y":10}}]' />
          <div className="editor-actions">
            <button onClick={() => setOpsText(JSON.stringify([{ clientOpId: 'op-demo-1', type: 'add_node', nodeType: 'text', title: 'Agent 建的', position: { x: 10, y: 10 } }, { clientOpId: 'op-demo-2', type: 'flip_node', id: 'image-1', axis: 'horizontal' }], null, 2))}>填入示例 ops</button>
            <button onClick={prepareOps}>准备 ops</button>
          </div>
          {pendingOps && (
            <div style={{ border: '2px solid #2563eb', borderRadius: 8, padding: 8, marginTop: 8 }}>
              <p>确认执行以下 {pendingOps.length} 条 ops？</p>
              <ul>{pendingOps.map((op) => <li key={op.clientOpId}>{op.type} · {op.clientOpId}</li>)}</ul>
              <div className="editor-actions">
                <button onClick={confirmOps}>确认执行</button>
                <button onClick={() => setPendingOps(null)}>取消</button>
              </div>
            </div>
          )}
          <p>已应用 clientOpId：{appliedOpIds.length} 个</p>
          <hr />
          <h4>资产与历史导入（R3）</h4>
          <div className="editor-actions">
            <button className={assetTab === 'assets' ? 'active' : ''} onClick={() => setAssetTab('assets')}>资产</button>
            <button className={assetTab === 'history' ? 'active' : ''} onClick={() => setAssetTab('history')}>历史</button>
          </div>
          {assetTab === 'assets' && (
            <div>
              {(board.materials || []).length === 0 && <p>暂无资产：先在节点右键点“创建素材”登记。</p>}
              {(board.materials || []).map((m) => (
                <div key={m.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 8, marginTop: 8 }}>
                  <p>{m.title} · {m.type} · assetId：{m.assetId || '（无，导入会明确报错）'}</p>
                  <button onClick={() => handleImportRecord(m)}>导入为新节点</button>
                </div>
              ))}
            </div>
          )}
          {assetTab === 'history' && (
            <div>
              {board.nodes.filter((n) => n.status === 'ready').map((n) => (
                <div key={n.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 8, marginTop: 8 }}>
                  <p>{n.title} · {n.type} · 版本 {n.version}</p>
                  <button onClick={() => handleImportRecord(n)}>导入为新节点</button>
                </div>
              ))}
            </div>
          )}
        </aside>
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
