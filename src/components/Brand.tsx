/** Task Mgnt logo: a round "TM" mark plus the wordmark. */
export function Brand({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  if (size === 'lg') {
    return (
      <div className="auth-logo">
        <div className="mark lg">TM</div>
        <div className="wordmark"><b>TASK MGNT</b><small>Pride Educare</small></div>
      </div>
    )
  }
  return (
    <div className="brand">
      <div className="mark">TM</div>
      <div className="wordmark"><b>TASK MGNT</b><small>Pride Educare</small></div>
    </div>
  )
}
