# moddable-nats

## このリポジトリは何か
moddable-nats は、[NATS](https://nats.io/) の JavaScript クライアント (nats.js core) を Moddable SDK の ECMA-419 ランタイムで動かすための移植セットです。`transport-moddable` モジュールが Moddable の TCP/TLS ソケットを使って NATS と接続するトランスポートを実装し、`bin/` にある Deno 製バンドラーで nats.js core の必要な部分をまとめて `dist/` 配下へ出力します。これにより、Moddable の `manifest.json` からそのまま読み込める形で NATS クライアントを利用できます。さらに `examples/hello-nats` には NATS 接続を行う Piu アプリのサンプルが含まれています。

## ビルド方法
### 前提条件
- [Deno](https://deno.com/) 2.x 系
- [Moddable SDK](https://github.com/Moddable-OpenSource/moddable) がインストール済みで、環境変数 `MODDABLE` が SDK ルートを指していること
- NATS サーバーを実行するためのホスト（ローカルでもリモートでも可）

### バンドルの生成
リポジトリのルートで以下を実行します。

```sh
deno task bundle-moddable
```

これにより `dist/nats-core.moddable.js` と `dist/nats-core-internal.moddable.js` が生成されます。nats.js を更新したり `transport-moddable` を変更した場合はこのコマンドを再実行してください。個別にビルドしたい場合は `deno task bundle-moddable-core` や `deno task bundle-moddable-internal` も利用できます。

## サンプルアプリケーション
`examples/hello-nats` は、Moddable の Piu UI を使った簡易的なコントローラーアプリです。接続状態を表示しつつ、仮想ジョイスティックの位置から JSON (ROS 2 Twist 形式) を生成して `demo.twist` に publish します。また `demo.>` トピックを購読し、受信内容をログ出力します。

このサンプルの `manifest.json` では `../../transport-moddable/manifest.json` を include しており、そのまま NATS クライアントのバンドルを取り込んでいます。他のアプリに組み込む場合も同様に manifest の include を追加し、`transport-moddable` から `connect()` などを import してください。

## 実行方法
### nats サーバー起動
ローカルで試す場合は、単純に NATS サーバーを起動します。

```sh
nats-server
```

もしくは Docker を使う場合は次のようにします。

```sh
docker run --rm -p 4222:4222 -p 8222:8222 nats:latest
```

実機デバイスを使用する際は、デバイスからサーバーのアドレスに到達できることを確認してください。

### 接続先 URL の設定
サンプルでは `examples/hello-nats/main.js` の `connect()` 呼び出しで接続先を指定しています。

```js
const nc = await connect({
  servers: ["nats://127.0.0.1:4222"],
  name: "moddable",
  reconnect: true,
  waitOnFirstConnect: true,
  maxReconnectAttempts: -1,
});
```

開発環境に合わせて `servers` 配列の URL を実際の NATS サーバーのホスト名や IP アドレスに変更してください。TLS で接続する場合は `factoryOpts` や `options.tls` を指定することで証明書設定を渡せます。

### アプリケーションのビルドと書き込み
1. 上記のバンドル生成 (`deno task bundle-moddable`) を済ませておきます。
2. Moddable SDK のビルドツール (`mcconfig`) を使ってサンプルをターゲットに合わせてビルドします。

   例: macOS シミュレータで動作を確認する場合
   ```sh
   mcconfig -d -m -p mac examples/hello-nats/manifest.json
   ```

   例: ESP32 系デバイスへ書き込む場合
   ```sh
   mcconfig -d -m -p esp32 examples/hello-nats/manifest.json ssid=<Wi-Fi SSID> password=<Wi-Fi 接続パスワード>
   ```

3. 書き込み後、`xsbug` でログを確認すると NATS への接続状態やサブスクリプションから受信したメッセージが確認できます。

他のアプリケーションに組み込む場合も、同じ手順でバンドルを生成し、manifest に `transport-moddable` を追加してから `mcconfig` でビルドしてください。
