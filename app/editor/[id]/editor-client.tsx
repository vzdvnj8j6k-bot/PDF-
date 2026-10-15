'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import PDFAnnotator from '@/components/PDFAnnotator'
import { createShareLink, getDocument, getPdfUrl } from '@/lib/db'
import { Document } from '@/types'

export default function EditorPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [document, setDocument] = useState<Document | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const doc = await getDocument(id)
      if (!doc) {
        router.replace('/')
        return
      }
      setDocument(doc)
      setPdfUrl(getPdfUrl(doc.pdf_path))
      setIsLoading(false)
    }
    load()
  }, [id, router])

  async function handleShare() {
    if (!document) return
    setIsSharing(true)
    try {
      const link = await createShareLink(document.id)
      const url = `${window.location.origin}/share/${link.token}`
      setShareUrl(url)
      setShowShareDialog(true)
    } catch (e) {
      console.error('Share error:', e)
      alert('共有リンクの作成に失敗しました')
    } finally {
      setIsSharing(false)
    }
  }

  async function copyToClipboard() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    alert('リンクをコピーしました！')
  }

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">読み込み中...</div>
      </div>
    )
  }

  if (!document || !pdfUrl) return null

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors">
          ← ホーム
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="font-semibold text-gray-800 truncate flex-1 text-sm">
          {document.title}
        </h1>
        <button
          onClick={handleShare}
          disabled={isSharing}
          className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
        >
          {isSharing ? '作成中...' : '🔗 共有'}
        </button>
      </header>

      {/* PDF Annotator */}
      <div className="flex-1 overflow-hidden">
        <PDFAnnotator
          pdfUrl={pdfUrl}
          documentId={document.id}
        />
      </div>

      {/* Share dialog */}
      {showShareDialog && shareUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-gray-800 mb-2">共有リンクが作成されました</h2>
            <p className="text-gray-500 text-sm mb-4">
              このリンクを知っている人は誰でも閲覧できます（書き込みはできません）
            </p>
            <div className="flex gap-2 mb-4">
              <input
                value={shareUrl}
                readOnly
                className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700 font-mono"
              />
              <button
                onClick={copyToClipboard}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
              >
                コピー
              </button>
            </div>
            <button
              onClick={() => setShowShareDialog(false)}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
