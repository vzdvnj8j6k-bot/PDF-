'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { deleteDocument, getDocuments, uploadDocument } from '@/lib/db'
import { Document } from '@/types'

export default function HomePage() {
  const router = useRouter()
  const [documents, setDocuments] = useState<Document[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await getDocuments()
      setDocuments(docs)
    } catch (e) {
      console.error('Failed to load documents:', e)
    }
  }, [])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  async function handleFile(file: File) {
    if (!file.type.includes('pdf')) {
      setError('PDFファイルのみアップロードできます')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('ファイルサイズは50MB以下にしてください')
      return
    }

    setError(null)
    setIsUploading(true)
    try {
      const doc = await uploadDocument(file, file.name.replace('.pdf', ''))
      router.push(`/editor/${doc.id}`)
    } catch (e) {
      console.error('Upload error:', e)
      setError('アップロードに失敗しました。Supabaseの設定を確認してください。')
    } finally {
      setIsUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleDelete(doc: Document) {
    if (!confirm(`「${doc.title}」を削除しますか？`)) return
    try {
      await deleteDocument(doc.id)
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
    } catch (e) {
      console.error('Delete error:', e)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-gray-800 mb-3">📝 PDF Note</h1>
          <p className="text-gray-500 text-lg">PDFに自由に書き込み・共有・印刷</p>
        </div>

        {/* Upload area */}
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 mb-8
            ${isDragging
              ? 'border-blue-500 bg-blue-50 scale-[1.01]'
              : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
            }
            ${isUploading ? 'pointer-events-none opacity-70' : ''}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {isUploading ? (
            <div className="space-y-3">
              <div className="text-4xl animate-bounce">⏳</div>
              <p className="text-gray-600 font-medium">アップロード中...</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-5xl">📄</div>
              <p className="text-gray-700 font-semibold text-lg">PDFファイルをドラッグ＆ドロップ</p>
              <p className="text-gray-400 text-sm">または クリックしてファイルを選択</p>
              <p className="text-gray-300 text-xs">最大 50MB</p>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Document list */}
        {documents.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-gray-700 mb-4">最近のファイル</h2>
            <div className="grid gap-3">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
                >
                  <div className="text-3xl">📄</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-800 truncate">{doc.title}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {doc.total_pages}ページ · {formatDate(doc.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/editor/${doc.id}`)}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      開く
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {documents.length === 0 && !isUploading && (
          <p className="text-center text-gray-400 text-sm">
            まだファイルがありません。上のエリアにPDFをアップロードしてください。
          </p>
        )}
      </div>
    </main>
  )
}
