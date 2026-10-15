'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import PDFAnnotator from '@/components/PDFAnnotator'
import { getDocumentByToken, getPdfUrl } from '@/lib/db'
import { Document, PageAnnotations } from '@/types'

export default function SharePage() {
  const params = useParams()
  const router = useRouter()
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

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors">
          📝 PDF Note
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 truncate flex-1 text-sm">
          {document.title}
        </h1>
        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
          閲覧のみ
        </span>
      </header>

      {/* PDF Annotator (readonly) */}
      <div className="flex-1 overflow-hidden">
        <PDFAnnotator
          pdfUrl={pdfUrl}
          documentId={document.id}
          readonly={true}
          initialAnnotations={annotations}
        />
      </div>
    </div>
  )
}
