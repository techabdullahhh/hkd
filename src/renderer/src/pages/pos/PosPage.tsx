import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Deal, Product } from '@shared/types'
import { api } from '../../lib/api'
import { useAsync, run } from '../../lib/useAsync'
import { useOps } from '../../store/ops'
import { useCart } from '../../store/cart'
import { toast } from '../../store/toast'
import { Loading, Money, EmptyState } from '../../components/ui'
import { MenuThumb } from '../../components/MenuImage'
import { formatMoney } from '../../lib/format'
import { PaymentModal } from './PaymentModal'
import { HeldOrdersModal } from './HeldOrdersModal'
import { DiscountModal } from './DiscountModal'

export function PosPage(): JSX.Element {
  const { session, refresh } = useOps()
  const menu = useAsync(() => api.menu.posMenu(), [])
  const settings = useAsync(() => api.settings.get(), [])
  const cart = useCart()
  const navigate = useNavigate()
  const [activeCat, setActiveCat] = useState<number | 'deals' | null>(null)
  const [search, setSearch] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [discOpen, setDiscOpen] = useState(false)
  const [heldCount, setHeldCount] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (settings.data) cart.setServiceCharge(settings.data.serviceChargeMinor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data])

  useEffect(() => {
    if (menu.data && activeCat === null) {
      setActiveCat(menu.data.categories[0]?.id ?? 'deals')
    }
  }, [menu.data, activeCat])

  const refreshHeld = (): void => {
    api.pos
      .heldOrders()
      .then((o) => setHeldCount(o.length))
      .catch(() => setHeldCount(0))
  }
  useEffect(() => {
    if (session) refreshHeld()
  }, [session])

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'F2') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'F9' && cart.lines.length) {
        e.preventDefault()
        setPayOpen(true)
      } else if (e.key === 'F4' && cart.lines.length) {
        e.preventDefault()
        void doHold()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines])

  const doHold = async (): Promise<void> => {
    if (!cart.lines.length) return
    const r = await run(
      () =>
        api.pos.holdOrder({
          lines: cart.lines.map((l) => ({
            kind: l.kind,
            refId: l.refId,
            productPriceId: l.productPriceId,
            quantity: l.quantity,
            note: l.note || undefined
          })),
          orderNote: cart.orderNote || undefined,
          customerName: cart.customerName || undefined,
          heldOrderId: cart.resumingHeldId ?? undefined
        }),
      { success: 'Order held.' }
    )
    if (r) {
      cart.clear()
      refreshHeld()
    }
  }

  if (!session) {
    return (
      <div className="pos">
        <div className="pos__blocker">
          <div className="box">
            <div className="empty-state__mark">◔</div>
            <h3>Start your session</h3>
            <p className="muted">
              Every order belongs to an employee session. Your session stays open until <strong>you</strong> end it —
              it never resets at midnight.
            </p>
            <button
              className="btn btn--primary btn--lg"
              onClick={() => run(() => api.session.open({}), { success: 'Session started.' }).then(() => refresh())}
            >
              Start session
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (menu.loading || !menu.data) return <Loading label="Loading menu…" />

  const { products, deals } = menu.data
  // Deals get their own rail entry below — don't also show an empty "Deals" category.
  const categories = menu.data.categories.filter((c) => c.name.trim().toLowerCase() !== 'deals')
  const showingDeals = activeCat === 'deals'
  const visibleProducts = search.trim()
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.nameUrdu ?? '').includes(search)
      )
    : products.filter((p) => p.categoryId === activeCat)

  return (
    <div className="pos">
      <div className="pos__cats">
        {categories.map((c) => (
          <button
            key={c.id}
            className={`pos__cat ${activeCat === c.id && !search ? 'is-active' : ''}`}
            onClick={() => {
              setActiveCat(c.id)
              setSearch('')
            }}
          >
            <span className="n">{c.name}</span>
            {c.nameUrdu && <span className="u">{c.nameUrdu}</span>}
          </button>
        ))}
        {deals.length > 0 && (
          <button
            className={`pos__cat ${showingDeals && !search ? 'is-active' : ''}`}
            onClick={() => {
              setActiveCat('deals')
              setSearch('')
            }}
          >
            <span className="n">Deals</span>
            <span className="c">{deals.length} available</span>
          </button>
        )}
      </div>

      <div className="pos__menu">
        <div className="pos__search">
          <input
            ref={searchRef}
            className="input"
            placeholder="Search menu…  (F2)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search.trim() ? (
          <ProductGrid products={visibleProducts} onPick={(p, priceId) => addProduct(cart, p, priceId)} />
        ) : showingDeals ? (
          <DealGrid deals={deals} onPick={(d) => cart.addDeal(d)} />
        ) : (
          <ProductGrid products={visibleProducts} onPick={(p, priceId) => addProduct(cart, p, priceId)} />
        )}
      </div>

      <div className="pos__cart">
        <div className="cart__head">
          <h3>{cart.resumingHeldId ? 'Resumed Order' : 'Current Order'}</h3>
          <div className="cart__head-actions">
            <button className="btn btn--sm" onClick={() => setHeldOpen(true)} title="View held orders">
              Held {heldCount > 0 && <span className="chip chip--accent">{heldCount}</span>}
            </button>
            {cart.lines.length > 0 && (
              <button
                className="btn btn--sm btn--danger"
                onClick={() => cart.clear()}
                title="Remove every item from this order"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="cart__lines">
          {cart.lines.length === 0 ? (
            <EmptyState title="No items yet" hint="Tap products to build the order" />
          ) : (
            cart.lines.map((l) => (
              <CartLineRow key={l.key} lineKey={l.key} />
            ))
          )}
        </div>

        {/*
          The footer is split deliberately: `cart__summary` may scroll if the
          pane gets very short, but `cart__actions` never does — Hold and
          Payment are always on screen, at any window size.
        */}
        <div className="cart__foot">
          <div className="cart__summary">
            <div className="form-row">
              <input
                className="input"
                placeholder="Customer name (optional)"
                value={cart.customerName}
                onChange={(e) => cart.setCustomerName(e.target.value)}
              />
              <input
                className="input"
                placeholder="Order note (optional)"
                value={cart.orderNote}
                onChange={(e) => cart.setOrderNote(e.target.value)}
              />
            </div>
            <div className="cart__totrow">
              <span>Subtotal</span>
              <Money minor={cart.subtotal()} />
            </div>
            <div className="cart__totrow">
              <button
                className={`btn btn--sm ${cart.discountMinor > 0 ? 'is-on' : ''}`}
                onClick={() => setDiscOpen(true)}
                title={cart.discountMinor > 0 ? `Discount: ${cart.discountReason}` : 'Apply a discount to this order'}
              >
                {cart.discountMinor > 0 ? `Discount · ${cart.discountReason}` : '＋ Add discount'}
              </button>
              <Money minor={-cart.discountMinor} sign />
            </div>
            {cart.serviceCharge() > 0 && (
              <div className="cart__totrow">
                <span>Service Charges</span>
                <Money minor={cart.serviceCharge()} />
              </div>
            )}
          </div>
          <div className="cart__totrow grand">
            <span>Total</span>
            <Money minor={cart.total()} />
          </div>
          <div className="cart__actions">
            <button className="btn" disabled={!cart.lines.length} onClick={doHold}>
              Hold <span className="muted">F4</span>
            </button>
            <button
              className="btn btn--primary"
              disabled={!cart.lines.length}
              onClick={() => setPayOpen(true)}
            >
              Payment <span style={{ opacity: 0.6 }}>F9</span>
            </button>
          </div>
        </div>
      </div>

      {payOpen && (
        <PaymentModal
          onClose={() => setPayOpen(false)}
          onDone={() => {
            setPayOpen(false)
            refreshHeld()
            void refresh()
          }}
        />
      )}
      {heldOpen && (
        <HeldOrdersModal
          onClose={() => setHeldOpen(false)}
          onResumed={() => {
            setHeldOpen(false)
            refreshHeld()
          }}
          onChanged={refreshHeld}
        />
      )}
      {discOpen && <DiscountModal onClose={() => setDiscOpen(false)} />}
      <PosHelpFooter navigateSession={() => navigate('/my-session')} />
    </div>
  )
}

function addProduct(cart: ReturnType<typeof useCart.getState>, p: Product, priceId?: number): void {
  const price = priceId ? p.prices.find((x) => x.id === priceId) : p.prices[0]
  if (!price) {
    toast.error('No price configured for this item.')
    return
  }
  cart.addProduct(p, price)
}

function ProductGrid({
  products,
  onPick
}: {
  products: Product[]
  onPick: (p: Product, priceId?: number) => void
}): JSX.Element {
  if (products.length === 0) return <EmptyState title="Nothing here" hint="No products match" />
  return (
    <div className="pos__grid">
      {products.map((p) => (
        <div className="tile" key={p.id}>
          {p.isPopular && <span className="tile__badge" title="Popular item">★</span>}
          <MenuThumb src={p.imageUrl} name={p.name} className="tile__thumb" />
          <div className="tile__body">
            <div className="tile__name">{p.name}</div>
            {p.nameUrdu && <div className="tile__urdu">{p.nameUrdu}</div>}
          </div>
          {p.prices.length <= 1 ? (
            <button
              className="tile__foot"
              onClick={() => onPick(p)}
              style={{ width: '100%' }}
              title={`Add ${p.name} to the order`}
              aria-label={`Add ${p.name} to the order`}
            >
              <span className="tile__price">{formatMoney(p.prices[0]?.priceMinor ?? 0)}</span>
              <span className="tile__add" aria-hidden>
                ＋
              </span>
            </button>
          ) : (
            <div className="tile__variants">
              {p.prices.map((pr) => (
                <button
                  key={pr.id}
                  className="tile__pill"
                  onClick={() => onPick(p, pr.id)}
                  title={`Add ${p.name} (${pr.label}) to the order`}
                  aria-label={`Add ${p.name}, ${pr.label}, to the order`}
                >
                  {/* label above price: a four-figure amount would otherwise
                      wrap and make one pill taller than the others */}
                  <span className="tile__pill-label">{pr.label}</span>
                  <span className="tile__pill-price">{formatMoney(pr.priceMinor, { withSymbol: false })}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function DealGrid({ deals, onPick }: { deals: Deal[]; onPick: (d: Deal) => void }): JSX.Element {
  return (
    <div className="pos__grid">
      {deals.map((d) => (
        <button
          className="tile tile--deal"
          key={d.id}
          onClick={() => onPick(d)}
          title={`Add ${d.name} to the order`}
          aria-label={`Add ${d.name} to the order`}
        >
          <MenuThumb src={d.imageUrl} name={d.name} className="tile__thumb" />
          <div className="tile__body">
            <div className="tile__name">{d.name}</div>
            {d.nameUrdu && <div className="tile__urdu">{d.nameUrdu}</div>}
          </div>
          <div className="tile__foot">
            <span className="tile__price">{formatMoney(d.priceMinor)}</span>
            <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
              {d.items.length} items
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

function CartLineRow({ lineKey }: { lineKey: string }): JSX.Element {
  const cart = useCart()
  const line = cart.lines.find((l) => l.key === lineKey)
  const [noteOpen, setNoteOpen] = useState(!!line?.note)
  if (!line) return <></>
  return (
    <div className="cart__line">
      {/* big −  qty  + stepper: the most-used control in the whole app */}
      <div className="stepper">
        <button
          type="button"
          className="stepper__btn"
          onClick={() => cart.bump(line.key, -1)}
          aria-label={`Decrease quantity of ${line.name}`}
          title="Decrease quantity"
        >
          −
        </button>
        <span className="stepper__value" aria-live="polite">
          {line.quantity}
        </span>
        <button
          type="button"
          className="stepper__btn"
          onClick={() => cart.bump(line.key, 1)}
          aria-label={`Increase quantity of ${line.name}`}
          title="Increase quantity"
        >
          +
        </button>
      </div>
      <div className="cart__line-info">
        <div className="nm">{line.name}</div>
        {line.variantLabel && <div className="vt">{line.variantLabel}</div>}
      </div>
      <div className="amt">{formatMoney(line.unitPriceMinor * line.quantity, { withSymbol: false })}</div>
      {/* deliberately separated from the stepper so Remove is never mis-hit */}
      <div className="cart__line-tools">
        <button
          type="button"
          className={`btn btn--icon btn--sm ${line.note ? 'is-on' : ''}`}
          onClick={() => setNoteOpen((v) => !v)}
          aria-label={`Add a note to ${line.name}`}
          title={line.note ? `Note: ${line.note}` : 'Add a note'}
        >
          ✎
        </button>
        <button
          type="button"
          className="btn btn--icon btn--sm btn--danger"
          onClick={() => cart.remove(line.key)}
          aria-label={`Remove ${line.name} from the order`}
          title="Remove this item"
        >
          ✕
        </button>
      </div>
      {noteOpen && (
        <input
          className="input note-in"
          placeholder="e.g. no chili, extra raita"
          value={line.note}
          onChange={(e) => cart.setNote(line.key, e.target.value)}
          aria-label={`Note for ${line.name}`}
        />
      )}
    </div>
  )
}

function PosHelpFooter({ navigateSession }: { navigateSession: () => void }): JSX.Element {
  return useMemo(
    () => (
      <div className="pos__help">
        <span>
          <kbd>F2</kbd> Search menu
        </span>
        <span>
          <kbd>F4</kbd> Hold order
        </span>
        <span>
          <kbd>F9</kbd> Take payment
        </span>
        <button
          className="btn btn--sm"
          style={{ marginLeft: 'auto' }}
          onClick={navigateSession}
          title="Open your session summary"
        >
          My session
        </button>
      </div>
    ),
    [navigateSession]
  )
}
