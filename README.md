# S3 File Manager

S3 または MinIO などの S3 互換サービスにあるファイルを、ローカルから確認・ダウンロード・編集・アップロードするための CLI / Web UI ツールです。

## セットアップ

前提:

- Node.js 20 以上
- npm
- AWS S3 を使う場合は AWS CLI または AWS SDK が読める認証情報

```bash
cd tools/s3-file-manager
npm install
cp .env.example .env
npm run build
```

ローカル MinIO などの S3 互換サービスを使う場合は、`.env.example` を環境に合わせて編集してください。

```env
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=dummy
AWS_SECRET_ACCESS_KEY=dummy
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=my-local-bucket
S3_FORCE_PATH_STYLE=true
```

別の env ファイルを直接使う場合は、各コマンドに `--env` を渡してください。

```bash
npm run s3 -- list --env ./path/to/.env
```

## ローカルS3互換サービス

MinIO や MiniStack など、S3互換エンドポイントを持つローカルサービスに接続できます。

### MiniStack

MiniStack はデフォルトで `http://localhost:4566` にAWS互換エンドポイントを立てます。

```bash
docker run -p 4566:4566 ministackorg/ministack
```

別ターミナルで、S3 File Manager 用の env を用意します。

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
S3_ENDPOINT=http://127.0.0.1:4566
S3_BUCKET=my-local-bucket
S3_FORCE_PATH_STYLE=true
```

バケットを作ってから起動します。

```bash
aws --endpoint-url=http://127.0.0.1:4566 s3 mb s3://my-local-bucket --region us-east-1
npm run web
```

### MinIO

MinIO を使う場合は、MinIOのエンドポイント、アクセスキー、シークレットキー、バケット名を設定してください。

```env
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=dummy
AWS_SECRET_ACCESS_KEY=dummy
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=my-local-bucket
S3_FORCE_PATH_STYLE=true
```

## AWS認証

AWS S3 にアクセスする場合、このツールは起動したローカル環境の AWS 認証情報を使います。ブラウザに AWS キーを渡すのではなく、localhost の Node サーバーが AWS SDK 経由で S3 にアクセスします。

よく使う設定例:

```bash
aws configure
aws sts get-caller-identity
```

プロファイルを使う場合:

```bash
export AWS_PROFILE=your-profile
npm run web
```

一時認証情報を使う場合:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...
npm run web
```

起動時に対象バケットやリージョンを固定したい場合:

```bash
npm run web -- --bucket your-bucket-name --region ap-northeast-1
```

MinIO ではなく AWS S3 に接続する場合は、`S3_ENDPOINT` を設定しないでください。

## コマンド

```bash
npm run s3 -- list
npm run s3 -- list logs/
npm run s3 -- head logs/example.json
npm run s3 -- get logs/example.json
npm run s3 -- show logs/example.json
npm run s3 -- diff logs/example.json
npm run s3 -- edit logs/example.json
npm run s3 -- put logs/example.json
```

各コマンドの用途は以下です。

| コマンド | 用途 |
| --- | --- |
| `list [prefix]` | オブジェクト一覧を表示します |
| `head <key>` | Content-Type、サイズ、ETag、更新日時を表示します |
| `get <key>` | S3 から `.s3-work/objects/` にダウンロードします |
| `show <key>` | テキスト系ファイルの中身を表示します |
| `diff <key>` | S3 上の最新版とローカルファイルの差分を表示します |
| `edit <key>` | ダウンロード後に `$EDITOR` で開き、差分確認後にアップロードします |
| `put <key>` | ローカルファイルを確認後にアップロードします |

## Web UI

ローカルブラウザで操作したい場合は、Web UI を起動できます。

```bash
npm run build
npm run web
```

起動後、以下のURLを開きます。

```text
http://127.0.0.1:5174
```

Web UI は安全のため、デフォルトでは読み取り専用で起動します。ブラウザからファイルを新規作成・保存する場合は、画面右上の `保存 OFF` を押して保存を有効にしてください。

起動直後から保存を有効にしたい場合は、`--allow-write` を付けて起動できます。

```bash
npm run web -- --allow-write
```

バケット作成も許可する場合は、追加で `--allow-create-bucket` を付けてください。

```bash
npm run web -- --allow-write --allow-create-bucket
```

ポートを変えたい場合は `--port` を指定します。

```bash
npm run web -- --port 5175
```

Web UI では以下ができます。

| 操作 | 内容 |
| --- | --- |
| バケット切り替え | 認証情報で参照できるバケットを一覧表示し、操作対象を切り替えます |
| バケット作成 | 保存ONまたは `--allow-create-bucket` 指定時に、新しいバケット名を入力して作成し、そのバケットへ切り替えます |
| 一覧表示 | Prefix で絞り込んで S3 オブジェクトを表示します |
| メタデータ確認 | Content-Type、サイズ、ETag、更新日時を表示します |
| 保存モード切り替え | 起動中に `保存 OFF` / `保存 ON` を切り替えます |
| 新規ファイル作成 | 保存ONの時に、現在の Prefix をもとに新しいキーを入力し、テキストファイルを作成します |
| テキスト編集 | 保存ONの時に、JSON、CSV、Markdown、YAML などをブラウザ上で編集します |
| env編集 | 保存ONの時に、`.env`, `.env.local`, `*.env` などを環境変数テーブルまたは通常テキストとして編集します |
| 差分確認 | 開いた時点の内容と現在の編集内容を比較します |
| アップロード | 保存ONの時に、確認ダイアログ後に S3 へ保存します |
| 画像プレビュー | JPEG、PNG、WebP などを表示します |

## 必要なIAM権限

用途に応じて、起動している AWS 認証情報に以下の権限が必要です。

| 用途 | 必要な権限 |
| --- | --- |
| バケット一覧 | `s3:ListAllMyBuckets` |
| バケット作成 | `s3:CreateBucket` |
| オブジェクト一覧 | `s3:ListBucket` |
| 表示・プレビュー | `s3:GetObject`, `s3:HeadObject` |
| アップロード | `s3:PutObject` |

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

アップロードも許可する場合は、対象バケットに `s3:PutObject` を追加してください。

```json
{
  "Effect": "Allow",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::your-bucket-name/*"
}
```

## 便利なオプション

```bash
npm run s3 -- list --env ./path/to/.env
npm run s3 -- get logs/example.json --out /tmp/example.json
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
| `--yes` | アップロード前の確認を省略します |
| `--port <number>` | Web UI のポートを指定します |
| `--allow-write` | Web UI からの新規ファイル作成・保存を有効にします |
| `--allow-create-bucket` | Web UI からのバケット作成を有効にします |

## 編集の流れ

```text
S3 からダウンロード
  ↓
.s3-work/objects/ に保存
  ↓
$EDITOR で開く
  ↓
差分を表示
  ↓
確認後にアップロード
```

`EDITOR` は `.env` やシェル環境変数で指定できます。

```env
EDITOR=code
```

## 安全仕様

- `edit` と `put` は、`--yes` を付けない限りアップロード前に確認します。
- Web UI の新規作成は、同じキーのオブジェクトが既にある場合に警告します。
- Web UI のバケット作成は、確認ダイアログ後に実行します。
- Web UI の env編集では、`KEY=VALUE` 行を編集・追加・削除できます。`env編集` / `テキスト編集` ボタンで通常テキスト編集にも切り替えできます。コメントや空行は読み込み時に保持されます。
- ダウンロード時のメタデータは `.s3-work/metadata/` に保存します。
- ダウンロード後に S3 側の ETag が変わっていた場合、アップロード前に警告します。
- バイナリと思われるオブジェクトは、`show` や `edit` の対象にしません。
- Web UI は `127.0.0.1` のみで待ち受けます。
- Web UI のバケット一覧には、現在の AWS 認証情報で `s3:ListAllMyBuckets` できるバケットが表示されます。
- 削除コマンドはありません。

## 本番S3を触るときの注意

- Web UI 右上やメタデータ欄で、対象バケットとキーを確認してからアップロードしてください。
- AWS S3 接続時は画面に警告バナーを表示します。
- Terraform state など重要なバケットが見える場合でも、内容の編集やアップロードは慎重に行ってください。
- このツールには削除機能はありませんが、`PutObject` による上書きはできます。
- 作業用ファイルやメタデータは `.s3-work/` に保存されます。

## トラブルシュート

### バケット一覧が表示されない

認証情報に `s3:ListAllMyBuckets` がない可能性があります。起動時に `--bucket` を指定して、対象バケットを直接開いてください。

```bash
npm run web -- --bucket your-bucket-name
```

### AccessDenied が出る

現在の AWS 認証情報に、対象バケットまたはオブジェクトへの権限がありません。

```bash
aws sts get-caller-identity
aws s3 ls s3://your-bucket-name/
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
