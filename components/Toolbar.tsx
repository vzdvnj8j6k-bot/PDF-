'use client'

import { Tool } from '@/types'

interface ToolbarProps {
  tool: Tool
  color: string
  size: number
  onToolChange: (tool: Tool) => void
  onColorChange: (color: string) => void
  onSizeChange: (size: number) => void
  onUndo: () => void
  onClearPage: () => void
  canUndo: boolean
}

const COLORS = [
  '#000000', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
]

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'pen', label: 'ペン', icon: '✏️' },
  { id: 'highlighter', label: 'マーカー', icon: '🖊️' },
  { id: 'text', label: 'テキスト', icon: 'T' },
  { id: 'eraser', label: '消しゴム', icon: '◻' },
]

export default function Toolbar({
  tool, color, size,
  onToolChange, onColorChange, onSizeChange,
  onUndo, onClearPage, canUndo,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 p-3 bg-white border-r border-gray-200 shadow-sm w-16 items-center">
      {/* Tools */}
      <div className="flex flex-col gap-1 w-full">
        {TOOLS.map(t => (
          <button
            key={t.id}
            title={tool === t.id ? `${t.label}（クリックで解除）` : t.label}
            onClick={() => onToolChange(tool === t.id ? 'none' : t.id)}
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all mx-auto
              ${tool === t.id
                ? 'bg-blue-600 text-white shadow-md scale-105'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="w-8 h-px bg-gray-200" />

      {/* Colors */}
      <div className="flex flex-col gap-1 w-full items-center">
        {COLORS.map(c => (
          <button
            key={c}
            title={c}
            onClick={() => onColorChange(c)}
            className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110
              ${color === c ? 'border-blue-500 scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="w-8 h-px bg-gray-200" />

      {/* Brush size */}
      <div className="flex flex-col gap-1 items-center">
        {[2, 4, 8, 12].map(s => (
          <button
            key={s}
            title={`サイズ ${s}`}
            onClick={() => onSizeChange(s)}
            className={`rounded-full transition-all hover:scale-110
              ${size === s ? 'bg-blue-600' : 'bg-gray-400'}`}
            style={{ width: Math.max(s * 2, 6), height: Math.max(s * 2, 6) }}
          />
        ))}
      </div>

      <div className="w-8 h-px bg-gray-200" />

      {/* Actions */}
      <button
        title="元に戻す (Ctrl+Z)"
        onClick={onUndo}
        disabled={!canUndo}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg disabled:opacity-30
          bg-gray-100 hover:bg-gray-200 disabled:cursor-not-allowed transition-colors"
      >
        ↩
      </button>
      <button
        title="このページをクリア"
        onClick={onClearPage}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-sm
          bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
      >
        🗑
      </button>
    </div>
  )
}
