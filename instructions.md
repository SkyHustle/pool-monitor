**Implement a real-time Ethereum transaction monitoring script using Alchemy’s WebSocket API with the following functionality and optimizations:**

1. **Connect to Alchemy’s WebSocket Endpoint**

    - Use the Alchemy WebSocket URL with your API key.
    - Subscribe to:
        - `alchemy_pendingTransactions` (pre-filtered by the target liquidity pool’s contract USDC/ETH `0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc`)
        - `newHeads` for new block notifications.

2. **Filter and Manage Pending Transactions**

    - Maintain an in-memory `Map<string, TransactionData>` to store and update relevant pending transactions efficiently.
    - Log newly detected pending transactions in real time.
    - Periodically remove stale transactions that remain unconfirmed after a set number of blocks or a time threshold.

3. **Confirm Transactions via Blocks**

    - On each `newHeads` event, use `eth_getBlockByNumber(true)` to fetch the full block.
        - (Optional) If supported, use `alchemy_getAssetTransfers` for more efficient filtering.
    - Compare the block’s transaction hashes to your in-memory pending transactions:
        - For matched transactions, log and remove them from the pending map.
    - Minimize repeated fetching of the same block data, and cache if necessary to avoid redundancy.

4. **Error Handling and Resilience**

    - Implement automatic retries with exponential backoff for:
        - Failed WebSocket connections (re-subscribe to `alchemy_pendingTransactions` and `newHeads`).
        - API request failures (e.g., during `eth_getBlockByNumber` calls).
    - Log errors and retry attempts in real time for transparency.

5. **Concurrency and Non-Blocking Operations**

    - Use asynchronous operations (`async/await`) for both the incoming transaction stream and block confirmation checks.
    - Ensure you do not block the main event loop—handle each event promptly and offload heavier tasks if needed.

6. **Up-to-Date Monitoring and Reporting**

    - Continuously print the current list of pending transactions and their status to the console.
    - Use concise, structured console logs to highlight important events:
        - **New relevant transactions**
        - **Confirmed transactions** when included in blocks
        - **Errors, retries, and reconnection attempts**
    - (Optional) Group logs or output a summary periodically (e.g., “X pending, Y just confirmed”).

7. **Scalability Considerations**
    - If your pool’s traffic increases, consider a lightweight in-memory or external store (e.g., Redis) for better performance.
    - Keep an eye on stale transaction “churn” and maintain a safe memory footprint.

---

## Implementation Requirements

-   **Language & Libraries**: TypeScript with ethers.js
-   **Structure**: Write reusable functions for subscription management, transaction filtering, block confirmation checks, and logging
-   **Comments**: Provide detailed comments explaining each step
-   **Logging**: Keep logs concise but informative, ensuring you have enough detail for debugging and monitoring
