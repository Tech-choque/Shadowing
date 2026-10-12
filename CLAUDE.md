# Shadowing

通勤（徒歩）中に聞くシャドーイング教材。**週1本、約25分の1本続きの会話**を、GitHub Pages のページ（`index.html`）で読み・聞く。

- 使い方（本人）: 事前にページで印と和訳を見ておく → 通勤中は音だけで追う
- 台本は Claude が書く。音声は、本人がページの「音声を作る」を押したときに Azure の読み上げで作られ、その端末に保存される
- 本人の第2の脳（Obsidian Vault）は別リポジトリ。このリポジトリでは Vault のノートを読まない・書かない

## 毎週の台本（日曜にRoutineが実行する）

1. **日付は推測しない。** `TZ=Asia/Tokyo date +%F` で今日の日付を取る。それが台本の id（`scripts/YYYY-MM-DD.txt`）
2. `scripts/index.json` と、直近3本の `scripts/*.txt` を読む。**関係・場面・話題が前の週と重ならないように**決める
3. 下の「台本の決まり」に沿って `scripts/YYYY-MM-DD.txt` を書く
4. `python3 tools/build.py scripts/YYYY-MM-DD.txt` を実行する。エラーが出たら直して、出なくなるまで繰り返す（JSONと `scripts/index.json` はこのツールが書く。手で書かない）
5. 書いた台本を、下の「印でよくある間違い」に照らして1回読み直す
6. main に commit して push する。メッセージは `台本: YYYY-MM-DD タイトル`

## 台本の決まり

### 中身

- **題材は日常会話・独り言の表現。** ビジネス英語は使わない。語彙は身近なもの、文法は中学英語が中心。ナチュラルスピードの口語にする
- **基本は2人の会話。** 1日の流れなど、**25分で1本続きの話**にする（短い会話の寄せ集めにしない）
- **途中に、1人になった場面の独り言を2〜3つ入れる。** 料理しながら、探し物をしながら、片づけながら、電話の片側だけ、など。スピーチやプレゼンのような語りにはしない
- **2人の関係は週ごとに変える。** ただし**「父と子ども」を3週に1回以上**入れる（直近3本に無ければ今週はそれにする）。ほかの例: 夫婦・同居の2人、友だち、きょうだい、近所の人、職場の同僚の雑談（仕事の中身は書かない）
- **長さ:** `build.py` の目安（3,300〜4,200語）に入れる。会話の切れ目の間が入るので、語数だけで見るより実際の音声は長くなる
- 子どもの登場人物の性別を決めつけない（名前は男女どちらにもある名前。he/she で呼ばない。和訳で「ぼく」「わたし」を使わない）
- 家族構成を決めつけない（母親・配偶者の有無に触れない話にする）
- 実在の人物・本人の私生活・仕事・健康の話は書かない

### ファイルの書き方（`scripts/YYYY-MM-DD.txt`）

```
title: A Saturday with Dad
title_ja: パパと過ごす土曜日
relation: 父と子ども
cast: A | Dad | 父 | en-US-GuyNeural
cast: B | Riley | 子ども | en-US-AnaNeural

## Saturday morning, the kitchen || 土曜の朝、台所
A: Good morning, sleepyhead. || おはよう、ねぼすけさん。
B: Morning, Dad. What time‿is‿it? || おはよう、パパ。いま何時？
```

- `## 英語 || 日本語` は場面の見出し（読み上げない）
- `記号: 英文 || 和訳` が1文。和訳は1文ごとに必ず付ける。ページでは最下部に番号付きで並ぶ
- `//` で始まる行はメモ（無視される）
- 声は次から選ぶ（ページの読み上げで使える声）。子どもの声は `en-US-AnaNeural` だけ
  - 男性: `en-US-GuyNeural` `en-US-AndrewNeural` `en-US-BrianNeural`
  - 女性: `en-US-JennyNeural` `en-US-AriaNeural` `en-US-EmmaNeural` `en-US-AvaNeural`
  - 子ども: `en-US-AnaNeural`

### 印（リンキング・フラッピング・リダクション）

| 書き方 | 意味 | 例 |
| --- | --- | --- |
| `a‿b` | リンキング。単語のあいだの**空白の代わりに** ‿ を置く | `pick‿up‿a` |
| `⟨t⟩` `⟨tt⟩` | フラッピング（t・d が軽いラ行の音になる） | `wa⟨t⟩er` `be⟨tt⟩er` `go⟨t⟩‿it` |
| `(t)` | ほとんど聞こえない音（英字1つだけ） | `don'(t) know` `jus(t) now` `tell (h)im` |
| `{書いた形|実際の言い方}` | リダクション。上に小さく実際の言い方が出る | `{going to|gonna}` `{let me|lemme}` |

- 全部に付けない。**聞き取りで引っかかりやすい所**に付ける（目安: 1文に0〜3個）
- `{…|…}` の中に別の印を入れない
- 英文の中で、印以外の `( ) { } | ⟨ ⟩` を使わない
- 読み上げは、`{…|…}` の右側が `gonna wanna gotta kinda sorta lemme gimme outta lotta 'em dunno gotcha ya` のときだけ右側（実際の言い方）で読む。それ以外は左側（書いた形）で読む

### 印でよくある間違い（実際にあったもの）

- **後ろが子音の t はフラッピングにならない。** `let's` `let me` `what's` `get some` は ⟨t⟩ にしない（`let me` は `{let me|lemme}`）
- **`what's` `that's` `it's` の t は発音される。** `(t)` にしない
- **母音にはさまれた t は「消える音」ではなくフラッピング。** `but I` → `bu⟨t⟩ I`、`what about` → `wha⟨t⟩‿abou(t)`、`what are` → `wha⟨t⟩‿are`
- `couldn't` の t を消すときは `couldn'(t)`（アポストロフィを残す）

## ページの仕組み（変えるときの注意）

- `index.html` と `app.js` だけで動く。ビルドは不要
- Azure のキーは、瞬間英作文の発音チェック（`Tech-choque/Instant_English_Composition`）と同じ localStorage の項目（`iec.key` `iec.region`）を使う。どちらも `tech-choque.github.io` の下なので共有される
- 音声は約450語ずつに分けて Azure に頼み、MP3をつなげる。各文の頭に bookmark を入れて、再生中の文の位置を取っている
- 作った音声は IndexedDB に保存する（直近4週分）。音声の作り方を変えたら `app.js` の `AUDIO_VERSION` を上げる
- `vendor/speech-sdk/`: Microsoft の Speech SDK（ブラウザ版）1.51.0。再配布が許されているファイルだけ（`REDIST.txt`）
