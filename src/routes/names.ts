import { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

const MYTH_NAMES_PROGRAM = new PublicKey(
  "GCmfmfV8LeVAsWBtHkwGvRU2r2gE37NWnHjMcQFyBV97"
);
const DOMAIN_SEED = Buffer.from("myth_domain");
const DOMAIN_ACCOUNT_SIZE = 205;

interface MythDomain {
  isInitialized: boolean;
  owner: string;
  domain: string;
  metadataUri: string;
  privacyShield: boolean;
  createdSlot: number;
  updatedSlot: number;
}

function deserializeDomain(data: Buffer): MythDomain | null {
  if (data.length < DOMAIN_ACCOUNT_SIZE) return null;

  const isInitialized = data[0] === 1;
  if (!isInitialized) return null;

  const owner = new PublicKey(data.subarray(1, 33)).toBase58();
  const domainBytes = data.subarray(33, 57); // 24 bytes
  const domainLen = data[57];
  const domain = domainBytes.subarray(0, domainLen).toString("utf8");

  const uriBytes = data.subarray(58, 186); // 128 bytes
  const uriLen = data[186];
  const metadataUri = uriBytes.subarray(0, uriLen).toString("utf8");

  const privacyShield = data[187] === 1;
  const createdSlot = Number(data.readBigUInt64LE(188));
  const updatedSlot = Number(data.readBigUInt64LE(196));

  return {
    isInitialized,
    owner,
    domain,
    metadataUri,
    privacyShield,
    createdSlot,
    updatedSlot,
  };
}

export async function namesRoutes(app: FastifyInstance) {
  // Look up a domain by name
  app.get<{ Params: { domain: string } }>(
    "/name/:domain",
    async (req, reply) => {
      let { domain } = req.params;
      domain = domain.toLowerCase().replace(/\.myth$/, "");

      const cacheKey = `name:${domain}`;
      const cached = cacheGet<unknown>(cacheKey);
      if (cached) return reply.send(cached);

      try {
        const [pda] = PublicKey.findProgramAddressSync(
          [DOMAIN_SEED, Buffer.from(domain)],
          MYTH_NAMES_PROGRAM
        );

        const accountInfo = await connection.getAccountInfo(pda);
        if (!accountInfo || !accountInfo.data) {
          return reply.status(404).send({ error: "Domain not found" });
        }

        const parsed = deserializeDomain(Buffer.from(accountInfo.data));
        if (!parsed) {
          return reply.status(404).send({ error: "Domain not initialized" });
        }

        const result = {
          address: pda.toBase58(),
          owner: parsed.owner,
          domain: parsed.domain,
          displayName: `${parsed.domain}.myth`,
          metadataUri: parsed.metadataUri,
          privacyShield: parsed.privacyShield,
          createdSlot: parsed.createdSlot,
          updatedSlot: parsed.updatedSlot,
        };

        cacheSet(cacheKey, result, 60_000);
        return reply.send(result);
      } catch (err) {
        app.log.error(err, "Failed to look up domain");
        return reply.status(500).send({ error: "Failed to look up domain" });
      }
    }
  );

  // Reverse lookup: find domains owned by a wallet
  app.get<{ Params: { wallet: string } }>(
    "/name/owner/:wallet",
    async (req, reply) => {
      const { wallet } = req.params;

      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(wallet);
      } catch {
        return reply.status(400).send({ error: "Invalid wallet address" });
      }

      const cacheKey = `name-owner:${wallet}`;
      const cached = cacheGet<unknown>(cacheKey);
      if (cached) return reply.send(cached);

      try {
        const accounts = await connection.getProgramAccounts(
          MYTH_NAMES_PROGRAM,
          {
            filters: [
              { dataSize: DOMAIN_ACCOUNT_SIZE },
              {
                memcmp: {
                  offset: 1,
                  bytes: pubkey.toBase58(),
                },
              },
            ],
          }
        );

        const domains = accounts
          .map((a) => {
            const parsed = deserializeDomain(Buffer.from(a.account.data));
            if (!parsed) return null;
            return {
              address: a.pubkey.toBase58(),
              domain: parsed.domain,
              displayName: `${parsed.domain}.myth`,
              metadataUri: parsed.metadataUri,
              privacyShield: parsed.privacyShield,
              createdSlot: parsed.createdSlot,
              updatedSlot: parsed.updatedSlot,
            };
          })
          .filter(Boolean);

        cacheSet(cacheKey, domains, 60_000);
        return reply.send(domains);
      } catch (err) {
        app.log.error(err, "Failed to look up domains for wallet");
        return reply
          .status(500)
          .send({ error: "Failed to look up domains for wallet" });
      }
    }
  );

  // List all registered domains
  app.get("/names", async (_req, reply) => {
    const cacheKey = "names:all";
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const accounts = await connection.getProgramAccounts(
        MYTH_NAMES_PROGRAM,
        {
          filters: [{ dataSize: DOMAIN_ACCOUNT_SIZE }],
        }
      );

      const domains = accounts
        .map((a) => {
          const parsed = deserializeDomain(Buffer.from(a.account.data));
          if (!parsed) return null;
          return {
            address: a.pubkey.toBase58(),
            owner: parsed.owner,
            domain: parsed.domain,
            displayName: `${parsed.domain}.myth`,
            metadataUri: parsed.metadataUri,
            privacyShield: parsed.privacyShield,
            createdSlot: parsed.createdSlot,
            updatedSlot: parsed.updatedSlot,
          };
        })
        .filter(Boolean)
        .sort(
          (a, b) => (b?.createdSlot ?? 0) - (a?.createdSlot ?? 0)
        );

      cacheSet(cacheKey, domains, 60_000);
      return reply.send(domains);
    } catch (err) {
      app.log.error(err, "Failed to list domains");
      return reply.status(500).send({ error: "Failed to list domains" });
    }
  });
}
