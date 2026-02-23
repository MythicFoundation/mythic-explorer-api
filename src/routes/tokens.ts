import { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  supply: string;
  decimals: number;
  holders: number;
  price: number;
  volume24h: number;
  liquidity: number;
}

// Known token metadata (L2 tokens don't have on-chain metadata programs yet)
const KNOWN_TOKENS: Record<
  string,
  { symbol: string; name: string; decimals: number }
> = {
  MythToken1111111111111111111111111111111111: {
    symbol: "MYTH",
    name: "Mythic Token",
    decimals: 9,
  },
};

export async function tokensRoutes(app: FastifyInstance) {
  app.get("/tokens", async (_req, reply) => {
    const cached = cacheGet<TokenInfo[]>("tokens");
    if (cached) return reply.send(cached);

    try {
      // Get all mint accounts from the token program
      const mintAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM, {
        filters: [{ dataSize: 82 }], // Mint account size
      });

      const tokens: TokenInfo[] = mintAccounts.map((account) => {
        const mint = account.pubkey.toBase58();
        const known = KNOWN_TOKENS[mint];
        const data = account.account.data;

        // Parse mint account data (Solana Token Program layout)
        // Supply: bytes 36-44 (u64 LE)
        const supply = data.readBigUInt64LE(36);
        const decimals = data[44];

        return {
          mint,
          symbol: known?.symbol || "UNKNOWN",
          name: known?.name || mint.slice(0, 8) + "...",
          supply: supply.toString(),
          decimals: known?.decimals ?? decimals,
          holders: 0, // Would require counting token accounts
          price: 0,
          volume24h: 0,
          liquidity: 0,
        };
      });

      cacheSet("tokens", tokens, 30_000); // Cache 30s
      return reply.send(tokens);
    } catch (err) {
      app.log.error(err, "Failed to fetch tokens");
      return reply.status(500).send({ error: "Failed to fetch tokens" });
    }
  });

  app.get<{ Params: { mint: string } }>(
    "/token/:mint",
    async (req, reply) => {
      const { mint } = req.params;

      let mintPubkey: PublicKey;
      try {
        mintPubkey = new PublicKey(mint);
      } catch {
        return reply.status(400).send({ error: "Invalid mint address" });
      }

      const cacheKey = `token:${mint}`;
      const cached = cacheGet<unknown>(cacheKey);
      if (cached) return reply.send(cached);

      try {
        const info = await connection.getAccountInfo(mintPubkey);
        if (!info || info.data.length < 82) {
          return reply.status(404).send({ error: "Token mint not found" });
        }

        const known = KNOWN_TOKENS[mint];
        const supply = info.data.readBigUInt64LE(36);
        const decimals = info.data[44];

        const result = {
          mint,
          symbol: known?.symbol || "UNKNOWN",
          name: known?.name || mint.slice(0, 8) + "...",
          supply: supply.toString(),
          decimals: known?.decimals ?? decimals,
          holders: 0,
          price: 0,
          volume24h: 0,
          liquidity: 0,
        };

        cacheSet(cacheKey, result, 30_000);
        return reply.send(result);
      } catch (err) {
        app.log.error(err, "Failed to fetch token");
        return reply.status(500).send({ error: "Failed to fetch token" });
      }
    }
  );
}
