# friend-sniper
[friend.tech](https://www.friend.tech/) new account snipper. **Not competitive and will not make any money.** Run at your own risk:)

## To run
You need to obtain your own Twitter API key (free tier is fine) and Base websocket endpoint. After that, create `.env` file following `.env.example` with the required info.

```
 ✗ cd friend-sniper && npm i
 ✗ npm run start

> friend-sniper@1.0.0 start
> nodemon --port 8000

[nodemon] 2.0.22
[nodemon] to restart at any time, enter `rs`
[nodemon] watching path(s): **/*
[nodemon] watching extensions: ts,json
[nodemon] starting `ts-node index.ts --port 8000`
Websocket connected to endpoint ws://127.0.0.1:8545
Subscribed to newPendingTransactions
```

## How it works
L2s technically don't have a public pending transaction pool but op-stack had the pending txn subscription API open to public for a while. That was patched on Aug 22 by this [PR](https://github.com/ethereum-optimism/op-geth/pull/118) so this code is no longer working.

It implements a very naive strategy: snipes 1 share of all new twitter accounts on friend.tech that have > 10k followers, and dump when profit or holding more than 24 hours. Also has very basic persistance for positions.
