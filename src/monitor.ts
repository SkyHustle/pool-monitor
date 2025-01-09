import { Alchemy, Network, AlchemySubscription } from "alchemy-sdk";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Constants
const USDC_ETH_POOL = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

if (!ALCHEMY_API_KEY) {
    throw new Error("ALCHEMY_API_KEY not found in environment variables");
}

// Uniswap V2 Pool Function Signatures
const FUNCTION_SIGNATURES = {
    SWAP: "0x022c0d9f", // swap(uint amount0Out, uint amount1Out, address to, bytes data)
    ADD_LIQUIDITY: "0xf305d719", // addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline)
    REMOVE_LIQUIDITY: "0xbaa2abde", // removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline)
};

// Configure Alchemy SDK
const config = {
    apiKey: ALCHEMY_API_KEY,
    network: Network.ETH_MAINNET,
};

// Types
interface TransactionData {
    hash: string;
    from: string;
    to: string;
    value: string;
    type: string;
    timestamp: number;
}

class TransactionMonitor {
    private alchemy: Alchemy;

    constructor() {
        this.alchemy = new Alchemy(config);
        this.setupSubscriptions();
    }

    private async setupSubscriptions() {
        console.log("Setting up subscriptions...");

        // Subscribe to pending transactions
        this.alchemy.ws.on(
            {
                method: AlchemySubscription.PENDING_TRANSACTIONS,
                toAddress: USDC_ETH_POOL,
            },
            (tx) => this.handlePendingTransaction(tx)
        );

        console.log("Subscriptions established");
    }

    private getTransactionType(input: string): string {
        const functionSignature = input.slice(0, 10);

        switch (functionSignature) {
            case FUNCTION_SIGNATURES.SWAP:
                return "SWAP";
            case FUNCTION_SIGNATURES.ADD_LIQUIDITY:
                return "ADD_LIQUIDITY";
            case FUNCTION_SIGNATURES.REMOVE_LIQUIDITY:
                return "REMOVE_LIQUIDITY";
            default:
                return "UNKNOWN";
        }
    }

    private handlePendingTransaction(transaction: any) {
        if (transaction.to?.toLowerCase() === USDC_ETH_POOL.toLowerCase()) {
            const txType = this.getTransactionType(transaction.input);

            const txData: TransactionData = {
                hash: transaction.hash,
                from: transaction.from,
                to: transaction.to,
                value: transaction.value,
                type: txType,
                timestamp: Date.now(),
            };

            console.log(`New ${txType} transaction:`, {
                hash: txData.hash,
                from: txData.from,
                value: ethers.formatEther(txData.value),
            });
        }
    }
}

// Start the monitor
const monitor = new TransactionMonitor();
