// @ID の入力欄。登録直後のプロフィール設定（PublicTagSetupModal）と、
// プロフィール編集シート（ProfileEditSheet）で共用する。
//
// 空き状況の先出しと、重なったときの代案をここに持つ。2か所で別々に書いていた間は
// 「このIDは使われています」と言うだけで、何を打てば通るかを当てずっぽうで試すしかなかった。
// 代案は元の綴りを残した候補のうち、空いているものだけを出す（押したら使われていた、を避ける）。
import { RefObject, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { statusTextColor, UI_METRICS } from '../../constants/ui'
import { TextField } from '../atoms/TextField'
import { AppColors, useApp } from '../../context/AppContext'
import { findAvailablePublicTags, isPublicTagAvailable } from '../../services/profiles'
import {
  findPublicTagIssue,
  normalizePublicTag,
  PublicTagIssue,
  publicTagIssueMessage,
  publicTagKey,
  publicTagSuggestions,
  PUBLIC_TAG_MAX_LENGTH,
} from '../../utils/publicTag'

interface Props {
  value: string
  /** 印（@ / #）と使えない文字を落とした値で呼ぶ */
  onChangeText: (tag: string) => void
  colors: AppColors
  lang: 'ja' | 'en'
  /** 保存で返った理由。呼び出し側は入力が変わったら null に戻す */
  issue: PublicTagIssue | null
  /** issue で表せない失敗（不適切な語・通信）の文言 */
  errorMessage?: string | null
  /** いま自分が持っている @ID。開いただけで「使えます」と出さない */
  currentTag?: string | null
  /** 綴りから何も残らないとき（日本語の名前など）に代案の元にする */
  name?: string
  busy?: boolean
  /** 状況が何も無いときに出す説明 */
  hint: string
  placeholder?: string
  inputRef?: RefObject<TextInput | null>
  onSubmitEditing?: () => void
}

export function PublicTagField({
  value,
  onChangeText,
  colors: C,
  lang,
  issue,
  errorMessage,
  currentTag,
  name = '',
  busy = false,
  hint,
  placeholder,
  inputRef,
  onSubmitEditing,
}: Props) {
  const { isDark } = useApp()
  const ja = lang === 'ja'
  // 空き状況（063）。null は「まだ分からない」
  const [available, setAvailable] = useState<boolean | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const seed = useRef(Date.now()).current

  const candidate = normalizePublicTag(value)
  const isCurrent = !!currentTag && publicTagKey(candidate) === publicTagKey(currentTag)

  // 打ち終わってから照会する。1文字ごとに投げると、打っている間ずっと
  // 「使われています」と「使えます」が入れ替わって読めない
  useEffect(() => {
    setAvailable(null)
    if (!candidate || isCurrent || findPublicTagIssue(candidate)) return
    let active = true
    const timer = setTimeout(() => {
      isPublicTagAvailable(candidate)
        .then((ok) => { if (active) setAvailable(ok) })
        // 通信できないだけなので何も言わない。保存の時点で改めて判定される
        .catch(() => {})
    }, 450)
    return () => { active = false; clearTimeout(timer) }
  }, [candidate, isCurrent])

  // 保存で重なったとき（照会と保存の間に他人が取った場合を含む）も代案を出す
  const conflict = !isCurrent && (issue === 'taken' || issue === 'reserved' || available === false)
  useEffect(() => {
    setSuggestions([])
    if (!conflict || !candidate) return
    let active = true
    findAvailablePublicTags(publicTagSuggestions(candidate, name, seed))
      .then((tags) => { if (active) setSuggestions(tags) })
      .catch(() => {})
    return () => { active = false }
    // 名前は代案の元にするだけ。名前を打つたびに照会し直さない
  }, [conflict, candidate, seed]) // eslint-disable-line react-hooks/exhaustive-deps

  const failed = !!errorMessage || !!issue || available === false
  const message = errorMessage
    ?? (issue ? publicTagIssueMessage(issue, lang)
      : available === false ? publicTagIssueMessage('taken', lang)
      : available === true ? (ja ? 'このIDは使えます' : 'That ID is available')
      : hint)

  return (
    <View>
      <TextField
          ref={inputRef}
          size="prominent"
          invalid={failed}
          leading={<Text style={[styles.prefix, { color: C.textMuted }]}>@</Text>}
          value={value}
          // 印と使えない文字はその場で落とす。打てるのに保存で弾かれる形にしない
          onChangeText={(next) => onChangeText(next.replace(/^[#@]/, '').replace(/[^A-Za-z0-9_]/g, ''))}
          // かな入力のまま打つと、変換中の文字が上の置き換えで消えて何も入らないように見える
          keyboardType="ascii-capable"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          maxLength={PUBLIC_TAG_MAX_LENGTH}
          placeholder={placeholder ?? (ja ? '例：desk_taro' : 'e.g. alex_desk')}
          accessibilityLabel={ja ? 'ユーザーID' : 'User ID'}
          editable={!busy}
          trailing={busy ? <ActivityIndicator size="small" color={C.textMuted} /> : undefined}
      />
      <Text style={[styles.hint, { color: failed ? C.danger : available === true ? statusTextColor('success', isDark) : C.textMuted }]}>
        {message}
      </Text>
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          <Text style={[styles.suggestionLabel, { color: C.textMuted }]}>
            {ja ? '空いているID' : 'Available IDs'}
          </Text>
          <View style={styles.chips}>
            {suggestions.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[styles.chip, { backgroundColor: C.chip, borderColor: C.border }]}
                onPress={() => onChangeText(tag)}
                disabled={busy}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={ja ? `@${tag} にする` : `Use @${tag}`}
              >
                <Text style={[styles.chipText, { color: C.text }]}>@{tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  prefix: { fontSize: 17, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  suggestions: { marginTop: 12, gap: 8 },
  suggestionLabel: { fontSize: 12, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: UI_METRICS.pillRadius,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
})
