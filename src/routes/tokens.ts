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
  uri: string;
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
  { symbol: string; name: string; decimals: number; uri?: string }
> = {
  MythToken1111111111111111111111111111111111: {
    symbol: "MYTH",
    name: "Mythic Token",
    decimals: 9,
  },
  "7sfazeMxmuoDkuU5fHkDGin8uYuaTkZrRSwJM1CHXvDq": {
    symbol: "MYTH",
    name: "Mythic Token",
    decimals: 6,
  },
  FEJa8wGyhXu9Hic1jNTg76Atb57C7jFkmDyDTQZkVwy3: {
    symbol: "wSOL",
    name: "Wrapped SOL",
    decimals: 9,
  },
  "6QTVHn4TUPQSpCH1uGmAK1Vd6JhuSEeKMKSi1F1SZMN": {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  "8Go32n5Pv4HYdML9DNr8ePh4UHunqS9ZgjKMurz1vPSw": {
    symbol: "wBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
  },
  "4zmzPzkexJRCVKSrYCHpmP8TVX6kMobjiFu8dVKtuXGT": {
    symbol: "wETH",
    name: "Wrapped Ethereum",
    decimals: 8,
  },
};

// Launchpad program IDs (V1 vanity + V2 deployed)
const LAUNCHPAD_PROGRAM_IDS = [
  new PublicKey("MythPad111111111111111111111111111111111111"),
  new PublicKey("CLBeDnHqa55wcgYeQwYdFyaG7WXoBdSrJwijA7DUgNy1"),
];

// In-memory cache for launchpad metadata (immutable once created)
const launchpadMetadataCache = new Map<
  string,
  { name: string; symbol: string; uri: string } | null
>();

/**
 * Fetch token metadata from the launchpad program's on-chain TokenLaunch PDA.
 * Tries both V1 and V2 program IDs. Returns null if not a launchpad token.
 */
async function fetchLaunchpadMetadata(
  mintPubkey: PublicKey
): Promise<{ name: string; symbol: string; uri: string } | null> {
  const mintStr = mintPubkey.toBase58();

  // Check in-memory cache first (launchpad metadata is immutable)
  if (launchpadMetadataCache.has(mintStr)) {
    return launchpadMetadataCache.get(mintStr)!;
  }

  for (const programId of LAUNCHPAD_PROGRAM_IDS) {
    try {
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_launch"), mintPubkey.toBuffer()],
        programId
      );

      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo || accountInfo.data.length < 307) continue;

      const data = accountInfo.data;

      // Check is_initialized (offset 0)
      if (data[0] !== 1) continue;

      // Extract token_name: offset 65, 32 bytes, null-padded UTF-8
      const nameBytes = data.subarray(65, 65 + 32);
      const name = Buffer.from(nameBytes)
        .toString("utf8")
        .replace(/\0+$/, "")
        .trim();

      // Extract token_symbol: offset 97, 10 bytes, null-padded UTF-8
      const symbolBytes = data.subarray(97, 97 + 10);
      const symbol = Buffer.from(symbolBytes)
        .toString("utf8")
        .replace(/\0+$/, "")
        .trim();

      // Extract token_uri: offset 107, 200 bytes, null-padded UTF-8
      const uriBytes = data.subarray(107, 107 + 200);
      const uri = Buffer.from(uriBytes)
        .toString("utf8")
        .replace(/\0+$/, "")
        .trim();

      if (name || symbol) {
        const result = {
          name: name || mintStr.slice(0, 8) + "...",
          symbol: symbol || "UNKNOWN",
          uri,
        };
        launchpadMetadataCache.set(mintStr, result);
        return result;
      }
    } catch {
      // PDA doesn't exist or fetch failed, try next program ID
    }
  }

  // Not a launchpad token
  launchpadMetadataCache.set(mintStr, null);
  return null;
}

export async function tokensRoutes(app: FastifyInstance) {
  app.get("/tokens", async (_req, reply) => {
    const cached = cacheGet<TokenInfo[]>("tokens");
    if (cached) return reply.send(cached);

    try {
      // Get all mint accounts from the token program
      const mintAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM, {
        filters: [{ dataSize: 82 }], // Mint account size
      });

      const tokens: TokenInfo[] = await Promise.all(
        mintAccounts.map(async (account) => {
          const mint = account.pubkey.toBase58();
          const known = KNOWN_TOKENS[mint];
          const data = account.account.data;

          // Parse mint account data (Solana Token Program layout)
          // Supply: bytes 36-44 (u64 LE)
          const supply = data.readBigUInt64LE(36);
          const decimals = data[44];

          // Try launchpad metadata as fallback for unknown tokens
          let launchpadMeta: { name: string; symbol: string; uri: string } | null = null;
          if (!known) {
            launchpadMeta = await fetchLaunchpadMetadata(account.pubkey);
          }

          return {
            mint,
            symbol: known?.symbol || launchpadMeta?.symbol || "UNKNOWN",
            name: known?.name || launchpadMeta?.name || mint.slice(0, 8) + "...",
            uri: known?.uri || launchpadMeta?.uri || "",
            supply: supply.toString(),
            decimals: known?.decimals ?? decimals,
            holders: 0, // Would require counting token accounts
            price: 0,
            volume24h: 0,
            liquidity: 0,
          };
        })
      );

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

        // Try launchpad metadata as fallback for unknown tokens
        let launchpadMeta: { name: string; symbol: string; uri: string } | null = null;
        if (!known) {
          launchpadMeta = await fetchLaunchpadMetadata(mintPubkey);
        }

        const result = {
          mint,
          symbol: known?.symbol || launchpadMeta?.symbol || "UNKNOWN",
          name: known?.name || launchpadMeta?.name || mint.slice(0, 8) + "...",
          uri: known?.uri || launchpadMeta?.uri || "",
          supply: supply.toString(),
          decimals: known?.decimals ?? decimals,
          holders: 0,
          price: 0,
          volume24h: 0,
          liquidity: 0,
        };

        // Launchpad metadata is immutable, cache longer (1 hour)
        cacheSet(cacheKey, result, launchpadMeta ? 3_600_000 : 30_000);
        return reply.send(result);
      } catch (err) {
        app.log.error(err, "Failed to fetch token");
        return reply.status(500).send({ error: "Failed to fetch token" });
      }
    }
  );
}
