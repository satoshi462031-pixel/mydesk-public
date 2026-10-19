import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

function localToday(): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

export function useToday(): Date {
  const [today, setToday] = useState(localToday)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      const now = new Date()
      const day = localToday()
      setToday((previous) => previous.getTime() === day.getTime() ? previous : day)
      const midnight = new Date(now)
      midnight.setHours(24, 0, 0, 0)
      clearTimeout(timer)
      timer = setTimeout(refresh, midnight.getTime() - now.getTime())
    }
    refresh()
    // バックグラウンドではタイマーが止まるため、復帰時にも日付を読み直す。
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    return () => {
      clearTimeout(timer)
      subscription.remove()
    }
  }, [])

  return today
}
