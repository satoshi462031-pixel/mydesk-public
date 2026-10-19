---
description: 配線図のバグを論理→配置→描画の層で切り分けて根本から直す
argument-hint: [症状] 例) 線が重なる / 垂直線が出ない / 交差する
---

症状: **$ARGUMENTS**

配線図のバグ。**対症療法を禁止する。**過去に同じ箇所を何度も直しているので、
今回はどの層の問題かを確定させてから手を入れること。

## 層の切り分け（この順で確認する）

1. **論理層 `src/utils/wiringEngine.ts`**
   `generateWiring()` が返す接続そのものが妥当か。ポート互換（`src/constants/portTypes.ts`）、
   ポート残数の消費（`PortType × direction`）、映像を通す端子の判定。
   → **接続の組み合わせ自体が間違っているなら、ここで直す。配置側で辻褄を合わせない。**

2. **配置・経路層 `src/utils/connectionMapLayout.ts`**
   `computeMapLayout()` のノード配置（tier / band）とエッジのルーティング。
   接続は正しいが線の通り道が悪い場合のみ、ここ。

3. **描画層 `src/components/organisms/ConnectionMap.tsx`**
   座標は正しいが見た目だけおかしい場合のみ、ここ。

**履歴アニメーション（`HistoryWiringCanvas.tsx` / `DeskHistoryAnimationModal.tsx`）は
別経路で描いている。**1・2 を直したらこちらでも症状が消えたか必ず確認する。

## 必ず踏むこと

- **`src/utils/mapLayoutCache.ts` の `LAYOUT_VERSION` を上げる。**
  上げないと古いレイアウトがキャッシュから返り「直したのに直らない」になる。
- 検証は最小構成ではなく `src/constants/demoDesks.ts` と `src/constants/deskTemplates.ts` の
  実データで行う。特にノートPC構成・スピーカー構成・大量ガジェット構成。
- `computeMapLayout` は 12ms ごとに `yieldToEventLoop()` で制御を返して UI を止めない設計。
  重い処理を足すと画面が固まる。ループを増やしたら計算量を見積もって報告する。
- 修正後に `npx tsc --noEmit` を通す。

## 報告

- どの層の問題だったか
- なぜ今まで再発していたか（前回どこで押さえていたか）
- 他のデスク構成で再発しない理由

原因が特定できないまま「経路を調整した」で終わらせない。特定できなければ、
どこまで絞り込めたかを報告して指示を仰ぐ。
