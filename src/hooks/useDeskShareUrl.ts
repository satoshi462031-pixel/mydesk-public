import { useEffect, useState } from 'react'
import { buildPublicUrl } from '../constants/plans'
import { getDeskShareIdentifier } from '../services/deskShareLinks'
import { Desk } from '../supabase/types'

export function useDeskShareUrl(
  deskId: string | null,
  visibility: Desk['visibility'] | null | undefined,
  ownerTag?: string | null,
  active = true,
): string {
  const [link, setLink] = useState<{ deskId: string; identifier: string } | null>(null)
  useEffect(() => {
    let current = true
    setLink(null)
    if (active && deskId && visibility === 'unlisted') {
      void getDeskShareIdentifier(deskId).then((identifier) => {
        if (current) setLink({ deskId, identifier })
      }).catch(() => {})
    }
    return () => { current = false }
  }, [active, deskId, visibility])
  if (!deskId || !active) return ''
  if (visibility === 'public') return buildPublicUrl(deskId, ownerTag)
  if (visibility === 'unlisted' && link?.deskId === deskId) return buildPublicUrl(link.identifier, ownerTag)
  return ''
}
