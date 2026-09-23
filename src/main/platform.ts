/**
 * Which machine are we actually on?
 *
 * Chrome OS runs desktop Linux apps inside a container (Crostini) whose
 * graphics reach the screen through a Wayland bridge rather than a normal
 * GPU stack. Electron's defaults assume the latter, so on Chrome OS the
 * window can come up black, blank or badly torn. Detecting the container
 * lets those few defaults be relaxed — but only there, so a real Linux PC
 * keeps full hardware acceleration.
 */

import { existsSync } from 'fs'

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
    // The Wayland bridge Chrome OS runs for Linux apps.
    !!process.env.SOMMELIER_VERSION ||
    // Crostini's shared-folder mount point.
    existsSync('/mnt/chromeos') ||
    // The container's conventional hostname.
    process.env.HOSTNAME === 'penguin'
  )
}
