import { useState } from 'react'
import { Download, MoreVertical, PlusSquare, Share, X } from 'lucide-react'
import { useInstall } from '../lib/install'

/** "Download this app" on phones: installs Task Mgnt on the home screen, or shows how to when the browser can't ask. */
export function InstallApp({ variant = 'button' }: { variant?: 'button' | 'nav' }) {
  const { show, ios, install } = useInstall()
  const [help, setHelp] = useState(false)
  if (!show) return null
  const click = async () => { if (!(await install())) setHelp(true) }
  return (
    <>
      {variant === 'nav'
        ? <button type="button" className="nav-item install-nav" onClick={click}><Download size={20} /><span>Download this app</span></button>
        : <button type="button" className="secondary block install-btn" onClick={click}><Download size={18} /> Download this app</button>}
      {help && (
        <div className="dialog-wrap" onMouseDown={() => setHelp(false)}>
          <div className="dialog install-help" role="dialog" aria-label="Install Task Mgnt" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="icon install-close" onClick={() => setHelp(false)} aria-label="Close"><X size={18} /></button>
            <div className="dialog-icon info"><Download size={22} /></div>
            <h3>Add Task Mgnt to your home screen</h3>
            <p>Then open it from the icon like any other app — no need to type the website again.</p>
            {ios ? (
              <ol className="install-steps">
                <li>Open this page in <b>Safari</b>.</li>
                <li>Tap the <b>Share</b> button <Share size={15} /> at the bottom.</li>
                <li>Scroll down and tap <b>Add to Home Screen</b> <PlusSquare size={15} />.</li>
                <li>Tap <b>Add</b>.</li>
              </ol>
            ) : (
              <ol className="install-steps">
                <li>Open this page in <b>Chrome</b>.</li>
                <li>Tap the menu <MoreVertical size={15} /> at the top right.</li>
                <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>).</li>
                <li>Tap <b>Install</b>.</li>
              </ol>
            )}
            <div className="dialog-actions"><button onClick={() => setHelp(false)}>Got it</button></div>
          </div>
        </div>
      )}
    </>
  )
}
