import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { freshDb, teardown, actAs } from './helpers'
import { db, schema } from '../src/main/db/connection'
import {
  clearImage,
  imageStamp,
  imageUrlFor,
  hasImage,
  readImage,
  seedBundledImages,
  stageImage,
  storeImage,
  takeStagedImage,
  applyImageWrite,
  imageStorageStats
} from '../src/main/services/images'
import { createProduct, getProduct, updateProduct } from '../src/main/services/menu'

afterEach(teardown)

const png = (tag: number): Buffer => Buffer.from([0x89, 0x50, 0x4e, 0x47, tag, tag, tag, tag])
const enc = (tag: number) => ({ bytes: png(tag), mime: 'image/png', width: 640, height: 480 })

const productId = (name: string): number =>
  db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.name, name)).get()!.id

describe('menu images — storage', () => {
  it('stores bytes in the database and serves them back', () => {
    freshDb()
    actAs('admin')
    const id = productId('Naan')
    storeImage('PRODUCT', id, enc(1))
    const got = readImage('PRODUCT', id)
    expect(got?.mime).toBe('image/png')
    expect(Buffer.from(got!.bytes).equals(png(1))).toBe(true)
  })

  it('keeps one image per owner — a replacement overwrites rather than accumulates', () => {
    freshDb()
    actAs('admin')
    const id = productId('Naan')
    storeImage('PRODUCT', id, enc(1))
    storeImage('PRODUCT', id, enc(2))
    const rows = db.select().from(schema.menuImages).where(eq(schema.menuImages.ownerId, id)).all()
    expect(rows.filter((r) => r.ownerType === 'PRODUCT')).toHaveLength(1)
    expect(Buffer.from(readImage('PRODUCT', id)!.bytes).equals(png(2))).toBe(true)
  })

  it('products and deals with the same id do not collide', () => {
    freshDb()
    actAs('admin')
    storeImage('PRODUCT', 1, enc(1))
    storeImage('DEAL', 1, enc(2))
    expect(Buffer.from(readImage('PRODUCT', 1)!.bytes).equals(png(1))).toBe(true)
    expect(Buffer.from(readImage('DEAL', 1)!.bytes).equals(png(2))).toBe(true)
  })

  it('clearing removes the row and the URL', () => {
    freshDb()
    actAs('admin')
    const id = productId('Naan')
    storeImage('PRODUCT', id, enc(1))
    expect(hasImage('PRODUCT', id)).toBe(true)
    clearImage('PRODUCT', id)
    expect(hasImage('PRODUCT', id)).toBe(false)
    expect(imageUrlFor('PRODUCT', id)).toBeNull()
    expect(readImage('PRODUCT', id)).toBeNull()
  })
})

describe('menu images — cache-busting URL', () => {
  it('is null with no image and carries the version stamp with one', () => {
    freshDb()
    actAs('admin')
    const id = productId('Chai')
    clearImage('PRODUCT', id)
    expect(imageUrlFor('PRODUCT', id)).toBeNull()

    storeImage('PRODUCT', id, enc(1))
    const url = imageUrlFor('PRODUCT', id)!
    expect(url).toContain(`hkd-img://menu/product/${id}`)
    expect(url).toContain(`v=${imageStamp('PRODUCT', id)}`)
  })

  it('changes when the image changes, so a replacement is never served from cache', async () => {
    freshDb()
    actAs('admin')
    const id = productId('Chai')
    storeImage('PRODUCT', id, enc(1))
    const before = imageUrlFor('PRODUCT', id)
    await new Promise((r) => setTimeout(r, 5))
    storeImage('PRODUCT', id, enc(2))
    expect(imageUrlFor('PRODUCT', id)).not.toBe(before)
  })
})

describe('menu images — staging across a create', () => {
  it('a staged image is consumed exactly once', () => {
    freshDb()
    const { stagedImageId } = stageImage(enc(1))
    expect(takeStagedImage(stagedImageId)).not.toBeNull()
    expect(takeStagedImage(stagedImageId)).toBeNull()
  })

  it('attaches to a product created after the photo was picked', () => {
    freshDb()
    actAs('admin')
    const { stagedImageId } = stageImage(enc(7))
    const created = createProduct({
      categoryId: db.select().from(schema.categories).all()[0].id,
      name: 'Test Kabab',
      prices: [{ variant: 'STANDARD', label: 'Standard', priceMinor: 15000 }],
      stagedImageId
    })
    expect(created.imageUrl).toContain(`hkd-img://menu/product/${created.id}`)
    expect(Buffer.from(readImage('PRODUCT', created.id)!.bytes).equals(png(7))).toBe(true)
  })

  it('removeImage on an edit drops the photo and wins over a staged one', () => {
    freshDb()
    actAs('admin')
    const id = productId('Naan')
    storeImage('PRODUCT', id, enc(1))
    const staged = stageImage(enc(2))
    const product = getProduct(id)
    const updated = updateProduct({
      id,
      categoryId: product.categoryId,
      name: product.name,
      prices: product.prices.map((p) => ({ id: p.id, variant: p.variant, label: p.label, priceMinor: p.priceMinor })),
      stagedImageId: staged.stagedImageId,
      removeImage: true
    })
    expect(updated.imageUrl).toBeNull()
  })

  it('a staged id that no longer exists is a clear error, not a silent no-op', () => {
    freshDb()
    actAs('admin')
    expect(() => applyImageWrite('PRODUCT', productId('Naan'), { stagedImageId: 'not-a-real-id' })).toThrow(
      /pick it again/i
    )
  })
})

describe('menu images — bundled photography', () => {
  it('attaches the shipped photos to the seeded menu', () => {
    freshDb()
    actAs('admin')
    const stats = imageStorageStats()
    // The repo ships resources/menu-images; if that folder were ever emptied
    // the app must still work, so this asserts consistency rather than a count.
    if (stats.bundledFiles === 0) {
      expect(stats.count).toBe(0)
      return
    }
    expect(stats.count).toBeGreaterThan(0)
    expect(getProduct(productId('Seekh Kabab')).imageUrl).toBeTruthy()
  })

  it('never overwrites an image already present — a second seed is a no-op', () => {
    freshDb()
    actAs('admin')
    const id = productId('Naan')
    storeImage('PRODUCT', id, enc(9))
    const before = imageStamp('PRODUCT', id)
    seedBundledImages()
    expect(imageStamp('PRODUCT', id)).toBe(before)
    expect(Buffer.from(readImage('PRODUCT', id)!.bytes).equals(png(9))).toBe(true)
  })
})
