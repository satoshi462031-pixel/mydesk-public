// ─── 公開ページに出ている「機材と写真」の指紋 ──────────────────────────
// 閲覧側に「機材が変わった」ことを見せるための判定材料。
//
// desks.updated_at では代用できない。あれはタイトルの直し・非公開化・再公開でも
// 動くので（050 の通り desks への UPDATE はすべて更新扱い）、中身が同じでも
// 「更新された」と出てしまう。公開のたびにここで焼いた値を desks.content_signature へ
// 入れ、サーバー側のトリガ（061）が前回と違うときだけ content_updated_at を進める。
//
// 入れるのは publish_desk_snapshot へ送る中身そのもの＝閲覧者に見えているものだけ。
// ports は公開ページに出ないうえ商品DBの整備でも動くので入れない
// （持ち主が何もしていないのに「更新」が付く）。

// 何を比べるかを変えたらここを上げる。上げないと旧形式の指紋と一致せず、
// 中身を変えていない公開済みのデスクが一斉に「更新あり」になる
//
// c1 → c2：写真の材料をアップロード後の URL から写真そのものの識別子へ変えた。
// URL のファイル名は `${Date.now()}-${randomToken()}` で公開のたびに変わり、
// plan.images にはローカルパスしか入らないので毎回再アップロードになる。
// つまり c1 では**写真も機材も変えずに再公開しただけで指紋が必ず変わり**、
// 061 のトリガが content_updated_at を進めて閲覧側に「機材更新」が出ていた。
// この列を作った目的そのものが無効化されていた。
const CONTENT_SIGNATURE_VERSION = 'c2'

/** publish_desk_snapshot の p_devices と同じ形（余分な列があっても無視する） */
export interface PublicContentDevice {
  local_id:     string
  name:         string
  category:     string
  price:        number | null
  purchased_at: string | null
  removed_at:   string | null
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * 写真1枚の同一性。パスやURLのファイル名だけを見る。
 *
 * 絶対パスをそのまま使えないのは、documentDirectory が端末のコンテナ UUID を
 * 含み、再インストールで変わるため。ローカルの写真は `<planId>_<assetId>.jpg`
 * という名前で一意になっている（planImages.ts が命名している）。
 * 再利用したリモートURLの側も、ファイル名はその実体に固定されている。
 */
export function photoIdentity(uri: string): string {
  const slash = uri.lastIndexOf('/')
  return slash >= 0 ? uri.slice(slash + 1) : uri
}

/**
 * @param devices    公開する機材（撤去済みを含む）。並び順は無視する
 * @param photoKeys  公開する写真の識別子（photoIdentity を通した値）。
 *                   こちらは並び順まで見る（公開ページの見た目が変わる）。
 *                   **アップロード後の URL を渡してはいけない** — 公開のたびに
 *                   変わるので、何も変えていない再公開が「更新」になる
 */
export function publicContentSignature(
  devices: readonly PublicContentDevice[],
  photoKeys: readonly string[],
): string {
  // 機材は並べ替えただけでは「更新」にしない。選び直さなくても
  // selectedGadgetIds の順序は編集操作で入れ替わる
  const rows = devices
    .map((d) => [
      d.local_id,
      d.name,
      d.category,
      d.price ?? '',
      d.purchased_at ?? '',
      d.removed_at ?? '',
    ].join('\u0001'))
    .sort()
  const body = `${CONTENT_SIGNATURE_VERSION}\u0002${rows.join('\u0002')}\u0003${photoKeys.join('\u0002')}`
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  // 生の中身をそのまま公開列に置くと、閲覧側が読める行が機材名で膨らむ。
  // 比較にしか使わないのでハッシュで足りる
  return `${CONTENT_SIGNATURE_VERSION}:${hex(fnv1a(body, 0x811c9dc5))}${hex(fnv1a(body, 0x1000193))}`
}
