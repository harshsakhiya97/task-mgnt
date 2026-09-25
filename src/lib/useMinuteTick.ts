import { useEffect, useState } from 'react'

/** Re-renders the caller at the start of every minute, so time-based tags (Ongoing → Expired) stay current. */
export function useMinuteTick() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => { setTick((n) => n + 1); schedule() }, 60_000 - (Date.now() % 60_000) + 50)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return tick
}
