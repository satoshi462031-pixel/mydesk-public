export interface UsageRow {
  allowed: boolean
  msg_count: number
  photo_count: number
  msg_limit: number
  photo_limit: number
}

export type UsageKind = 'photo' | 'msg'

export type UsageReservation =
  | { allowed: true; usage: UsageRow; consumedKinds: UsageKind[] }
  | { allowed: false; deniedKind: UsageKind; usage: UsageRow; consumedKinds: [] }

export async function reserveUsage(
  hasImage: boolean,
  consume: (kind: UsageKind) => Promise<UsageRow>,
  refund: (kind: UsageKind) => Promise<void>,
): Promise<UsageReservation> {
  const consumedKinds: UsageKind[] = []
  try {
    if (hasImage) {
      const photoUsage = await consume('photo')
      if (!photoUsage.allowed) return { allowed: false, deniedKind: 'photo', usage: photoUsage, consumedKinds: [] }
      consumedKinds.push('photo')
    }

    const messageUsage = await consume('msg')
    if (!messageUsage.allowed) {
      await Promise.all(consumedKinds.map(refund))
      const usageAfterRefund = consumedKinds.includes('photo')
        ? { ...messageUsage, photo_count: Math.max(0, messageUsage.photo_count - 1) }
        : messageUsage
      return { allowed: false, deniedKind: 'msg', usage: usageAfterRefund, consumedKinds: [] }
    }
    consumedKinds.push('msg')
    return { allowed: true, usage: messageUsage, consumedKinds }
  } catch (error) {
    await Promise.all(consumedKinds.map(refund))
    throw error
  }
}

/** 返金したぶんを差し引いた行。返金前の行を返すと、使っていない回がアプリの残り回数から減って見える */
export function usageWithoutKinds(usage: UsageRow, kinds: UsageKind[]): UsageRow {
  return {
    ...usage,
    msg_count: Math.max(0, usage.msg_count - (kinds.includes('msg') ? 1 : 0)),
    photo_count: Math.max(0, usage.photo_count - (kinds.includes('photo') ? 1 : 0)),
  }
}

export async function refundUsage(
  kinds: UsageKind[],
  refund: (kind: UsageKind) => Promise<void>,
): Promise<void> {
  await Promise.all(kinds.map(refund))
}
