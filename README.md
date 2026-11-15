# MEAT LINK（ミートチーム ポータル）

ホーム画面に追加したときの名前は「MEAT LINK」。

作業指示書（.xlsx）から 4シートを抜き出してメンバーに共有し、既存の申請アプリと1つにまとめたWebアプリです。

```
index.html        … 共有アプリ（タブ：明日の作業予定／現場改善／シフト変更／希望休）
extract.html      … 抽出アプリ（作業指示書を読み込んで共有する担当者用）
assets/
  config.js       … ★設定はここだけ（GASのURL・各アプリのURL）
  parser.js       … 指示書の読み取り（内臓作業室・精肉パック作業室・当日分まとめ・翌日分まとめ）
  render.js       … 作業予定の表示（共有アプリ・抽出アプリ共通）
  style.css
gas/
  Code.gs         … 保存・配信・Slack投稿（ES5）
  appsscript.json
_demo/sample-plan.json … 11/16の指示書から抽出した見本データ（動作確認用）
```

## 公開先

- 共有アプリ: https://s-meat.github.io/meat-portal/
- 抽出アプリ: https://s-meat.github.io/meat-portal/extract.html
- 使い方（メンバー向け）: https://s-meat.github.io/meat-portal/manual.html
- 取り込みマニュアル（社員向け）: https://s-meat.github.io/meat-portal/manual-admin.html
- GAS（API）: プロジェクト「ミートチームポータル（作業予定API）」
  https://script.google.com/macros/s/AKfycbzluIQS2f70q-PWnUw1Jpgql-xiG4tMU3ap-hXcmcf0Mbt0_c6dudgoavMrVM-3fXj7/exec

## しくみ

```
作業指示書.xlsx ─▶ extract.html（ブラウザ内で読み取り・プレビュー）
                     │ 暗証番号つきで送信（hidden form + iframe POST）
                     ▼
               GAS（スプレッドシート「plans」に日付ごとに保存）
                     │ JSONP で配信              │ 毎朝 6:50
                     ▼                           ▼
               index.html「明日の作業予定」     Slack #110
```

- 指示書はブラウザの中だけで読み取ります（ファイル自体はどこにも上げません）。
- 同じ日付を取り込み直すと上書き。60日より古いデータは自動で消えます。
- セル番地ではなく「作業終了予定」「総パック数」「商品名」「7:30～」などのラベルを目印に読むので、行が多少増減しても動きます。シート名を変えると読めなくなります。

## セットアップ

### 1. GAS
1. Apps Script で新しいプロジェクトを作り、`gas/Code.gs` を貼り付け
2. `setup` を1回実行（保存用スプレッドシート「ミートチーム 作業予定データ（ポータル用）」が自動で作られます）
3. プロジェクトの設定 → スクリプト プロパティ

   | プロパティ | 値 |
   |---|---|
   | `UPLOAD_PIN` | 取り込み用の暗証番号 |
   | `SLACK_BOT_TOKEN` | 既存のまとめBotと同じ xoxb- トークン |
   | `SLACK_CHANNEL` | `C05G46NECKV`（#110） |
   | `APP_URL` | 共有アプリのURL |
   | `SLACK_DAY_OFFSET` | `0`＝当日の予定を投稿（既定）／`1`＝翌日の予定を投稿 |

4. デプロイ → 新しいデプロイ → ウェブアプリ（実行：自分／アクセス：全員）→ URL（…/exec）を控える
5. エディタで `testSlackText` を実行するとログでSlack文面を確認できます（取り込み後）

### 2. 共有アプリ（GitHub Pages）
1. `assets/config.js` の `GAS_URL` に 4. のURLを入れる
2. このフォルダをリポジトリ（例：`S-meat/meat-portal`）に置いて Pages を有効化
3. `_demo/` はアップしないでください（メンバー名が入っています）。
   `GAS_URL` が空のときは `_demo/sample-plan.js` の見本を表示します（zip を「すべて展開」してから index.html をダブルクリックで確認できます）。

### 3. タブで表示する既存アプリ
現場改善フォーム（Googleフォーム）・シフト変更申請・希望休申請（いずれも GitHub Pages）はタブ内にそのまま表示されます。表示されない時はタブ上部の「別タブで開く」から使えます。

## Slack #110（6:50）への投稿

**A. 既存のまとめBotに組み込む（おすすめ）** — いつものまとめの中に入り、時間もぴったり合います。既存Botの投稿文を作る所に追加：

```js
var PLAN_URL = 'https://script.google.com/macros/s/xxxx/exec'; // このGASのURL
var planText = '';
try {
  var r = JSON.parse(UrlFetchApp.fetch(PLAN_URL + '?action=slack&offset=0').getContentText());
  planText = r.text || '';
} catch (e) {}
if (planText) text += '\n\n' + planText;   // text = 既存の投稿文
```

**B. 別メッセージで投稿する** — このGASで `setupTriggers` を1回実行。毎朝5時台に準備が動き、6:50ちょうどに投稿します（GASの「毎日○時」トリガーは±15分ずれるため、この方式にしています）。予定が取り込まれていない日は投稿しません。

## メンバー向けの使い方
- 「明日の作業予定」は、今日以降で一番近い日の予定を表示。‹ › で前後の日に切り替え。
- 「自分の予定」で名前を選ぶと、その人の時間割が上に出て、人員配置表でも強調されます（端末に記憶）。
- 当日分・翌日分は数量0の商品を隠しています（「0の商品も表示」で全件）。
