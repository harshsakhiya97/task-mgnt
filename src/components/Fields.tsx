import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'

/** Big login-style input with an icon on the left. */
export function IconInput({ icon, label, required, ...rest }: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; label: string }) {
  return (
    <label className="field">
      <span>{label}{required && <span className="req">*</span>}</span>
      <div className="input-icon">{icon}<input required={required} {...rest} /></div>
    </label>
  )
}

/** Password input with a show/hide eye toggle. */
export function PasswordInput({ label, required, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [show, setShow] = useState(false)
  return (
    <label className="field">
      <span>{label}{required && <span className="req">*</span>}</span>
      <div className="input-icon">
        <Lock size={20} />
        <input type={show ? 'text' : 'password'} required={required} {...rest} />
        <button type="button" className="icon eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      </div>
    </label>
  )
}

/** Regular labelled field for drawers and settings forms. */
export function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}{required && <span className="req"> *</span>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
