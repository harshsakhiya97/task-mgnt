import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copies `text` to the clipboard and shows "Copied" for a moment. */
export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Older browsers / non-secure pages: fall back to a hidden textarea.
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } finally { ta.remove() }
    }
    setDone(true)
    setTimeout(() => setDone(false), 1500)
  }
  return (
    <button type="button" className={`secondary small-btn copy-btn ${done ? 'copied' : ''} ${className}`} onClick={copy} title={label}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : label}
    </button>
  )
}
