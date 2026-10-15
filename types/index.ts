export type Tool = 'pen' | 'highlighter' | 'eraser' | 'text' | 'line' | 'none'

export interface Point {
  x: number
  y: number
}

export interface Stroke {
  id: string
  tool: Tool
  color: string
  size: number
  opacity: number
  points: Point[]
}

export interface TextAnnotation {
  id: string
  x: number
  y: number
  text: string
  fontSize: number
  color: string
}

export interface PageAnnotations {
  strokes: Stroke[]
  texts: TextAnnotation[]
}

export interface Document {
  id: string
  user_id: string
  title: string
  pdf_path: string
  total_pages: number
  created_at: string
}

export interface ShareLink {
  id: string
  document_id: string
  token: string
  created_at: string
}
