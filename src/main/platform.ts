/**
 * Which machine are we actually on?
 *
 * Chrome OS runs desktop Linux apps inside a container (Crostini) whose
 * graphics reach the screen through a Wayland bridge rather than a normal
 * GPU stack. Electron's defaults assume the latter, so on Chrome OS the
 * window can come up black, blank, or not at all. Detecting the container
 * lets those few defaults be relaxed — but only there, so a real Linux PC
 * keeps full hardware acceleration.
 *
 * Getting the detection wrong is not a cosmetic matter: when it returns false
 * on a Chromebook the app simply does not open, and the only clue is an
 * `XGetWindowAttributes failed` line in a terminal the user has no reason to
 * be looking at.
 */

import { existsSync } from 'fs'
import { hostname } from 'os'

/**
 * Crostini leaves several unmistakable marks. Any one is enough; checking
 * several means a Chrome OS update that drops one of them does not silently
 * turn the detection off.
 */
export function isChromeOsContainer(): boolean {
  if (process.platform !== 'linux') return false
  return (
    // Written by Chrome OS into every container it starts.
    existsSync('/dev/.cros_milestone') ||
    // Chrome OS's own integration tooling, installed in every Crostini
    // container. The most dependable marker of the three paths here.
    existsSync('/opt/google/cros-containers') ||
    // The Wayland bridge Chrome OS runs for Linux apps.
    !!process.env.SOMMELIER_VERSION ||
    // Crostini's shared-folder mount point.
    existsSync('/mnt/chromeos') ||
    /*
     * The container's conventional hostname.
     *
     * Read through os.hostname(), NOT process.env.HOSTNAME: bash sets HOSTNAME
     * as a shell variable and does not export it, so a launched program sees
     * nothing — the env check silently never matched on a real Chromebook
     * called exactly that.
     */
    hostname() === 'penguin'
  )
}
