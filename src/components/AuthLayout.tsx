import type { ReactNode } from 'react'
import { Brand } from './Brand'
import { VERSION_LABEL } from '../lib/version'

const BARS: [string, number][] = [['To do', 72], ['In progress', 54], ['Done', 88], ['Ongoing', 40], ['Expired', 18]]

/** Split screen: form on the left, a light grid panel with a product preview on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-form">
        <div className="auth-box">
          <Brand size="lg" />
          {children}
          <p className="auth-version">{VERSION_LABEL}</p>
        </div>
      </div>
      <div className="auth-art" aria-hidden="true">
        <div className="corner"><div className="mark md">TM</div></div>
        <div className="preview">
          <div className="preview-side">
            <Brand />
            <div className="pl head" />
            <div className="pl active" />
            <div className="pl" /><div className="pl" style={{ width: '70%' }} />
            <div className="pl head" />
            <div className="pl" /><div className="pl" style={{ width: '60%' }} />
          </div>
          <div className="preview-main">
            <h3>Highlights</h3>
            <div className="preview-cards">
              <div className="preview-card"><span>Tasks today</span><b>24</b></div>
              <div className="preview-card"><span>Completed</span><b>18</b></div>
              <div className="preview-card"><span>On-time rate</span><b>92%</b></div>
            </div>
            <div className="preview-bars">
              <h3>Task status</h3>
              {BARS.map(([label, pct]) => (
                <div className="preview-bar" key={label}>
                  <span style={{ width: 80 }}>{label}</span>
                  <em><i style={{ width: `${pct}%` }} /></em>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
