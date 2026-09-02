import { useState } from 'react'
import type { Category, Product } from '@shared/types'
import type { ProductWriteInput } from '@shared/ipc'
import { api } from '../lib/api'
import { useAsync, run } from '../lib/useAsync'
import { Loading, EmptyState, Modal, Field, Money } from '../components/ui'
import { confirmDialog } from '../components/confirm'
import { ImageField, MenuThumb, type StagedImage } from '../components/MenuImage'
import { toast } from '../store/toast'

export function MenuPage(): JSX.Element {
  const cats = useAsync(() => api.menu.categories({ includeInactive: true }), [])
  const [activeCat, setActiveCat] = useState<number | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const products = useAsync(
    () => api.menu.products({ categoryId: activeCat === 'all' ? undefined : activeCat, includeArchived: true }),
    [activeCat]
  )
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [catModal, setCatModal] = useState(false)

  if (cats.loading && !cats.data) return <Loading />
  const categories = cats.data ?? []
  const rows = (products.data ?? []).filter((p) => showArchived || !p.isArchived)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Menu</h1>
          <p>Products, prices, half/full variants, Urdu names. Historical invoices are never affected by edits.</p>
        </div>
        <div className="row gap-2">
          <button className="btn" onClick={() => setCatModal(true)}>
            Categories
          </button>
          <button className="btn btn--primary" onClick={() => setEditing('new')}>
            + New product
          </button>
        </div>
      </div>

      <div className="page-toolbar">
        <button className={`tag-btn ${activeCat === 'all' ? 'is-active' : ''}`} onClick={() => setActiveCat('all')}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`tag-btn ${activeCat === c.id ? 'is-active' : ''}`}
            onClick={() => setActiveCat(c.id)}
          >
            {c.name} <span className="muted">{c.productCount ?? 0}</span>
          </button>
        ))}
        <label className="check" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="panel">
        <div className="panel__body" style={{ padding: 0 }}>
          {products.loading && !products.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState title="No products" />
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Prices</th>
                  <th>Flags</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => setEditing(p)}>
                    <td>
                      <div className="row gap-3">
                        <MenuThumb src={p.imageUrl} name={p.name} className="thumb--row" />
                        <div className="row gap-2">
                          <strong>{p.name}</strong>
                          {p.nameUrdu && <span className="urdu muted">{p.nameUrdu}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="muted">{p.categoryName}</td>
                    <td className="mono" style={{ fontSize: 'var(--text-xs)' }}>
                      {p.prices.map((pr) => `${pr.label} ${(pr.priceMinor / 100).toLocaleString()}`).join(' · ')}
                    </td>
                    <td>
                      <div className="row gap-1 wrap">
                        {p.isArchived && <span className="chip chip--danger">Archived</span>}
                        {!p.isArchived && !p.isAvailable && <span className="chip chip--warn">Unavailable</span>}
                        {p.isPopular && <span className="chip chip--accent">Popular</span>}
                      </div>
                    </td>
                    <td className="num">›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <ProductEditor
          product={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            products.reload()
            cats.reload()
          }}
        />
      )}
      {catModal && (
        <CategoryManager
          categories={categories}
          onClose={() => setCatModal(false)}
          onChanged={() => {
            cats.reload()
            products.reload()
          }}
        />
      )}
    </div>
  )
}

function ProductEditor({
  product,
  categories,
  onClose,
  onSaved
}: {
  product: Product | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [f, setF] = useState<ProductWriteInput>(() => ({
    categoryId: product?.categoryId ?? categories[0]?.id ?? 0,
    name: product?.name ?? '',
    nameUrdu: product?.nameUrdu ?? '',
    description: product?.description ?? '',
    isPopular: product?.isPopular ?? false,
    isAvailable: product?.isAvailable ?? true,
    isActive: product?.isActive ?? true,
    prices: product
      ? product.prices.map((p) => ({ id: p.id, variant: p.variant, label: p.label, priceMinor: p.priceMinor }))
      : [{ variant: 'STANDARD', label: 'Standard', priceMinor: 0 }]
  }))
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState<StagedImage | null>(null)
  const [removeImage, setRemoveImage] = useState(false)

  const save = async (): Promise<void> => {
    if (f.name.trim().length < 2) return toast.error('Name is required.')
    setBusy(true)
    const body = { ...f, stagedImageId: staged?.stagedImageId ?? null, removeImage }
    const r = await run(
      () => (product ? api.menu.productUpdate({ ...body, id: product.id }) : api.menu.productCreate(body)),
      { success: product ? 'Product updated.' : 'Product created.' }
    )
    setBusy(false)
    if (r) onSaved()
  }

  return (
    <Modal
      open
      title={product ? `Edit — ${product.name}` : 'New product'}
      onClose={onClose}
      width={560}
      footer={
        <>
          {product && !product.isArchived && (
            <button
              className="btn btn--danger"
              style={{ marginRight: 'auto' }}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: 'Archive product?',
                    message: 'It will be hidden from the POS. Existing invoices keep referencing it. You can restore it later.',
                    danger: true
                  })
                )
                  run(() => api.menu.productArchive({ id: product.id }), { success: 'Archived.' }).then(onSaved)
              }}
            >
              Archive
            </button>
          )}
          {product?.isArchived && (
            <button
              className="btn"
              style={{ marginRight: 'auto' }}
              onClick={() => run(() => api.menu.productRestore({ id: product.id }), { success: 'Restored.' }).then(onSaved)}
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
          <Field label="English name">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Urdu name">
            <input
              className="input urdu"
              value={f.nameUrdu}
              onChange={(e) => setF({ ...f, nameUrdu: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Category">
          <select
            className="select"
            value={f.categoryId}
            onChange={(e) => setF({ ...f, categoryId: Number(e.target.value) })}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description (optional)">
          <textarea
            className="textarea"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>

        <ImageField
          name={f.name}
          currentUrl={product?.imageUrl ?? null}
          staged={staged}
          removed={removeImage}
          onStaged={setStaged}
          onRemovedChange={setRemoveImage}
        />

        <div className="field">
          <label>Prices &amp; variants</label>
          <div className="stack gap-2">
            {f.prices.map((p, i) => (
              <div className="row gap-2" key={i}>
                <select
                  className="select"
                  style={{ width: 110 }}
                  value={p.variant}
                  onChange={(e) => {
                    const prices = [...f.prices]
                    prices[i] = { ...p, variant: e.target.value }
                    setF({ ...f, prices })
                  }}
                >
                  <option value="STANDARD">Standard</option>
                  <option value="HALF">Half</option>
                  <option value="FULL">Full</option>
                </select>
                <input
                  className="input"
                  placeholder="Label"
                  value={p.label}
                  onChange={(e) => {
                    const prices = [...f.prices]
                    prices[i] = { ...p, label: e.target.value }
                    setF({ ...f, prices })
                  }}
                />
                <input
                  className="input mono"
                  style={{ width: 110 }}
                  placeholder="Rs."
                  value={p.priceMinor ? p.priceMinor / 100 : ''}
                  onChange={(e) => {
                    const prices = [...f.prices]
                    prices[i] = { ...p, priceMinor: Math.round(parseFloat(e.target.value || '0') * 100) }
                    setF({ ...f, prices })
                  }}
                />
                {f.prices.length > 1 && (
                  <button
                    className="btn btn--sm"
                    onClick={() => setF({ ...f, prices: f.prices.filter((_, x) => x !== i) })}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              className="btn btn--sm"
              onClick={() => setF({ ...f, prices: [...f.prices, { variant: 'FULL', label: 'Full', priceMinor: 0 }] })}
            >
              + Add price
            </button>
          </div>
        </div>

        <div className="row gap-4 wrap">
          <label className="check">
            <input type="checkbox" checked={f.isPopular} onChange={(e) => setF({ ...f, isPopular: e.target.checked })} />
            Mark popular
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={f.isAvailable}
              onChange={(e) => setF({ ...f, isAvailable: e.target.checked })}
            />
            Available on POS
          </label>
        </div>
        {product && (
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Current lowest price: <Money minor={Math.min(...product.prices.map((p) => p.priceMinor))} />
          </div>
        )}
      </div>
    </Modal>
  )
}

function CategoryManager({
  categories,
  onClose,
  onChanged
}: {
  categories: Category[]
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [urdu, setUrdu] = useState('')
  return (
    <Modal open title="Categories" onClose={onClose} width={460}>
      <div className="stack gap-2" style={{ marginBottom: 'var(--s-4)' }}>
        {categories.map((c) => (
          <div key={c.id} className="row between">
            <div className="row gap-2">
              <strong>{c.name}</strong>
              {c.nameUrdu && <span className="urdu muted">{c.nameUrdu}</span>}
            </div>
            <button
              className={`btn btn--sm ${c.isActive ? 'is-on' : ''}`}
              title={c.isActive ? `Hide ${c.name} from the POS` : `Show ${c.name} on the POS`}
              onClick={() =>
                run(() => api.menu.categoryUpdate({ id: c.id, isActive: !c.isActive }), {
                  success: c.isActive ? 'Hidden.' : 'Shown.'
                }).then(onChanged)
              }
            >
              {c.isActive ? '✓ Active' : 'Hidden'}
            </button>
          </div>
        ))}
      </div>
      <div className="form-row">
        <input className="input" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input urdu" placeholder="اردو نام" value={urdu} onChange={(e) => setUrdu(e.target.value)} />
      </div>
      <button
        className="btn btn--primary btn--block"
        style={{ marginTop: 'var(--s-2)' }}
        onClick={async () => {
          if (name.trim().length < 2) return
          const r = await run(() => api.menu.categoryCreate({ name, nameUrdu: urdu || undefined }), {
            success: 'Category added.'
          })
          if (r) {
            setName('')
            setUrdu('')
            onChanged()
          }
        }}
      >
        Add category
      </button>
    </Modal>
  )
}
