'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import Toolbar from './Toolbar'
import { PageAnnotations, Point, Stroke, TextAnnotation, Tool } from '@/types'
import { getAllAnnotations, saveAnnotations, updateDocumentPages } from '@/lib/db'

// PDF.js is loaded dynamically to avoid SSR issues
let pdfjsLib: typeof import('pdfjs-dist') | null = null

interface Props {
  pdfUrl: string
  documentId: string
  readonly?: boolean
  initialAnnotations?: Map<number, PageAnnotations>
}

const SAVE_DEBOUNCE_MS = 1500

export default function PDFAnnotator({ pdfUrl, documentId, readonly = false, initialAnnotations }: Props) {
  const [pdf, setPdf] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.4)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(3)
  const [annotations, setAnnotations] = useState<Map<number, PageAnnotations>>(
    initialAnnotations ?? new Map()
  )
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isLoading, setIsLoading] = useState(true)

  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const annotCanvasRef = useRef<HTMLCanvasElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const isDrawing = useRef(false)
  const currentStroke = useRef<Stroke | null>(null)
  const history = useRef<Map<number, PageAnnotations[]>>(new Map())
  const saveTimer = useRef<NodeJS.Timeout | null>(null)
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null)

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

  // Redraw all annotations for a page
  function redrawAnnotations(canvas: HTMLCanvasElement, pageAnnotations: PageAnnotations) {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const stroke of pageAnnotations.strokes) {
      if (stroke.points.length < 2) continue
      drawStroke(ctx, stroke)
    }

    for (const text of pageAnnotations.texts) {
      ctx.save()
      ctx.font = `${text.fontSize}px sans-serif`
      ctx.fillStyle = text.color
      ctx.fillText(text.text, text.x, text.y)
      ctx.restore()
    }
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    if (stroke.points.length < 2) return
    ctx.save()
    ctx.globalAlpha = stroke.opacity
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (stroke.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply'
    } else if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
    }

    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i++) {
      const prev = stroke.points[i - 1]
      const curr = stroke.points[i]
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2)
    }
    ctx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y)
    ctx.stroke()
    ctx.restore()
  }

  // Get canvas-relative coordinates
  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = annotCanvasRef.current!.getBoundingClientRect()
    const scaleX = annotCanvasRef.current!.width / rect.width
    const scaleY = annotCanvasRef.current!.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  // Drawing handlers
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (readonly) return
    e.currentTarget.setPointerCapture(e.pointerId)

    const point = getPoint(e)

    if (tool === 'text') {
      setTextInput(point)
      setTextValue('')
      setTimeout(() => textInputRef.current?.focus(), 50)
      return
    }

    isDrawing.current = true
    currentStroke.current = {
      id: uuidv4(),
      tool,
      color: tool === 'highlighter' ? color + '80' : color,
      size: tool === 'highlighter' ? brushSize * 5 : tool === 'eraser' ? brushSize * 4 : brushSize,
      opacity: tool === 'highlighter' ? 0.4 : 1,
      points: [point],
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current || !currentStroke.current || !annotCanvasRef.current) return

    const point = getPoint(e)
    currentStroke.current.points.push(point)

    // Live drawing
    const ctx = annotCanvasRef.current.getContext('2d')!
    const pageAnnotations = annotations.get(currentPage) ?? { strokes: [], texts: [] }
    redrawAnnotations(annotCanvasRef.current, pageAnnotations)
    drawStroke(ctx, currentStroke.current)
  }

  function handlePointerUp() {
    if (!isDrawing.current || !currentStroke.current) return
    isDrawing.current = false

    const stroke = currentStroke.current
    currentStroke.current = null

    if (stroke.points.length < 2) return

    setAnnotations(prev => {
      const next = new Map(prev)
      const page = next.get(currentPage) ?? { strokes: [], texts: [] }

      // Save to history
      const hist = history.current.get(currentPage) ?? []
      history.current.set(currentPage, [...hist, page])

      const updated: PageAnnotations = {
        ...page,
        strokes: [...page.strokes, stroke],
      }
      next.set(currentPage, updated)

      scheduleSave(currentPage, updated)
      return next
    })
  }

  function handleTextSubmit() {
    if (!textInput || !textValue.trim()) {
      setTextInput(null)
      return
    }

    const textAnnotation: TextAnnotation = {
      id: uuidv4(),
      x: textInput.x,
      y: textInput.y,
      text: textValue,
      fontSize: brushSize * 5 + 10,
      color,
    }

    setAnnotations(prev => {
      const next = new Map(prev)
      const page = prev.get(currentPage) ?? { strokes: [], texts: [] }
      const updated: PageAnnotations = {
        ...page,
        texts: [...page.texts, textAnnotation],
      }
      next.set(currentPage, updated)
      scheduleSave(currentPage, updated)
      return next
    })

    setTextInput(null)
    setTextValue('')
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

      // Draw annotations on top
      const annotC = document.createElement('canvas')
      annotC.width = viewport.width
      annotC.height = viewport.height
      const pageAnnotations = annotations.get(p) ?? { strokes: [], texts: [] }

      // Scale strokes for print (scale 2 vs current scale)
      const ratio = 2 / scale
      const ctx = annotC.getContext('2d')!
      ctx.scale(ratio, ratio)

      const scaledAnnotations: PageAnnotations = {
        strokes: pageAnnotations.strokes,
        texts: pageAnnotations.texts,
      }
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = viewport.width / ratio
      tempCanvas.height = viewport.height / ratio
      redrawAnnotations(tempCanvas, scaledAnnotations)
      ctx.drawImage(tempCanvas, 0, 0)

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

  const canvasStyle = {
    cursor: tool === 'pen' || tool === 'highlighter'
      ? 'crosshair'
      : tool === 'eraser'
      ? 'cell'
      : 'text',
    touchAction: 'none',
  }

  return (
    <div className="flex h-full">
      {/* Toolbar (edit mode only) */}
      {!readonly && (
        <Toolbar
          tool={tool}
          color={color}
          size={brushSize}
          onToolChange={setTool}
          onColorChange={setColor}
          onSizeChange={setBrushSize}
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
        <div className="flex-1 overflow-auto">
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
                    left: textInput.x * (annotCanvasRef.current ? annotCanvasRef.current.getBoundingClientRect().width / annotCanvasRef.current.width : 1),
                    top: textInput.y * (annotCanvasRef.current ? annotCanvasRef.current.getBoundingClientRect().height / annotCanvasRef.current.height : 1),
                    color,
                    fontSize: brushSize * 5 + 10,
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
