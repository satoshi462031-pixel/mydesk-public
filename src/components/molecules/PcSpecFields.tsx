// PC の詳細スペック（PCタイプ・Thunderbolt 対応と CPU/GPU/メモリ/ストレージ）。
// 詳細（GadgetDetailScreen）で使う。
// 畳んだ状態から始めるのは、PC を1台足すたびに4つの入力欄を見せると手が止まるため。
import { ReactNode, useRef } from 'react'
import { LayoutAnimation, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { PcPartProductField } from './PcPartProductField'
import { ToggleRow } from './GadgetFormRows'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppColors, useApp } from '../../context/AppContext'

interface Props {
  expanded: boolean
  onExpanded: (v: boolean) => void
  thunderbolt: boolean
  onThunderbolt: (v: boolean) => void
  cpu: string
  cpuProductId?: string
  onCpu: (v: string) => void
  onCpuProductId: (v?: string) => void
  gpu: string
  gpuProductId?: string
  onGpu: (v: string) => void
  onGpuProductId: (v?: string) => void
  ram: string
  ramProductId?: string
  onRam: (v: string) => void
  onRamProductId: (v?: string) => void
  storage: string
  storageProductId?: string
  onStorage: (v: string) => void
  onStorageProductId: (v?: string) => void
  colors: AppColors
  lang: 'ja' | 'en'
  /** 開いた中の先頭に置く欄（PCタイプ）。給電の既定を変えるので画面側が持つ */
  children?: ReactNode
}

export function PcSpecFields({
  expanded, onExpanded, thunderbolt, onThunderbolt,
  cpu, cpuProductId, onCpu, onCpuProductId,
  gpu, gpuProductId, onGpu, onGpuProductId,
  ram, ramProductId, onRam, onRamProductId,
  storage, storageProductId, onStorage, onStorageProductId,
  colors: C, lang, children,
}: Props) {
  const { reduceMotion } = useApp()
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  return (
    <>
      <TouchableOpacity
        style={[styles.pcDetailToggle, { borderColor: C.border }]}
        onPress={() => {
          if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
          expandedRef.current = !expandedRef.current
          onExpanded(expandedRef.current)
        }}
      >
        <Text style={[styles.pcDetailToggleText, { color: C.textSub }]}>{lang === 'en' ? 'Set Detailed Specs' : '詳細スペックを設定'}</Text>
        <AppIcon name={expanded ? ICONS.chevronUp : ICONS.chevronDown} size={16} color={C.textMuted} />
      </TouchableOpacity>
      {expanded && (
        <>
          {children}
          <ToggleRow
            label={lang === 'en' ? 'Thunderbolt support' : 'Thunderbolt対応'}
            value={thunderbolt}
            onChange={onThunderbolt}
            colors={C}
          />
          <PcPartProductField
            label="CPU"
            productCategory="PCPartCPU"
            placeholder="e.g. Apple M4 Pro / Core i9-14900K"
            value={cpu}
            productId={cpuProductId}
            onChange={onCpu}
            onProductIdChange={onCpuProductId}
          />
          <PcPartProductField
            label={lang === 'en' ? 'Graphics (GPU)' : 'グラフィックス (GPU)'}
            productCategory="PCPartGPU"
            placeholder={lang === 'en' ? 'e.g. RTX 4090 / Integrated GPU' : '例：RTX 4090 / 内蔵GPU'}
            value={gpu}
            productId={gpuProductId}
            onChange={onGpu}
            onProductIdChange={onGpuProductId}
          />
          <PcPartProductField
            label={lang === 'en' ? 'Memory (RAM)' : 'メモリ (RAM)'}
            productCategory="PCPartMemory"
            placeholder="e.g. 32GB"
            value={ram}
            productId={ramProductId}
            onChange={onRam}
            onProductIdChange={onRamProductId}
          />
          <PcPartProductField
            label={lang === 'en' ? 'Storage' : 'ストレージ'}
            productCategory="PCPartStorage"
            placeholder="e.g. 1TB SSD"
            value={storage}
            productId={storageProductId}
            onChange={onStorage}
            onProductIdChange={onStorageProductId}
          />
        </>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  pcDetailToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: UI_METRICS.controlRadius, paddingVertical: 10, paddingHorizontal: 14, marginTop: 4 },
  pcDetailToggleText: { fontSize: 13, fontWeight: '500' },
})
