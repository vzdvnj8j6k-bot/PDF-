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
  const [shareError, setShareError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
    setShareError(null)
    try {
      const link = await createShareLink(document.id)
      const url = `${window.location.origin}/share/${link.token}`
      setShareUrl(url)
      setShowShareDialog(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as {message?: string})?.message ?? JSON.stringify(e)
      console.error('Share error:', e)
      setShareError(msg)
      setShowShareDialog(true)
    } finally {
      setIsSharing(false)
    }
  }

  async function copyToClipboard() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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

      {/* Share sheet */}
      {showShareDialog && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
          onClick={() => { setShowShareDialog(false); setShareError(null) }}
        >
          <div
            className="bg-white rounded-t-2xl shadow-2xl w-full max-w-lg p-6 pb-8 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />

            {shareError ? (
              <>
                <h2 className="text-lg font-bold text-red-600 mb-2">共有リンクの作成に失敗しました</h2>
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 font-mono break-all mb-4">{shareError}</p>
                <p className="text-sm text-gray-500 mb-4">Supabaseの設定を確認してください。</p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-gray-800 mb-1">共有リンク</h2>
                <p className="text-sm text-gray-500 mb-4">
                  このリンクを知っている人は閲覧できます（書き込みはできません）
                </p>
                <div className="flex gap-2 mb-3">
                  <input
                    value={shareUrl ?? ''}
                    readOnly
                    className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-600 font-mono min-w-0"
                  />
                  <button
                    onClick={copyToClipboard}
                    className={`px-4 py-2 text-sm rounded-lg font-medium whitespace-nowrap transition-colors
                      ${copied ? 'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                  >
                    {copied ? '✓ コピー済み' : 'コピー'}
                  </button>
                </div>
              </>
            )}

            <button
              onClick={() => { setShowShareDialog(false); setShareError(null) }}
              className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors rounded-lg hover:bg-gray-50"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
