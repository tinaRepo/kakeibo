# デザイン適用メモ
`apple/DESIGN.md`(Apple-design-analysis)に従って `src/web/styles.css` を作成。トークン名はDESIGN.mdと同じ(`--primary`, `--ink`, `--parchment`, `--tile-1` など)。

- 色: Action Blue #0066cc を唯一のアクセントに。ダークタイル上は Sky Link Blue #2997ff。予算バーの黄・赤だけは仕様書(80%/100%)により例外
- 文字: SF Pro Display/Text(なければ system-ui)。本文17px/1.47/-0.374px、見出し600。weight 500・700は使わない
- 形: ボタン・入力は pill、カードは18px+hairline(影なし)、ダーク小ボタンは8px
- 構成: 上に黒の global-nav(44px)、その下に frosted sub-nav(52px)。集計画面は白/ダーク/パーチメントのタイルを交互に配置
- 操作: ボタン押下は scale(.95)、フォーカスは 2px #0071e3
- ダークモード: DESIGN.md に定義がないため未対応(タイルのダーク面のみ)
