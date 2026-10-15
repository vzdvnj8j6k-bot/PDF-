'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getDocumentByToken, getPdfUrl } from '@/lib/db'
import { Document, PageAnnotations } from '@/types'

// PDF.js loaded dynamically
let pdfjsLib: typeof import('pdfjs-dist') | null = null

export default function SharePage() {
  const params = useParams()
  const token = params.token as string

  const [document, setDocument] = useState<Document | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<Map<number, PageAnnotations>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const result = await getDocumentByToken(token)
      if (!result) {
        setNotFound(true)
        setIsLoading(false)
        return
      }
      setDocument(result.document)
      setPdfUrl(getPdfUrl(result.document.pdf_path))
      setAnnotations(result.annotations)
      setIsLoading(false)
    }
    load()
  }, [token])

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-xl font-bold text-gray-700 mb-2">ページが見つかりません</h1>
          <p className="text-gray-400 text-sm mb-6">共有リンクが無効か、削除されています</p>
          <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">
            ホームへ戻る
          </Link>
        </div>
      </div>
    )
  }

  if (!document || !pdfUrl) return null

  return <ShareReader document={document} pdfUrl={pdfUrl} annotations={annotations} />
}

function ShareReader({
  document: doc,
  pdfUrl,
  annotations,
}: {
  document: Document
  pdfUrl: string
  annotations: Map<number, PageAnnotations>
}) {
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(doc.total_pages || 1)
  const [scale, setScale] = useState(1.4)
  const [isPrinting, setIsPrinting] = useState(false)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const annotCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null)
  const pdfRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const pinchStartDist = useRef<number | null>(null)
  const pinchStartScale = useRef<number>(1)

  // Load PDF
  useEffect(() => {
    async function load() {
      if (!pdfjsLib) {
        pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
      }
      try {
        const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise
        pdfRef.current = pdf
        setTotalPages(pdf.numPages)
      } catch (e) {
        console.error('PDF load error:', e)
      }
    }
    load()
  }, [pdfUrl])

  // Render page
  useEffect(() => {
    async function render() {
      if (!pdfRef.current || !pdfCanvasRef.current || !annotCanvasRef.current) return
      try {
        const page = await pdfRef.current.getPage(currentPage)
        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: scale * dpr })
        const cssW = Math.round(viewport.width / dpr)
        const cssH = Math.round(viewport.height / dpr)

        const pdfCanvas = pdfCanvasRef.current
        pdfCanvas.width = viewport.width
        pdfCanvas.height = viewport.height
        pdfCanvas.style.width = cssW + 'px'
        pdfCanvas.style.height = cssH + 'px'

        const annotCanvas = annotCanvasRef.current
        annotCanvas.width = viewport.width
        annotCanvas.height = viewport.height
        annotCanvas.style.width = cssW + 'px'
        annotCanvas.style.height = cssH + 'px'

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel()
          renderTaskRef.current = null
        }

        renderTaskRef.current = page.render({ canvas: pdfCanvas, viewport })
        await renderTaskRef.current.promise
        renderTaskRef.current = null

        // Draw annotations
        const pageAnnotations = annotations.get(currentPage) ?? { strokes: [], texts: [] }
        drawAnnotations(annotCanvas, pageAnnotations, scale * dpr, dpr)
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== 'RenderingCancelledException') {
          console.error('Render error:', e)
        }
      }
    }
    render()
  }, [currentPage, scale, annotations])

  function drawAnnotations(canvas: HTMLCanvasElement, pageAnnotations: PageAnnotations, drawScale: number, lineWidthScale: number) {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const stroke of pageAnnotations.strokes) {
      if (stroke.points.length < 2) continue
      ctx.save()
      const isH = stroke.tool === 'highlighter'
      ctx.globalAlpha = stroke.opacity
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.size * lineWidthScale
      ctx.lineCap = isH ? 'square' : 'round'
      ctx.lineJoin = isH ? 'miter' : 'round'
      if (isH) ctx.globalCompositeOperation = 'multiply'
      const pts = stroke.points
      ctx.beginPath()
      ctx.moveTo(pts[0].x * drawScale, pts[0].y * drawScale)
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], curr = pts[i]
        ctx.quadraticCurveTo(prev.x * drawScale, prev.y * drawScale, (prev.x + curr.x) / 2 * drawScale, (prev.y + curr.y) / 2 * drawScale)
      }
      ctx.lineTo(pts[pts.length - 1].x * drawScale, pts[pts.length - 1].y * drawScale)
      ctx.stroke()
      ctx.restore()
    }

    for (const text of pageAnnotations.texts) {
      ctx.save()
      ctx.font = `${text.fontSize * drawScale}px sans-serif`
      ctx.fillStyle = text.color
      ctx.fillText(text.text, text.x * drawScale, text.y * drawScale)
      ctx.restore()
    }

    if (pageAnnotations.eraserMarks?.length) {
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const mark of pageAnnotations.eraserMarks) {
        if (!mark.points.length) continue
        ctx.lineWidth = mark.r * 2 * drawScale
        ctx.beginPath()
        if (mark.points.length === 1) {
          ctx.arc(mark.points[0].x * drawScale, mark.points[0].y * drawScale, mark.r * drawScale, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.moveTo(mark.points[0].x * drawScale, mark.points[0].y * drawScale)
          for (let i = 1; i < mark.points.length; i++) ctx.lineTo(mark.points[i].x * drawScale, mark.points[i].y * drawScale)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
  }

  async function handlePrint() {
    if (!pdfRef.current) return
    setIsPrinting(true)
    const printWindow = window.open('', '_blank')
    if (!printWindow) { setIsPrinting(false); return }
    printWindow.document.write('<html><head><title>印刷</title><style>body{margin:0;background:#fff}img{display:block;width:100%;page-break-after:always;}</style></head><body>')
    const total = pdfRef.current.numPages
    for (let p = 1; p <= total; p++) {
      const page = await pdfRef.current.getPage(p)
      const viewport = page.getViewport({ scale: 2 })
      const pdfC = globalThis.document.createElement('canvas')
      pdfC.width = viewport.width; pdfC.height = viewport.height
      await page.render({ canvas: pdfC, viewport }).promise
      const annotC = globalThis.document.createElement('canvas')
      annotC.width = viewport.width; annotC.height = viewport.height
      drawAnnotations(annotC, annotations.get(p) ?? { strokes: [], texts: [] }, 2, 1)
      const merged = globalThis.document.createElement('canvas')
      merged.width = viewport.width; merged.height = viewport.height
      const mctx = merged.getContext('2d')!
      mctx.drawImage(pdfC, 0, 0); mctx.drawImage(annotC, 0, 0)
      printWindow.document.write(`<img src="${merged.toDataURL()}" />`)
    }
    printWindow.document.write('</body></html>')
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => { printWindow.print(); setIsPrinting(false) }, 500)
  }

  async function handleDownload() {
    try {
      const res = await fetch(pdfUrl)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = globalThis.document.createElement('a')
      a.href = url
      a.download = doc.title.endsWith('.pdf') ? doc.title : doc.title + '.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Download error:', e)
    }
  }

  // Keep scaleRef in sync for native event handlers
  const scaleRef = useRef(scale)
  useEffect(() => { scaleRef.current = scale }, [scale])

  // Ctrl+wheel zoom + pinch zoom via native listeners (so preventDefault works on iOS)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setScale(s => Math.min(3, Math.max(0.5, Math.round((s - e.deltaY * 0.001) * 10) / 10)))
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchStartDist.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        pinchStartScale.current = scaleRef.current
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchStartDist.current !== null) {
        e.preventDefault()
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        const ratio = dist / pinchStartDist.current
        if (Math.abs(ratio - 1) < 0.04) return
        const next = Math.min(3, Math.max(0.5, pinchStartScale.current * ratio))
        setScale(Math.round(next * 20) / 20)
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchStartDist.current = null
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors whitespace-nowrap">
          📝 PDF Note
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 truncate flex-1 text-sm">{doc.title}</h1>
        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full whitespace-nowrap">閲覧のみ</span>
      </header>

      {/* Reader controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-100">
        {/* Page nav */}
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors">←</button>
          <span className="text-sm font-medium text-gray-700">{currentPage} / {totalPages}</span>
          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-md disabled:opacity-40 hover:bg-gray-200 transition-colors">→</button>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.max(0.5, Math.round((s - 0.2) * 10) / 10))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">－</button>
          <span className="text-xs text-gray-500 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(3, Math.round((s + 0.2) * 10) / 10))} className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200">＋</button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} disabled={isPrinting}
            className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 transition-colors">
            {isPrinting ? '準備中...' : '🖨 印刷'}
          </button>
          <button onClick={handleDownload}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            ⬇ DL
          </button>
        </div>
      </div>

      {/* PDF area */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100 pdf-scroll-area">
        <div className="flex justify-center min-w-max py-6 px-8">
          <div className="relative shadow-xl" style={{ display: 'inline-block' }}>
            <canvas ref={pdfCanvasRef} className="block" />
            <canvas ref={annotCanvasRef} className="absolute top-0 left-0" style={{ pointerEvents: 'none' }} />
          </div>
        </div>
      </div>

      {/* Page thumbnail strip */}
      <div className="bg-white border-t border-gray-200 overflow-x-auto">
        <div className="flex gap-2 px-4 py-2 min-w-max">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setCurrentPage(p)}
              className={`w-10 h-10 rounded text-xs font-medium transition-all ${currentPage === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
