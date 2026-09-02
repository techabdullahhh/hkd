/**
 * The restaurant's bilingual identity lockup — Urdu Nastaliq as the hero,
 * the English wordmark beneath a saffron hairline, and the HKD monogram.
 * Used on the auth screens.
 */
export function Brandmark(): JSX.Element {
  return (
    <div className="brandmark" aria-label="Hashmi Ka Dera — HKD">
      <div className="brandmark__ur" lang="ur">
        ہاشمی کا ڈیرہ
      </div>
      <div className="brandmark__rule">
        <span>✦</span>
      </div>
      <div className="brandmark__en">
        Hashmi&nbsp;Ka&nbsp;Dera&nbsp;<em>—&nbsp;HKD</em>
      </div>
      <div className="brandmark__mono">
        <span>Restaurant · Lahore</span>
      </div>
    </div>
  )
}
