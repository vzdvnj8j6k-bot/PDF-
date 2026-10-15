import { supabase } from './supabase'
import { Document, PageAnnotations, ShareLink, Stroke, TextAnnotation } from '@/types'

// ==================== Auth ====================

export async function ensureAnonymousAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// ==================== Documents ====================

export async function uploadDocument(file: File, title: string): Promise<Document> {
  await ensureAnonymousAuth()
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('Not authenticated')

  // Upload PDF to Supabase Storage
  const fileName = `${userId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await supabase.storage
    .from('pdfs')
    .upload(fileName, file, { contentType: 'application/pdf' })

  if (uploadError) throw uploadError

  // Create document record
  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      title,
      pdf_path: fileName,
      total_pages: 1,
    })
    .select()
    .single()

  if (error) throw error
  return data as Document
}

export async function getDocuments(): Promise<Document[]> {
  await ensureAnonymousAuth()
  const userId = await getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Document[]
}

export async function getDocument(id: string): Promise<Document | null> {
  await ensureAnonymousAuth()
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as Document
}

export async function updateDocumentPages(id: string, totalPages: number) {
  await supabase
    .from('documents')
    .update({ total_pages: totalPages })
    .eq('id', id)
}

export async function deleteDocument(id: string) {
  const doc = await getDocument(id)
  if (!doc) return

  // Delete PDF from storage
  await supabase.storage.from('pdfs').remove([doc.pdf_path])

  // Delete document record (cascades to annotations and share_links)
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export function getPdfUrl(pdfPath: string): string {
  const { data } = supabase.storage.from('pdfs').getPublicUrl(pdfPath)
  return data.publicUrl
}

// ==================== Annotations ====================

export async function getAnnotations(documentId: string, pageNumber: number): Promise<PageAnnotations> {
  const { data, error } = await supabase
    .from('annotations')
    .select('strokes')
    .eq('document_id', documentId)
    .eq('page_number', pageNumber)
    .single()

  if (error || !data) return { strokes: [], texts: [] }

  const stored = data.strokes as { strokes?: Stroke[], texts?: TextAnnotation[] }
  return {
    strokes: stored.strokes ?? [],
    texts: stored.texts ?? [],
  }
}

export async function saveAnnotations(
  documentId: string,
  pageNumber: number,
  annotations: PageAnnotations
) {
  const { error } = await supabase
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
  const { data, error } = await supabase
    .from('annotations')
    .select('page_number, strokes')
    .eq('document_id', documentId)

  if (error || !data) return new Map()

  const map = new Map<number, PageAnnotations>()
  for (const row of data) {
    const stored = row.strokes as { strokes?: Stroke[], texts?: TextAnnotation[] }
    map.set(row.page_number, {
      strokes: stored.strokes ?? [],
      texts: stored.texts ?? [],
    })
  }
  return map
}

// ==================== Share Links ====================

export async function createShareLink(documentId: string): Promise<ShareLink> {
  await ensureAnonymousAuth()

  // Check if share link already exists
  const { data: existing } = await supabase
    .from('share_links')
    .select('*')
    .eq('document_id', documentId)
    .single()

  if (existing) return existing as ShareLink

  // Create new share link
  const { data, error } = await supabase
    .from('share_links')
    .insert({ document_id: documentId })
    .select()
    .single()

  if (error) throw error
  return data as ShareLink
}

export async function getDocumentByToken(token: string): Promise<{ document: Document; annotations: Map<number, PageAnnotations> } | null> {
  // Get share link
  const { data: shareLink, error: slError } = await supabase
    .from('share_links')
    .select('document_id')
    .eq('token', token)
    .single()

  if (slError || !shareLink) return null

  // Get document
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', shareLink.document_id)
    .single()

  if (docError || !doc) return null

  const annotations = await getAllAnnotations(doc.id)

  return { document: doc as Document, annotations }
}
