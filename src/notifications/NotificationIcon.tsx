import { AlarmClock, CalendarClock, ArrowRightLeft, CheckCircle2, ClipboardPlus, MessageSquare, Paperclip, PencilLine, UserX } from 'lucide-react'

const MAP = {
  assigned: { Icon: ClipboardPlus, tone: 'tone-blue' },
  reassigned: { Icon: ArrowRightLeft, tone: 'tone-orange' },
  status: { Icon: CheckCircle2, tone: 'tone-green' },
  comment: { Icon: MessageSquare, tone: 'tone-purple' },
  attachment: { Icon: Paperclip, tone: 'tone-teal' },
  updated: { Icon: PencilLine, tone: 'tone-yellow' },
  unassigned: { Icon: UserX, tone: 'tone-orange' },
  reminder: { Icon: AlarmClock, tone: 'tone-purple' },
  meeting: { Icon: CalendarClock, tone: 'tone-teal' },
} as const

export function NotificationIcon({ type }: { type: string }) {
  const { Icon, tone } = MAP[type as keyof typeof MAP] ?? MAP.updated
  return <div className={`notif-icon ${tone}`}><Icon size={16} /></div>
}
