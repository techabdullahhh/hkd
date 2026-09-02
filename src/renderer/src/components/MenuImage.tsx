import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { toast } from '../store/toast'
import { ApiCallError } from '../lib/api'

/**
 * Menu photography in the renderer.
 *
 * Images arrive as `hkd-img://` URLs (see main/services/images.ts) so the
 * browser fetches and caches them itself. An item without a photo gets a
 * drawn placeholder — never a broken-image icon, and never an empty gap that
 * makes the grid look misaligned.
 */

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/)
  if (words.length === 0) return '•'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Neutral line-art serving plate. Deliberately quiet — it must not compete
 *  with the real photographs sitting next to it in the same grid. */
function PlateMark(): JSX.Element {
  return (
    <svg className="thumb__mark" viewBox="0 0 48 34" aria-hidden focusable="false">
      <path d="M4 24h40" />
      <path d="M8 24a16 10 0 0 1 32 0" />
      <path d="M24 8v-3" />
      <path d="M17 11c0-2 1.4-3 1.4-4.6S17 3.5 17 2" />
      <path d="M31 11c0-2-1.4-3-1.4-4.6S31 3.5 31 2" />
      <path d="M2 28h44" />
    </svg>
  )
}

export function MenuThumb({
  src,
  name,
  className = ''
}: {
  src: string | null
  name: string
  className?: string
}): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
    return (
      <div className={`thumb thumb--empty ${className}`} role="img" aria-label={`${name} — no photo yet`}>
        <PlateMark />
        <span className="thumb__initials">{initials(name)}</span>
      </div>
    )
  }
  return (
    <div className={`thumb ${className}`}>
      {/* alt is empty on purpose: the item name is right beside it, so a
          screen reader would otherwise read the dish twice. */}
      <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
    </div>
  )
}

export interface StagedImage {
  stagedImageId: string
  previewDataUrl: string
  byteSize: number
}

/**
 * The admin-side control. Picking happens in the main process (native file
 * dialog + downscale), so the renderer only ever holds a small preview and a
 * token that the following save consumes.
 */
export function ImageField({
  name,
  currentUrl,
  staged,
  removed,
  onStaged,
  onRemovedChange
}: {
  name: string
  currentUrl: string | null
  staged: StagedImage | null
  removed: boolean
  onStaged: (s: StagedImage | null) => void
  onRemovedChange: (v: boolean) => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const shown = staged ? staged.previewDataUrl : removed ? null : currentUrl
  const hasSomething = !!shown

  const pick = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.menu.imagePick()
      if (r) {
        onStaged(r)
        onRemovedChange(false)
      }
    } catch (e) {
      toast.error(e instanceof ApiCallError ? e.message : 'That image could not be used.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <label>Photo</label>
      <div className="imgfield">
        <MenuThumb src={shown} name={name || 'New item'} className="imgfield__preview" />
        <div className="imgfield__side">
          <button type="button" className="btn btn--lg" onClick={pick} disabled={busy}>
            {busy ? 'Opening…' : hasSomething ? 'Replace photo…' : 'Upload photo…'}
          </button>
          {hasSomething && (
            <button
              type="button"
              className="btn btn--lg btn--danger"
              title={`Remove the photo for ${name || 'this item'}`}
              onClick={() => {
                onStaged(null)
                onRemovedChange(true)
              }}
            >
              Remove photo
            </button>
          )}
          <p className="imgfield__hint">
            JPG or PNG. Photos are cropped to 4:3 and shrunk to 640×480 automatically, so a large
            phone photo is fine — it is stored at roughly 40&nbsp;KB.
            {staged && <> Saved when you press Save.</>}
          </p>
        </div>
      </div>
    </div>
  )
}
