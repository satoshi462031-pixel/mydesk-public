import type { Gadget, WiringResult } from '../types'

/** デモやテンプレートの空枠ではなく、本人の機器から成果が出た場合だけActivationとする。 */
export function isPersonalizedResult(gadgets: Gadget[], result: WiringResult | undefined): boolean {
  const actual = gadgets.filter((gadget) => !gadget.isPlaceholder)
  if (actual.length < 2 || !result) return false
  return result.connections.length > 0
    || result.requiredCables.length > 0
    || result.warnings.length > 0
    || actual.some((gadget) => gadget.portsNeedConfirmation || gadget.ports.length === 0)
}
