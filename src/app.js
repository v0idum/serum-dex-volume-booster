import {Account, Connection, PublicKey} from '@solana/web3.js';
import {Market} from '@project-serum/serum';

const ownerPrivateKey = []; // address private key, ex: [231, 3213, 3213, ...]

let connection = new Connection('https://solana-api.projectserum.com');

let marketAddress = new PublicKey('EfNw2rVeteCFEjRPaBumGEygTRo8sS1wrVeWyP6W5HTp'); // APPLE/USDC market
let programAddress = new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"); // SERUM DEX Program
let market = await Market.load(connection, marketAddress, {}, programAddress);

const baseTokenAccount = new PublicKey(''); // apple spl-token address
const quoteTokenAccount = new PublicKey(''); // usdc spl-token address
const baseTokenDecimals = 9; // Apple Decimals
const quoteTokenDecimals = 6; // USDC Decimals

const minBaseTokenBalance = 5000; // Min amount in wallet to sell
const minQuoteTokenBalance = 10;  // Min amount in wallet to use to buy

let fundsSettled = false;
let bought = false;
let sold = false;

let owner = new Account(ownerPrivateKey);

const sleep = (milliseconds) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

const getBaseTokenBalance = async () => {
    let accountInfo = await connection.getAccountInfo(baseTokenAccount);
    return market.getSplTokenBalanceFromAccountInfo(accountInfo, baseTokenDecimals);
}

const getQuoteTokenBalance = async () => {
    let accountInfo = await connection.getAccountInfo(quoteTokenAccount);
    return market.getSplTokenBalanceFromAccountInfo(accountInfo, quoteTokenDecimals);
}

const buyOrder = async (price, size) => {
    let buy = await market.placeOrder(connection, {
        owner,
        payer: quoteTokenAccount,
        side: 'buy', // 'buy' or 'sell'
        price,
        size,
        orderType: 'limit', // 'limit', 'ioc', 'postOnly'
    });
    console.log('Buy success:', buy);
}

const sellOrder = async (price, size) => {
    let sell = await market.placeOrder(connection, {
        owner,
        payer: baseTokenAccount,
        side: 'sell', // 'buy' or 'sell'
        price,
        size,
        orderType: 'limit', // 'limit', 'ioc', 'postOnly'
    });
    console.log('Sell success:', sell);
}

const settleFunds = async () => {
    // Settle funds
    for (let openOrders of await market.findOpenOrdersAccountsForOwner(
        connection,
        owner.publicKey,
    )) {
        if (!fundsSettled) {
            console.log('Funds Settling...')
            await market.settleFunds(
                connection,
                owner,
                openOrders,
                // spl-token accounts to which to send the proceeds from trades
                baseTokenAccount,
                quoteTokenAccount,
            );
            fundsSettled = true;
            console.log()
        }
    }

}

const performBuy = async (quoteTokenBalance) => {
    console.log('Placing Buy Order...');
    let asks = await market.loadAsks(connection);
    for (let [price, size] of asks.getL2(10)) {
        if (price * size > quoteTokenBalance) {
            console.log('Price:', price, 'Size:', size);
            let amountToBuy = Math.floor(quoteTokenBalance / price);
            console.log('Amount to buy:', amountToBuy, 'with balance:', quoteTokenBalance);
            await buyOrder(price, amountToBuy);
            fundsSettled = false;
            bought = true;
            sold = false;
            break;
        }
    }
}

const performSell = async (baseTokenBalance) => {
    console.log('Placing Sell Order...');
    let bids = await market.loadBids(connection);
    for (let [price, size] of bids.getL2(10)) {
        if (size > baseTokenBalance) {
            console.log('Price:', price, 'Size:', size);
            console.log('Amount to sell:', baseTokenBalance);
            await sellOrder(price, baseTokenBalance);
            fundsSettled = false;
            bought = false;
            sold = true;
            break;
        }
    }
}

const main = async () => {
    while (true) {
        try {
            let quoteTokenBalance = await getQuoteTokenBalance();
            if (!bought && quoteTokenBalance >= minQuoteTokenBalance) {
                console.log('Quote token balance (USDC):', quoteTokenBalance);
                await performBuy(quoteTokenBalance);
                console.log();
            } else {
                let baseTokenBalance = await getBaseTokenBalance();
                if (!sold && baseTokenBalance >= minBaseTokenBalance) {
                    console.log('Base token balance (APPLE):', baseTokenBalance);
                    await performSell(baseTokenBalance);
                    console.log();
                }
            }
            await sleep(3000);
            await settleFunds();
            await sleep(1000);

        } catch (e) {
            console.warn('Error:', e);
        }
    }
}

const cancelOrders = async () => {
    // Retrieving open orders by owner
    let myOrders = await market.loadOrdersForOwner(connection, owner.publicKey);
    console.log('Open orders:', myOrders);
    // Cancelling orders
    for (let order of myOrders) {
        await market.cancelOrder(connection, owner, order);
    }
}
main().catch(console.error);