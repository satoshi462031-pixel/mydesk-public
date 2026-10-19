import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'

export interface AvatarCropRect {
  originX: number
  originY: number
  width: number
  height: number
}

interface Props {
  visible: boolean
  uri: string | null
  imageWidth: number
  imageHeight: number
  processing: boolean
  onCancel: () => void
  onConfirm: (crop: AvatarCropRect) => void
}

interface Transform {
  zoom: number
  x: number
  y: number
}

interface TouchPoint {
  x: number
  y: number
  distance: number | null
}

const MIN_ZOOM = 1
const MAX_ZOOM = 5
const ZOOM_STEP = 0.25
const ZOOM_DISABLED_COLOR = '#666666'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function touchPoint(touches: readonly { locationX: number; locationY: number }[]): TouchPoint | null {
  if (touches.length === 0) return null
  if (touches.length === 1) {
    return { x: touches[0].locationX, y: touches[0].locationY, distance: null }
  }
  const a = touches[0]
  const b = touches[1]
  const dx = b.locationX - a.locationX
  const dy = b.locationY - a.locationY
  return {
    x: (a.locationX + b.locationX) / 2,
    y: (a.locationY + b.locationY) / 2,
    distance: Math.hypot(dx, dy),
  }
}

export function AvatarCropModal({
  visible,
  uri,
  imageWidth,
  imageHeight,
  processing,
  onCancel,
  onConfirm,
}: Props) {
  const { colors: C, lang, reduceMotion } = useApp()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const ja = lang === 'ja'
  const cropSize = Math.max(220, Math.min(windowWidth - 40, windowHeight - 260, 360))
  const baseScale = imageWidth > 0 && imageHeight > 0
    ? Math.max(cropSize / imageWidth, cropSize / imageHeight)
    : 1
  const baseWidth = imageWidth * baseScale
  const baseHeight = imageHeight * baseScale
  const [transform, setTransform] = useState<Transform>({ zoom: 1, x: 0, y: 0 })
  const transformRef = useRef(transform)
  const previousTouchRef = useRef<TouchPoint | null>(null)

  const commitTransform = (next: Transform) => {
    const zoom = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM)
    const maxX = Math.max(0, (baseWidth * zoom - cropSize) / 2)
    const maxY = Math.max(0, (baseHeight * zoom - cropSize) / 2)
    const clamped = {
      zoom,
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    }
    transformRef.current = clamped
    setTransform(clamped)
  }

  useEffect(() => {
    if (!visible) return
    const initial = { zoom: 1, x: 0, y: 0 }
    transformRef.current = initial
    previousTouchRef.current = null
    setTransform(initial)
  }, [uri, visible])

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !processing,
    onMoveShouldSetPanResponder: () => !processing,
    onPanResponderGrant: (event) => {
      previousTouchRef.current = touchPoint(event.nativeEvent.touches)
    },
    onPanResponderMove: (event) => {
      const currentTouch = touchPoint(event.nativeEvent.touches)
      const previousTouch = previousTouchRef.current
      previousTouchRef.current = currentTouch
      if (!currentTouch || !previousTouch) return

      const current = transformRef.current
      const dx = currentTouch.x - previousTouch.x
      const dy = currentTouch.y - previousTouch.y
      if (currentTouch.distance != null && previousTouch.distance != null && previousTouch.distance > 0) {
        const zoom = clamp(current.zoom * (currentTouch.distance / previousTouch.distance), MIN_ZOOM, MAX_ZOOM)
        const ratio = zoom / current.zoom
        const focusX = previousTouch.x - cropSize / 2
        const focusY = previousTouch.y - cropSize / 2
        commitTransform({
          zoom,
          x: focusX + dx - (focusX - current.x) * ratio,
          y: focusY + dy - (focusY - current.y) * ratio,
        })
        return
      }
      if (currentTouch.distance == null && previousTouch.distance == null) {
        commitTransform({ ...current, x: current.x + dx, y: current.y + dy })
      }
    },
    onPanResponderRelease: () => { previousTouchRef.current = null },
    onPanResponderTerminate: () => { previousTouchRef.current = null },
  }), [cropSize, processing, baseWidth, baseHeight]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeZoom = (delta: number) => {
    const current = transformRef.current
    commitTransform({ ...current, zoom: current.zoom + delta })
  }
  const zoomOutDisabled = processing || transform.zoom <= MIN_ZOOM
  const zoomInDisabled = processing || transform.zoom >= MAX_ZOOM

  const confirm = () => {
    if (!uri || imageWidth <= 0 || imageHeight <= 0 || processing) return
    const current = transformRef.current
    const renderedScale = baseScale * current.zoom
    const width = Math.min(imageWidth, Math.max(1, Math.round(cropSize / renderedScale)))
    const height = Math.min(imageHeight, Math.max(1, Math.round(cropSize / renderedScale)))
    const originX = clamp(
      Math.round((imageWidth - width) / 2 - current.x / renderedScale),
      0,
      imageWidth - width,
    )
    const originY = clamp(
      Math.round((imageHeight - height) / 2 - current.y / renderedScale),
      0,
      imageHeight - height,
    )
    onConfirm({ originX, originY, width, height })
  }

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} presentationStyle="fullScreen" onRequestClose={processing ? undefined : onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} disabled={processing} hitSlop={10}>
            <Text style={[styles.headerAction, { opacity: processing ? 0.4 : 1 }]}>{ja ? 'キャンセル' : 'Cancel'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{ja ? '表示範囲を調整' : 'Adjust photo'}</Text>
          <TouchableOpacity onPress={confirm} disabled={processing} hitSlop={10}>
            <Text style={[styles.headerAction, styles.confirm, { color: C.accentTextOnDark, opacity: processing ? 0.4 : 1 }]}>
              {ja ? '決定' : 'Done'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.help}>{ja ? 'ドラッグで位置、ピンチで大きさを調整' : 'Drag to move and pinch to zoom'}</Text>
          <View
            style={[styles.crop, { width: cropSize, height: cropSize, borderRadius: cropSize / 2 }]}
            {...panResponder.panHandlers}
          >
            {!!uri && imageWidth > 0 && imageHeight > 0 && (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Image
                  source={{ uri }}
                  style={{
                    position: 'absolute',
                    width: baseWidth * transform.zoom,
                    height: baseHeight * transform.zoom,
                    left: (cropSize - baseWidth * transform.zoom) / 2 + transform.x,
                    top: (cropSize - baseHeight * transform.zoom) / 2 + transform.y,
                  }}
                  resizeMode="stretch"
                  fadeDuration={0}
                />
              </View>
            )}
            {processing && (
              <View style={[StyleSheet.absoluteFill, styles.processing]}>
                <ActivityIndicator size="large" color="#FFFFFF" />
              </View>
            )}
          </View>

          <View style={styles.zoomControls}>
            {/* 端まで来たら字を落とす。押しても変わらないボタンが同じ白のままだと、壊れたように見える */}
            <IconCircleButton
              name={ICONS.subtract}
              diameter={44}
              size={24}
              color={zoomOutDisabled ? ZOOM_DISABLED_COLOR : '#FFFFFF'}
              background="#242424"
              onPress={() => changeZoom(-ZOOM_STEP)}
              disabled={zoomOutDisabled}
              accessibilityLabel={ja ? '縮小' : 'Zoom out'}
            />
            <View style={styles.zoomTrack}>
              <View style={[styles.zoomFill, { width: `${((transform.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%`, backgroundColor: C.accentTextOnDark }]} />
            </View>
            <IconCircleButton
              name={ICONS.add}
              diameter={44}
              size={24}
              color={zoomInDisabled ? ZOOM_DISABLED_COLOR : '#FFFFFF'}
              background="#242424"
              onPress={() => changeZoom(ZOOM_STEP)}
              disabled={zoomInDisabled}
              accessibilityLabel={ja ? '拡大' : 'Zoom in'}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerAction: { minWidth: 72, color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  confirm: { textAlign: 'right' },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 48 },
  help: { color: '#BDBDBD', fontSize: 13, marginBottom: 24 },
  crop: { overflow: 'hidden', backgroundColor: '#111111', borderWidth: 1, borderColor: '#FFFFFF' },
  processing: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000088' },
  zoomControls: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 28 },
  zoomTrack: { width: 140, height: 3, overflow: 'hidden', borderRadius: 2, backgroundColor: '#555555' },
  zoomFill: { height: '100%' },
})
