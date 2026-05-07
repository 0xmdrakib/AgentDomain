import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Pinata IPFS integration for storing agent metadata.
 *
 * The metadata URI we mint into each AgentID NFT points to an IPFS CID
 * via pinata gateway, holding the agent's profile (capabilities, bio, image).
 */

const log = logger.child({ service: 'pinata' });

export interface AgentMetadataDocument {
  name: string;
  description?: string;
  image?: string;
  external_url?: string;
  attributes?: { trait_type: string; value: string | number }[];
  agentdomain?: {
    domain: string;
    basename?: string;
    ensName?: string;
    walletAddress: string;
    capabilities?: string[];
    framework?: string;
    x402Endpoint?: string;
    socials?: Record<string, string>;
  };
}

export class PinataService {
  private readonly jwt: string;
  private readonly gateway = 'https://gateway.pinata.cloud/ipfs';

  constructor() {
    const env = getServerEnv();
    if (!env.PINATA_JWT) {
      throw new Error('PINATA_JWT is not configured');
    }
    this.jwt = env.PINATA_JWT;
  }

  /**
   * Upload a JSON metadata document to IPFS via Pinata.
   * Returns an ipfs:// URI suitable for ERC-721 tokenURI.
   */
  async uploadMetadata(metadata: AgentMetadataDocument, name?: string): Promise<{
    cid: string;
    ipfsUri: string;
    gatewayUrl: string;
  }> {
    const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: { name: name ?? metadata.name ?? 'agent-metadata' },
      }),
    });

    if (!res.ok) {
      throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { IpfsHash: string };
    log.info('metadata uploaded', { cid: body.IpfsHash, name });
    return {
      cid: body.IpfsHash,
      ipfsUri: `ipfs://${body.IpfsHash}`,
      gatewayUrl: `${this.gateway}/${body.IpfsHash}`,
    };
  }

  /**
   * Fetch a metadata document from IPFS via the Pinata gateway.
   */
  async fetchMetadata(cidOrUri: string): Promise<AgentMetadataDocument> {
    const cid = cidOrUri.startsWith('ipfs://') ? cidOrUri.slice(7) : cidOrUri;
    const res = await fetch(`${this.gateway}/${cid}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Pinata fetch failed: ${res.status}`);
    return (await res.json()) as AgentMetadataDocument;
  }
}

let _instance: PinataService | null = null;
export function getPinata(): PinataService {
  if (!_instance) _instance = new PinataService();
  return _instance;
}
