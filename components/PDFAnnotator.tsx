'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import Toolbar from './Toolbar'
import { PageAnnotations, Point, Stroke, TextAnnotation, Tool } from '@/types'
import { getAllAnnotations, saveAnnotations, updateDocumentPages } from '@/lib/db'
import { getSupabaseClient } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// PDF.js is loaded dynamically to avoid SSR issues
let pdfjsLib: typeof import('pdfjs-dist') | null = null

interface Props {
  pdfUrl: string
  documentId: string
  readonly?: boolean
  initialAnnotations?: Map<number, PageAnnotations>
  initialPage?: number
  onPageChange?: (page: number) => void
}

const SAVE_DEBOUNCE_MS = 1500

export default function PDFAnnotator({ pdfUrl, documentId, readonly = false, initialAnnotations, initialPage = 1, onPageChange }: Props) {
  const [pdf, setPdf] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [currentPage, _setCurrentPage] = useState(initialPage)
  function setCurrentPage(p: number | ((prev: number) => number)) {
    _setCurrentPage(prev => {
      const next = typeof p === 'function' ? p(prev) : p
      onPageChange?.(next)
      return next
    })
  }
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.4)
  const [tool, setTool] = useState<Tool>('none')
  const [color, setColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(3)
  const [annotations, setAnnotations] = useState<Map<number, PageAnnotations>>(
    initialAnnotations ?? new Map()
  )
  const [fontSize, setFontSize] = useState(16)
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [onlineCount, setOnlineCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const annotCanvasRef = useRef<HTMLCanvasElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDrawing = useRef(false)
  const currentStroke = useRef<Stroke | null>(null)
  const history = useRef<Map<number, PageAnnotations[]>>(new Map())
  const saveTimer = useRef<NodeJS.Timeout | null>(null)
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null)
  const pinchStartDist = useRef<number | null>(null)
  const pinchStartScale = useRef<number>(1)
  const clientId = useRef(uuidv4())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const erasedInGesture = useRef<Set<string>>(new Set())

  // Load PDF.js and PDF
  useEffect(() => {
    async function loadPdf() {
      setIsLoading(true)
      if (!pdfjsLib) {
        pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
      }
      try {
        const doc = await pdfjsLib.getDocument({ url: pdfUrl }).promise
        setPdf(doc)
        setTotalPages(doc.numPages)
        if (!readonly) {
          await updateDocumentPages(documentId, doc.numPages)
        }
      } catch (e) {
        console.error('PDF load error:', e)
      } finally {
        setIsLoading(false)
      }
    }
    loadPdf()
  }, [pdfUrl, documentId, readonly])

  // Load annotations from DB if not provided
  useEffect(() => {
    if (!initialAnnotations && !readonly) {
      getAllAnnotations(documentId).then(a => setAnnotations(a))
    }
  }, [documentId, initialAnnotations, readonly])

  // Realtime collaboration channel
  useEffect(() => {
    if (readonly) return
    const sb = getSupabaseClient()
    const channel = sb.channel(`doc-${documentId}`, { config: { presence: { key: clientId.current } } })
      .on('broadcast', { event: 'annotation-update' }, ({ payload }) => {
        if (payload.clientId === clientId.current) return
        const { pageNumber, data } = payload as { pageNumber: number; data: PageAnnotations; clientId: string }
        setAnnotations(prev => {
          const next = new Map(prev)
          next.set(pageNumber, data)
          return next
        })
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setOnlineCount(Object.keys(state).length)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() })
        }
      })
    channelRef.current = channel
    return () => {
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [documentId, readonly])

  // Render PDF page + annotations
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdf || !pdfCanvasRef.current || !annotCanvasRef.current) return

    try {
      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale })

      const pdfCanvas = pdfCanvasRef.current
      const ctx = pdfCanvas.getContext('2d')!
      pdfCanvas.width = viewport.width
      pdfCanvas.height = viewport.height

      const annotCanvas = annotCanvasRef.current
      annotCanvas.width = viewport.width
      annotCanvas.height = viewport.height

      // Cancel previous render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }

      renderTaskRef.current = page.render({ canvas: pdfCanvas, viewport })
      await renderTaskRef.current.promise
      renderTaskRef.current = null

      // Draw annotations
      const pageAnnotations = annotations.get(pageNum) ?? { strokes: [], texts: [] }
      redrawAnnotations(annotCanvas, pageAnnotations)
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'RenderingCancelledException') {
        console.error('Render error:', e)
      }
    }
  }, [pdf, scale, annotations])

  useEffect(() => {
    renderPage(currentPage)
  }, [currentPage, renderPage])

  // Redraw all annotations for a page at the given drawScale
  function redrawAnnotations(canvas: HTMLCanvasElement, pageAnnotations: PageAnnotations, drawScale = scale) {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const stroke of pageAnnotations.strokes) {
      if (stroke.points.length < 2) continue
      drawStroke(ctx, stroke, drawScale)
    }

    for (const text of pageAnnotations.texts) {
      ctx.save()
      ctx.font = `${text.fontSize * drawScale}px sans-serif`
      ctx.fillStyle = text.color
      ctx.fillText(text.text, text.x * drawScale, text.y * drawScale)
      ctx.restore()
    }
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, drawScale = scale) {
    if (stroke.points.length < 2) return
    ctx.save()
    ctx.globalAlpha = stroke.opacity
    ctx.strokeStyle = stroke.color
    // size is in screen pixels — do NOT multiply by drawScale so thickness stays consistent across zoom
    ctx.lineWidth = stroke.size
    ctx.lineCap = stroke.tool === 'highlighter' ? 'square' : 'round'
    ctx.lineJoin = stroke.tool === 'highlighter' ? 'miter' : 'round'

    if (stroke.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply'
    }

    const pts = stroke.points
    ctx.beginPath()
    ctx.moveTo(pts[0].x * drawScale, pts[0].y * drawScale)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const curr = pts[i]
      ctx.quadraticCurveTo(
        prev.x * drawScale, prev.y * drawScale,
        (prev.x + curr.x) / 2 * drawScale, (prev.y + curr.y) / 2 * drawScale
      )
    }
    ctx.lineTo(pts[pts.length - 1].x * drawScale, pts[pts.length - 1].y * drawScale)
    ctx.stroke()
    ctx.restore()
  }

  // Get canvas-relative coordinates normalized to scale=1 (PDF page units)
  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = annotCanvasRef.current!.getBoundingClientRect()
    const scaleX = annotCanvasRef.current!.width / rect.width
    const scaleY = annotCanvasRef.current!.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX / scale,
      y: (e.clientY - rect.top) * scaleY / scale,
    }
  }

  // Drawing handlers
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (readonly || tool === 'none') return
    e.currentTarget.setPointerCapture(e.pointerId)

    const point = getPoint(e)

    if (tool === 'text') {
      const pageAnnotations = annotations.get(currentPage) ?? { strokes: [], texts: [] }
      const hit = pageAnnotations.texts.find(t =>
        Math.abs(t.x - point.x) < 200 && Math.abs(t.y - point.y) < t.fontSize * 1.5
      )
      if (hit) {
        setEditingTextId(hit.id)
        setTextInput({ x: hit.x, y: hit.y })
        setTextValue(hit.text)
        setFontSize(hit.fontSize)
        setAnnotations(prev => {
          const next = new Map(prev)
          const page = prev.get(currentPage) ?? { strokes: [], texts: [] }
          next.set(currentPage, { ...page, texts: page.texts.filter(t => t.id !== hit.id) })
          return next
        })
      } else {
        setEditingTextId(null)
        setTextInput(point)
        setTextValue('')
      }
      setTimeout(() => textInputRef.current?.focus(), 50)
      return
    }

    isDrawing.current = true
    currentStroke.current = {
      id: uuidv4(),
      tool,
      color: tool === 'highlighter' ? color + '80' : color,
      size: tool === 'highlighter' ? brushSize * 5 : tool === 'eraser' ? brushSize * 4 : tool === 'line' ? brushSize * 1.5 : brushSize,
      opacity: tool === 'highlighter' ? 0.4 : 1,
      points: [point],
    }
    if (tool === 'eraser') {
      // Save undo history at start of erase gesture (before any erasure)
      const page = annotations.get(currentPage) ?? { strokes: [], texts: [] }
      const hist = history.current.get(currentPage) ?? []
      history.current.set(currentPage, [...hist, page])
      erasedInGesture.current = new Set()
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current || !currentStroke.current || !annotCanvasRef.current) return

    const point = getPoint(e)
    currentStroke.current.points.push(point)

    const ctx = annotCanvasRef.current.getContext('2d')!
    const pageAnnotations = annotations.get(currentPage) ?? { strokes: [], texts: [] }

    if (tool === 'eraser') {
      // Real-time erasure: mark overlapping strokes as erased immediately
      const r = currentStroke.current.size / scale
      for (const s of pageAnnotations.strokes) {
        if (!erasedInGesture.current.has(s.id) &&
            s.points.some(sp => Math.hypot(sp.x - point.x, sp.y - point.y) < r)) {
          erasedInGesture.current.add(s.id)
        }
      }
      // Redraw excluding erased strokes (visual update without state change)
      const filtered: typeof pageAnnotations = {
        ...pageAnnotations,
        strokes: pageAnnotations.strokes.filter(s => !erasedInGesture.current.has(s.id)),
      }
      redrawAnnotations(annotCanvasRef.current, filtered)
      // Draw eraser cursor
      ctx.save()
      ctx.strokeStyle = 'rgba(150,150,150,0.6)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(point.x * scale, point.y * scale, currentStroke.current.size, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    } else {
      redrawAnnotations(annotCanvasRef.current, pageAnnotations)
      drawStroke(ctx, currentStroke.current)
    }
  }

  function handlePointerUp() {
    if (!isDrawing.current || !currentStroke.current) return
    isDrawing.current = false

    const stroke = currentStroke.current
    currentStroke.current = null

    if (stroke.points.length < 2) return

    if (tool === 'line') {
      stroke.points = [stroke.points[0], stroke.points[stroke.points.length - 1]]
    }

    if (tool === 'eraser') {
      // Commit the visually-erased strokes to state
      const erasedIds = new Set(erasedInGesture.current)
      erasedInGesture.current = new Set()
      if (erasedIds.size > 0) {
        const page = annotations.get(currentPage) ?? { strokes: [], texts: [] }
        const updated = { ...page, strokes: page.strokes.filter(s => !erasedIds.has(s.id)) }
        setAnnotations(prev => {
          const next = new Map(prev)
          next.set(currentPage, updated)
          return next
        })
        scheduleSave(currentPage, updated)
      }
      return
    }

    setAnnotations(prev => {
      const next = new Map(prev)
      const page = next.get(currentPage) ?? { strokes: [], texts: [] }
      const hist = history.current.get(currentPage) ?? []
      history.current.set(currentPage, [...hist, page])
      const updated: PageAnnotations = { ...page, strokes: [...page.strokes, stroke] }
      next.set(currentPage, updated)
      scheduleSave(currentPage, updated)
      return next
    })
  }

  function handleTextSubmit() {
    if (!textInput) return
    if (!textValue.trim()) {
      // If cancelling an edit, restore the original text
      if (editingTextId) {
        const orig = annotations.get(currentPage)?.texts.find(t => t.id === editingTextId)
        if (!orig) {
          setTextInput(null)
          setEditingTextId(null)
          return
        }
      }
      setTextInput(null)
      setEditingTextId(null)
      return
    }

    setAnnotations(prev => {
      const next = new Map(prev)
      const page = prev.get(currentPage) ?? { strokes: [], texts: [] }
      const hist = history.current.get(currentPage) ?? []
      history.current.set(currentPage, [...hist, page])

      let updatedTexts: TextAnnotation[]
      if (editingTextId) {
        // Update existing text
        updatedTexts = page.texts.map(t =>
          t.id === editingTextId
            ? { ...t, text: textValue, fontSize, color }
            : t
        )
        // If not found (was removed in handlePointerDown), add it back
        if (!updatedTexts.some(t => t.id === editingTextId)) {
          updatedTexts = [...page.texts, { id: editingTextId, x: textInput.x, y: textInput.y, text: textValue, fontSize, color }]
        }
      } else {
        updatedTexts = [...page.texts, { id: uuidv4(), x: textInput.x, y: textInput.y, text: textValue, fontSize, color }]
      }

      const updated: PageAnnotations = { ...page, texts: updatedTexts }
      next.set(currentPage, updated)
      scheduleSave(currentPage, updated)
      return next
    })

    setTextInput(null)
    setTextValue('')
    setEditingTextId(null)
  }

  function scheduleSave(pageNum: number, data: PageAnnotations) {
    if (readonly) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        await saveAnnotations(documentId, pageNum, data)
        setStatus('saved')
        setTimeout(() => setStatus('idle'), 2000)
        // Broadcast change to collaborators
        channelRef.current?.send({
          type: 'broadcast',
          event: 'annotation-update',
          payload: { pageNumber: pageNum, data, clientId: clientId.current },
        })
      } catch {
        setStatus('error')
      }
    }, SAVE_DEBOUNCE_MS)
  }

  function handleUndo() {
    const hist = history.current.get(currentPage)
    if (!hist || hist.length === 0) return

    const previous = hist[hist.length - 1]
    history.current.set(currentPage, hist.slice(0, -1))

    setAnnotations(prev => {
      const next = new Map(prev)
      next.set(currentPage, previous)
      scheduleSave(currentPage, previous)
      return next
    })
  }

  function handleClearPage() {
    if (!confirm('このページの書き込みをすべて消しますか？')) return
    const empty: PageAnnotations = { strokes: [], texts: [] }
    const page = annotations.get(currentPage) ?? { strokes: [], texts: [] }
    const hist = history.current.get(currentPage) ?? []
    history.current.set(currentPage, [...hist, page])

    setAnnotations(prev => {
      const next = new Map(prev)
      next.set(currentPage, empty)
      scheduleSave(currentPage, empty)
      return next
    })
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Print function
  async function handlePrint() {
    if (!pdf) return
    setStatus('saving')

    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write('<html><head><title>印刷</title><style>body{margin:0;background:#fff}img{display:block;width:100%;page-break-after:always;}</style></head><body>')

    for (let p = 1; p <= totalPages; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2 })

      // Render PDF to offscreen canvas
      const pdfC = document.createElement('canvas')
      pdfC.width = viewport.width
      pdfC.height = viewport.height
      await page.render({ canvas: pdfC, viewport }).promise

      // Draw annotations on top at print scale=2
      const annotC = document.createElement('canvas')
      annotC.width = viewport.width
      annotC.height = viewport.height
      const pageAnnotations = annotations.get(p) ?? { strokes: [], texts: [] }
      redrawAnnotations(annotC, pageAnnotations, 2)

      // Merge PDF + annotations
      const merged = document.createElement('canvas')
      merged.width = viewport.width
      merged.height = viewport.height
      const mctx = merged.getContext('2d')!
      mctx.drawImage(pdfC, 0, 0)
      mctx.drawImage(annotC, 0, 0)

      printWindow.document.write(`<img src="${merged.toDataURL()}" />`)
    }

    printWindow.document.write('</body></html>')
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
    }, 500)
    setStatus('idle')
  }

  // Ctrl+wheel zoom (desktop)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      setScale(s => Math.min(3, Math.max(0.5, Math.round((s - e.deltaY * 0.001) * 10) / 10)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchStartDist.current = Math.hypot(dx, dy)
      pinchStartScale.current = scale
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchStartDist.current !== null) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const ratio = dist / pinchStartDist.current
      const next = Math.min(3, Math.max(0.5, pinchStartScale.current * ratio))
      setScale(Math.round(next * 10) / 10)
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) {
      pinchStartDist.current = null
    }
  }

  const canvasStyle = tool === 'none'
    ? { cursor: 'grab', touchAction: 'auto', pointerEvents: 'none' as const }
    : {
        cursor: tool === 'pen' || tool === 'highlighter' || tool === 'line'
          ? 'crosshair'
          : tool === 'eraser'
          ? 'cell'
          : 'text',
        touchAction: 'none' as const,
      }

  return (
    <div className="flex h-full">
      {/* Toolbar (edit mode only) */}
      {!readonly && (
        <Toolbar
          tool={tool}
          color={color}
          size={brushSize}
          fontSize={fontSize}
          onToolChange={setTool}
          onColorChange={setColor}
          onSizeChange={setBrushSize}
          onFontSizeChange={setFontSize}
          onUndo={handleUndo}
          onClearPage={handleClearPage}
          canUndo={(history.current.get(currentPage)?.length ?? 0) > 0}
        />
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors"
            >
              ←
            </button>
            <span className="text-sm font-medium text-gray-700">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors"
            >
              →
            </button>
          </div>

          {/* Scale */}
          <div className="flex items-center gap-2">
            <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">－</button>
            <span className="text-xs text-gray-500 w-12 text-center">{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">＋</button>
          </div>

          {/* Status + Print */}
          <div className="flex items-center gap-3">
            {!readonly && onlineCount > 1 && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                {onlineCount}人が編集中
              </span>
            )}
            {status === 'saving' && <span className="text-xs text-gray-400">保存中...</span>}
            {status === 'saved' && <span className="text-xs text-green-500">保存済み ✓</span>}
            {status === 'error' && <span className="text-xs text-red-500">保存失敗</span>}
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              🖨 印刷
            </button>
          </div>
        </div>

        {/* PDF Canvas area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="flex justify-center min-w-max py-6 px-8">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-gray-400">PDFを読み込み中...</div>
            </div>
          ) : (
            <div className="relative shadow-xl" style={{ display: 'inline-block' }}>
              {/* PDF layer */}
              <canvas ref={pdfCanvasRef} className="block" />
              {/* Annotation layer */}
              <canvas
                ref={annotCanvasRef}
                className="absolute top-0 left-0"
                style={readonly ? { cursor: 'default' } : canvasStyle}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
              {/* Text input */}
              {textInput && (
                <input
                  ref={textInputRef}
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleTextSubmit()
                    if (e.key === 'Escape') { setTextInput(null); setTextValue('') }
                  }}
                  onBlur={handleTextSubmit}
                  className="absolute bg-transparent border-b border-blue-400 outline-none"
                  style={{
                    left: textInput.x * scale * (annotCanvasRef.current ? annotCanvasRef.current.getBoundingClientRect().width / annotCanvasRef.current.width : 1),
                    top: textInput.y * scale * (annotCanvasRef.current ? annotCanvasRef.current.getBoundingClientRect().height / annotCanvasRef.current.height : 1),
                    color,
                    fontSize: fontSize * scale,
                    minWidth: 100,
                  }}
                  placeholder="テキストを入力..."
                />
              )}
            </div>
          )}
          </div>
        </div>

        {/* Thumbnail page list */}
        {totalPages > 1 && (
          <div className="h-20 bg-white border-t border-gray-200 flex items-center gap-2 px-4 overflow-x-auto">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setCurrentPage(p)}
                className={`h-14 px-3 text-xs rounded border transition-all flex-shrink-0
                  ${currentPage === p
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold'
                    : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
