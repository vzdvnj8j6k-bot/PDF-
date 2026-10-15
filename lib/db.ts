import { getSupabaseClient } from './supabase'
import { Document, PageAnnotations, ShareLink, Stroke, TextAnnotation } from '@/types'

// ==================== Auth ====================

export async function ensureAnonymousAuth() {
  const sb = getSupabaseClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) {
    const { error } = await sb.auth.signInAnonymously()
    if (error) throw error
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const sb = getSupabaseClient()
  const { data: { user } } = await sb.auth.getUser()
  return user?.id ?? null
}

// ==================== Documents ====================

export async function uploadDocument(file: File, title: string): Promise<Document> {
  await ensureAnonymousAuth()
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('Not authenticated')
  const sb = getSupabaseClient()

  const fileName = `${userId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await sb.storage
    .from('pdfs')
    .upload(fileName, file, { contentType: 'application/pdf' })

  if (uploadError) throw uploadError

  const { data, error } = await sb
    .from('documents')
    .insert({ user_id: userId, title, pdf_path: fileName, total_pages: 1 })
    .select()
    .single()

  if (error) throw error
  return data as Document
}

export async function getDocuments(): Promise<Document[]> {
  await ensureAnonymousAuth()
  const userId = await getCurrentUserId()
  if (!userId) return []
  const sb = getSupabaseClient()

  const { data, error } = await sb
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Document[]
}

export async function getDocument(id: string): Promise<Document | null> {
  await ensureAnonymousAuth()
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as Document
}

export async function updateDocumentPages(id: string, totalPages: number) {
  const sb = getSupabaseClient()
  await sb.from('documents').update({ total_pages: totalPages }).eq('id', id)
}

export async function deleteDocument(id: string) {
  const doc = await getDocument(id)
  if (!doc) return
  const sb = getSupabaseClient()
  await sb.storage.from('pdfs').remove([doc.pdf_path])
  const { error } = await sb.from('documents').delete().eq('id', id)
  if (error) throw error
}

export function getPdfUrl(pdfPath: string): string {
  const sb = getSupabaseClient()
  const { data } = sb.storage.from('pdfs').getPublicUrl(pdfPath)
  return data.publicUrl
}

// ==================== Annotations ====================

export async function getAnnotations(documentId: string, pageNumber: number): Promise<PageAnnotations> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('annotations')
    .select('strokes')
    .eq('document_id', documentId)
    .eq('page_number', pageNumber)
    .single()

  if (error || !data) return { strokes: [], texts: [] }
  const stored = data.strokes as { strokes?: Stroke[], texts?: TextAnnotation[] }
  return { strokes: stored.strokes ?? [], texts: stored.texts ?? [] }
}

export async function saveAnnotations(
  documentId: string,
  pageNumber: number,
  annotations: PageAnnotations
) {
  const sb = getSupabaseClient()
  const { error } = await sb
    .from('annotations')
    .upsert(
      {
        document_id: documentId,
        page_number: pageNumber,
        strokes: { strokes: annotations.strokes, texts: annotations.texts },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'document_id,page_number' }
    )
  if (error) throw error
}

export async function getAllAnnotations(documentId: string): Promise<Map<number, PageAnnotations>> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('annotations')
    .select('page_number, strokes')
    .eq('document_id', documentId)

  if (error || !data) return new Map()
  const map = new Map<number, PageAnnotations>()
  for (const row of data) {
    const stored = row.strokes as { strokes?: Stroke[], texts?: TextAnnotation[] }
    map.set(row.page_number, { strokes: stored.strokes ?? [], texts: stored.texts ?? [] })
  }
  return map
}

// ==================== Share Links ====================

export async function createShareLink(documentId: string): Promise<ShareLink> {
  await ensureAnonymousAuth()
  const sb = getSupabaseClient()

  const { data: existing } = await sb
    .from('share_links')
    .select('*')
    .eq('document_id', documentId)
    .single()

  if (existing) return existing as ShareLink

  const { data, error } = await sb
    .from('share_links')
    .insert({ document_id: documentId })
    .select()
    .single()

  if (error) throw error
  return data as ShareLink
}

export async function getDocumentByToken(token: string): Promise<{ document: Document; annotations: Map<number, PageAnnotations> } | null> {
  const sb = getSupabaseClient()
  const { data: shareLink, error: slError } = await sb
    .from('share_links')
    .select('document_id')
    .eq('token', token)
    .single()

  if (slError || !shareLink) return null

  const { data: doc, error: docError } = await sb
    .from('documents')
    .select('*')
    .eq('id', shareLink.document_id)
    .single()

  if (docError || !doc) return null

  const annotations = await getAllAnnotations(doc.id)
  return { document: doc as Document, annotations }
}
