import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'

/**
 * The on-screen receipt.
 *
 * Used everywhere staff look at an invoice — straight after payment and in
 * the Invoices list — so that what they see always matches what the printer
 * produces. Keeping it in one component is the point: when this was inlined
 * in two places, the logo was added to one of them and quietly missing from
 * the other, which is the screen employees actually look at most.
 *
 * The logo is fetched rather than passed in because it is a property of the
 * printer settings, not of the invoice: it is resolved at print time, so an
 * old invoice previews with today's logo, exactly as a reprint would come out.
 */
export function ReceiptPreview({ text }: { text: string }): JSX.Element {
  const logo = useAsync(() => api.printer.logo(), [])
  const l = logo.data
  return (
    <div className="inv-preview">
      {l?.enabled && l.previewDataUrl && <img className="inv-preview__logo" src={l.previewDataUrl} alt="" />}
      {text}
    </div>
  )
}
