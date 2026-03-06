import { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

const RPC_URL = process.env.L2_RPC_URL || "http://127.0.0.1:8899";

/**
 * Raw RPC helper – bypasses @solana/web3.js so we can call methods
 * that the JS SDK does not expose or that have Frankendancer quirks.
 */
async function rawRpc(method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

/**
 * Alias routes so the explorer frontend can use /blocks, /blocks/:slot,
 * /transactions/:signature, /accounts/:address, and /supply
 */
export async function aliasRoutes(app: FastifyInstance) {

  // ───────────────────────────────────────────────
  //  GET /blocks  →  recent confirmed blocks
  //  Works on Frankendancer via getBlocksWithLimit + getBlockTime
  // ───────────────────────────────────────────────
  app.get<{
    Querystring: { limit?: string; before?: string };
  }>("/blocks", async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const beforeSlot = req.query.before
      ? parseInt(req.query.before, 10)
      : undefined;

    try {
      const currentSlot = beforeSlot ?? (await connection.getSlot());
      const cacheKey = `blocks:${currentSlot}:${limit}`;

      const cached = cacheGet<unknown[]>(cacheKey);
      if (cached) return reply.send(cached);

      // Get confirmed slot numbers (works on Frankendancer)
      const startSlot = Math.max(0, currentSlot - limit * 2);
      const confirmedSlots: number[] = await rawRpc("getBlocksWithLimit", [startSlot, limit * 2, { commitment: "confirmed" }]);

      // Take the most recent `limit` slots in reverse order
      const recentSlots = confirmedSlots
        .filter((s) => s <= currentSlot)
        .slice(-limit)
        .reverse();

      // Fetch block time for each slot in parallel
      const blocks: unknown[] = [];
      const batchSize = 10;

      for (let i = 0; i < recentSlots.length && blocks.length < limit; i += batchSize) {
        const batch = recentSlots.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (slot) => {
            // Try getBlock first (full data)
            try {
              const block = await connection.getBlock(slot, {
                maxSupportedTransactionVersion: 0,
                transactionDetails: "full",
                rewards: false,
              });
              if (block) {
                return {
                  slot,
                  blockTime: block.blockTime,
                  txCount: block.transactions.length,
                  leader: null,
                  hash: block.blockhash,
                };
              }
            } catch {
              // getBlock not available on Frankendancer
            }

            // Fallback: getBlockTime (may return null on fddev)
            let blockTime: number | null = null;
            try {
              blockTime = await rawRpc("getBlockTime", [slot]);
            } catch {
              // getBlockTime not available
            }

            // If blockTime is null, estimate from slot rate (~0.4s per slot)
            if (blockTime === null) {
              const now = Math.floor(Date.now() / 1000);
              blockTime = now - Math.round((currentSlot - slot) * 0.4);
            }

            return {
              slot,
              blockTime,
              txCount: 1,
              leader: null,
              hash: "",
            };
          })
        );

        for (const r of results) {
          if (r && blocks.length < limit) blocks.push(r);
        }
      }

      cacheSet(cacheKey, blocks);
      return reply.send(blocks);
    } catch (err) {
      app.log.error(err, "Failed to fetch blocks");
      return reply.status(500).send({ error: "Failed to fetch blocks" });
    }
  });

  // ───────────────────────────────────────────────
  //  GET /blocks/:slot  →  single block detail
  // ───────────────────────────────────────────────
  app.get<{ Params: { slot: string } }>("/blocks/:slot", async (req, reply) => {
    const slot = parseInt(req.params.slot, 10);
    if (isNaN(slot)) {
      return reply.status(400).send({ error: "Invalid slot number" });
    }

    const cacheKey = `block:${slot}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return reply.send(cached);

    try {
      // Try getBlock first
      try {
        const block = await connection.getBlock(slot, {
          maxSupportedTransactionVersion: 0,
          transactionDetails: "full",
          rewards: false,
        });
        if (block) {
          const transactions = block.transactions.map((tx) => {
            const sig = tx.transaction.signatures[0];
            return {
              signature: sig,
              fee: tx.meta?.fee ?? 0,
              status: tx.meta?.err ? "failed" : "success",
              accounts: tx.transaction.message
                .getAccountKeys()
                .staticAccountKeys.map((k) => k.toBase58()),
            };
          });

          const result = {
            slot,
            blockTime: block.blockTime,
            transactions,
            parentSlot: block.parentSlot,
            blockhash: block.blockhash,
          };

          cacheSet(cacheKey, result);
          return reply.send(result);
        }
      } catch {
        // Frankendancer fallback below
      }

      // Fallback: get block time + try to find transactions at this slot
      let blockTime = await rawRpc("getBlockTime", [slot]).catch(() => null);
      // fddev may return null for getBlockTime - estimate from slot rate
      if (blockTime === null) {
        const currentSlot = await connection.getSlot();
        blockTime = Math.floor(Date.now() / 1000) - Math.round((currentSlot - slot) * 0.4);
      }

      // Try to get vote signatures for this slot
      let transactions: any[] = [];
      try {
        const voteAccounts = await connection.getVoteAccounts();
        if (voteAccounts.current.length > 0) {
          const votePubkey = new PublicKey(voteAccounts.current[0].votePubkey);
          const sigs = await connection.getSignaturesForAddress(votePubkey, { limit: 20 });
          transactions = sigs
            .filter((s) => s.slot === slot)
            .map((s) => ({
              signature: s.signature,
              fee: 0,
              status: s.err ? "failed" : "success",
              accounts: [],
            }));
        }
      } catch {
        // Best effort
      }

      const result = {
        slot,
        blockTime,
        transactions,
        parentSlot: slot > 0 ? slot - 1 : 0,
        blockhash: "",
      };

      cacheSet(cacheKey, result);
      return reply.send(result);
    } catch (err) {
      app.log.error(err, "Failed to fetch block");
      return reply.status(500).send({ error: "Failed to fetch block" });
    }
  });

  // ───────────────────────────────────────────────
  //  GET /transactions/:signature
  // ───────────────────────────────────────────────
  app.get<{ Params: { signature: string } }>(
    "/transactions/:signature",
    async (req, reply) => {
      const { signature } = req.params;

      const cacheKey = `tx:${signature}`;
      const cached = cacheGet<unknown>(cacheKey);
      if (cached) return reply.send(cached);

      try {
        // Try getTransaction (may return null on Frankendancer)
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx) {
          // On Frankendancer, getTransaction returns null. Return minimal info
          // by searching signatures from vote accounts
          try {
            const voteAccounts = await connection.getVoteAccounts();
            for (const va of voteAccounts.current) {
              const votePk = new PublicKey(va.votePubkey);
              const sigs = await connection.getSignaturesForAddress(votePk, { limit: 100 });
              const match = sigs.find((s) => s.signature === signature);
              if (match) {
                const result = {
                  signature,
                  slot: match.slot,
                  blockTime: match.blockTime,
                  status: match.err ? "failed" : "success",
                  fee: 0,
                  instructions: [],
                  accounts: [va.votePubkey],
                  logs: [],
                  note: "Limited data: Frankendancer does not support getTransaction for historical blocks",
                };
                cacheSet(cacheKey, result, 60_000);
                return reply.send(result);
              }
            }
          } catch {
            // Best effort
          }
          return reply.status(404).send({ error: "Transaction not found" });
        }

        const accounts = tx.transaction.message
          .getAccountKeys()
          .staticAccountKeys.map((k) => k.toBase58());

        const instructions = tx.transaction.message.compiledInstructions.map(
          (ix) => ({
            programId: accounts[ix.programIdIndex] || "unknown",
            accounts: ix.accountKeyIndexes.map((i) => accounts[i] || "unknown"),
            data: Buffer.from(ix.data).toString("base64"),
          })
        );

        const result = {
          signature,
          slot: tx.slot,
          blockTime: tx.blockTime,
          status: tx.meta?.err ? "failed" : "success",
          fee: tx.meta?.fee ?? 0,
          instructions,
          accounts,
          logs: tx.meta?.logMessages ?? [],
        };

        cacheSet(cacheKey, result, 60_000);
        return reply.send(result);
      } catch (err) {
        app.log.error(err, "Failed to fetch transaction");
        return reply.status(500).send({ error: "Failed to fetch transaction" });
      }
    }
  );

  // ───────────────────────────────────────────────
  //  GET /accounts/:address
  // ───────────────────────────────────────────────
  app.get<{ Params: { address: string } }>(
    "/accounts/:address",
    async (req, reply) => {
      const { address } = req.params;

      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(address);
      } catch {
        return reply.status(400).send({ error: "Invalid address" });
      }

      const cacheKey = `account:${address}`;
      const cached = cacheGet<unknown>(cacheKey);
      if (cached) return reply.send(cached);

      try {
        const info = await connection.getAccountInfo(pubkey);
        if (!info) {
          return reply.send({
            address,
            lamports: 0,
            owner: "11111111111111111111111111111111",
            executable: false,
            data: "",
            tokenAccounts: [],
          });
        }

        let tokenAccounts: unknown[] = [];
        try {
          const tokenProgramId = new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          );
          const tokens = await connection.getTokenAccountsByOwner(pubkey, {
            programId: tokenProgramId,
          });
          tokenAccounts = tokens.value.map((ta) => ({
            address: ta.pubkey.toBase58(),
            lamports: ta.account.lamports,
          }));
        } catch {
          // Token program may not exist
        }

        const result = {
          address,
          lamports: info.lamports,
          owner: info.owner.toBase58(),
          executable: info.executable,
          data:
            info.data.length > 1024
              ? `<${info.data.length} bytes>`
              : info.data.toString("base64"),
          tokenAccounts,
        };

        cacheSet(cacheKey, result);
        return reply.send(result);
      } catch (err) {
        app.log.error(err, "Failed to fetch account");
        return reply.status(500).send({ error: "Failed to fetch account" });
      }
    }
  );

  // ───────────────────────────────────────────────
  //  GET /accounts/:address/transactions
  // ───────────────────────────────────────────────
  app.get<{
    Params: { address: string };
    Querystring: { limit?: string; before?: string };
  }>("/accounts/:address/transactions", async (req, reply) => {
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const before = req.query.before || undefined;

    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(address);
    } catch {
      return reply.status(400).send({ error: "Invalid address" });
    }

    const cacheKey = `account-txs:${address}:${limit}:${before || "latest"}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const sigs = await connection.getSignaturesForAddress(pubkey, {
        limit,
        before: before || undefined,
      });

      const txs = sigs.map((sig) => ({
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime ?? null,
        status: sig.err ? "failed" : "success",
      }));

      cacheSet(cacheKey, txs);
      return reply.send(txs);
    } catch (err) {
      app.log.error(err, "Failed to fetch account transactions");
      return reply
        .status(500)
        .send({ error: "Failed to fetch account transactions" });
    }
  });

  // ───────────────────────────────────────────────
  //  GET /supply  →  MYTH token supply info
  // ───────────────────────────────────────────────
  app.get("/supply", async (_req, reply) => {
    const cached = cacheGet<unknown>("supply");
    if (cached) return reply.send(cached);

    try {
      const solSupply = await connection.getSupply();

      let mythSupply = {
        total: "0",
        circulating: "0",
        decimals: 6,
        mint: "7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq",
      };

      try {
        const mythMint = new PublicKey(
          "7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq"
        );
        const mintInfo = await connection.getAccountInfo(mythMint);
        if (mintInfo && mintInfo.data.length >= 82) {
          const supply = mintInfo.data.readBigUInt64LE(36);
          mythSupply.total = supply.toString();
          mythSupply.circulating = supply.toString();
        }
      } catch {
        // MYTH token may not be initialized
      }

      // On L2, native SOL = MYTH. Include human-readable supply.
      const LAMPORTS_PER_SOL = 1_000_000_000;
      const result = {
        nativeSupply: {
          total: solSupply.value.total,
          circulating: solSupply.value.circulating,
          nonCirculating: solSupply.value.nonCirculating,
          totalMyth: Math.round(solSupply.value.total / LAMPORTS_PER_SOL),
          circulatingMyth: Math.round(solSupply.value.circulating / LAMPORTS_PER_SOL),
        },
        myth: mythSupply,
      };

      cacheSet("supply", result, 30_000);
      return reply.send(result);
    } catch (err) {
      app.log.error(err, "Failed to fetch supply");
      return reply.status(500).send({ error: "Failed to fetch supply" });
    }
  });
}
