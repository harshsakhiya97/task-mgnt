import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PAGE_SIZES = [10, 25, 50, 100]

/** Page numbers to show, with "…" gaps, e.g. 1 … 4 5 6 … 12 */
function pageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push('…')
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < total - 1) pages.push('…')
  pages.push(total)
  return pages
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize: (size: number) => void
}) {
  if (total === 0) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <div className="pagination">
      <div className="pagination-info">
        Showing <b>{from}–{to}</b> of <b>{total}</b>
      </div>
      <label className="pagination-size">
        Rows per page
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="pagination-pages">
        <button className="page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        {pageList(page, pages).map((p, i) =>
          p === '…'
            ? <span key={`gap${i}`} className="page-gap">…</span>
            : <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => onPage(p)}
                aria-current={p === page ? 'page' : undefined}>{p}</button>,
        )}
        <button className="page-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
