# DESIGN.md (Apple風)
参照: getdesign.md/apple の分析 (Apple Blue / SF Pro / pill CTA / tight tracking)。ページ本体からは全文を取得できなかったため、公開されている値(下記)で構成。

- 雰囲気: 余白を広く、色はほぼ無彩色。アクセントは青1色のみ(操作できるものだけ青)
- 色: canvas #fff / parchment #f5f5f7 / ink #1d1d1f / mute #6e6e73 / line #d2d2d7 / Action Blue #0066cc / focus #0071e3。ダークは自動(prefers-color-scheme)
- 文字: SF Pro Display(見出し・600・字間 -0.28px) / SF Pro Text(本文17px)。非Apple端末は system-ui にフォールバック
- 形: ボタンは pill(角丸999)、カードは18px、入力は12px。タップ領域は最低44px
- 状態色: 予算80%以上=橙 #ff9f0a、100%超=赤 #ff3b30
- ナビ: 下部固定、すりガラス(backdrop-filter)
トークンは `src/web/styles.css` の `:root` に集約。
