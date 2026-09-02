import { useState } from 'react'
import type { Deal, Product } from '@shared/types'
import type { DealWriteInput } from '@shared/ipc'
import { api } from '../lib/api'
import { useAsync, run } from '../lib/useAsync'
import { Loading, EmptyState, Modal, Field, Money } from '../components/ui'
import { ImageField, MenuThumb, type StagedImage } from '../components/MenuImage'
import { confirmDialog } from '../components/confirm'
import { toast } from '../store/toast'
import { formatMoney } from '../lib/format'

export function DealsPage(): JSX.Element {
  const deals = useAsync(() => api.deals.list({ includeArchived: true }), [])
  const products = useAsync(() => api.menu.products({}), [])
  const [editing, setEditing] = useState<Deal | 'new' | null>(null)

  if (deals.loading && !deals.data) return <Loading />
  const rows = deals.data ?? []

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Deals</h1>
          <p>Configurable bundles with their own price. Nothing is hard-coded — edit items, quantities and price here.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setEditing('new')}>
          + New deal
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No deals" />
      ) : (
        <div className="cols cols--2">
          {rows.map((d) => (
            <div className="panel" key={d.id}>
              <div className="panel__head">
                <div className="row gap-2">
                  <h3>{d.name}</h3>
                  {d.nameUrdu && <span className="urdu muted">{d.nameUrdu}</span>}
                </div>
                <strong>
                  <Money minor={d.priceMinor} />
                </strong>
              </div>
              <div className="panel__body deal-card">
                <MenuThumb src={d.imageUrl} name={d.name} className="deal-card__thumb" />
                <div className="deal-card__main">
                  {d.description && (
                    <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--s-2)' }}>
                      {d.description}
                    </p>
                  )}
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {d.items.map((it) => (
                      <li key={it.id} style={{ fontSize: 'var(--text-sm)' }}>
                        <span className="mono">{it.quantity}×</span> {it.productName}
                        {it.variant !== 'STANDARD' && <span className="muted"> ({it.variant})</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="row gap-2 wrap" style={{ marginTop: 'var(--s-3)' }}>
                    {d.isArchived && <span className="chip chip--danger">Archived</span>}
                    {!d.isArchived && !d.isAvailable && <span className="chip chip--warn">Unavailable</span>}
                    <button className="btn btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing(d)}>
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <DealEditor
          deal={editing === 'new' ? null : editing}
          products={products.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            deals.reload()
          }}
        />
      )}
    </div>
  )
}

function DealEditor({
  deal,
  products,
  onClose,
  onSaved
}: {
  deal: Deal | null
  products: Product[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [f, setF] = useState<DealWriteInput>(() => ({
    name: deal?.name ?? '',
    nameUrdu: deal?.nameUrdu ?? '',
    description: deal?.description ?? '',
    priceMinor: deal?.priceMinor ?? 0,
    isAvailable: deal?.isAvailable ?? true,
    isActive: deal?.isActive ?? true,
    items: deal
      ? deal.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          productName: i.productName,
          variant: i.variant,
          quantity: i.quantity
        }))
      : [{ productName: '', variant: 'STANDARD', quantity: 1 }]
  }))
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState<StagedImage | null>(null)
  const [removeImage, setRemoveImage] = useState(false)

  const componentValue = f.items.reduce((sum, it) => {
    const p = products.find((x) => x.name === it.productName)
    const price = p?.prices.find((pr) => pr.variant === it.variant) ?? p?.prices[0]
    return sum + (price?.priceMinor ?? 0) * it.quantity
  }, 0)

  const save = async (): Promise<void> => {
    if (f.name.trim().length < 2) return toast.error('Deal name is required.')
    if (f.items.some((i) => !i.productName.trim())) return toast.error('Every deal item needs a product.')
    setBusy(true)
    const body = { ...f, stagedImageId: staged?.stagedImageId ?? null, removeImage }
    const r = await run(() => (deal ? api.deals.update({ ...body, id: deal.id }) : api.deals.create(body)), {
      success: deal ? 'Deal updated.' : 'Deal created.'
    })
    setBusy(false)
    if (r) onSaved()
  }

  return (
    <Modal
      open
      title={deal ? `Edit — ${deal.name}` : 'New deal'}
      onClose={onClose}
      width={560}
      footer={
        <>
          {deal && !deal.isArchived && (
            <button
              className="btn btn--danger"
              style={{ marginRight: 'auto' }}
              onClick={async () => {
                if (await confirmDialog({ title: 'Archive deal?', message: 'It will be removed from the POS.', danger: true }))
                  run(() => api.deals.archive({ id: deal.id }), { success: 'Archived.' }).then(onSaved)
              }}
            >
              Archive
            </button>
          )}
          {deal?.isArchived && (
            <button
              className="btn"
              style={{ marginRight: 'auto' }}
              onClick={() => run(() => api.deals.restore({ id: deal.id }), { success: 'Restored.' }).then(onSaved)}
            >
              Restore
            </button>
          )}
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-row">
          <Field label="Deal name">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Urdu name">
            <input className="input urdu" value={f.nameUrdu} onChange={(e) => setF({ ...f, nameUrdu: e.target.value })} />
          </Field>
        </div>
        <Field label="Description / note">
          <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Deal price (Rs.)">
          <input
            className="input mono"
            value={f.priceMinor ? f.priceMinor / 100 : ''}
            onChange={(e) => setF({ ...f, priceMinor: Math.round(parseFloat(e.target.value || '0') * 100) })}
          />
        </Field>

        <ImageField
          name={f.name}
          currentUrl={deal?.imageUrl ?? null}
          staged={staged}
          removed={removeImage}
          onStaged={setStaged}
          onRemovedChange={setRemoveImage}
        />

        <div className="field">
          <label>Included items</label>
          <div className="stack gap-2">
            {f.items.map((it, i) => (
              <div className="row gap-2" key={i}>
                <input
                  className="input mono"
                  style={{ width: 54 }}
                  value={it.quantity}
                  onChange={(e) => {
                    const items = [...f.items]
                    items[i] = { ...it, quantity: Math.max(1, parseInt(e.target.value || '1')) }
                    setF({ ...f, items })
                  }}
                />
                <input
                  className="input"
                  list="deal-products"
                  placeholder="Product"
                  value={it.productName}
                  onChange={(e) => {
                    const items = [...f.items]
                    const match = products.find((p) => p.name === e.target.value)
                    items[i] = { ...it, productName: e.target.value, productId: match?.id ?? null }
                    setF({ ...f, items })
                  }}
                />
                <select
                  className="select"
                  style={{ width: 110 }}
                  value={it.variant}
                  onChange={(e) => {
                    const items = [...f.items]
                    items[i] = { ...it, variant: e.target.value }
                    setF({ ...f, items })
                  }}
                >
                  <option value="STANDARD">Standard</option>
                  <option value="HALF">Half</option>
                  <option value="FULL">Full</option>
                </select>
                {f.items.length > 1 && (
                  <button
                    className="btn btn--sm"
                    onClick={() => setF({ ...f, items: f.items.filter((_, x) => x !== i) })}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <datalist id="deal-products">
              {products.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <button
              className="btn btn--sm"
              onClick={() => setF({ ...f, items: [...f.items, { productName: '', variant: 'STANDARD', quantity: 1 }] })}
            >
              + Add item
            </button>
          </div>
        </div>

        <div className="kv-list">
          <div className="kv">
            <span>Value if bought separately</span>
            <span>{formatMoney(componentValue)}</span>
          </div>
          <div className="kv">
            <span>Deal price</span>
            <span>{formatMoney(f.priceMinor)}</span>
          </div>
          <div className="kv">
            <span>Customer saves</span>
            <span className="money-pos">{formatMoney(Math.max(0, componentValue - f.priceMinor))}</span>
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={f.isAvailable} onChange={(e) => setF({ ...f, isAvailable: e.target.checked })} />
          Available on POS
        </label>
      </div>
    </Modal>
  )
}
