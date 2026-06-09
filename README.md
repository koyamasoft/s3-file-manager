# S3 File Manager

[![Test](https://github.com/koyamasoft/s3-file-manager/actions/workflows/test.yml/badge.svg)](https://github.com/koyamasoft/s3-file-manager/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/koyamasoft/s3-file-manager)](https://github.com/koyamasoft/s3-file-manager/releases)

S3 / MinIO / MiniStack などの S3 互換ストレージを、安全に確認・編集するためのローカル専用 Web UI / CLI ツールです。

AWS 認証情報はブラウザに渡しません。localhost の Node.js サーバーが AWS SDK 経由で S3 にアクセスします。Web UI は `127.0.0.1` のみで待ち受け、起動直後は保存OFFです。

![S3 File Manager Web UI](docs/screenshot.svg)

## 主な機能

- バケット検索と切り替え
- 選択バケットのリージョン表示と接続リージョン切り替え
- リージョン不一致エラー時の通知からのリージョン切り替え
- 接続設定の折りたたみ表示
- Prefix 検索、サジェスト、階層ナビゲーション
- バケット / Prefix の履歴表示
- 表示中オブジェクトの key フィルタ検索（階層表示に対応）
- オブジェクト一覧の名前順 / 更新順ソート
- オブジェクト一覧、メタデータ確認、画像/PDFプレビュー
- バケット / オブジェクトのお気に入り登録、一覧表示、削除
- Web UI からのオブジェクトダウンロード
- テキストファイルの表示・編集・Content-Type変更・差分確認・アップロード
- ローカルファイルの単体/複数アップロード、ドラッグ&ドロップアップロード
- 選択中オブジェクトの複製
- key / S3 URI / download URL のコピー
- `.env`, `.env.local`, `*.env` の key/value 編集
- CLI での `list`, `head`, `get`, `show`, `diff`, `edit`, `put`
- CLI でのオブジェクトコピー
- 認証期限切れ時の S3 クライアント再作成と1回リトライ
- AWS S3 のバケットリージョンリダイレクト追従
- MinIO / MiniStack などの S3 互換エンドポイント対応

## クイックスタート

```bash
git clone https://github.com/koyamasoft/s3-file-manager.git
cd s3-file-manager
npm ci
npm run build
npm run web
```

起動後、ブラウザで開きます。

```text
http://127.0.0.1:5174
```

AWS S3 を使う場合は、AWS CLI / AWS SDK が参照できる認証情報を先に用意してください。

```bash
aws configure
aws sts get-caller-identity
```

プロファイルを使う場合:

```bash
export AWS_PROFILE=your-profile
npm run web
```

## Web UI

通常起動では `保存 OFF` で開始します。必要なときだけ画面右上の `保存 OFF` を押して、ファイル作成・アップロードを一時的に有効化できます。

起動直後から保存を有効にしたい場合:

```bash
npm run web -- --allow-write
```

バケット作成は、保存ONとは別に `--allow-create-bucket` を指定した場合のみ有効です。実行時には確認ダイアログを表示します。

```bash
npm run web -- --allow-write --allow-create-bucket
```

Web UI で使えるオプション:

| オプション | 用途 |
| --- | --- |
| `--port <number>` | Web UI のポートを指定します |
| `--bucket <name>` | 起動時に選択するバケットを指定します |
| `--endpoint <url>` | `S3_ENDPOINT` を上書きします |
| `--region <name>` | `AWS_REGION` を上書きします |
| `--env <path>` | 読み込む env ファイルを指定します |
| `--allow-write` | Web UI を起動直後から保存ONで開始します |
| `--allow-create-bucket` | Web UI からのバケット作成を有効にします |

ポートを変えたい場合:

```bash
npm run web -- --port 5175
```

対象バケットやリージョンを固定したい場合:

```bash
npm run web -- --bucket your-bucket-name --region ap-northeast-1
```

AWS S3 ではバケットごとにリージョンが異なる場合があります。通常は S3 のリージョンリダイレクトに追従しますが、対象バケットのリージョンが分かっている場合は `--region` で固定できます。

Web UI では選択中バケットのリージョンを確認できます。通常は折りたたまれていますが、`Region` をクリックすると表示され、必要に応じて接続リージョンを切り替えられます。
バケットのリージョン違いによる S3 のリダイレクトエラーを検出した場合は、通知から対象リージョンへ切り替えられます。
バケット / Region / Prefix の接続設定は折りたたみ可能です。バケット名や接続リージョンはヘッダーにも表示されるため、一覧を広く使えます。
お気に入りと履歴はサイドバー下部から切り替えて表示できます。

Web UI でできること:

| 操作 | 内容 |
| --- | --- |
| バケット検索 | 認証情報で参照できるバケットを検索・切り替えします |
| Region表示・切替 | 選択中バケットのリージョンを確認し、接続リージョンを切り替えます |
| Prefix検索 | 表示中のオブジェクトから Prefix 候補を作り、検索を補助します |
| Prefix階層表示 | `logs/2026/05/` のようなキーをフォルダ風に辿れます |
| 一覧表示 | Prefix で絞り込んで S3 オブジェクトを表示します（1000件ごとに追加読み込み） |
| 一覧フィルタ検索 | 現在読み込まれているオブジェクトを key でローカルに絞り込みます。途中階層では次の階層を保って表示します |
| 一覧ソート | 表示中のオブジェクトを名前順または更新順で並び替えます |
| お気に入り | バケットとオブジェクトをお気に入り登録し、一覧から開いたり不要なものを削除できます |
| 履歴 | 最近開いたバケットと Prefix をローカルに保存し、一覧から再度開いたり不要なものを削除できます |
| メタデータ確認 | Content-Type、サイズ、ETag、更新日時を表示します |
| Content-Type編集 | 新規作成・アップロード時の Content-Type を選択または入力できます |
| ダウンロード | 選択中のオブジェクトをローカルにダウンロードします |
| 保存モード切り替え | 起動中に `保存 OFF` / `保存 ON` を切り替えます |
| 新規ファイル作成 | 保存ONの時に、現在の Prefix をもとにテキストファイルを作成します |
| ローカルファイルアップロード | 保存ONの時に、ローカルファイルを現在の Prefix 配下へアップロードします |
| 複数ファイルアップロード | 複数選択したファイルを直列にアップロードし、既存キー衝突時は上書き確認します |
| ドラッグ&ドロップアップロード | ファイルを画面にドロップして現在の Prefix 配下へアップロードします |
| アップロード進捗 | 複数ファイルアップロード中の成功、衝突、失敗件数を表示します |
| 複製 | 保存ONの時に、選択中オブジェクトを別 key にコピーします |
| テキスト編集 | JSON、CSV、Markdown、YAML などをブラウザ上で編集します |
| env編集 | `.env`, `.env.local`, `*.env` を key/value テーブルまたは通常テキストとして編集します |
| 差分確認 | 開いた時点の内容と現在の編集内容を比較します |
| 画像/PDFプレビュー | JPEG、PNG、WebP、GIF、PDF を表示します |
| コピー | 選択中オブジェクトの key、S3 URI、download URL をコピーします |
| バケット作成 | `--allow-create-bucket` 指定時のみバケットを作成します |

## CLI

```bash
npm run s3 -- list
npm run s3 -- list logs/
npm run s3 -- head logs/example.json
npm run s3 -- get logs/example.json
npm run s3 -- show logs/example.json
npm run s3 -- diff logs/example.json
npm run s3 -- copy logs/example.json logs/example-copy.json
npm run s3 -- edit logs/example.json
npm run s3 -- put logs/example.json
```

| コマンド | 用途 |
| --- | --- |
| `list [prefix]` | オブジェクト一覧を表示します（最大1000件） |
| `head <key>` | Content-Type、サイズ、ETag、更新日時を表示します |
| `get <key>` | S3 から `.s3-work/objects/` にダウンロードします |
| `show <key>` | テキスト系ファイルの中身を表示します |
| `diff <key>` | S3 上の最新版とローカルファイルの差分を表示します |
| `copy <source-key> <target-key>` | S3 上のオブジェクトを別 key にコピーします |
| `edit <key>` | ダウンロード後に `$EDITOR` で開き、差分確認後にアップロードします |
| `put <key>` | ローカルファイルを確認後にアップロードします |

よく使うオプション:

```bash
npm run s3 -- list --env ./path/to/.env
npm run s3 -- get logs/example.json --out /tmp/example.json
npm run s3 -- copy logs/example.json logs/example-copy.json --yes
npm run s3 -- put logs/example.json --file /tmp/example.json
npm run s3 -- put logs/example.json --yes
```

| オプション | 用途 |
| --- | --- |
| `--env <path>` | 読み込む env ファイルを指定します |
| `--bucket <name>` | 起動時に選択するバケットを指定します |
| `--endpoint <url>` | `S3_ENDPOINT` を上書きします |
| `--region <name>` | `AWS_REGION` を上書きします |
| `--workdir <path>` | 作業ディレクトリを上書きします |
| `--yes` | アップロードやコピー前の確認を省略します |

## 設定

`.env.local` または `.env` を置くと、起動時に自動で読み込みます。別ファイルを使う場合は `--env` を指定してください。

```bash
cp .env.example .env
npm run web
```

MinIO などの S3 互換サービスを使う例:

```env
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=dummy
AWS_SECRET_ACCESS_KEY=dummy
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=my-local-bucket
S3_FORCE_PATH_STYLE=true
```

AWS S3 に接続する場合は、`S3_ENDPOINT` を設定しないでください。

## ローカルS3互換サービス

### MiniStack

MiniStack はデフォルトで `http://localhost:4566` に AWS 互換エンドポイントを立てます。

```bash
docker run -p 4566:4566 ministackorg/ministack
aws --endpoint-url=http://127.0.0.1:4566 s3 mb s3://my-local-bucket --region us-east-1
npm run web
```

`.env` の例:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
S3_ENDPOINT=http://127.0.0.1:4566
S3_BUCKET=my-local-bucket
S3_FORCE_PATH_STYLE=true
```

### MinIO

MinIO を使う場合は、MinIO のエンドポイント、アクセスキー、シークレットキー、バケット名を設定してください。

```env
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=dummy
AWS_SECRET_ACCESS_KEY=dummy
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=my-local-bucket
S3_FORCE_PATH_STYLE=true
```

## 必要なIAM権限

用途に応じて、起動している AWS 認証情報に以下の権限が必要です。

| 用途 | 必要な権限 |
| --- | --- |
| バケット一覧 | `s3:ListAllMyBuckets` |
| バケット作成 | `s3:CreateBucket` |
| オブジェクト一覧 | `s3:ListBucket` |
| 表示・プレビュー | `s3:GetObject`, `s3:HeadObject` |
| ダウンロード | `s3:GetObject` |
| アップロード | `s3:PutObject` |
| コピー | コピー元に `s3:GetObject`、コピー先に `s3:PutObject` |

読み取り中心の例:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListAllMyBuckets",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::your-bucket-name"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

アップロードも許可する場合:

```json
{
  "Effect": "Allow",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::your-bucket-name/*"
}
```

コピーも許可する場合は、コピー元オブジェクトへの `s3:GetObject` とコピー先オブジェクトへの `s3:PutObject` を許可してください。同じバケット内でコピーする場合は、上記の読み取り権限とアップロード権限の組み合わせで動きます。

## 安全仕様

### 認証情報

- AWS 認証情報はブラウザに渡しません。
- Node.js サーバーが AWS SDK 経由で S3 にアクセスします。
- `.env`, `.env.local`, `*.env` はブラウザに直接読み込ませず、ローカルサーバー経由で表示・編集します。

### ネットワーク

- Web UI は `127.0.0.1` のみで待ち受けます。
- Web UI の書き込みAPIには CSRF トークンと Origin / Sec-Fetch-Site チェックがあります。

### 書き込み保護

- Web UI は起動直後、保存OFFです。
- `--allow-write` を指定すると、起動直後から保存ONで開始します。
- Web UI の新規作成は、同じキーのオブジェクトが既にある場合に警告します。
- Web UI のローカルファイルアップロードは、同じキーのオブジェクトが既にある場合に警告します。
- Web UI と CLI のコピーは、コピー先に同じキーのオブジェクトが既にある場合に警告します。
- Web UI のバケット作成は、`--allow-create-bucket` 指定時のみ有効です。
- ダウンロード後に S3 側の ETag が変わっていた場合、アップロード前に警告します。
- 削除コマンドはありません。

### 表示・プレビュー

- AWS S3 接続時は、本番環境の誤操作を避けるため警告バナーを表示します。
- Web UI の表示・プレビューは 5 MiB までのオブジェクトに制限しています。
- バイナリと思われるオブジェクトは、`show` や `edit` の対象にしません。
- raw プレビューでは JPEG、PNG、WebP、GIF、PDF を inline 表示します。

## 制限事項

- 削除操作には対応していません。
- 5 MiB を超えるオブジェクトは Web UI で表示・プレビューできません。ダウンロードは Web UI または CLI の `get` で行えます。
- Web UI のアップロードリクエスト本文は 10 MiB までです。
- バイナリファイルの編集には対応していません。
- 複数ユーザーで共有するサーバー用途は想定していません。
- Prefix サジェストは、現在表示中のオブジェクト一覧から候補を作ります。

## 認証期限切れへの対応

Web UI と CLI は、認証期限切れ系エラーを検知した場合に S3 クライアントを作り直し、同じ操作を1回だけ自動で再試行します。

Web UI は画面リロード時にも S3 クライアントを作り直します。AWS SSO などで認証が切れた場合は、別ターミナルで `aws sso login` などを実行してからブラウザをリロードすると復帰できることがあります。

`.env` の一時認証情報を手で書き換えた場合も、リロード時に env ファイルの AWS 認証関連キーを読み直します。シェルの `export` だけを更新した場合は、起動中の Node.js プロセスには反映されないため、Web サーバーを再起動してください。

```bash
lsof -ti tcp:5174
kill <PID>
npm run web -- --allow-write --allow-create-bucket
```

## テスト

```bash
npm test
```

`npm test` は TypeScript をビルドしてから、Node.js 標準のテストランナーでユニットテストを実行します。

## リリース時の確認

リリースや公開設定を変更する前に、以下を確認してください。

- `npm test` が通ること
- `.env`, `.env.local`, `.s3-work/`, `dist/`, `node_modules/` をコミットしていないこと
- README、Issue、PR、スクリーンショットに実バケット名、アカウントID、社内パスが残っていないこと
- 書き込み系機能は必要最小限の IAM 権限で試すこと
- GitHub Actions と Dependabot alerts / security updates が有効であること

安定版の区切りは Git タグで管理します。

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

## トラブルシュート

### バケット一覧が表示されない

認証情報に `s3:ListAllMyBuckets` がない可能性があります。起動時に `--bucket` を指定して、対象バケットを直接開いてください。

```bash
npm run web -- --bucket your-bucket-name
```

`Your session has expired. Please reauthenticate.` が出る場合は、AWS CLI などで認証を更新してください。

```bash
aws sts get-caller-identity
```

認証更新後も Web UI でバケットが見えない場合は、起動中の S3 File Manager が古い認証状態を保持している可能性があります。Web サーバーを再起動してください。

### AccessDenied が出る

現在の AWS 認証情報に、対象バケットまたはオブジェクトへの権限がありません。

```bash
aws sts get-caller-identity
aws s3 ls s3://your-bucket-name/
```

### 指定 endpoint へ送るように求められる

`The bucket you are attempting to access must be addressed using the specified endpoint.` が出る場合、対象バケットが現在のリージョンとは別リージョンにある可能性があります。

AWS S3 接続時はリージョンリダイレクトに追従します。Web UI でリージョン不一致を検出した場合は、通知に表示される切り替えボタンから対象リージョンへ変更できます。

解消しない場合は、対象バケットのリージョンを確認して `--region` を指定してください。

```bash
npm run web -- --bucket your-bucket-name --region us-east-1
```

### MinIO ではなく AWS S3 を見たい

`.env` や `.env.local` に `S3_ENDPOINT=http://127.0.0.1:9000` があると MinIO に接続します。AWS S3 を見る場合は `S3_ENDPOINT` を消すか、`--bucket` を指定して起動してください。

### 変更が画面に反映されない

Web UI の静的ファイルがブラウザに残っている可能性があります。ハードリロードしてください。

```text
Cmd + Shift + R
```

### `dist/` がないと言われる

`dist/` はビルド成果物です。初回セットアップ後、またはソース変更後にビルドしてください。

```bash
npm run build
```

## License

MIT
