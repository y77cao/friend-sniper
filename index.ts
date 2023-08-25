import { BigNumber, ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import { WebSocket } from "ws";

import FriendTechSharesV1Abi from "./abis/FriendTechSharesV1.json";
import { FriendtechClient } from "./clients/FriendtechClient";
import { TwitterClient } from "./clients/TwitterClient";
import { methodSignatures } from "./constants";

dotenv.config({ path: `${__dirname}/.env` });

const positions: {
  [address: string]: {
    shares: number;
    cost: string; // stored as string since BigNumber is not serializable and can be written to file
  };
} = {};

const contractAddress = "0xCF205808Ed36593aa40a44F10c7f7C2F67d4A4d4"; // "0x8aAC5570d54306Bb395bf2385ad327b7b706016b"
const provider = new ethers.providers.WebSocketProvider(
  process.env.BASE_WS_URL
);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(
  contractAddress,
  FriendTechSharesV1Abi,
  signer
);
const friendTechClient = new FriendtechClient();
const twitterClient = new TwitterClient();
const ws = new WebSocket(process.env.BASE_WS_URL);

const saveToFile = async (data: object) => {
  try {
    await fs.promises.writeFile(
      `${__dirname}/positions.json`,
      JSON.stringify(data, null, 2),
      { flag: "a+" } // append or create
    );
  } catch (err) {
    console.log(`Save to file failed`, err);
  }
};

const snipe = async (txInfo: ethers.providers.TransactionResponse) => {
  const { from, to, value } = txInfo;

  if (to !== contractAddress || !value.eq(0)) return;

  const frientTechUserInfo = await friendTechClient.getUserByAddress(from);
  const twitterUserInfo = await twitterClient.getUser(
    frientTechUserInfo.twitterUsername
  );

  if (!twitterUserInfo || twitterUserInfo.follower_count < 10) return;

  console.log(
    "Actionable account",
    JSON.stringify(
      {
        ...txInfo,
        ...frientTechUserInfo,
        followerCount: twitterUserInfo.followers_count,
      },
      null,
      2
    )
  );

  const cost = await contract.getBuyPriceAfterFee(from, 1);
  const formattedCost = ethers.utils.formatEther(cost);
  console.log(
    `Estimate cost to snipe user ${frientTechUserInfo.twitterUsername}: `,
    formattedCost
  );

  if (Number(formattedCost) >= 0.01) {
    console.log(`Cost too high: ${formattedCost} ETH, skipping`);
    return;
  }

  try {
    const buyTx = await contract.buyShares(from, 1, {
      value: cost,
    });
    const receipt = await buyTx.wait();
    const txCost = receipt.gasUsed.mul(receipt.effectiveGasPrice).add(cost);
    const formattedTxCost = ethers.utils.formatEther(txCost);

    if (!positions[from]) {
      positions[from] = {
        shares: 0,
        cost: "0",
      };
    }
    positions[from] = {
      shares: positions[from].shares + 1,
      cost: BigNumber.from(positions[from].cost).add(txCost).toString(),
    };

    console.log(
      `Sniped 1 share of user ${frientTechUserInfo.twitterUsername} with cost ${formattedTxCost} ETH`
    );
  } catch (err) {
    console.log(`Snipe failed`, err);
  }
};

const maybeExit = async (txInfo: ethers.providers.TransactionResponse) => {
  const { from, to, data: txData } = txInfo;
  // const sellTx = await contract.sellShares(from, 1);
  // await sellTx.wait();
  // console.log("sellTx", sellTx);
};

const main = async () => {
  const savedPositions = await fs.promises.readFile(
    `${__dirname}/positions.json`,
    "utf-8"
  );
  if (savedPositions) {
    Object.assign(positions, JSON.parse(savedPositions));
  }

  ws.on("open", () => {
    console.log("Websocket connected to node");

    const subscriptionRequest = {
      jsonrpc: "2.0",
      method: "eth_subscribe",
      params: ["newPendingTransactions"],
      id: 1,
    };

    ws.send(JSON.stringify(subscriptionRequest));

    console.log("Subscribed to newPendingTransactions");
  });

  ws.on("close", () => {
    console.log("Websocket disconnected");
  });

  ws.on("message", async (data) => {
    const { method, params } = JSON.parse(data.toString());
    if (method !== "eth_subscription") return;

    const hash = params.result;
    const txInfo = await provider.getTransaction(hash);
    if (!txInfo) return;

    const { data: txData } = txInfo;
    const contractMethod = txData.slice(0, 10);

    if (contractMethod === methodSignatures.buyShares) {
      await snipe(txInfo);
      await maybeExit(txInfo);
    } else if (contractMethod === methodSignatures.sellShares) {
      await maybeExit(txInfo);
    }
  });
};

[
  `exit`,
  `SIGINT`,
  `SIGUSR1`,
  `SIGUSR2`,
  `uncaughtException`,
  `SIGTERM`,
].forEach((eventType) => {
  process.on(eventType, async () => {
    await saveToFile(positions);
    process.exit(0);
  });
});

main();
