import { useCallback, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../../context/AppContext'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import {
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  PLAYBACK_SPEED_STEP,
  PLAYBACK_SPEEDS,
  PlaybackSpeed,
} from '../../hooks/useHistoryPlayback'
import { AppIcon } from '../atoms/AppIcon'
import { hapticSelection } from '../../utils/haptics'

interface Props {
  value: PlaybackSpeed
  onChange: (speed: PlaybackSpeed) => void
}

const THUMB_SIZE = 20
const clampSpeed = (value: number): PlaybackSpeed => Number(Math.max(
  MIN_PLAYBACK_SPEED,
  Math.min(MAX_PLAYBACK_SPEED, Math.round(value / PLAYBACK_SPEED_STEP) * PLAYBACK_SPEED_STEP),
).toFixed(2))

export function PlaybackSpeedControl({ value, onChange }: Props) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  const [draft, setDraft] = useState<PlaybackSpeed | null>(null)
  const [width, setWidth] = useState(0)
  const speed = draft ?? value
  const latest = useRef({ value, onChange, width })
  latest.current = { value, onChange, width }
  const startX = useRef(0)
  const draftRef = useRef<PlaybackSpeed | null>(null)
  const chooseSpeed = useCallback((next: PlaybackSpeed) => {
    if (next !== latest.current.value) hapticSelection()
    latest.current.value = next
    latest.current.onChange(next)
  }, [])

  const responder = useMemo(() => {
    const preview = (x: number) => {
      const trackWidth = latest.current.width - THUMB_SIZE
      if (trackWidth <= 0) return
      const ratio = Math.max(0, Math.min(1, (x - THUMB_SIZE / 2) / trackWidth))
      const next = clampSpeed(MIN_PLAYBACK_SPEED + ratio * (MAX_PLAYBACK_SPEED - MIN_PLAYBACK_SPEED))
      draftRef.current = next
      setDraft(next)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        startX.current = event.nativeEvent.locationX
        preview(startX.current)
      },
      onPanResponderMove: (_event, gesture) => preview(startX.current + gesture.dx),
      onPanResponderRelease: (_event, gesture) => {
        preview(startX.current + gesture.dx)
        const next = draftRef.current
        draftRef.current = null
        setDraft(null)
        // 保存は指を離したときに一度だけ行い、ドラッグ中の書き込みを避ける。
        if (next !== null && next !== latest.current.value) chooseSpeed(next)
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        draftRef.current = null
        setDraft(null)
      },
    })
  }, [chooseSpeed])

  const adjust = (delta: number) => {
    const next = clampSpeed((draftRef.current ?? latest.current.value) + delta)
    if (next !== latest.current.value) chooseSpeed(next)
  }
  const ratio = (speed - MIN_PLAYBACK_SPEED) / (MAX_PLAYBACK_SPEED - MIN_PLAYBACK_SPEED)

  return (
    <View style={styles.control}>
      <Text style={[styles.value, { color: C.text }]}>{speed.toFixed(2)}x</Text>
      <View style={styles.sliderRow}>
        <TouchableOpacity
          style={[styles.stepButton, { backgroundColor: C.chip, opacity: speed <= MIN_PLAYBACK_SPEED ? 0.4 : 1 }]}
          onPress={() => adjust(-PLAYBACK_SPEED_STEP)}
          disabled={speed <= MIN_PLAYBACK_SPEED}
          accessibilityRole="button"
          accessibilityLabel={ja ? '再生速度を下げる' : 'Decrease playback speed'}
          accessibilityState={{ disabled: speed <= MIN_PLAYBACK_SPEED }}
        >
          <AppIcon name={ICONS.subtract} size={28} color={C.text} />
        </TouchableOpacity>
        <View
          style={styles.slider}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          {...responder.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={ja ? '再生速度' : 'Playback speed'}
          accessibilityValue={{ min: MIN_PLAYBACK_SPEED, max: MAX_PLAYBACK_SPEED, now: speed, text: ja ? `${speed.toFixed(2)}倍` : `${speed.toFixed(2)}x` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') adjust(PLAYBACK_SPEED_STEP)
            if (event.nativeEvent.actionName === 'decrement') adjust(-PLAYBACK_SPEED_STEP)
          }}
        >
          <View pointerEvents="none" style={[styles.track, { backgroundColor: C.inputBorder }]}>
            <View style={[styles.fill, { backgroundColor: C.text, width: `${ratio * 100}%` }]} />
          </View>
          <View pointerEvents="none" style={[styles.thumb, { backgroundColor: C.text, left: Math.max(0, width - THUMB_SIZE) * ratio }]} />
        </View>
        <TouchableOpacity
          style={[styles.stepButton, { backgroundColor: C.chip, opacity: speed >= MAX_PLAYBACK_SPEED ? 0.4 : 1 }]}
          onPress={() => adjust(PLAYBACK_SPEED_STEP)}
          disabled={speed >= MAX_PLAYBACK_SPEED}
          accessibilityRole="button"
          accessibilityLabel={ja ? '再生速度を上げる' : 'Increase playback speed'}
          accessibilityState={{ disabled: speed >= MAX_PLAYBACK_SPEED }}
        >
          <AppIcon name={ICONS.add} size={28} color={C.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.presets} accessibilityRole="radiogroup" accessibilityLabel={ja ? '再生速度のプリセット' : 'Playback speed presets'}>
        {PLAYBACK_SPEEDS.map((preset) => {
          const selected = speed === preset
          return (
            <View key={preset} style={styles.presetColumn}>
              <TouchableOpacity
                style={[styles.preset, { backgroundColor: selected ? C.text : C.chip }]}
                onPress={() => chooseSpeed(preset)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={ja ? `${preset}倍${preset === 1 ? '、標準' : ''}` : `${preset}x${preset === 1 ? ', Normal' : ''}`}
              >
                <Text style={[styles.presetText, { color: selected ? C.card : C.text }]} numberOfLines={1}>
                  {Number.isInteger(preset) ? preset.toFixed(1) : preset}
                </Text>
              </TouchableOpacity>
              {preset === 1 && <Text style={[styles.normal, { color: C.textMuted }]}>{ja ? '標準' : 'Normal'}</Text>}
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  control: { gap: 12, paddingTop: 4, paddingBottom: 16 },
  value: { fontSize: 24, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepButton: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.pillRadius, alignItems: 'center', justifyContent: 'center' },
  slider: { flex: 1, height: UI_METRICS.touchMinSize, justifyContent: 'center' },
  track: { height: 3, marginHorizontal: THUMB_SIZE / 2, borderRadius: UI_METRICS.pillRadius, overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: { position: 'absolute', top: (UI_METRICS.touchMinSize - THUMB_SIZE) / 2, width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_SIZE / 2 },
  presets: { flexDirection: 'row', gap: 8, marginTop: 8 },
  presetColumn: { flex: 1, minWidth: 0, alignItems: 'stretch' },
  preset: { minHeight: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.pillRadius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  presetText: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  normal: { fontSize: 11, textAlign: 'center', marginTop: 5 },
})
