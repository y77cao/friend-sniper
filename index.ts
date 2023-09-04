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
    cost: string; // stored as string since BigNumber is not serializable and cannnot be written to file
    createdAt: number;
    twitterUsername: string;
  };
} = {};

const contractAddress = "0xCF205808Ed36593aa40a44F10c7f7C2F67d4A4d4";
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

const saveToFile = (data: object) => {
  fs.writeFileSync(
    `${__dirname}/positions.json`,
    JSON.stringify(data, null, 2)
  );
};

const snipe = async (txInfo: ethers.providers.TransactionResponse) => {
  try {
    const { from: caseSensitiveFrom, to, value } = txInfo;
    // for maybeExit later, we need to check the calldata with this given address
    // which is not case sensitive, so we convert it to lowercase here
    const from = caseSensitiveFrom.toLowerCase();

    if (to !== contractAddress || !value.eq(0)) return;

    const frientTechUserInfo = await friendTechClient.getUserByAddress(from);
    const twitterUserInfo = await twitterClient.getUser(
      frientTechUserInfo.twitterUsername
    );

    if (!twitterUserInfo || twitterUserInfo.follower_count < 10000) return;

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
        createdAt: Date.now(),
        twitterUsername: frientTechUserInfo.twitterUsername,
      };
    }
    positions[from] = {
      shares: positions[from].shares + 1,
      cost: BigNumber.from(positions[from].cost).add(txCost).toString(),
      createdAt: Date.now(),
      twitterUsername: frientTechUserInfo.twitterUsername,
    };
    console.log(
      `Sniped 1 share of user ${frientTechUserInfo.twitterUsername} with cost ${formattedTxCost} ETH`
    );
  } catch (err) {
    console.log(`Snipe failed`, err);
  }
};

const maybeExit = async (txInfo: ethers.providers.TransactionResponse) => {
  try {
    const { from, to, data: txData } = txInfo;
    const subject = `0x${txData.slice(34, 74)}`;
    const holdingSet = new Set(Object.keys(positions));

    if (to !== contractAddress || !holdingSet.has(subject)) return;

    const { shares, cost, createdAt, twitterUsername } = positions[subject];
    const sellPrice: BigNumber = await contract.getSellPriceAfterFee(
      subject,
      shares
    );
    const estimatedGas = await contract.estimateGas.sellShares(subject, shares);
    const gasPrice = await provider.getFeeData();
    const { maxFeePerGas, maxPriorityFeePerGas } = gasPrice;
    const estimatedGasCost = estimatedGas.mul(
      maxFeePerGas.add(maxPriorityFeePerGas)
    );

    const prevCost = BigNumber.from(cost);
    const holdTime = Date.now() - createdAt;
    const oneDay = 1000 * 60 * 60 * 24;
    const delta = sellPrice.sub(prevCost).sub(estimatedGasCost);

    const formattedPreviousCost = ethers.utils.formatEther(prevCost);
    const formattedSellPrice = ethers.utils.formatEther(sellPrice);
    const formattedDelta = ethers.utils.formatEther(delta);
    console.log(
      `Trading activity for ${twitterUsername} detected. Previous perchase cost: ${formattedPreviousCost} ETH. Estimated sell price: ${formattedSellPrice} ETH. Current holding time ${holdTime} ms. Estimated revenue if exit: ${formattedDelta}: ETH.`
    );

    // don't sell if we cannot make any profit and if hold time is less than 1 day
    if (delta.lte(0) && holdTime < oneDay) return;

    const sellTx = await contract.sellShares(subject, shares);
    await sellTx.wait();
    console.log(`Sold shares for ${twitterUsername}`, sellTx);

    delete positions[subject];
  } catch (err) {
    console.log(`maybeExit failed`, err);
  }
};

const main = async () => {
  const savedPositions = await fs.promises.readFile(
    `${__dirname}/positions.json`,
    "utf-8"
  );
  if (savedPositions && savedPositions.length > 0) {
    Object.assign(positions, JSON.parse(savedPositions));
  }

  const requestId = Date.now();

  ws.on("open", () => {
    console.log(`Websocket connected to endpoint ${process.env.BASE_WS_URL}`);

    const subscriptionRequest = {
      jsonrpc: "2.0",
      method: "eth_subscribe",
      params: ["newAcceptedTransactions"],
      id: requestId,
    };

    ws.send(JSON.stringify(subscriptionRequest));
  });

  ws.on("close", () => {
    console.log("Websocket disconnected");
  });

  ws.on("message", async (data) => {
    const { method, params, result, id } = JSON.parse(data.toString());

    if (id === requestId) {
      console.log("Subscribed to newPendingTransactions");
      return;
    }
    if (method !== "eth_subscription") return;

    const hash = params.result;
    const txInfo = await provider.getTransaction(hash);

    if (!txInfo) return;

    const { data: txData } = txInfo;
    const contractMethod = txData.slice(0, 10);

    if (contractMethod === methodSignatures.buyShares) {
      await snipe(txInfo);
    }

    await maybeExit(txInfo);
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
  process.on(eventType, () => {
    saveToFile(positions);
    process.exit(0);
  });
});

main();
