import { Paperclip, X } from 'lucide-react'
import { formatSize, MAX_FILE_BYTES } from '../lib/tasks'

export function FilePicker({ files, onChange, onError, label = 'Attach files (max 10 MB each)' }: {
  files: File[]; onChange: (f: File[]) => void; onError?: (msg: string) => void; label?: string
}) {
  return (
    <>
      <label className="dropzone">
        <Paperclip size={18} /> {label}
        <input type="file" multiple onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES)
          onError?.(tooBig.length ? `Too large (max 10 MB): ${tooBig.map((f) => f.name).join(', ')}` : '')
          onChange([...files, ...picked.filter((f) => f.size <= MAX_FILE_BYTES)])
          e.target.value = ''
        }} />
      </label>
      {files.length > 0 && (
        <div className="picked">
          {files.map((f, i) => (
            <span key={i}>{f.name} <small className="muted">{formatSize(f.size)}</small>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
    </>
  )
}
