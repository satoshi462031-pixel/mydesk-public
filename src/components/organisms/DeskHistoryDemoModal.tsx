import { useMemo } from 'react'
import { getDeskHistoryDemo } from '../../constants/deskHistoryDemo'
import { DeskHistoryAnimationModal } from './DeskHistoryAnimationModal'

export function DeskHistoryDemoModal({ lang, onClose }: { lang: 'ja' | 'en'; onClose: () => void }) {
  const { plan, gadgets } = useMemo(() => getDeskHistoryDemo(lang), [lang])
  return <DeskHistoryAnimationModal visible plan={plan} gadgets={gadgets} lang={lang} yearsLimit={-1} onRequirePro={() => {}} onClose={onClose} />
}
