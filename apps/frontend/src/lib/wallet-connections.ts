import type { Config } from 'wagmi';
import { disconnect, getConnections } from 'wagmi/actions';

export async function disconnectWalletConnections(config: Config): Promise<void> {
  let failure: unknown;
  // Disconnecting only the current connector makes wagmi select another active one.
  // One provider may be represented by both an EIP-6963 and a legacy connector.
  for (const { connector } of getConnections(config)) {
    if (!getConnections(config).some((connection) => connection.connector.uid === connector.uid))
      continue;
    try {
      await disconnect(config, { connector });
    } catch (error) {
      failure ??= error;
    }
  }
  if (getConnections(config).length > 0)
    throw failure ?? new Error('The wallet is still connected. Please try again.');
}
