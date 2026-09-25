import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_VERSION, VERSION_LABEL } from '../lib/version'

type Result = { status: 'idle' | 'running' | 'ok' | 'fail'; detail?: string }

function Check({ title, run }: { title: string; run: () => Promise<string> }) {
  const [r, setR] = useState<Result>({ status: 'idle' })
  const go = async () => {
    setR({ status: 'running' })
    try { setR({ status: 'ok', detail: await run() }) }
    catch (e) { setR({ status: 'fail', detail: e instanceof Error ? e.message : String(e) }) }
  }
  return (
    <div className="card">
      <div className="row">
        <h3>{title}</h3>
        <button onClick={go} disabled={r.status === 'running'}>{r.status === 'running' ? 'Testing…' : 'Run test'}</button>
      </div>
      {(r.status === 'ok' || r.status === 'fail') && (
        <pre className={r.status}>{r.status === 'ok' ? 'PASS  ' : 'FAIL  '}{r.detail}</pre>
      )}
    </div>
  )
}

/** Admin-only system check (the original deploy test). */
export function Health() {
  return (
    <>
      <div className="page-head"><div><h2>System Check</h2><p>Confirms the app can reach the Supabase database and Edge Functions.</p></div></div>
      <Check title="Database" run={async () => {
        const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true })
        if (error) throw new Error(error.message)
        return `${count} user profile(s) readable`
      }} />
      <Check title="Edge Function (hello)" run={async () => {
        const { data, error } = await supabase.functions.invoke('hello', { body: { name: 'Task Mgnt' } })
        if (error) throw new Error(error.message)
        return JSON.stringify(data)
      }} />
      <p className="muted small">{VERSION_LABEL} ({APP_VERSION}) · Build time: {new Date(__BUILD_TIME__).toLocaleString()}</p>
    </>
  )
}
